import os
import re
import mermaidx
from mermaidx.raster import render_png as _render_png

# Ensure the output directory exists
output_dir = "sources/srs"
os.makedirs(output_dir, exist_ok=True)


THEME_VARIABLES = {
    "primaryColor": "#cde2fb",
    "primaryTextColor": "#0b0b0b",
    "primaryBorderColor": "#2a78d6",
    "lineColor": "#52514e",
    "secondaryColor": "#fde8dc",
    "secondaryBorderColor": "#eb6834",
    "tertiaryColor": "#d9f2e8",
    "tertiaryBorderColor": "#1baf7a",
    "fontFamily": "Helvetica, Arial, sans-serif",
    "fontSize": "16px",
    "actorBkg": "#cde2fb",
    "actorBorder": "#2a78d6",
    "actorTextColor": "#0b0b0b",
    "signalColor": "#52514e",
    "signalTextColor": "#0b0b0b",
    "labelBoxBkgColor": "#fde8dc",
    "labelBoxBorderColor": "#eb6834",
    "noteBkgColor": "#fdf2d0",
    "noteBorderColor": "#eda100",
    "activationBorderColor": "#2a78d6",
    "activationBkgColor": "#e9f2fc",
    "sequenceNumberColor": "#ffffff",
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
# 1. High-Level System Architecture
# ---------------------------------------------------------------------------
architecture_mermaid = """
flowchart TB
    subgraph OWNER["Data Owner Domain (Trusted)"]
        RAW[("Raw Sensitive\\nDataset")]
        KMS["Key Management\\n(Keypair Generation)"]
        ENC["Local Encryption\\nClient"]
        DEC["Local Decryption &\\nVerification Client"]
        RAW --> ENC
        KMS -. "public key" .-> ENC
        KMS -. "private key" .-> DEC
    end

    subgraph CLOUD["Cloud Analytics Engine (Untrusted Compute)"]
        GW["API Gateway &\\nAccess Control"]
        STORE[("Ciphertext\\nData Store")]
        HCE["Homomorphic Compute\\nEngine (PHE / Paillier)"]
        AUDIT["Verifiable Computation\\n& Audit Log"]
        GW --> STORE
        STORE --> HCE
        HCE --> AUDIT
    end

    ENC -- "TLS 1.3: Ciphertext Upload" --> GW
    AUDIT -- "TLS 1.3: Encrypted Result" --> DEC

    classDef trusted fill:#d9f2e8,stroke:#1baf7a,stroke-width:1.5px;
    classDef untrusted fill:#fde8dc,stroke:#eb6834,stroke-width:1.5px;
    class OWNER trusted
    class CLOUD untrusted
"""
render_and_save("system-architecture.png", architecture_mermaid)


# ---------------------------------------------------------------------------
# 2. End-to-End Data Flow (Sequence Diagram)
# ---------------------------------------------------------------------------
sequence_mermaid = """
sequenceDiagram
    autonumber
    actor Owner as Data Owner
    participant KMS as Key Management
    participant GW as API Gateway
    participant HCE as Homomorphic Compute Engine
    participant Audit as Audit Log

    Owner->>KMS: Generate keypair (public, private)
    Owner->>Owner: Encrypt raw records locally
    Owner->>GW: Upload ciphertext + query request
    GW->>GW: Authenticate & authorize request
    GW->>HCE: Forward ciphertext for aggregation
    HCE->>HCE: Homomorphic sum / average (no decryption)
    HCE->>Audit: Log computation proof & metadata
    HCE-->>GW: Encrypted result
    GW-->>Owner: Return encrypted result
    Owner->>Owner: Decrypt locally with private key
    Owner->>Audit: Verify computation proof
"""
render_and_save("data-flow-sequence.png", sequence_mermaid)


# ---------------------------------------------------------------------------
# 3. Component / Module Breakdown
# ---------------------------------------------------------------------------
component_mermaid = """
flowchart LR
    subgraph INGEST["Ingestion Layer"]
        A1["Ingestion &\\nEncryption Module"]
    end
    subgraph CORE["Core Engine"]
        B1["Access Control &\\nPolicy Engine"]
        B2["Homomorphic\\nComputation Engine"]
        B3["Verifiable Computation\\n& Audit Module"]
    end
    subgraph SUPPORT["Support Services"]
        C1["Key Management\\nService (HSM-backed)"]
        C2["Monitoring &\\nAdmin Dashboard"]
    end
    subgraph OUT["Delivery Layer"]
        D1["Result Delivery &\\nDecryption Module"]
    end

    A1 --> B1 --> B2 --> B3 --> D1
    C1 -. keys .-> A1
    C1 -. keys .-> D1
    C2 -. metrics/logs .-> B1
    C2 -. metrics/logs .-> B2
    C2 -. metrics/logs .-> B3

    classDef layer fill:#cde2fb,stroke:#2a78d6,stroke-width:1.5px;
    class INGEST,CORE,SUPPORT,OUT layer
"""
render_and_save("component-breakdown.png", component_mermaid)


# ---------------------------------------------------------------------------
# 4. Requirements Prioritization (Impact vs. Implementation Effort)
# ---------------------------------------------------------------------------
quadrant_mermaid = """
quadrantChart
    title Functional Requirement Prioritization
    x-axis Low Effort --> High Effort
    y-axis Low Impact --> High Impact
    quadrant-1 Plan Carefully
    quadrant-2 Do First
    quadrant-3 Reconsider
    quadrant-4 Quick Wins
    Homomorphic Aggregation: [0.75, 0.9]
    Local Key Management: [0.35, 0.85]
    Access Control - RBAC: [0.3, 0.6]
    Audit & Verifiability Log: [0.55, 0.7]
    TLS Data-in-Transit: [0.15, 0.4]
    Result Decryption Client: [0.2, 0.65]
    Admin Monitoring Dashboard: [0.4, 0.3]
    Multi-Key-Length Support: [0.6, 0.4]
"""
render_and_save("requirements-priority.png", quadrant_mermaid)


print("\nAll diagrams generated successfully.")
