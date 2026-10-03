# Security analysis

How the implementation meets each requirement in the SRS, what it guarantees, and what it doesn't.

## Threat model (from the reports)

- **Data Owner** (hospital): trusted, single per deployment (A2). Holds private keys.
- **Cloud**: honest-but-curious (A3), follows the protocol but tries to learn from what it sees. Additionally, the
  verifiability layer is designed so that an *actively* dishonest cloud is **detected**.
- **Auditor**: reads public information only.
- **Network**: TLS and at-rest encryption are assumed provided by the infrastructure (A4). Inside the compose network
  traffic is plain HTTP; a production deployment puts TLS in front of nginx and between owner and cloud.

## Requirement traceability

| Requirement | Where | How |
|---|---|---|
| FR-1 Local key generation | `owner/src/campaign.js` | `generateRandomKeys(bits, true)` inside the owner container; private key written only to `/keys` (mode 600) |
| FR-2 Client-side encryption | `owner/src/worker.js` | every measure encrypted before any network call; identifiers dropped |
| FR-3 Homomorphic aggregation | `cloud/src/compute.js` | Π cᵢ mod n² per group and column; count is the group size |
| FR-4 Access control & policy | `cloud/src/auth.js` | bearer sessions, role per route, k-min on results, every decision logged |
| FR-5 Local decryption | `owner/src/campaign.js` `analyze()` | decryption in owner workers, only after checks pass |
| FR-6 Verifiable log | `cloud/src/board.js`, `shared/protocol.js` | SHA-256 chain + P-256 signature per entry; receipts; results; decryption proofs |
| FR-7 Key lengths | UI + validation in both services | 1024 / 2048 / 3072 |
| FR-8 Admin monitoring | `GET /metrics`, `Monitor.vue`; `GET /admin/tables/:name`, `Database.vue` | throughput, latency, storage; the raw tables, read-only, without password hashes or session tokens; no key or plaintext anywhere because the cloud holds none |
| NFR Integrity | Merkle leaves bind dims + ciphertext | any stored ciphertext or label change alters the root |
| NFR Auditability | `query_log` | user, role, action, detail, records, time, outcome; no plaintext logged |

## Confidentiality

What the cloud sees per record: seq (0..N−1), seven coarse labels, and ciphertexts. Paillier is IND-CPA under the
decisional composite residuosity assumption, so ciphertexts reveal nothing about values without the factorisation of n.
Each encryption uses fresh randomness, so equal values give different ciphertexts.

What the cloud learns per query: group sizes, and nothing about the sums (they stay encrypted until the owner publishes
the aggregate, and it only publishes aggregates over ≥ k records).

What leaks by design:
- the coarse labels and their joint distribution (AD-3);
- aggregate plaintexts of groups ≥ k once the owner publishes them (this is the point of the system);
- campaign sizes and timing.

**How identifying the labels are together.** Each label is coarse, but their combination is not. Measured on campaign #6
(500 records, `COUNT(*) OVER (PARTITION BY …)` on `records`):

| Labels combined | Records whose combination is unique |
|---|---|
| all seven | 474 (95 %) |
| department + month + sex + age band | 268 (54 %) |
| department + sex + age band | 16 (3 %) |

So someone who already knows a person's department, month, sex and age band can usually find that person's row. The
values stay encrypted, but the row itself discloses that the admission happened and its department, ward, type and
insurance. Published aggregates are still protected by k-min; the stored records are not. Mitigations, cheapest first:
send only the labels a campaign's queries group by (the current queries never group by `insurance_type` or `sex`);
coarser bins; keyed-hash labels (still open to frequency analysis); encrypted one-hot indicators so no label is in the
clear (costs one ciphertext per category).

Not leaked: identifiers, exact ages, dates, per-record measures, keys.

**Linkage attacks (Pre-Study §5).** The identifiers a linkage attack needs (name, NIC, DOB, postcode) never leave the
owner. The labels that do leave are coarse, and group results under k are withheld. Differencing attacks (e.g. two
overlapping queries whose difference isolates one person) are *not* fully prevented: every query runs over the whole
committed set, which limits them, but k-min on individual groups is not a formal guarantee. Differential privacy is the
SRS's listed future work.

## Integrity and verifiability

| Attack by the cloud | Detected by |
|---|---|
| store a different ciphertext than uploaded | owner leaf-by-leaf check at upload; receipt root; per-record inclusion proof |
| drop / add / duplicate a record in a query | owner checks 3 & 4 (root, count); auditor input-set check |
| relabel a record (move it to another group) | owner plaintext check 5 (group sums change); auditor input-set check (leaves are rebuilt from the published labels + ciphertext, so the root no longer matches the receipt) |
| alter a ciphertext at query time | owner plaintext check 5; auditor computation check |
| return a result other than the one published | owner check 2 (board copy) |
| forge or edit a board entry | signature and chain verification (owner and auditor) |
| swap its signing key | owner's pinned key no longer matches → refuses |

Verified with the fault switch (`drop`, `tamper`); see `problems-and-fixes.md` and the screenshots.

**Owner honesty.** The (m, r) proof means the hospital can't publish a false aggregate to an auditor: a wrong m has no
matching r.

## Authentication

- Cloud passwords: scrypt (N=16384 default, 16-byte salt, 32-byte key), compared with `timingSafeEqual`.
- Owner password: compared through fixed-length SHA-256 digests with `timingSafeEqual`, no short-circuit.
- Tokens: 256-bit random, server-side sessions with expiry; logout deletes them.
- Two independent sessions in the browser (owner and cloud); a cloud token is useless against the owner.

**Not implemented:** rate limiting on login, MFA, CSRF tokens (not needed with bearer tokens in headers rather than
cookies), token storage outside `localStorage` (XSS would expose it; the app renders no HTML from data, and chart
tooltips escape all text).

## Input validation

All writes to both services validate types, ranges and sizes at the boundary (see the component docs). SQL uses
placeholders throughout. Board and ciphertext reads are paged and capped.

## Residual risks and upgrades

| Risk | Upgrade path |
|---|---|
| TOFU pin of board key | distribute the key out of band or via PKI |
| clear labels are quasi-identifiers | encrypted indicator columns, or differential-privacy noise on released aggregates |
| single owner, single key holder | threshold Paillier for multi-owner (SRS future work) |
| plaintext transport inside compose | TLS termination at nginx; mTLS owner ↔ cloud |
| owner keys on a Docker volume | HSM / KMS integration (SRS A5 assumes the hospital's existing key store) |
