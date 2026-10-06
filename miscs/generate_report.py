"""Builds the E-Privacy implementation report.

Run from anywhere:  python3 miscs/generate_report.py

Writes the Mermaid sources and rendered diagrams to miscs/diagrams/, cropped
screen captures to miscs/screens/, and the report to
miscs/E-Privacy_Implementation_Report.pdf. Code listings and the schema are
read from the live source tree, which keeps them in step with the code.
"""
import re
from pathlib import Path

import mermaidx
from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.platypus import (
    CondPageBreak, Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate,
    Spacer, Table, TableStyle, XPreformatted,
)

ROOT = Path(__file__).resolve().parent.parent
IMPL = ROOT / "Implementation"
OUT = ROOT / "miscs"
DIAGRAMS = OUT / "diagrams"
SCREENS = OUT / "screens"
PDF = OUT / "E-Privacy_Implementation_Report.pdf"

TEAM_NAME = ""  # fill in to print it on the title page
MEMBERS = [("Dilmith D. L. S.", "220123C"), ("Hansana O. G. V.", "220211U"), ("Vidyananda H. K. H.", "220666R")]

# ---------------------------------------------------------------------------
# fonts and styles
# ---------------------------------------------------------------------------
FONT_DIR = Path("/usr/share/fonts/truetype")
for name, file in {
    "Serif": "liberation/LiberationSerif-Regular.ttf",
    "Serif-Bold": "liberation/LiberationSerif-Bold.ttf",
    "Serif-Italic": "liberation/LiberationSerif-Italic.ttf",
    "Sans": "liberation/LiberationSans-Regular.ttf",
    "Sans-Bold": "liberation/LiberationSans-Bold.ttf",
    "Mono": "dejavu/DejaVuSansMono.ttf",
    "Mono-Bold": "dejavu/DejaVuSansMono-Bold.ttf",
}.items():
    pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / file)))
pdfmetrics.registerFontFamily("Serif", normal="Serif", bold="Serif-Bold", italic="Serif-Italic", boldItalic="Serif-Bold")

INK = colors.HexColor("#1b1d20")
MUTED = colors.HexColor("#5a6068")
ACCENT = colors.HexColor("#0f6b5c")
RULE = colors.HexColor("#c9ccd1")
CODE_BG = colors.HexColor("#f4f5f7")

body = ParagraphStyle("body", fontName="Serif", fontSize=10.5, leading=14.5, textColor=INK,
                      alignment=TA_JUSTIFY, spaceAfter=6)
bullet = ParagraphStyle("bullet", parent=body, leftIndent=14, bulletIndent=4, spaceAfter=3)
h1 = ParagraphStyle("h1", fontName="Sans-Bold", fontSize=16, leading=20, textColor=INK, spaceBefore=14, spaceAfter=8, keepWithNext=1)
h2 = ParagraphStyle("h2", fontName="Sans-Bold", fontSize=12, leading=15, textColor=INK, spaceBefore=10, spaceAfter=5, keepWithNext=1)
caption = ParagraphStyle("caption", fontName="Serif-Italic", fontSize=9, leading=11.5, textColor=MUTED,
                         alignment=TA_CENTER, spaceBefore=4, spaceAfter=12)
listing_title = ParagraphStyle("lt", fontName="Sans-Bold", fontSize=8.5, leading=11, textColor=ACCENT, spaceBefore=6, spaceAfter=8)
code = ParagraphStyle("code", fontName="Mono", fontSize=6.9, leading=8.6, textColor=INK, backColor=CODE_BG,
                      borderPadding=(5, 6, 5, 6), leftIndent=6, rightIndent=6, spaceBefore=2, spaceAfter=12)
cell = ParagraphStyle("cell", fontName="Serif", fontSize=9, leading=11.5, textColor=INK)
cell_head = ParagraphStyle("cellh", fontName="Sans-Bold", fontSize=8.5, leading=11, textColor=INK)

PAGE_W, PAGE_H = A4
MARGIN = 22 * mm
TEXT_W = PAGE_W - 2 * MARGIN

# Every bit of prose goes through P() or the tables, which lets check_prose()
# scan it for the punctuation and words the report avoids.
PROSE = []


def P(text, style=body):
    PROSE.append(text)
    return Paragraph(text, style)


def bullets(items):
    out = []
    for t in items:
        PROSE.append(t)
        out.append(Paragraph(t, bullet, bulletText="\u2022"))
    return out


def table(rows, widths, head=True):
    PROSE.extend(str(c) for r in rows for c in r)
    data = [[Paragraph(str(c), cell_head if head and i == 0 else cell) for c in r] for i, r in enumerate(rows)]
    t = Table(data, colWidths=[w * TEXT_W for w in widths], repeatRows=1 if head else 0)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 1.1, INK),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


figure_no = 0
listing_no = 0


def figure(path, text, max_h=200 * mm, width=1.0):
    global figure_no
    figure_no += 1
    with PILImage.open(path) as im:
        w, h = im.size
    draw_w = TEXT_W * width
    draw_h = draw_w * h / w
    if draw_h > max_h:
        draw_w, draw_h = draw_w * max_h / draw_h, max_h
    return KeepTogether([Image(str(path), width=draw_w, height=draw_h),
                         P(f"Figure {figure_no}. {text}", caption)])


