import os
import re
import mermaidx
from mermaidx.raster import render_png as _render_png

# Each diagram is saved under sources/<subfolder>/, one subfolder per deliverable
sources_root = "sources"
for _subfolder in ("srs", "crypto-design", "verifiability"):
    os.makedirs(os.path.join(sources_root, _subfolder), exist_ok=True)


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


def render_and_save(subfolder, name, source, scale=3.0, extra_config=None, svg_fixup=None):
    print(f"Rendering {subfolder}/{name} ...")
    config = dict(RENDER_CONFIG)
    if extra_config:
        config = {**config, **extra_config}
    diagram = mermaidx.render(source, theme="base", config=config)
    if svg_fixup is not None:
        svg_text = svg_fixup(diagram.svg())
        png_bytes = _render_png(svg_text, scale=scale, background="#ffffff")
    else:
        png_bytes = diagram.png(scale=scale, background="#ffffff")
    out_path = os.path.join(sources_root, subfolder, name)
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
render_and_save("srs", "system-architecture.png", architecture_mermaid)


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
render_and_save("srs", "data-flow-sequence.png", sequence_mermaid)


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
render_and_save("srs", "component-breakdown.png", component_mermaid)


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
render_and_save("srs", "requirements-priority.png", quadrant_mermaid)


# ---------------------------------------------------------------------------
# 5. Cryptographic Techniques by Data State (Deliverable 3)
# ---------------------------------------------------------------------------
crypto_states_mermaid = """
flowchart LR
    subgraph REST["Data at Rest (Data Owner)"]
        R1[("Raw Dataset")]
        R2[("Locally Encrypted\\nDataset Store")]
        R1 -- "AES-256-GCM" --> R2
    end

    subgraph TRANSIT1["Data in Transit (Upload)"]
        T1["Local Encryption\\nClient"]
        T2["API Gateway"]
        T1 -- "TLS 1.3\\nECDHE + AES-256-GCM" --> T2
    end

    subgraph USE["Data in Use (Cloud)"]
        U1[("Ciphertext\\nData Store")]
        U2["Homomorphic Compute\\nEngine"]
        U1 -- "Paillier PHE\\n(n = 2048-bit)" --> U2
    end

    subgraph TRANSIT2["Data in Transit (Result)"]
        S1["Audit / Result\\nSigning"]
        S2["Local Decryption\\nClient"]
        S1 -- "TLS 1.3\\nECDSA-P256 signed" --> S2
    end

    R2 --> T1
    T2 --> U1
    U2 --> S1
    S2 -.-> R1

    classDef state fill:#cde2fb,stroke:#2a78d6,stroke-width:1.5px;
    class REST,TRANSIT1,USE,TRANSIT2 state
"""
render_and_save("crypto-design", "crypto-per-data-state.png", crypto_states_mermaid)


# ---------------------------------------------------------------------------
# 6. Verifiability: Computation Bulletin Board (Deliverable 4)
# ---------------------------------------------------------------------------
verifiability_mermaid = """
sequenceDiagram
    autonumber
    actor Contributor as Record Owner
    participant Ingest as Ingestion Module
    participant BB as Computation Bulletin Board
    participant HCE as Homomorphic Compute Engine
    actor Auditor as Independent Auditor

    Contributor->>Ingest: Submit encrypted record
    Ingest->>BB: Publish record hash as Merkle leaf
    BB-->>Contributor: Inclusion proof (receipt)
    Note over Contributor,BB: Individual Verifiability:<br/>contributor checks own leaf is included

    Ingest->>HCE: Forward committed ciphertext set
    HCE->>HCE: Homomorphic aggregation (ciphertext product)
    HCE->>BB: Publish computation transcript,<br/>Merkle root & signed result hash

    Auditor->>BB: Fetch Merkle root, transcript, signature
    Auditor->>Auditor: Recompute ciphertext product<br/>& verify signature
    Note over Auditor,BB: Universal Verifiability:<br/>anyone can confirm result matches<br/>the published, committed ciphertext set
"""
render_and_save("verifiability", "verifiability-bulletin-board.png", verifiability_mermaid)


print("\nAll diagrams generated successfully.")
