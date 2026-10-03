# Database — `db/schema.sql`

MySQL 8.4, cloud side only. The schema is baked into a small image (`db/Dockerfile`) and applied by the MySQL entrypoint
the first time the `mysql_data` volume is empty. It is not seeded with the dataset: records only arrive as ciphertext
through a campaign.

## Tables

| Table | Holds | Notes |
|---|---|---|
| `users` | username, role (`owner`/`auditor`/`admin`), scrypt hash | synced from `.env` at cloud start |
| `sessions` | 64-hex token, user, expiry | deleted on logout; `ON DELETE CASCADE` from users |
| `campaigns` | name, key bits, `n`, `g` (hex), measure layout (JSON), record count, source bytes, Merkle root, status | status `uploading` → `committed` (one-way) |
| `records` | (campaign, seq) PK, 7 dimension labels, packed ciphertext `LONGBLOB`, leaf hash | cascade-deleted with campaign |
| `board` | seq PK, kind, campaign, payload (`LONGTEXT`, the exact hashed string), prev hash, hash, signature, time | append-only by convention and by the hash chain |
| `query_log` | time, user, role, action, campaign, detail, records, ms, outcome | every authenticated request and every login attempt |

## What is *not* in the database

No patient identifiers, no exact ages, no plaintext measures, no private keys, no hospital passwords.
An attacker with a full dump gets: ciphertexts, public keys, coarse labels (department, ward, admission type, insurance,
month, sex, age band), aggregate plaintexts that the hospital chose to publish (only groups ≥ k), and the board.

## Decisions

- **`payload` as `LONGTEXT`, not `JSON`**. MySQL re-serialises JSON columns (key order, spacing), which would change the
  bytes and invalidate hashes and signatures. The string is stored exactly as signed.
- **`seq` as the board's primary key.** A second entry with the same number is impossible, so the chain can't fork.
- **Dimensions as real columns** instead of a JSON blob: typed, short, and simple to select. They are also exactly the
  seven fields bound into each leaf.
- **Packed `LONGBLOB` ciphertext.** 512 bytes per value at 2048 bits in binary, instead of ~1 KB as hex text.
- **`campaigns.metrics` as `JSON`.** This one is fine as JSON: it is metadata the cloud reads, never hashed from the column.
- **`information_schema` for storage metrics.** The Monitor page reads table sizes directly; no extra bookkeeping.
- **Inspecting the tables.** The admin's Database page (`GET /admin/tables/:name`) shows every table read-only, so the
  claim above can be checked in the UI. It never selects `users.pass_hash` or `sessions.token` (a token is a live
  sign-in), and shows only the first 48 bytes of each ciphertext.
- **No foreign key from `board` to `campaigns`.** Board entries must outlive any cleanup of campaign data. The audit
  trail isn't deleted with the data it describes.
