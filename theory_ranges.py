import math


MIN_WEBER_NUMBER = 1.0
MAX_WEBER_NUMBER = 1e3
MIN_OHNESORGE_NUMBER = 1e-3
MAX_OHNESORGE_NUMBER = 1e2

THEORY_RANGE_ERROR = (
    "Theory is valid only for "
    "1 <= We <= 10^3 and 10^-3 <= Oh <= 10^2."
)


def validate_theory_inputs(weber_number, ohnesorge_number):
    if not math.isfinite(weber_number) or not math.isfinite(ohnesorge_number):
        return 'Inputs must be finite'
    if weber_number <= 0 or ohnesorge_number <= 0:
        return 'Inputs must be positive'
    if not (MIN_WEBER_NUMBER <= weber_number <= MAX_WEBER_NUMBER):
        return THEORY_RANGE_ERROR
    if not (MIN_OHNESORGE_NUMBER <= ohnesorge_number <= MAX_OHNESORGE_NUMBER):
        return THEORY_RANGE_ERROR
    return None
