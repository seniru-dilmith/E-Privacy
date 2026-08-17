import os
import re
import mermaidx
from mermaidx.raster import render_png as _render_png

# Ensure the output directory exists
output_dir = ""
os.makedirs(output_dir, exist_ok=True)


THEME_VARIABLES = {
    }

RENDER_CONFIG = {"theme": "base", "themeVariables": THEME_VARIABLES}


def _fix_gantt_gridlines(svg_text, top_margin=40):
    """mermaid's gantt renderer computes the vertical gridline length from a
    default barHeight/barGap, not from the overridden values passed in the
    render config, so with taller custom bars the gridlines fall short of
    the chart's actual top and only cover the lower rows. Stretch them back
    to the full chart height by rewriting the shared y2 length they all use.
    """
    m = re.search(
        r'<g class="grid" transform="translate\(([\d.]+), ([\d.]+)\)"[^>]*>.*?y2="(-?[\d.]+)"',
        svg_text,
        re.S,
    )
    if not m:
        return svg_text
    axis_y = float(m.group(2))
    old_y2 = m.group(3)
    new_y2 = -(axis_y - top_margin)
    return svg_text.replace(f'y2="{old_y2}"', f'y2="{new_y2}"')


def render_and_save(name, source, scale=3.0, extra_config=None, svg_fixup=None):
    print(f"Rendering {name} ...")
    config = dict(RENDER_CONFIG)
    if extra_config:
        config = {**config, **extra_config}
    diagram = mermaidx.render(source, theme="base", config=config)
    if svg_fixup is not None:
        svg_text = svg_fixup(diagram.svg())
        png_bytes = _render_png(svg_text, scale=scale, background="#ffffff")
    else:
        png_bytes = diagram.png(scale=scale, background="#ffffff")
    out_path = os.path.join(output_dir, name)
    with open(out_path, "wb") as f:
        f.write(png_bytes)
    print(f"  -> saved {out_path} ({len(png_bytes)/1024:.1f} KB)")


# ---------------------------------------------------------------------------
# 1. Architecture Diagram
# ---------------------------------------------------------------------------
architecture_mermaid = f"""

"""
render_and_save("", )


print("\nAll diagrams generated successfully.")
