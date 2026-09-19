import io
from functools import lru_cache
from typing import Optional

import numpy as np
from matplotlib import rc_context
from matplotlib.backends.backend_svg import FigureCanvasSVG
from matplotlib.figure import Figure
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
from matplotlib.ticker import LogFormatterMathtext


MIN_WE = 1.0
MAX_WE = 1_000.0
MIN_OH = 1e-3
MAX_OH = 1e2


# Palette drawn from the CoMPhy Lab design tokens (static/tokens.css) so the
# server-rendered figure sits on the same paper/ink surfaces as the page.
# Regime fills run cool to warm through the brand hues: teal (I), brand blue
# (II), brand purple (III), coral (IV). Matplotlib accepts #RRGGBBAA.
THEMES = {
    "light": {
        "figure_face": "#fffdf9",      # --c-surface-strong
        "axes_face": "#fffdf9",
        "frame": "#0f0c082e",          # --c-border-strong
        "grid": "#0f0c08",             # --fg-strong at grid_alpha
        "text": "#1f1a15",             # --fg-1
        "axis": "#625648",             # --fg-2
        "regime_i_fill": "#254c4a",    # --c-accent-teal
        "regime_ii_fill": "#0056b3",   # --c-brand-blue
        "regime_iii_fill": "#68236d",  # --c-brand-purple
        "regime_iv_fill": "#cf4900",   # --c-accent-coral
        "boundary": "#625648",         # --fg-2
        "point": "#254c4a",            # --c-accent-teal
        "point_ring": "#254c4a",
        "fill_alpha": 0.16,
        "grid_alpha": 0.09,
    },
    "dark": {
        "figure_face": "#1c1915",      # --c-surface-strong (dark)
        "axes_face": "#1c1915",
        "frame": "#f8f4ec29",          # --c-border-strong (dark)
        "grid": "#f8f4ec",             # --fg-strong (dark) at grid_alpha
        "text": "#e6dfd0",             # --fg-1 (dark)
        "axis": "#e6dfd0",
        "regime_i_fill": "#6ac2bd",    # --c-accent-teal (dark)
        "regime_ii_fill": "#8fb8ff",   # dark-theme link blue used by tokens.css
        "regime_iii_fill": "#d99adc",  # dark-theme chip--brand ink used by tokens.css
        "regime_iv_fill": "#ff9966",   # dark-theme chip--coral ink used by tokens.css
        "boundary": "#9a8e7d",         # --fg-2 (dark)
        "point": "#6ac2bd",            # --c-accent-teal (dark)
        "point_ring": "#6ac2bd",
        "fill_alpha": 0.24,
        "grid_alpha": 0.08,
    },
}


