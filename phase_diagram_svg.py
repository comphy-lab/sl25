import io
from typing import Optional

import numpy as np
from matplotlib.backends.backend_svg import FigureCanvasSVG
from matplotlib.figure import Figure
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
from matplotlib.ticker import LogFormatterMathtext


MIN_WE = 1.0
MAX_WE = 1_000.0
MIN_OH = 1e-3
MAX_OH = 1e2


THEMES = {
    "light": {
        "figure_face": "#fffdfa",
        "axes_face": "#fffdfa",
        "frame": "#d4cabb",
        "grid": "#d9d1c6",
        "text": "#2b261f",
        "axis": "#6f6559",
        "regime_i_fill": "#d9efe3",
        "regime_ii_fill": "#d7e4fa",
        "regime_iii_fill": "#f5eec8",
        "regime_iv_fill": "#f4d6d7",
        "boundary": "#5d998e",
        "point": "#117c52",
        "point_ring": "#7dbba0",
    },
    "dark": {
        "figure_face": "#1a1822",
        "axes_face": "#211d2b",
        "frame": "#3a3244",
        "grid": "#4a4658",
        "text": "#f0ecf4",
        "axis": "#cdc5d8",
        "regime_i_fill": "#2f4b43",
        "regime_ii_fill": "#314564",
        "regime_iii_fill": "#67522d",
        "regime_iv_fill": "#67394b",
        "boundary": "#d4a0da",
        "point": "#7ec8a0",
        "point_ring": "#c084c8",
    },
}


def render_phase_diagram_svg(
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

    axes.grid(True, which="major", color=palette["grid"], linewidth=0.9, alpha=0.45)
    axes.grid(False, which="minor")

    axes.fill_between(
        we_values,
        MIN_OH,
        np.clip(lower_boundary, MIN_OH, MAX_OH),
        where=lower_boundary > MIN_OH,
        color=palette["regime_i_fill"],
        zorder=1,
    )
    axes.fill_between(
        we_values,
        np.clip(lower_boundary, MIN_OH, MAX_OH),
        np.clip(middle_boundary, MIN_OH, MAX_OH),
        where=middle_boundary > np.clip(lower_boundary, MIN_OH, MAX_OH),
        color=palette["regime_ii_fill"],
        zorder=1,
    )
    axes.fill_between(
        we_values,
        np.clip(middle_boundary, MIN_OH, MAX_OH),
        np.clip(upper_boundary, MIN_OH, MAX_OH),
        where=upper_boundary > np.clip(middle_boundary, MIN_OH, MAX_OH),
        color=palette["regime_iii_fill"],
        zorder=1,
    )
    axes.fill_between(
        we_values,
        np.clip(upper_boundary, MIN_OH, MAX_OH),
        MAX_OH,
        where=MAX_OH > np.clip(upper_boundary, MIN_OH, MAX_OH),
        color=palette["regime_iv_fill"],
        zorder=1,
    )

    axes.plot(we_values, lower_boundary, color=palette["boundary"], linestyle=(0, (4, 3)), linewidth=1.2, zorder=2)
    axes.plot(we_values, middle_boundary, color=palette["boundary"], linestyle=(0, (4, 3)), linewidth=1.2, zorder=2)
    axes.plot(we_values, upper_boundary, color=palette["boundary"], linestyle=(0, (4, 3)), linewidth=1.2, zorder=2)

    axes.text(2.2, 1.2e-2, r"$\mathrm{I}$", color=palette["axis"], fontsize=14, ha="left", va="center")
    axes.text(5.5, 1.5e-1, r"$\mathrm{II}$", color=palette["axis"], fontsize=14, ha="center", va="center")
    axes.text(28, 2.0, r"$\mathrm{III}$", color=palette["axis"], fontsize=14, ha="center", va="center")
    axes.text(320, 18, r"$\mathrm{IV}$", color=palette["axis"], fontsize=14, ha="center", va="center")

    if (
        weber_number is not None
        and ohnesorge_number is not None
        and MIN_WE <= weber_number <= MAX_WE
        and MIN_OH <= ohnesorge_number <= MAX_OH
    ):
        axes.scatter(
            [weber_number],
            [ohnesorge_number],
            s=220,
            color=palette["point_ring"],
            alpha=0.28,
            linewidths=0,
            zorder=3,
        )
        axes.scatter(
            [weber_number],
            [ohnesorge_number],
            s=36,
            color=palette["point"],
            zorder=4,
        )

    axes.set_xlabel(r"$We$", color=palette["axis"], fontsize=14, labelpad=14)
    axes.set_ylabel(r"$Oh$", color=palette["axis"], fontsize=14, labelpad=10)
    axes.tick_params(axis="both", which="major", colors=palette["axis"], labelsize=11)
    axes.tick_params(axis="both", which="minor", length=0)
    axes.xaxis.set_major_formatter(LogFormatterMathtext(base=10))
    axes.yaxis.set_major_formatter(LogFormatterMathtext(base=10))

    legend_handles = [
        Patch(facecolor=palette["regime_i_fill"], edgecolor="none", label=r"$\mathrm{Regime\ I}$"),
        Patch(facecolor=palette["regime_ii_fill"], edgecolor="none", label=r"$\mathrm{Regime\ II}$"),
        Patch(facecolor=palette["regime_iii_fill"], edgecolor="none", label=r"$\mathrm{Regime\ III}$"),
        Patch(facecolor=palette["regime_iv_fill"], edgecolor="none", label=r"$\mathrm{Regime\ IV}$"),
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
                markersize=7,
                label=r"$\mathrm{Your\ input}$",
            )
        )

    legend = axes.legend(
        handles=legend_handles,
        frameon=False,
        loc="upper left",
        bbox_to_anchor=(1.02, 1.0),
        handlelength=1.0,
        handletextpad=0.45,
        labelspacing=1.05,
        borderaxespad=0.0,
        fontsize=11,
    )
    for text in legend.get_texts():
        text.set_color(palette["text"])

    buffer = io.StringIO()
    FigureCanvasSVG(figure).print_svg(buffer)
    svg_markup = buffer.getvalue()
    return svg_markup.replace("<svg ", '<svg role="img" aria-label="Weber-Ohnesorge phase diagram" ')
