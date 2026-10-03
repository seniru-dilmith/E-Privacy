# Problems met during development and how they were resolved

In the order they came up. Each entry: symptom → cause → fix → what it taught us.

---

### 1. Unrealistic ICU share in the first dataset
**Symptom.** A 20k-row trial of the generator put ~10.5 % of admissions in ICU and ~9 % in HDU, too high for a general hospital.
**Cause.** The emergency multiplier on ICU probability (×1.6) compounded with comorbidity and age boosts.
**Fix.** Emergency ×1.25, elective ×0.6, HDU band 1.8× the ICU probability. ICU share now ≈ 8 %.
**Lesson.** Sanity-check synthetic data per group before building charts on it; the charts would have "worked" and been wrong.

### 2. The dataset couldn't keep 2M rows
**Symptom.** 26 columns × 2M rows ≈ 350 MB.
**Cause.** GitHub rejects files over 100 MB (warns over 50 MB).
**Fix.** 540,000 rows (96.7 MB), deterministic generator committed next to it, campaigns sample from it.

### 3. 2048-bit encryption is expensive in JavaScript
**Symptom.** Benchmark: 44 ms per encryption, 26 values per record.
**Cause.** Each encryption is a 2048-bit exponent modulo a 4096-bit number, in pure-JS BigInt.
**Fix.** Worker-thread pool; campaigns encrypt a sample; squares optional.

