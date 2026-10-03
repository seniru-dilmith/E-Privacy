# E-Privacy

Privacy-preserving analytics over hospital admissions. The hospital encrypts records with Paillier before they leave its
network. The cloud adds up ciphertexts it cannot read, and every step goes on a signed, hash-chained bulletin board so
both the hospital and an outside auditor can check the result.

This is the implementation of the design in `../Documents` (Pre-Study, SRS, Cryptographic Design, Verifiability).

```
   hospital (trusted)                          │                cloud (untrusted)
                                               │
  CSV ──► owner agent ── ciphertext + coarse ──┼──► gateway ──► MySQL (records, board, logs)
          · Paillier keys per campaign   dims  │     · roles, k-min policy
          · encrypt / spot-check               │     · Π cᵢ mod n²  (sum without the key)
          · verify receipts & results  ◄───────┼──── · signed Merkle receipts, signed results
          · decrypt, publish (m, r)  ──────────┼──►  bulletin board ◄── auditor's browser
                                               │                         (re-checks everything)
```

## Running it

Requirements: Docker with Compose v2. Nothing else needs to be installed on the host.

```bash
cp .env.example .env        # then replace every change-me
docker compose up --build
```

Open <http://localhost:8080> (or whatever `WEB_PORT` is set to). The first build takes a few minutes; later starts are quick.

Sign-ins come from `.env`:

| Side | Account | Can do |
|---|---|---|
| Hospital | `OWNER_USER` / `OWNER_PASSWORD` | create campaigns, analyse, check receipts |
| Cloud | `AUDITOR_USER` / `AUDITOR_PASSWORD` | read the board, run the four public checks |
| Cloud | `ADMIN_USER` / `ADMIN_PASSWORD` | monitoring, board, fault injection |

`CLOUD_OWNER_USER` is a service account the hospital agent uses to talk to the cloud; nobody signs in with it.

The database starts empty apart from the three cloud accounts. Records only reach it as ciphertext, through a campaign.

## A walk through

1. **Campaigns** (hospital). Pick how many admissions to sample, the key length and the measures. The agent samples
   the CSV, generates a keypair, encrypts on all cores, decrypts 1 % as a spot-check, uploads, and compares the cloud's
   signed Merkle root with its own. Encryption is the slow part: under Docker Desktop on an 8-core laptop, 600
   admissions × 26 values took 22 s at 1024 bits, and 1,000 admissions took 17 min at 2048 bits. The form shows an
   estimate before you start.
2. **Source data** (hospital). The rows a campaign sampled, in plaintext as they are in the CSV, with each column
   marked encrypted, sent in clear or kept at the hospital. Downloadable as CSV.
3. **Analysis** (hospital). Runs five grouped queries. Each result is accepted only if the signature, the board copy,
   the input-set root, the record count and a recomputation from the local plaintext all agree. Then the sums are
   decrypted and the randomness `r` is published so anyone can check the decryption.
4. **Receipts** (hospital). Prove any single record is still stored as uploaded.
5. **Bulletin board** (auditor or admin). "Run all four checks" re-verifies the hash chain and signatures, rebuilds every Merkle
   root from the published ciphertexts, recomputes every encrypted sum and checks every published plaintext against
   `gᵐ · rⁿ ≡ C (mod n²)`. It runs in a Web Worker in the browser and uses only public data.
6. **Monitor** (admin). Traffic, latency, storage expansion against the SRS budget, and a fault switch: *drop* leaves
   a record out of each query, *tamper* doubles one ciphertext. Run an analysis afterwards and the hospital rejects it;
   run the audit and the matching check fails.
7. **Database** (admin). The cloud's tables, read-only. Put a record next to its row on the Source data page: the name,
   ID and exact values are gone, only coarse labels and ciphertext remain. Password hashes and session tokens are not
   shown.

## Layout

```
data/        generate.js (seeded, stdlib only) and the generated hospital_admissions.csv
db/          schema.sql and the MySQL image that loads it
shared/      protocol.js — record layout, leaf/Merkle hashing, board chain, signatures,
             public decryption check; used by owner, cloud and the browser alike
cloud/       Express gateway: auth + policy, ingest, receipts, homomorphic queries, metrics
owner/       Express agent: dataset sampling, key generation, worker-thread crypto,
             result verification and decryption
web/         Vue 3 + ECharts, built by Vite and served by nginx (which also proxies both APIs)
```

## Development

Hot reload in Docker (APIs restart on save, the UI hot-reloads on <http://localhost:5173>):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml watch
```

Or on the host, with only MySQL in Docker (port 3307):

```bash
npm install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mysql
cp cloud/.env.local.example cloud/.env.local   # fill in the passwords from .env
cp owner/.env.local.example owner/.env.local
npm run dev -w cloud    # and in two more terminals:
npm run dev -w owner
npm run dev -w web      # http://localhost:5173
```

Other tasks:

```bash
npm test                    # protocol checks with a real 1024-bit key
npm run dataset             # rebuild data/hospital_admissions.csv (same seed → same file)
node data/generate.js 20000 # or a smaller file
```

## Configuration

| Variable | Used by | Meaning |
|---|---|---|
| `WEB_PORT` | web | host port for the UI |
| `MYSQL_*` | mysql, cloud | database name and credentials |
| `K_MIN` | cloud | smallest group size the cloud will release (default 10) |
| `SESSION_TTL_HOURS` | cloud | cloud session lifetime |
| `DEFAULT_KEY_BITS` | owner | preselected key length in the form |

Each container gets only its own variables: the owner never sees database credentials, the cloud never sees the
hospital's password or any private key.

## Known limits

- The cloud aggregates in one process and holds a campaign in memory while it does; fine for tens of thousands of
  records, not for millions (see the `ponytail:` note in `cloud/src/compute.js`).
- The hospital pins the cloud's signing key the first time it connects (trust on first use).
- Grouping dimensions (department, ward, admission type, insurance, month, sex, age band) are sent in the clear so the
  cloud can group; small groups are withheld by `K_MIN`, but they are still quasi-identifiers.
- Only additive statistics: counts, sums, means, rates, and standard deviations via encrypted squares. Medians and
  other order statistics need a different protocol.
