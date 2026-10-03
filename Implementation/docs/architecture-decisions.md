# Architecture decisions

Each record: the context, the options that were on the table, what was chosen, how well it worked in practice, and the
trade-offs. Numbered in the order they were made.

---

## AD-1 — Two services on either side of the trust boundary

**Context.** The SRS puts key generation, encryption and decryption in the Data Owner's domain and everything else in an
untrusted cloud. The implementation had to make that boundary real, not just a folder name.

**Options.**
1. One backend with "owner" and "cloud" modules.
2. Owner logic in the browser (Web Crypto / Web Workers), one cloud backend.
3. Separate owner and cloud services with separate credentials, networks and storage.

**Decision.** Option 3 (confirmed with the team before building).

**Effectiveness.** The boundary is enforced by infrastructure: the owner container has the CSV and the key volume but no
DB credentials; the cloud container has the DB but has never been given a private key; MySQL isn't even routable from the
owner. Everything the owner sends is visible in one small client (`owner/src/cloud.js`), which makes "what leaves the
hospital" easy to audit.

**Pros.** Faithful to the SRS diagrams; compromise of the cloud (or its admin account) yields no keys; the owner can be
deployed on-premises while the cloud runs elsewhere.
**Cons.** One more container and API hop; the owner needs its own login.

---

## AD-2 — Paillier via `paillier-bigint`, 2048-bit default, key per campaign

**Context.** The cryptographic design fixes Paillier (additively homomorphic) at a 2048-bit modulus, with 1024/3072
selectable (FR-7), rotated per campaign, using a reviewed library (B1).

**Options.** `paillier-bigint` (native BigInt, TypeScript, maintained); a port of Python `phe`; a hand-written
implementation (with CRT speed-ups).

**Decision.** `paillier-bigint`, simple variant `g = n + 1`, new keypair per campaign.

**Effectiveness.** Correct on first use (spot-checks, accuracy ledger at 0 difference, `protocol.test.js`). It already
exposes `getRandomFactor`, which the decryption proof needs, so no crypto code had to be written by hand. A CRT-based
encryption was prototyped and measured at only 1.5× faster, which wasn't worth taking on custom crypto (problem log #10).

**Pros.** Reviewed code; one dependency; works in Node and the browser.
**Cons.** Pure-JS big-integer arithmetic is slower than GMP; 2048-bit encryption is the throughput bottleneck.

---

## AD-3 — Clear-text coarse dimensions for grouping, encrypted measures

**Context.** Useful analytics need "per department", "per month". Paillier can add but can't compare or branch, so the
cloud can't group on encrypted labels without a much heavier protocol (e.g. encrypted one-hot indicators, one extra
ciphertext per category per record).

**Options.** (a) encrypted one-hot group indicators; (b) owner-side grouping, uploading one campaign per group;
(c) coarse labels in clear with a minimum group size.

**Decision.** (c): seven coarse labels, k-min = 10 enforced by the cloud, exact values stay encrypted (e.g. exact age
encrypted, only the age band is visible).

**Effectiveness.** All five analysis views run as single queries; the cost per query is dominated by decryption, not
grouping. Groups under k are withheld and reported only as a count.

**Pros.** Cheap; any combination of up to two dimensions per query; matches the SRS anonymity argument
("aggregation-only query surface").
**Cons.** The labels are quasi-identifiers. The cloud learns the joint distribution of department/ward/type/insurance/
month/sex/age band. Documented in the README and security analysis as a known limit.

---

## AD-4 — Encrypted squares for standard deviation

**Context.** SRS assumption A1 defers non-linear statistics. The charts are much more honest with spread than without.

**Options.** Skip s.d.; two-round protocol (owner decrypts the mean and sends it back); FHE fallback; upload E(x²).

**Decision.** Upload E(x²) as an extra column (optional, on by default for continuous measures).

**Effectiveness.** Exact s.d. in one round from `n·Σx² − (Σx)²` in BigInt. Whiskers and bands in every chart.

**Pros.** No extra round trips, no new cryptography, exact.
**Cons.** Nearly doubles ciphertexts, and so encryption time and storage (26 vs 14 values per record).

---

## AD-5 — Merkle receipts + signed, hash-chained bulletin board

**Context.** The Verifiability report requires detecting dropped, extra or substituted records, and log entries that can't be
rewritten.

**Decision.** SHA-256 Merkle tree over per-record leaves (dims + ciphertext), root signed on commit; every campaign,
receipt, query result and decryption proof is a board entry chained by hash and signed with ECDSA P-256.

**Effectiveness.** Demonstrated with fault injection: *drop* changes the input root (owner check 3 fails; auditor's input-set
check fails), *tamper* leaves the root intact but breaks the product (auditor's computation check fails) and the
decrypted value (owner's plaintext check fails).

**Pros.** Standard primitives; O(log N) inclusion proofs (10 hashes for 1,000 records).
**Cons.** Detection, not prevention. A cloud that refuses to answer is an availability failure (as the report says).

---

## AD-6 — Hospital publishes (m, r) for each sum

**Context.** Universal verifiability needs a third party to confirm the *decryption*, without the key.

**Decision.** After accepting a result, the owner recovers r for each aggregate ciphertext and posts (m, r). Anyone checks
`gᵐ·rⁿ ≡ C (mod n²)`.

**Effectiveness.** The auditor verifies every published plaintext; a false m can't pass (encryption is a bijection).
**Cons.** Each proof costs a modular exponentiation to create and to check (~tens of ms at 2048 bits in JS).

---

## AD-7 — Shared protocol module used by all three parties

**Decision.** `shared/protocol.js` (npm workspace package), with `@noble/*` for hashing and signatures so the same code runs
in Node and the browser.
**Effectiveness.** No format mismatch bugs between owner, cloud and auditor during development.
**Cons.** Needed npm workspaces and a slightly unusual Dockerfile pattern (copy all manifests, then `npm ci -w`).

---

## AD-8 — Auditor verification in the browser

**Options.** A server-side "verify" endpoint on the cloud (pointless: the cloud would be checking itself); a CLI tool;
in the browser.
**Decision.** In a Web Worker in the auditor's browser.
**Effectiveness.** The auditor needs nothing installed, and the check is independent of the cloud's code paths. The
first run over 7 entries / 136 sums / 50 proofs finished in about a second at 1024 bits.
**Cons.** Downloads every published ciphertext (13 KB per record at 2048 bits); fine for thousands of records, slow for millions.

---

## AD-9 — MySQL as the cloud store, aggregation in the app

**Decision.** Requested stack. Ciphertext packed per record in a `LONGBLOB`; multiplication done in Node with BigInt.
**Cons.** Whole campaign loaded per query (see `ponytail:` note in `compute.js`).

---

## AD-10 — No bind mounts; dataset lives in the owner image

See `docker-and-env.md`. Forced by Docker Desktop file sharing, kept because it's more portable and keeps the dataset
physically inside the trusted container.

---

## AD-11 — Accept or reject, never "show with a warning"

**Context.** If any owner check fails, should the UI still show the numbers?
**Decision.** No. A rejected result shows which checks failed and no figures or charts, and no decryption proof is
published. The only place the decrypted sums still appear is the accuracy ledger, next to the plaintext sums, so that
the officer can see *which* sum was wrong and by how much.
**Why.** A plausible-looking wrong number is exactly the failure the Verifiability report sets out to prevent.