### 4. npm install-script warning for esbuild
**Symptom.** npm 11 warns that esbuild's postinstall isn't in its allow-list.
**Fix.** Server images install with `--ignore-scripts` (they don't need esbuild). The web build image runs the normal install.

### 5. `node --test shared/` failed on Node 24
**Cause.** A bare directory argument is treated as a file to run.
**Fix.** `node --test shared/*.test.js`.

### 6. Recovering the Paillier randomness
**Expected problem.** The decryption proof needs r from C, which meant writing number theory by hand.
**Resolution.** `paillier-bigint` already has `getRandomFactor` (needs `g = n + 1` and p, q), so keys are generated in the
"simple variant" and nothing was hand-written.

### 7. Docker refused the bind mounts
**Symptom.** `mounts denied: The path …/db/schema.sql is not shared from the host`.
**Cause.** Docker Desktop on Linux only shares configured host paths; the project is under `/mnt/workspace`.
**Fix.** No bind mounts at all: schema baked into `db/Dockerfile`, CSV copied into the owner image.
**Lesson.** Turned out better: the stack runs anywhere, and the dataset now physically exists only in the trusted container.

### 8. `EACCES` writing the cloud signing key
**Symptom.** Cloud crashed on start: permission denied on `/var/lib/cloud/signing.key`.
**Cause.** Named volumes are created root-owned; the service runs as the `node` user.
**Fix.** `mkdir` + `chown node:node` of the mount point in the Dockerfile; Docker seeds a *new* volume with the image
directory's ownership. The volume from the failed run had to be removed once (`down -v`).

### 9. Hyper-threads don't help
**Observation.** 15 worker threads were not faster than 8 on an 8-core/16-thread CPU.
**Cause.** BigInt exponentiation keeps the integer units busy; two hyper-threads share one core's units.
**Kept.** The pool still uses `cores − 1` (harmless), but estimates are based on measured rates.

### 10. CRT encryption wasn't worth it
**Idea.** The owner knows p and q, so `rⁿ mod n²` can be computed mod p² and q² and recombined.
**Result.** 45 → 29 ms (1.5×). V8's big-integer multiply doesn't get cheaper as steeply as the textbook suggests.
**Decision.** Not adopted: custom crypto code for 1.5× goes against assumption B1 (use reviewed libraries).

### 11. First end-to-end run
600 records, 1024-bit: all five owner checks passed; 0 of 50 decrypted sums differed from plaintext; cloud query 207 ms,
decryption 397 ms. (A good sign, recorded because nothing had been integration-tested before it.)

### 12. Analysis hung while a campaign was encrypting
**Symptom.** Opening the Analysis page during a 2048-bit campaign showed "Summing ciphertexts…" for minutes.
**Cause.** The worker pool is a FIFO queue, and a campaign enqueues all its encryption chunks at once. The analysis's
decrypt tasks waited behind all of them.
**Fix.** Decrypt tasks go to the head of the queue (`owner/src/pool.js`). Committed separately.

### 13. Real encryption rate 4–5× below estimate
**Symptom.** The 1,000-record 2048-bit campaign took 1,022 s (~25 enc/s); the UI had estimated ~4 minutes.
**Diagnosis.** Single-thread speed is identical in and out of the container (43 ms). Thread scaling is not:
host 20/40/74/112/109 enc/s for 1/2/4/8/15 threads; container 18/32/51/57/65 in a short burst and ~25 sustained.
Docker Desktop's VM plus a 15 W laptop CPU throttling under a long all-core load.
**Fix.** Estimates now use measured sustained rates (1024: 180, 2048: 30, 3072: 10 enc/s) and switch to the live rate of the
last run at the same key length; default sample lowered to 500. README states the real timings.

### 14. Sessions lost when the owner restarted
**Symptom.** After rebuilding the owner, pages showed "Please sign in" as an error instead of going to the sign-in page.
**Cause.** Owner sessions are in memory (by design: a restart logs everyone out), and the UI didn't react to 401.
**Fix.** A 401 on either API clears that side's session and routes to its sign-in with `next` set.

### 15. Chart readability issues found in review
- **Whisker labels on top of whiskers.** Labels moved past the whisker's right end (custom series text).
- **Mean bill band below zero.** Bills are right-skewed, so mean − s.d. < 0. The band is now floored at 0 for non-negative
  measures and the caption says so; the tooltip still shows the true s.d.
- **Decimal ticks** (`140.0`, `8.0`) on integer axes. `compact()` returns integers as-is.
- **Traffic chart skipped idle minutes**, compressing time. It now always shows 60 one-minute slots.
- **Budget line on the storage chart didn't render** (label position on a vertical mark line). Fixed style and position; the axis
  now extends to include the reference value.
- **Crowded percentage ticks** on the mortality chart: `splitNumber: 4`.

### 16. Planned dual-axis chart dropped
The plan had "monthly admissions + mean charges on a dual axis". Dual axes make two unrelated scales look correlated,
so it became two charts sharing the month axis.

### 17. Fault injection confirmed the design
- **tamper** (square one ciphertext): owner rejected every query (plaintext check); auditor's computation check listed exactly
  five failures, one per tampered query; no decryption proof was published for them.
- **drop** (leave one record out): owner rejected with three failed checks: root `38c0b308…` vs receipt `5683db42…`,
  count 999 vs 1000, and 2 of 20 sums differing.

Screenshots: `screenshots/09-analysis-rejected.png`, `screenshots/10-board-audit-failed.png`.

### 18. A subtle point caught while writing the security analysis
The cloud's query root is computed from the *stored* leaf hashes. A cloud that edits a record's label in the database
but keeps the old leaf hash would pass the owner's root check. It is still caught, twice: the owner's plaintext check (group
sums change) and the auditor, who rebuilds leaves from the *published* labels and ciphertexts. Documented in the
security analysis instead of changed: recomputing every leaf per query would cost a SHA-256 per record and add no
detection power.

### 19. `node --watch` crashed key generation
**Symptom.** In the first version of the hot-reload setup, the owner died on start with
`Cannot destructure property 'resolve' of 'pending.get(...)'`, and after a guard for that, during key generation with
`Cannot read properties of undefined (reading 'isPrime')` inside `bigint-crypto-utils`.
**Cause.** Node's watch mode (`--watch` and `--watch-path` alike) exchanges its own messages with every worker thread.
Our pool and `paillier-bigint`'s prime-generation workers both assume every message is theirs.
**Fix.** Don't use Node's watch mode for these services. `shared/dev/watch.js` (25 lines, stdlib only) restarts the
process from outside. The guard in the pool was reverted, because it only hid the symptom in one of the two places.

### 20. Recursive `fs.watch` missed repeated edits
**Symptom.** The first restart worked; the next save of the same file did nothing.
**Cause.** On Linux, Node's recursive `fs.watch` follows individual files. Saving by writing a new file and renaming it
(what `sed -i` and many editors do) replaces the inode, and the watch is lost.
**Fix.** One non-recursive watcher per directory. A directory watch sees replaced files. Verified with six
edit/revert cycles.

### 21. Dev override replaced the production web image
**Symptom.** After using `docker-compose.dev.yml`, a plain `docker compose up -d` left the web container restarting.
**Cause.** The dev override builds the web image's Node build stage (to run Vite), and Compose tagged it with the
same name as the nginx image.
**Fix.** The dev web service has its own image name, `e-privacy-web-dev`.

### 22. Two signing keys on one board
**Symptom.** Testing the host setup against the Docker MySQL added board entries signed by the host cloud's freshly
generated key. The auditor verifies the whole board against one key, so its log-integrity check would fail.
**Fix.** The test entries were removed, and DEVELOPMENT.md explains how to share the Docker signing key or use a
separate database for host work.

### 23. Cloud sign-in "did nothing" for the service account
**Symptom.** Signing in to the cloud console with `CLOUD_OWNER_USER` succeeded (200) but landed back on the sign-in page
with no message.
**Cause.** That account has role `owner`, which no console page allows, so the router guard bounced it silently.
**Fix.** `Login.vue` signs the service account straight back out and says to use an auditor or admin account.

### 24. Navigation silently stopped after a rebuild
**Symptom.** After `docker compose up --build`, signing in did nothing in a browser that had the app open before.
**Cause.** The cached `index.html` named the old content-hashed chunks. They no longer existed, and nginx's
`try_files $uri /index.html` answered with HTML, so the dynamic import failed and the route change was dropped.
**Fix.** `index.html` is served `no-cache`; `/assets/` returns 404 for unknown files and is cached as immutable;
`router.onError` reloads the target page when a chunk fails to load.

### 25. The admin's audit stopped at 403
**Symptom.** "Run all four checks" as admin: log integrity held, then `/campaigns/:id/records … returned 403`.
**Cause.** The board and its audit were open to admins, but the records route allowed only auditor and owner.
**Fix.** The records route allows any cloud role. It serves only ciphertext and coarse labels the admin's own database
already holds, and the audit is meant to be repeatable by anyone from public data.
