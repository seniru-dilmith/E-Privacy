# Performance — what was measured

All numbers come from this implementation on the development machine: AMD Ryzen 7 7730U (8 cores / 16 threads,
15 W laptop part), Docker Desktop on Linux, Node 22 in containers, Node 24 on the host.

## Paillier primitives (single thread, `paillier-bigint` 3.4.3)

| Operation | 1024-bit | 2048-bit |
|---|---:|---:|
| Key generation | 0.4–0.6 s | 1.0–1.6 s |
| Encrypt one value | 7 ms | 43–45 ms (same in container and on host) |
| Decrypt one value | 5 ms | 30 ms |
| Ciphertext multiply mod n² (homomorphic add) | 4 µs | 14 µs |

The encryption cost is one modular exponentiation `rⁿ mod n²`. Homomorphic addition is about 3,000× cheaper than
encryption, which is why the cloud side is fast and the hospital side is the bottleneck.

A CRT-based encryption (the owner knows p and q) was prototyped: 45 → 29 ms at 2048 bits, only 1.5×. Not adopted (see
problem log #10).

## Encryption throughput with worker threads (2048-bit)

| Threads | Host (enc/s) | Owner container, short burst (enc/s) |
|---:|---:|---:|
| 1 | 20 | 18 |
| 2 | 40 | 32 |
| 4 | 74 | 51 |
| 8 | 112 | 57 |
| 15 | 109 | 65 |

The host scales almost linearly up to the 8 physical cores; hyper-threads add nothing to BigInt exponentiation.
The container flattens out after 4 threads. Over a long, all-core job the rate fell further, to ~25 enc/s: the 1,000-row,
26-value campaign (26,000 encryptions) took **1,022 s**. This is Docker Desktop's VM plus a low-power laptop CPU throttling under sustained
load, not the code: the same pool on the host would do the job in ~4 minutes. On a Linux server with native Docker,
expect the host column.

## Campaigns actually run

| Campaign | Records | Key | Values / record | Encryption | Upload + receipt |
|---|---:|---:|---:|---:|---:|
| #1 Smoke 1024 | 600 | 1024 | 26 | 22.4 s | < 2 s |
| #2 Admissions sample | 1,000 | 2048 | 26 | 1,022 s | < 3 s |

Upload batches of 250 records took 135 ms on average on the cloud side (max 256 ms); commit (Merkle root over 1,000 leaves + sign) 22 ms.

## Query path (campaign #2, 1,000 records, 2048-bit)

| Step | Time |
|---|---:|
| Cloud: load + group + multiply (`POST /query`, mean of 24 calls) | 383 ms (max 720 ms) |
| Owner: decrypt 26 sums + recover r (whole sample) | ~0.6 s |
| Owner: decrypt 60 sums + recover r (by department) | ~1.3–1.4 s |
| Owner: plaintext recomputation | a few ms once rows are cached (~0.4 s first load) |
| Publish decryption proof | 51 ms mean |

All five analysis views together (182 sums) finish in well under 10 s once the owner is idle.

For comparison, the Crypto Design report's benchmark (Python `phe`, 2M records, one value per record) measured
4.99 min for a 2048-bit sum. Our per-record aggregation cost is ~14 µs per ciphertext per column, which extrapolates to
~28 s per column for 2M records in a single thread. It's the same order of cost, and it parallelises.

## Auditor

| Scope | Result |
|---|---|
| 7 entries, 600 records at 1024-bit, 136 sums, 50 proofs | 1.0 s |
| 45 entries, 1,600 records (1024 + 2048), 1,056 sums, 826 proofs | 118.7 s |

The auditor's time is dominated by the decryption proofs: each is a 2048-bit `rⁿ mod n²` in browser BigInt (~100+ ms in a
Web Worker). It's embarrassingly parallel (several workers would divide it) and only needs to be done once per entry.

## Storage

Measured from the cloud database (`GET /metrics`):

| Campaign | Source rows | Ciphertext | × per row | Values / record | × per encrypted measure |
|---|---:|---:|---:|---:|---:|
| #1 (1024-bit) | 107,532 B | 3,993,600 B | 37.1× | 26 | **1.4×** |
| #2 (2048-bit) | 179,151 B | 13,312,000 B | 74.3× | 26 | **2.9×** |

A 2048-bit ciphertext is exactly 512 bytes; 26 of them per record = 13,312 B per admission against ~179 B of CSV.

The SRS budget (≤ 1.1 GB per 100 MB, ~11×) was set for the benchmark's layout: one encrypted value per ~47-byte record.
The comparable figure here is "per encrypted measure", which is well inside the budget because our rows are wider
(~179 B). Encrypting 14 measures **and** their squares multiplies the total, which is the direct cost of richer
analytics (AD-4). Dropping the squares halves it; selecting fewer measures in the campaign form reduces it linearly.

Note: `information_schema` row counts on the Monitor page are InnoDB estimates and lag behind (it showed ~301 rows for
1,600 records until statistics refreshed); the byte sizes and the per-campaign figures come from exact `SUM(LENGTH(cipher))`.

## Scaling notes

- Hospital encryption: CPU-bound and linear in values × records; add cores/nodes, or encrypt incrementally as
  admissions happen (the SRS "streaming ingestion" idea) rather than in one batch.
- Cloud aggregation: linear and parallel; the current implementation holds one campaign in memory per query
  (~13 KB/record at 2048 bits), which is fine to ~100k records.
- Auditor: linear in published values; parallelise across workers.