def listing(title, text):
    global listing_no
    listing_no += 1
    # The report avoids long dashes everywhere, including quoted code.
    text = text.replace("—", ",").replace("–", "to").rstrip()
    # Hard wrap long lines; the continuation is marked and indented.
    width = 108
    wrapped = []
    for line in text.splitlines():
        while len(line) > width:
            wrapped.append(line[:width] + " \u21b5")
            line = "        " + line[width:]
        wrapped.append(line)
    text = "\n".join(wrapped)
    esc = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return [CondPageBreak(40 * mm),
            Paragraph(f"Listing {listing_no}. {title}", listing_title),
            XPreformatted(esc, code)]


def snippet(rel, start, end=None, include_end=True):
    """Lines of a source file from the first line containing `start` to the
    next line containing `end` (or to the end of the file)."""
    lines = (IMPL / rel).read_text().splitlines()
    i = next(n for n, l in enumerate(lines) if start in l)
    if end is None:
        return "\n".join(lines[i:])
    j = next(n for n in range(i + 1, len(lines)) if end in lines[n])
    return "\n".join(lines[i:j + 1 if include_end else j])


# ---------------------------------------------------------------------------
# diagrams
# ---------------------------------------------------------------------------
THEME = {
    "theme": "base",
    "themeVariables": {
        "primaryColor": "#e3efe9", "primaryBorderColor": "#0f6b5c", "primaryTextColor": "#1b1d20",
        "secondaryColor": "#e4e8f3", "secondaryBorderColor": "#33498f",
        "tertiaryColor": "#f6f3ec", "tertiaryBorderColor": "#a39a85",
        "lineColor": "#55595f", "fontFamily": "Helvetica, Arial, sans-serif", "fontSize": "15px",
        "actorBkg": "#e3efe9", "actorBorder": "#0f6b5c", "signalColor": "#55595f",
        "noteBkgColor": "#fbf4dc", "noteBorderColor": "#c79a1e",
        "labelBoxBkgColor": "#e4e8f3", "labelBoxBorderColor": "#33498f",
    },
}

