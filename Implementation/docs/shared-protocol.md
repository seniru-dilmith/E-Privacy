# Shared protocol — `shared/protocol.js`

## Why a shared module exists

Verification only works if every party computes hashes over *exactly* the same bytes. If the owner hashed a record one way
and the cloud another, every check would fail; if the auditor's code differed from both, it would not be checking the
same thing. So everything that must be byte-identical lives in one ES module that the owner (Node), the cloud (Node)
and the browser (Vite bundle, including the audit Web Worker) all import as `@e-privacy/shared`.

It contains **no secrets and no I/O**, only definitions and public arithmetic.

## Contents

| Export | Purpose |
|---|---|
| `DIMENSIONS` | the 7 clear-text grouping attributes, in a fixed order |
| `METRICS`, `METRIC` | the 14 measures: label, unit, fixed-point `scale`, whether a square is kept, whether it is a 0/1 flag |
| `ageBand(age)` | 0-17, 18-34, 35-49, 50-64, 65-79, 80+ |
| `cipherColumns(metrics)` | column layout of a record's ciphertext blob: each measure, then its square if kept |
| `cipherWidth(bits)` | bytes per ciphertext slot = bits/4 (ciphertexts live mod n², so 2× the modulus length) |
| `bigintToBytes`, `bytesToBigint`, `splitCipher` | packing ciphertexts into fixed-width big-endian slots and back |
| `leafHash(dims, cipherBytes)` | SHA-256(0x00 ‖ dims joined by `|` ‖ 0x00 ‖ ciphertext blob) |
| `merkleRoot`, `merkleProof`, `verifyProof` | binary Merkle tree over leaf hashes, inner node = SHA-256(0x01 ‖ L ‖ R) |
| `entryHash`, `signHash`, `verifySig`, `verifyChain` | board entries: SHA-256 over `seq\nkind\nprev_hash\npayload`, ECDSA P-256 |
| `modPow`, `aggregate`, `verifyDecryption` | public Paillier side: product of ciphertexts mod n², and `gᵐ·rⁿ ≡ C (mod n²)` |

## Decisions

### The leaf covers the grouping dimensions, not just the ciphertext
- **Problem:** dimensions are sent in the clear so the cloud can group. If only the ciphertext were hashed, a dishonest cloud
  could move a record from Cardiology to Paediatrics and every Merkle check would still pass.
- **Chosen:** the leaf hash binds dims and ciphertext together. Changing either changes the leaf and the root.
- **Test:** `leaf hash binds dimensions to ciphertext` in `protocol.test.js`.

### Domain separation (0x00 leaf, 0x01 node)
Without it, an inner node could be presented as a leaf (second-preimage style attack on Merkle trees). One prefix byte
costs nothing.

### Odd node carried up, not duplicated
Bitcoin-style trees duplicate the last node on odd levels, which makes `[a, b, c]` and `[a, b, c, c]` share a root
(CVE-2012-2459). Carrying the odd node up unchanged keeps the root unique for each leaf list, so "one extra record" can
never go unnoticed.

### Payload hashed as the exact stored string
The board stores `payload` as the string that was hashed (a `LONGTEXT`, not a MySQL `JSON` column). MySQL's JSON type
normalises key order and whitespace, which would silently change the bytes and break every hash.

### Library choice: noble
- **Options:** Node `crypto` on the server + WebCrypto in the browser; `elliptic`; noble.
- **Chosen:** `@noble/hashes` + `@noble/curves`.
- **Why:** one synchronous API in both environments (WebCrypto is async and has no raw ECDSA prehash API that matches
  Node's), audited, no native deps. **Con:** slower than native OpenSSL, irrelevant at these volumes.

### Signature format
Compact 64-byte (r‖s) hex, over the 32-byte SHA-256 entry hash. The public key is published at `GET /board/key`
(compressed SEC1) and pinned by the owner on first use.

### Why `verifyDecryption` works
With `g = n + 1`, encryption is `c = gᵐ · rⁿ mod n²`. Decryption with the private key recovers m, and
`paillier-bigint`'s `getRandomFactor` recovers r (it needs p and q). Publishing (m, r) lets anyone recompute `gᵐ·rⁿ` and
compare with C. For a different m′ there is no r′ with the same C (Paillier encryption is a bijection from Zₙ × Zₙ* onto
Zₙ²*), so a false plaintext can't pass. Revealing r of an *aggregate* reveals nothing about individual records: it is
the product of the records' r values, and those are uniformly random.

## Test — `shared/protocol.test.js`

`npm test` from `Implementation/` runs four checks with a real 1024-bit key:

1. homomorphic sum of 5 encrypted values decrypts to the plaintext sum; the (m, r) proof verifies, and fails for m+1;
2. Merkle proofs verify for all 11 leaves; changing one leaf changes the root and breaks its proof; dropping a leaf changes the root;
3. the leaf hash changes when only a dimension changes;
4. the board chain detects an edited payload (at the right seq) and a wrong signing key.