@lru_cache(maxsize=256)
def _render_phase_diagram_svg_cached(
    *,
    theme: str = "light",
    weber_number: Optional[float] = None,
    ohnesorge_number: Optional[float] = None,
) -> str:
    palette = THEMES["dark" if theme == "dark" else "light"]
    we_values = np.logspace(0, 3, 600)
    lower_boundary = we_values ** -2
    middle_boundary = we_values ** -0.75
    upper_boundary = np.sqrt(we_values)

    with rc_context(
        {
            "font.family": "STIXGeneral",
            "mathtext.fontset": "stix",
            "svg.fonttype": "path",
        }
    ):
        figure = Figure(figsize=(9.2, 6.9), dpi=100)
        figure.patch.set_facecolor(palette["figure_face"])
        figure.set_layout_engine("tight")
        figure.subplots_adjust(left=0.10, right=0.74, bottom=0.14, top=0.96)

        axes = figure.add_subplot(111)
        axes.set_facecolor(palette["axes_face"])
        axes.set_xscale("log")
        axes.set_yscale("log")
        axes.set_xlim(MIN_WE, MAX_WE)
        axes.set_ylim(MIN_OH, MAX_OH)
        axes.set_box_aspect(1)

        for spine in axes.spines.values():
            spine.set_color(palette["frame"])
            spine.set_linewidth(1.1)

        axes.grid(True, which="major", color=palette["grid"], linewidth=0.9, alpha=palette["grid_alpha"])
        axes.grid(False, which="minor")

        axes.fill_between(
            we_values,
            MIN_OH,
            np.clip(lower_boundary, MIN_OH, MAX_OH),
            where=lower_boundary > MIN_OH,
            color=palette["regime_i_fill"],
            alpha=palette["fill_alpha"],
            zorder=1,
        )
        axes.fill_between(
            we_values,
            np.clip(lower_boundary, MIN_OH, MAX_OH),
            np.clip(middle_boundary, MIN_OH, MAX_OH),
            where=middle_boundary > np.clip(lower_boundary, MIN_OH, MAX_OH),
            color=palette["regime_ii_fill"],
            alpha=palette["fill_alpha"],
            zorder=1,
        )
        axes.fill_between(
            we_values,
            np.clip(middle_boundary, MIN_OH, MAX_OH),
            np.clip(upper_boundary, MIN_OH, MAX_OH),
            where=upper_boundary > np.clip(middle_boundary, MIN_OH, MAX_OH),
            color=palette["regime_iii_fill"],
            alpha=palette["fill_alpha"],
            zorder=1,
        )
        axes.fill_between(
            we_values,
            np.clip(upper_boundary, MIN_OH, MAX_OH),
            MAX_OH,
            where=MAX_OH > np.clip(upper_boundary, MIN_OH, MAX_OH),
            color=palette["regime_iv_fill"],
            alpha=palette["fill_alpha"],
            zorder=1,
        )

        axes.plot(we_values, lower_boundary, color=palette["boundary"], linestyle=(0, (4, 3)), linewidth=1.25, zorder=2)
        axes.plot(we_values, middle_boundary, color=palette["boundary"], linestyle=(0, (4, 3)), linewidth=1.25, zorder=2)
        axes.plot(we_values, upper_boundary, color=palette["boundary"], linestyle=(0, (4, 3)), linewidth=1.25, zorder=2)

        axes.text(2.5, 1.5e-2, r"$\mathrm{I}$", color=palette["axis"], fontsize=22.5, ha="left", va="center")
        axes.text(7.8, 1.4e-1, r"$\mathrm{II}$", color=palette["axis"], fontsize=22.5, ha="center", va="center")
        axes.text(42, 2.1, r"$\mathrm{III}$", color=palette["axis"], fontsize=22.5, ha="center", va="center")
        axes.text(520, 38, r"$\mathrm{IV}$", color=palette["axis"], fontsize=22.5, ha="center", va="center")

        if (
            weber_number is not None
            and ohnesorge_number is not None
            and MIN_WE <= weber_number <= MAX_WE
            and MIN_OH <= ohnesorge_number <= MAX_OH
        ):
            axes.scatter(
                [weber_number],
                [ohnesorge_number],
                s=260,
                color=palette["point_ring"],
                alpha=0.34,
                linewidths=0,
                zorder=3,
            )
            axes.scatter(
                [weber_number],
                [ohnesorge_number],
                s=42,
                color=palette["point"],
                zorder=4,
            )

        axes.set_xlabel(r"$We$", color=palette["axis"], fontsize=21, labelpad=15)
        axes.set_ylabel(r"$Oh$", color=palette["axis"], fontsize=21, labelpad=13)
        axes.tick_params(axis="both", which="major", colors=palette["axis"], labelsize=16)
        axes.tick_params(axis="both", which="minor", length=0)
        axes.xaxis.set_major_formatter(LogFormatterMathtext(base=10))
        axes.yaxis.set_major_formatter(LogFormatterMathtext(base=10))

        legend_handles = [
            Patch(facecolor=palette["regime_i_fill"], edgecolor="none", alpha=palette["fill_alpha"], label=r"$\mathrm{Regime\ I}$"),
            Patch(facecolor=palette["regime_ii_fill"], edgecolor="none", alpha=palette["fill_alpha"], label=r"$\mathrm{Regime\ II}$"),
            Patch(facecolor=palette["regime_iii_fill"], edgecolor="none", alpha=palette["fill_alpha"], label=r"$\mathrm{Regime\ III}$"),
            Patch(facecolor=palette["regime_iv_fill"], edgecolor="none", alpha=palette["fill_alpha"], label=r"$\mathrm{Regime\ IV}$"),
        ]
        if weber_number is not None and ohnesorge_number is not None:
            legend_handles.append(
                Line2D(
                    [0],
                    [0],
                    marker="o",
                    linestyle="None",
                    markerfacecolor=palette["point"],
                    markeredgecolor=palette["point"],
                    markersize=9,
                    label=r"$\mathrm{Your\ input}$",
                )
            )

        legend = axes.legend(
            handles=legend_handles,
            frameon=False,
            loc="upper left",
            bbox_to_anchor=(1.02, 1.0),
            handlelength=1.0,
            handletextpad=0.5,
            labelspacing=1.15,
            borderaxespad=0.0,
            fontsize=16,
        )
        for text in legend.get_texts():
            text.set_color(palette["text"])

        buffer = io.StringIO()
        FigureCanvasSVG(figure).print_svg(buffer)
        svg_markup = buffer.getvalue()

    return svg_markup.replace("<svg ", '<svg role="img" aria-label="Weber-Ohnesorge phase diagram" ')


def render_phase_diagram_svg(
    *,
    theme: str = "light",
    weber_number: Optional[float] = None,
    ohnesorge_number: Optional[float] = None,
) -> str:
    return _render_phase_diagram_svg_cached(
        theme=theme,
        weber_number=weber_number,
        ohnesorge_number=ohnesorge_number,
    )