MERMAID = {
"architecture": """
flowchart TB
    subgraph OWNER["Data owner domain (trusted)"]
        direction LR
        CSV["Source dataset<br/>CSV file"]
        UI1["Web UI<br/>owner pages"]
        AG["Owner agent<br/>Express"]
        WP["Worker thread pool<br/>Paillier encrypt and decrypt"]
        KS["Key store<br/>one keypair per campaign"]
        UI1 --> AG
        CSV --> AG
        AG <--> WP
        AG <--> KS
    end
    subgraph CLOUD["Cloud domain (untrusted)"]
        direction LR
        GW["Gateway<br/>roles, policy, query log"]
        CE["Compute engine<br/>product of ciphertexts mod n squared"]
        BB["Bulletin board<br/>hash chain, P256 signatures"]
        DB["MySQL<br/>ciphertext, labels, board"]
        GW --> CE
        GW --> BB
        CE --> DB
        BB --> DB
        GW --> DB
    end
    subgraph PUB["Public"]
        AU["Auditor browser<br/>Web Worker replays every check"]
    end
    AG -- "public key, ciphertext, coarse labels" --> GW
    GW -- "signed receipts and signed results" --> AG
    AU -- "reads board and ciphertext" --> GW
    classDef trusted fill:#e3efe9,stroke:#0f6b5c
    classDef untrusted fill:#e4e8f3,stroke:#33498f
    class OWNER trusted
    class CLOUD untrusted
""",

"deployment": """
flowchart TB
    USER(["Browser"]) -->|"port WEB_PORT"| WEB
    subgraph EDGE["Docker network: edge"]
        WEB["web<br/>nginx serving the Vue build<br/>proxies /api/owner and /api/cloud"]
        OWN["owner<br/>Node 22, port 4000<br/>holds CSV and private keys"]
    end
    subgraph CNET["Docker network: cloud_net"]
        CLD["cloud<br/>Node 22, port 5000<br/>signing key volume"]
        SQL["mysql<br/>MySQL 8.4<br/>schema.sql on first start"]
    end
    WEB --> OWN
    WEB --> CLD
    OWN -->|"HTTP API only"| CLD
    CLD --> SQL
    OWN --- V1[["volume owner_keys"]]
    CLD --- V2[["volume cloud_keys"]]
    SQL --- V3[["volume mysql_data"]]
""",

"campaign_sequence": """
sequenceDiagram
    autonumber
    actor U as Data owner
    participant A as Owner agent
    participant W as Worker pool
    participant C as Cloud gateway
    participant B as Bulletin board
    U->>A: POST /campaigns (rows, key length, measures)
    A->>A: drop identifiers
    A->>A: generate Paillier keypair
    A->>C: open campaign with public key n, g
    C->>B: append campaign_opened
    A->>W: encrypt every measure (and its square)
    W-->>A: ciphertexts
    A->>W: decrypt 1 percent as a spot check
    W-->>A: plaintexts match the source rows
    loop batches of 250 records
        A->>C: labels and packed ciphertext
        C-->>A: leaf hash per record
        A->>A: compare with own leaf hashes
    end
    A->>C: commit
    C->>B: append batch_committed (Merkle root, count)
    C-->>A: signed receipt
    A->>A: own root equals signed root, signature verifies
    A-->>U: campaign ready
""",

"query_sequence": """
sequenceDiagram
    autonumber
    actor U as Data owner
    participant A as Owner agent
    participant C as Cloud gateway
    participant E as Compute engine
    participant B as Bulletin board
    U->>A: analyse (group by, measures)
    A->>C: POST /campaigns/:id/query
    C->>E: group records, multiply ciphertexts mod n squared
    E-->>C: encrypted sums, input root, groups under k withheld
    C->>B: append query_result (signed)
    C-->>A: signed board entry
    A->>C: fetch the same entry from the board
    A->>A: check signature, board copy, input root, record count
    A->>A: decrypt sums and recover r
    A->>A: recompute sums from local plaintext
    alt all five checks hold
        A->>C: publish m and r for every sum
        C->>B: append decryption_published
        A-->>U: statistics and charts
    else any check fails
        A-->>U: result rejected, nothing shown
    end
""",

"audit_flow": """
flowchart TB
    S(["Auditor presses Run all four checks"]) --> K["Fetch board signing key<br/>and every board entry"]
    K --> C1["1. Log integrity<br/>sequence, links, hashes, signatures"]
    C1 --> R["For each campaign:<br/>fetch all published ciphertext"]
    R --> C2["2. Input set<br/>rebuilt Merkle root equals receipt<br/>and every query used that root"]
    C2 --> C3["3. Computation<br/>product of member ciphertexts<br/>equals each published sum C"]
    C3 --> C4["4. Decryption<br/>g to the m times r to the n<br/>equals C mod n squared"]
    C4 --> D(["Report: holds or list of failures"])
    classDef check fill:#e4e8f3,stroke:#33498f
    class C1,C2,C3,C4 check
""",

"merkle": """
flowchart BT
    L0["leaf 0<br/>H(0, labels, ciphertext)"] --> N01["H(1, leaf 0, leaf 1)"]
    L1["leaf 1"] --> N01
    L2["leaf 2"] --> N23["H(1, leaf 2, leaf 3)"]
    L3["leaf 3"] --> N23
    L4["leaf 4"] --> N4["leaf 4 carried up unchanged"]
    N01 --> N03["H(1, left, right)"]
    N23 --> N03
    N03 --> ROOT["Merkle root<br/>signed in the receipt"]
    N4 --> ROOT
    classDef root fill:#e3efe9,stroke:#0f6b5c,stroke-width:2px
    class ROOT root
""",

"erd": """
erDiagram
    users ||--o{ sessions : "signs in with"
    campaigns ||--o{ records : "holds"
    campaigns ||..o{ board : "described by"
    campaigns ||..o{ query_log : "referenced by"
    users {
        int id PK
        varchar username UK
        enum role "owner, auditor, admin"
        varchar pass_hash "scrypt"
    }
    sessions {
        char token PK "64 hex"
        int user_id FK
        datetime expires_at
    }
    campaigns {
        int id PK
        varchar name
        smallint key_bits
        text n "public modulus"
        text g "generator"
        json metrics
        int record_count
        bigint plaintext_bytes
        char merkle_root
        enum status "uploading, committed"
        datetime created_at
    }
    records {
        int campaign_id PK
        int seq PK
        varchar seven_labels "coarse grouping labels"
        longblob cipher "packed ciphertexts"
        char leaf_hash
    }
    board {
        int seq PK
        varchar kind
        int campaign_id "no FK on purpose"
        longtext payload "exact signed string"
        char prev_hash
        char hash
        char sig
        datetime created_at
    }
    query_log {
        bigint id PK
        datetime at
        varchar username
        varchar role
        varchar action
        int campaign_id
        varchar detail
        int records
        int ms
        enum outcome "allowed, denied, error"
    }
""",

"sitemap": """
flowchart LR
    LG["Sign in<br/>/login<br/>split by trust boundary"]
    subgraph OWN["Owner session"]
        CA["Campaigns<br/>/campaigns"]
        SD["Source data<br/>/data/:id"]
        AN["Analysis<br/>/analysis/:id"]
        RC["Receipts<br/>/receipts/:id"]
    end
    subgraph AUD["Auditor or admin session"]
        BD["Bulletin board<br/>/board"]
    end
    subgraph ADM["Admin session only"]
        MO["Monitor<br/>/monitor"]
        DBV["Database<br/>/database/:table"]
    end
    LG --> CA
    LG --> BD
    LG --> MO
    CA --> AN
    CA --> RC
    CA --> SD
    MO --> DBV
    classDef trusted fill:#e3efe9,stroke:#0f6b5c
    classDef untrusted fill:#e4e8f3,stroke:#33498f
    class OWN trusted
    class AUD,ADM untrusted
""",

"job_states": """
stateDiagram-v2
    [*] --> keygen
    keygen --> encrypting: campaign opened on cloud
    encrypting --> spot_check
    spot_check --> uploading: decryptions match the source
    uploading --> committing: every leaf hash matches
    committing --> done: receipt root and signature verify
    spot_check --> failed: mismatch
    uploading --> failed: leaf differs
    committing --> failed: receipt rejected
    done --> [*]
    failed --> [*]
""",
}


