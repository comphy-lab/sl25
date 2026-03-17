#!/usr/bin/env python3
"""Standalone BetaMax predictor from a saved best_model.json file.

Export this script together with ``SLtheory_model.json`` and run:

    python3 SLtheory_prediction.py --oh 1e-3 --we 450

The script uses only the Python standard library.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

LN10 = math.log(10.0)
MAX_EXP_ARGUMENT = 700.0


def _safe_exp(value: float) -> float:
    return math.exp(max(-MAX_EXP_ARGUMENT, min(MAX_EXP_ARGUMENT, value)))


def _positive_power(base: float, exponent: float) -> float:
    return _safe_exp(exponent * math.log(base))


def _cutoff_denominator(
    oh: float,
    we: float,
    log10_scale: float,
    we_exponent: float,
    oh_exponent: float,
    outer_exponent: float,
) -> float:
    ratio_log = math.log(oh) - (log10_scale * LN10) - we_exponent * math.log(we)
    transition = _safe_exp(oh_exponent * ratio_log)
    return _safe_exp(outer_exponent * math.log1p(transition))


def _product_denominator(
    oh: float,
    we: float,
    log10_scale: float,
    oh_exponent: float,
    we_exponent: float,
    outer_exponent: float,
) -> float:
    interaction = _safe_exp(
        log10_scale * LN10 + oh_exponent * math.log(oh) + we_exponent * math.log(we)
    )
    return _safe_exp(outer_exponent * math.log1p(interaction))


def _power_amplitude(we: float, amplitude: float, exponent: float) -> float:
    return amplitude * _positive_power(we, exponent)


def _powered_saturation_amplitude(
    we: float,
    amplitude: float,
    exponent: float,
    outer_exponent: float,
) -> float:
    scaled = amplitude * _positive_power(we, exponent)
    return math.expm1(outer_exponent * math.log1p(scaled))


def _sqrt_saturation_amplitude(we: float, amplitude: float, exponent: float) -> float:
    return math.sqrt(1.0 + amplitude * _positive_power(we, exponent)) - 1.0


def _baseline_term(
    we: float,
    oh: float,
    amplitude: float,
    we_exponent: float,
    oh_exponent: float,
) -> float:
    return (
        amplitude
        * _positive_power(we, we_exponent)
        / (1.0 + _positive_power(oh, oh_exponent))
    )


def _viscous_branch(
    we: float,
    oh: float,
    amplitude: float,
    we_exponent: float,
    oh_exponent: float,
    log10_scale: float,
    outer_exponent: float,
) -> float:
    scaled_oh = (10.0**log10_scale) * _positive_power(oh, oh_exponent)
    return (
        amplitude
        * _positive_power(we, we_exponent)
        / _positive_power(1.0 + scaled_oh, outer_exponent)
    )


def _model_power_cutoff_ratio(params: dict[str, float], we: float, oh: float) -> float:
    amp = _power_amplitude(we, params["A"], params["b"])
    den = _cutoff_denominator(
        oh, we, params["log10_C"], params["d"], params["e"], params["f"]
    )
    return 1.0 + amp / den


def _model_powered_sat_cutoff_ratio(
    params: dict[str, float], we: float, oh: float
) -> float:
    amp = _powered_saturation_amplitude(we, params["A"], params["b"], params["g"])
    den = _cutoff_denominator(
        oh, we, params["log10_C"], params["d"], params["e"], params["f"]
    )
    return 1.0 + amp / den


def _model_sqrt_sat_cutoff_ratio(
    params: dict[str, float], we: float, oh: float
) -> float:
    amp = _sqrt_saturation_amplitude(we, params["A"], params["b"])
    den = _cutoff_denominator(
        oh, we, params["log10_C"], params["d"], params["e"], params["f"]
    )
    return 1.0 + amp / den


def _model_powered_sat_product_ratio(
    params: dict[str, float], we: float, oh: float
) -> float:
    amp = _powered_saturation_amplitude(we, params["A"], params["b"], params["g"])
    den = _product_denominator(
        oh, we, params["log10_Q"], params["e"], params["d"], params["f"]
    )
    return 1.0 + amp / den


def _model_powered_sat_cutoff_outerexp(
    params: dict[str, float], we: float, oh: float
) -> float:
    amp = _powered_saturation_amplitude(we, params["A"], params["b"], params["g"])
    den = _cutoff_denominator(
        oh, we, params["log10_C"], params["d"], params["e"], params["f"]
    )
    return _positive_power(1.0 + amp / den, params["h"])


def _model_powered_sat_cutoff_plus_baseline(
    params: dict[str, float], we: float, oh: float
) -> float:
    amp = _powered_saturation_amplitude(we, params["A"], params["b"], params["g"])
    den = _cutoff_denominator(
        oh, we, params["log10_C"], params["d"], params["e"], params["f"]
    )
    base = _baseline_term(we, oh, params["A_v"], params["p_v"], params["q_v"])
    return 1.0 + base + amp / den


def _model_two_branch_additive(params: dict[str, float], we: float, oh: float) -> float:
    viscous = _viscous_branch(
        we,
        oh,
        params["A_mu"],
        params["p_mu"],
        params["q_mu"],
        params["log10_B_mu"],
        params["r_mu"],
    )
    capillary_amp = _powered_saturation_amplitude(
        we, params["A_sigma"], params["p_sigma"], params["g_sigma"]
    )
    capillary_den = _cutoff_denominator(
        oh, we, params["log10_C"], params["d"], params["e"], params["f"]
    )
    return 1.0 + viscous + capillary_amp / capillary_den


MODEL_FUNCTIONS = {
    "power_cutoff_ratio": _model_power_cutoff_ratio,
    "powered_sat_cutoff_ratio": _model_powered_sat_cutoff_ratio,
    "sqrt_sat_cutoff_ratio": _model_sqrt_sat_cutoff_ratio,
    "powered_sat_product_ratio": _model_powered_sat_product_ratio,
    "powered_sat_cutoff_outerexp": _model_powered_sat_cutoff_outerexp,
    "powered_sat_cutoff_plus_baseline": _model_powered_sat_cutoff_plus_baseline,
    "two_branch_additive": _model_two_branch_additive,
}


def load_model_payload(model_json: str | Path) -> dict[str, object]:
    path = Path(model_json)
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise TypeError("Model JSON must contain an object at the top level.")
    return payload


def predict_beta_from_payload(
    payload: dict[str, object], *, oh: float, we: float
) -> float:
    model_name = str(payload["model"])
    parameters = payload["parameters"]
    if not isinstance(parameters, dict):
        raise TypeError("Model JSON is missing a 'parameters' object.")
    if model_name not in MODEL_FUNCTIONS:
        raise KeyError(f"Unsupported model '{model_name}' in saved JSON.")
    if oh <= 0.0 or we <= 0.0:
        raise ValueError("Oh and We must both be positive.")

    parameter_map = {str(key): float(value) for key, value in parameters.items()}
    return float(MODEL_FUNCTIONS[model_name](parameter_map, we, oh))


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Predict BetaMax from We and Oh.")
    parser.add_argument("--oh", type=float, required=True, help="Ohnesorge number.")
    parser.add_argument("--we", type=float, required=True, help="Weber number.")
    parser.add_argument(
        "--model-json",
        default="SLtheory_model.json",
        help="Path to saved model JSON. Defaults to SLtheory_model.json.",
    )
    parser.add_argument(
        "--value-only",
        action="store_true",
        help="Print only the numeric BetaMax value.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_arguments()
    payload = load_model_payload(args.model_json)
    beta = predict_beta_from_payload(payload, oh=args.oh, we=args.we)
    if args.value_only:
        print(f"{beta:.12g}")
    else:
        print(f"predBeta(Oh={args.oh:g}, We={args.we:g}) = {beta:.6f}")


if __name__ == "__main__":
    main()