def render_diagrams():
    DIAGRAMS.mkdir(parents=True, exist_ok=True)
    out = {}
    for name, src in MERMAID.items():
        (DIAGRAMS / f"{name}.mmd").write_text(src.strip() + "\n")
        png = DIAGRAMS / f"{name}.png"
        png.write_bytes(mermaidx.render(src, theme="base", config=THEME).png(scale=3, background="#ffffff"))
        print(f"diagram  {png.relative_to(ROOT)}")
        out[name] = png
    return out


# ---------------------------------------------------------------------------
# screen captures (full page captures are cut to the part the caption covers)
# ---------------------------------------------------------------------------
SHOTS = {  # name: (source file, top, bottom) in source pixels; None keeps the full height
    "login": ("01-login.png", 0, None),
    "campaigns": ("02-campaigns.png", 0, None),
    "analysis_top": ("03-analysis.png", 0, 2620),
    "analysis_charts": ("03-analysis.png", 2620, 5780),
    "receipts": ("04-receipts.png", 0, None),
    "board": ("05-board-audit.png", 0, 1480),
    "monitor": ("06-monitor.png", 0, 1960),
    "rejected": ("09-analysis-rejected.png", 0, 1560),
    "audit_failed": ("10-board-audit-failed.png", 0, 1120),
}


def crop_screens():
    SCREENS.mkdir(parents=True, exist_ok=True)
    out = {}
    for name, (file, top, bottom) in SHOTS.items():
        with PILImage.open(IMPL / "docs" / "screenshots" / file) as im:
            im = im.convert("RGB").crop((0, top, im.width, bottom or im.height))
            path = SCREENS / f"{name}.png"
            im.save(path, optimize=True)
        print(f"screen   {path.relative_to(ROOT)}")
        out[name] = path
    return out


# ---------------------------------------------------------------------------
# the report
# ---------------------------------------------------------------------------
def title_page():
    t = ParagraphStyle("t", fontName="Sans-Bold", fontSize=30, leading=36, textColor=INK, alignment=TA_CENTER)
    st = ParagraphStyle("st", fontName="Sans", fontSize=15, leading=20, textColor=ACCENT, alignment=TA_CENTER)
    c = ParagraphStyle("c", fontName="Serif", fontSize=11.5, leading=16, textColor=INK, alignment=TA_CENTER)
    m = ParagraphStyle("m", parent=c, textColor=MUTED, fontSize=10.5)
    flow = [Spacer(1, 62 * mm), Paragraph("E-Privacy", t), Spacer(1, 6 * mm),
            Paragraph("Implementation Report", st), Spacer(1, 14 * mm),
            P("A privacy preserving analytics platform that computes statistics on encrypted data, "
              "without ever revealing the original values to the server that does the computing.", c),
            Spacer(1, 30 * mm)]
    if TEAM_NAME:
        flow += [Paragraph(f"<b>{TEAM_NAME}</b>", c), Spacer(1, 3 * mm)]
    left = ParagraphStyle("left", parent=c, alignment=0)
    members = Table([[Paragraph(n, left), Paragraph(i, left)] for n, i in MEMBERS], colWidths=[55 * mm, 30 * mm])
    members.setStyle(TableStyle([("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    flow += [members, Spacer(1, 10 * mm), Paragraph("09/10/2026", m), PageBreak()]
    return flow


def contents():
    toc = TableOfContents(dotsMinLevel=0)
    toc.levelStyles = [ParagraphStyle("toc", fontName="Serif", fontSize=11, leading=19, textColor=INK)]
    return [Paragraph("Contents", h1), toc, PageBreak()]


class Report(SimpleDocTemplate):
    """Records every section heading for the contents page, with a link target."""

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style is h1 and flowable.getPlainText() != "Contents":
            text = flowable.getPlainText()
            key = "sec-" + text.split()[0]
            self.canv.bookmarkPage(key)
            self.notify("TOCEntry", (0, text, self.page, key))


def build(d, s):
    story = title_page() + contents()

    # 1 -------------------------------------------------------------------
    story += [Paragraph("1  Overview", h1),
        P("E-Privacy lets a data owner hand computation to a server it does not trust. Before any record leaves "
          "the owner, every numeric measure is encrypted with the Paillier cryptosystem. Paillier is additively "
          "homomorphic: multiplying two ciphertexts modulo n<super>2</super> yields an encryption of the sum of "
          "the two plaintexts. The cloud can therefore add up thousands of encrypted values and return an "
          "encrypted total that only the owner, who holds the private key, can read."),
        P("Encryption alone does not stop a dishonest server from dropping a record, inventing one or reporting "
          "the wrong total. The implementation adds the pieces a real deployment needs on top of the cipher:"),
        *bullets([
            "<b>Access control.</b> Three cloud roles (owner service, auditor, operator) behind a policy gateway "
            "that writes every request and its outcome to a query log.",
            "<b>Receipts.</b> The cloud signs a Merkle root over every record it stored, which the owner compares "
            "with a root it computed itself.",
            "<b>A public bulletin board.</b> Every campaign, receipt, encrypted result and decryption proof is "
            "appended to a signed hash chain that anyone with read access can replay.",
            "<b>Result verification.</b> The owner accepts a result only after five independent checks pass: the "
            "result carries the cloud's signature, it matches the copy on the public board, it was computed over "
            "exactly the records in the upload receipt, the record count is unchanged, and every decrypted sum "
            "equals the owner's own recomputation. The owner then publishes a proof that lets any auditor confirm "
            "the decryption without the private key.",
            "<b>Small group suppression.</b> Groups with fewer than k records (10 by default) are never released.",
        ]),
        P("The system is exercised with a synthetic test dataset of 540,000 rows and 26 columns, produced by a "
          "seeded generator."),
    ]

    # 2 -------------------------------------------------------------------
    story += [PageBreak(), Paragraph("2  System architecture", h1),
        P("The system is split along a single trust boundary. Everything that can see plaintext or a private "
          "key sits on the owner side; everything on the cloud side works only with public keys, ciphertext and "
          "coarse labels. A third party, the auditor, needs nothing beyond read access to public data."),
        figure(d["architecture"], "Components and the trust boundary. Arrows show the only data that crosses "
               "from one domain to the other.", max_h=120 * mm),
        Paragraph("2.1  Components", h2),
        table([
            ["Component", "Domain", "Responsibility"],
            ["Owner agent (owner/)", "Trusted", "Generates one Paillier keypair per campaign, "
             "encrypts on a worker pool, uploads, checks receipts, verifies and decrypts results."],
            ["Cloud gateway (cloud/)", "Untrusted", "Authenticates sessions, enforces role policy, stores ciphertext, "
             "issues signed receipts, runs homomorphic queries, serves monitoring data."],
            ["Bulletin board (cloud/src/board.js)", "Untrusted, verifiable", "Append only log. Each entry is "
             "SHA-256 chained to the previous one and signed with the cloud's P-256 key."],
            ["Shared protocol (shared/)", "Both and the browser", "Record layout, leaf and Merkle hashing, board "
             "chain, signatures and the public decryption check. One module, imported by all three parties."],
            ["Web UI (web/)", "Both", "Vue 3 single page app. Owner pages talk to the owner agent; auditor and "
             "operator pages talk to the cloud."],
            ["Auditor worker (web/src/audit.worker.js)", "Public", "Runs the four universal checks in a Web Worker "
             "using only public data."],
            ["MySQL 8.4 (db/)", "Untrusted", "Six tables; no identifiers, plaintext measures or private keys."],
        ], [0.27, 0.17, 0.56]),
        Spacer(1, 8),
        Paragraph("2.2  Deployment", h2),
        P("All four services run under Docker Compose. Two networks enforce the boundary at the network level: "
          "the database sits on <i>cloud_net</i> only, which the owner container is not attached to. The owner "
          "therefore has no route to the database and no database credentials; it reaches the cloud only through "
          "the HTTP API. Each container receives only its own environment variables."),
        figure(d["deployment"], "Containers, networks and volumes as defined in docker-compose.yml.", max_h=110 * mm),
    ]

    # 3 -------------------------------------------------------------------
    story += [Paragraph("3  Technology stack", h1),
        table([
            ["Layer", "Choice", "Reason"],
            ["Homomorphic encryption", "Paillier via paillier-bigint 3.4", "Additive only, which is exactly what "
             "sums, means, rates and variances need. Fully homomorphic schemes were benchmarked at roughly 600 "
             "times the storage."],
            ["Hashing and signatures", "@noble/hashes SHA-256, @noble/curves P-256", "Audited, dependency free, "
             "and identical in Node and in the browser."],
            ["Services", "Node.js 22 with Express", "Native BigInt and worker_threads for the CPU bound "
             "cryptography."],
            ["Database", "MySQL 8.4", "Relational tables, LONGBLOB for packed ciphertext, information_schema for "
             "storage metrics."],
            ["Frontend", "Vue 3, Vue Router, ECharts, built by Vite", "Small runtime, lazy loaded routes, charts "
             "with accessible labels."],
            ["Serving", "nginx", "Serves the static build and proxies /api/owner and /api/cloud."],
            ["Packaging", "Docker Compose v2", "One command brings up the whole system; a development override "
             "adds hot reload."],
            ["Password storage", "scrypt (Node crypto)", "Memory hard key derivation with a random salt per user."],
        ], [0.22, 0.30, 0.48]),
    ]

    # 4 -------------------------------------------------------------------
    story += [PageBreak(), Paragraph("4  Core protocol and data flow", h1),
        Paragraph("4.1  Creating a campaign", h2),
        P("A campaign is one encrypted upload with its own keypair. A fresh key per campaign limits what a leaked "
          "key could expose. The owner agent runs the steps below as a background job and reports its progress "
          "to the UI. Encryption is the slow step; it is spread across every core except one."),
        figure(d["campaign_sequence"], "Campaign creation, from key generation to a verified receipt.", max_h=165 * mm),
        figure(d["job_states"], "Phases of the campaign job. Any failed check stops the job before the next step.",
               max_h=105 * mm, width=0.75),
        Paragraph("4.2  Record layout and receipts", h2),
        P("Each stored record carries its seven labels in clear and its ciphertexts packed into one binary blob: "
          "each chosen measure, then the encryption of its square when spread statistics are wanted. At 2048 bits "
          "every ciphertext is exactly 512 bytes. The leaf hash binds the labels to the ciphertext, which stops "
          "the cloud from quietly moving a record into a different group. Leaves and inner nodes use distinct "
          "prefixes (0 and 1), and an odd node is carried up rather than duplicated, which avoids the duplicate "
          "leaf ambiguity of some Merkle designs."),
        figure(d["merkle"], "Merkle tree over five records. The signed root becomes the owner's receipt.", max_h=85 * mm),
        Paragraph("4.3  Running a query and verifying it", h2),
        P("The cloud groups records by at most two labels and multiplies the ciphertexts of each group modulo "
          "n<super>2</super>. Groups smaller than k are withheld. The signed result also carries the Merkle root "
          "and size of the input set it actually used. The owner accepts the result only when all five checks "
          "hold: the signature verifies against the key pinned on first contact, the returned entry is identical "
          "to the copy on the board, the input root equals the receipt, the record count equals the upload, and "
          "every decrypted sum equals a recomputation from the owner's own plaintext."),
        figure(d["query_sequence"], "Query, verification and publication of the decryption proof.", max_h=150 * mm),
        P("Mean and standard deviation come from exact integer sums. With S = &#931;x, Q = &#931;x<super>2</super> "
          "and group size n, the variance is (nQ &#8722; S<super>2</super>) / n<super>2</super>. Values with "
          "decimals are scaled to integers before encryption (for example by 100 for currency)."),
        Paragraph("4.4  Universal audit", h2),
        P("When the owner decrypts a sum it also recovers the Paillier randomness r and publishes the pair (m, r). "
          "Anyone holding the public key can then confirm that g<super>m</super> &#183; r<super>n</super> "
          "&#8801; C (mod n<super>2</super>). The auditor page replays the whole board in a Web Worker and runs "
          "four checks that together cover every step of the pipeline."),
        figure(d["audit_flow"], "The four checks run by the auditor. None of them needs a private key.", max_h=125 * mm),
    ]

    # 5 -------------------------------------------------------------------
    story += [PageBreak(), Paragraph("5  Database schema", h1),
        P("The database belongs to the cloud and holds six tables. It starts empty apart from three service "
          "accounts; records arrive only as ciphertext, through a campaign."),
        figure(d["erd"], "Entity relationship diagram. Dotted lines are logical links without a foreign key.",
               max_h=150 * mm),
        table([
            ["Table", "Holds", "Design note"],
            ["users", "username, role, scrypt hash", "Synced from the environment at every cloud start, which lets "
             "a changed password take effect without touching the database."],
            ["sessions", "random 64 hex token, user, expiry", "Deleted on sign out and cascaded when a user goes."],
            ["campaigns", "key length, public key n and g, measure layout, Merkle root, status",
             "Status moves one way, from uploading to committed. No upload is accepted after commit."],
            ["records", "seven labels, packed ciphertext, leaf hash", "Labels are real columns because they are the "
             "exact fields bound into each leaf. Binary storage halves the size compared with hex text."],
            ["board", "sequence, kind, payload, previous hash, hash, signature", "The payload is LONGTEXT, not JSON: "
             "MySQL would reorder JSON keys and break every signature. The sequence is the primary key, "
             "which makes a fork of the chain impossible."],
            ["query_log", "time, user, role, action, records, duration, outcome", "Written for every authenticated "
             "request and every sign in attempt, allowed or denied."],
        ], [0.14, 0.33, 0.53]),
        Spacer(1, 6),
        P("A full dump of this database yields ciphertext, public keys, coarse labels, the aggregates the owner "
          "chose to publish and the board. It contains no identifiers, no exact values and no key material."),
        *listing("db/schema.sql, complete", (IMPL / "db/schema.sql").read_text()),
    ]

    # 6 -------------------------------------------------------------------
    story += [PageBreak(), Paragraph("6  Code listings", h1),
        P("The listings below are taken directly from the repository when this report is generated. They cover "
          "the shared protocol, the owner agent, the cloud gateway and the auditor."),
        Paragraph("6.1  Shared protocol", h2),
        *listing("shared/protocol.js: leaf hashing and Merkle proofs",
                 snippet("shared/protocol.js", "// Leaf binds", "return h === root;") + "\n}"),
        *listing("shared/protocol.js: board chain verification and the public decryption check",
                 snippet("shared/protocol.js", "// Returns null when the whole chain", "return null;") + "\n}\n\n"
                 + snippet("shared/protocol.js", "export function aggregate")),
        CondPageBreak(70 * mm), Paragraph("6.2  Owner agent", h2),
        *listing("owner/src/worker.js, complete: Paillier work off the main thread",
                 (IMPL / "owner/src/worker.js").read_text()),
        *listing("owner/src/campaign.js: spot check, upload and receipt verification",
                 snippet("owner/src/campaign.js", "// Spot-check before", "job.phase = 'done';")),
        *listing("owner/src/campaign.js: the five acceptance checks (excerpt)",
                 snippet("owner/src/campaign.js", "// Individual verifiability: is this", "  ];") + "\n  // ... decrypt, recompute from plaintext ...\n"
                 + snippet("owner/src/campaign.js", "const mismatches =", "proofSeq = proof.seq;") + "\n  }"),
        *listing("owner/src/campaign.js: mean and standard deviation from encrypted sums",
                 snippet("owner/src/campaign.js", "// mean and population s.d.", "return out;") + "\n}"),
        CondPageBreak(70 * mm), Paragraph("6.3  Cloud gateway", h2),
        *listing("cloud/src/compute.js, complete: the homomorphic query engine",
                 snippet("cloud/src/compute.js", "// Homomorphic compute engine")),
        *listing("cloud/src/board.js: appending a signed, chained entry",
                 snippet("cloud/src/board.js", "let tail = Promise.resolve();", "return run;") + "\n}"),
        *listing("cloud/src/auth.js: role policy middleware with request logging",
                 snippet("cloud/src/auth.js", "// allow(...roles)")),
        *listing("cloud/src/index.js: ingest and commit endpoints",
                 snippet("cloud/src/index.js", "app.post('/campaigns/:id/records'", "res.json({ root, count: leaves.length, entry });") + "\n});"),
        CondPageBreak(70 * mm), Paragraph("6.4  Auditor and frontend", h2),
        *listing("web/src/audit.worker.js: input set, computation and decryption checks",
                 snippet("web/src/audit.worker.js", "// 2. input set", "report('decrypt'")),
        *listing("web/src/router.js: routes and role guard",
                 snippet("web/src/router.js", "const routes = [", "});")),
    ]

    # 7 -------------------------------------------------------------------
    story += [PageBreak(), Paragraph("7  User interface design", h1),
        P("The interface is built around one idea: the user should always know which side of the trust boundary "
          "they are looking at. The navigation rail is painted in two halves, a warm paper tone for the owner "
          "above a dashed boundary marker and a cool slate for the cloud below it. The page background follows "
          "the domain of the current page, and the sign in screen is split down the middle with one form per "
          "domain."),
        figure(d["sitemap"], "Pages and the session each one requires. The router sends a user without the right "
               "role back to the sign in page, and the navigation rail lists only the cloud pages the signed in role "
               "may open.", max_h=80 * mm),
        Paragraph("7.1  Charts", h2),
        P("Charts are drawn with Apache ECharts 5, imported module by module, which keeps only the bar, line, "
          "scatter, heatmap and custom chart types in the build. One small Vue component wraps ECharts, renders "
          "to SVG and redraws on resize. Every chart is built in the browser from the decrypted sums the owner "
          "agent returns; the cloud never produces a chart or sees the numbers behind one."),
        Paragraph("7.2  Pages", h2),
        table([
            ["Page", "Role", "Purpose"],
            ["Sign in", "anyone", "Two forms side by side, one per domain."],
            ["Campaigns", "owner", "Choose the records, key length and measures; see an estimate of ciphertext "
             "count, upload size and time; follow the job phase by phase."],
            ["Source data", "owner", "The campaign's rows in plaintext, with each column marked encrypted, sent in "
             "clear or kept by the owner. Exists only on the owner side."],
            ["Analysis", "owner", "Five grouped queries, each with its five checks, followed by charts and an "
             "accuracy ledger comparing every decrypted sum with the plaintext sum."],
            ["Receipts", "owner", "The signed receipt and an inclusion proof for any single record."],
            ["Bulletin board", "auditor, admin", "The four public checks and the full timeline of entries."],
            ["Monitor", "admin", "Traffic, latency per endpoint, ciphertext storage and the fault injection switch."],
            ["Database", "admin", "Read only view of the cloud tables. Password hashes and session tokens are "
             "never selected."],
        ], [0.18, 0.17, 0.65]),
    ]

    # 8 -------------------------------------------------------------------
    story += [PageBreak(), Paragraph("8  Runtime screen captures", h1),
        P("The captures below were taken from the running system under Docker Compose with the synthetic test "
          "dataset."),
        figure(s["login"], "Sign in. The owner form on the left and the cloud console on the right, divided by "
               "the trust boundary.", max_h=100 * mm),
        figure(s["campaigns"], "Campaigns page. The form shows the ciphertext count, upload size and estimated "
               "time before anything starts. Below it, the last run with its phase list, the first ciphertexts "
               "and a timestamped log of every step.", max_h=225 * mm),
        figure(s["analysis_top"], "Analysis, first section. All five checks passed; headline figures and the "
               "overall table are decrypted from sums the cloud computed without the key.", max_h=225 * mm),
        figure(s["analysis_charts"], "Analysis, grouped views. Means with spread per group, a monthly trend on two "
               "stacked charts and a heatmap where withheld groups stay empty.", max_h=225 * mm),
        figure(s["receipts"], "Receipts. The signed receipt and a verified inclusion proof for record 718: ten "
               "sibling hashes prove membership among 1,000 records.", max_h=200 * mm),
        figure(s["board"], "Bulletin board after an honest run. All four checks hold; one entry is expanded to "
               "show its hash, link, signature and payload.", max_h=200 * mm),
        figure(s["monitor"], "Monitor. Requests per minute, mean latency per endpoint and ciphertext storage per "
               "campaign. No key material or plaintext reaches this page.", max_h=225 * mm),
    ]

    # 9 -------------------------------------------------------------------
    story += [PageBreak(), Paragraph("9  Testing and measured results", h1),
        Paragraph("9.1  Protocol unit tests", h2),
        P("The shared protocol has four tests that use a real 1024 bit key. They run with <i>npm test</i> and all "
          "four pass."),
        table([
            ["Test", "Result", "Time"],
            ["Aggregate over ciphertext decrypts to the plaintext sum, and the decryption proof holds", "pass", "985 ms"],
            ["Merkle proofs verify for every leaf and fail after tampering", "pass", "4.7 ms"],
            ["Leaf hash binds dimensions to ciphertext", "pass", "0.3 ms"],
            ["Board chain detects edits and forged signatures", "pass", "64 ms"],
        ], [0.70, 0.12, 0.18]),
        Paragraph("9.2  Fault injection", h2),
        P("The operator can switch the cloud into a cheating mode. <i>Drop</i> leaves one record out of every "
          "query and <i>tamper</i> squares one ciphertext before summing. Both were run against a committed "
          "campaign. In each case the owner refused the result and the auditor's matching check failed, while "
          "the remaining checks still held."),
        figure(s["rejected"], "Analysis with the tamper fault on. Four of five checks pass, but one decrypted sum "
               "differs from the plaintext recomputation and the result is rejected.", max_h=150 * mm),
        figure(s["audit_failed"], "Audit after faulty queries. Log integrity holds, while the input set and "
               "computation checks list the exact entries that do not match.", max_h=130 * mm),
        Paragraph("9.3  Performance", h2),
        P("Measured on an 8 core laptop (AMD Ryzen 7 7730U) under Docker Desktop."),
        table([
            ["Operation", "1024 bit", "2048 bit"],
            ["Key generation", "0.4 to 0.6 s", "1.0 to 1.6 s"],
            ["Encrypt one value", "7 ms", "43 to 45 ms"],
            ["Decrypt one value", "5 ms", "30 ms"],
            ["Homomorphic addition (one multiply mod n<super>2</super>)", "4 &#181;s", "14 &#181;s"],
        ], [0.52, 0.24, 0.24]),
        Spacer(1, 8),
        table([
            ["Measurement", "Value"],
            ["Campaign of 600 records, 26 values each, 1024 bit", "22.4 s to encrypt"],
            ["Campaign of 1,000 records, 26 values each, 2048 bit", "1,022 s to encrypt, under 3 s to upload"],
            ["Cloud query over 1,000 records at 2048 bit", "383 ms mean, 720 ms max"],
            ["Commit: Merkle root over 1,000 leaves and signature", "22 ms"],
            ["Full audit: 45 entries, 1,600 records, 1,056 sums, 826 proofs", "118.7 s in one Web Worker"],
            ["Storage per encrypted measure (2048 bit)", "2.9 times the source bytes"],
        ], [0.62, 0.38]),
        Spacer(1, 6),
        P("Homomorphic addition is about 3,000 times cheaper than encryption. The owner side is the bottleneck, "
          "and it scales nearly linearly with physical cores on the host."),
    ]

    # 10 ------------------------------------------------------------------
    story += [Paragraph("10  Limitations and future work", h1),
        *bullets([
            "The cloud holds one campaign in memory while it aggregates. This suits tens of thousands of records; "
            "beyond that it should stream by sequence range and fan out to worker threads.",
            "The owner pins the cloud's signing key the first time it connects (trust on first use).",
            "Grouping labels travel in clear. Small groups are withheld, but the labels remain quasi identifiers.",
            "Only additive statistics are possible: counts, sums, means, rates and standard deviations. Medians "
            "and other order statistics need a different protocol.",
            "Planned next: differential privacy noise on released results, and studies across several data owners "
            "with threshold decryption.",
        ]),
    ]
    return story


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Sans", 8)
    canvas.setFillColor(MUTED)
    if doc.page > 1:
        canvas.drawString(MARGIN, 12 * mm, "E-Privacy  |  Implementation Report")
        canvas.drawRightString(PAGE_W - MARGIN, 12 * mm, str(doc.page))
    canvas.restoreState()


def check_prose():
    """The report text avoids long dashes, keeps hyphens rare and avoids the
    word 'so'. Fails loudly if a later edit slips one in."""
    text = " ".join(PROSE) + " ".join(MERMAID.values())
    plain = re.sub(r"<[^>]+>", " ", text)
    assert "—" not in plain and "–" not in plain, "long dash in report text"
    found = re.findall(r"\bso\b", plain, re.I)
    assert not found, f"'so' appears {len(found)} times"
    hyphens = len(re.findall(r"\w-\w", re.sub(r"(SHA-256|P-256|E-Privacy|paillier-bigint|stateDiagram-v2|docker-compose)", "", plain)))
    print(f"prose check passed ({hyphens} hyphenated words outside names)")


def main():
    OUT.mkdir(exist_ok=True)
    d = render_diagrams()
    s = crop_screens()
    doc = Report(str(PDF), pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                            topMargin=20 * mm, bottomMargin=20 * mm,
                            title="E-Privacy Implementation Report", author=", ".join(n for n, _ in MEMBERS))
    story = build(d, s)
    check_prose()
    doc.multiBuild(story, onFirstPage=footer, onLaterPages=footer)
    print(f"report   {PDF.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
