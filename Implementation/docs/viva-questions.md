# Viva preparation — likely questions and good answers

Grouped by theme. Answers are short enough to say out loud; follow-ups point to where the detail is.

---

## A. Problem and motivation

**Q1. What problem does E-Privacy solve, in one sentence?**
It lets a hospital get statistics computed by a cloud it doesn't trust, without the cloud ever seeing a plaintext value,
and lets anyone check that the numbers are complete and correct.

**Q2. What is the "data-in-use gap"?**
TLS protects data in transit and AES protects it at rest, but conventional analytics must decrypt to compute. For that
window the plaintext is in the server's memory, exposed to insiders and memory-scraping malware (Pre-Study §3). Paillier
lets the cloud compute on ciphertext, so the window doesn't exist.

**Q3. Why not just anonymise the data?**
Removing names and IDs doesn't stop linkage attacks: ZIP code + birth date + sex re-identifies most people when joined with
public data (Pre-Study §5). In our system those quasi-identifiers never leave the hospital at all.

---

## B. Cryptography

**Q4. Why Paillier and not RSA or FHE?**
RSA isn't additively homomorphic, so the server would have to decrypt to add (it breaks confidentiality in use).
FHE (CKKS) works but at 2048-bit parameters our benchmark showed ~611× more storage than Paillier (617 GB vs 1 GB for 2M
records). Paillier is the narrowest scheme that does sums, averages and counts on ciphertext (Crypto Design §2.2, §3).

**Q5. Show the homomorphic property.**
`E(m₁)·E(m₂) = g^{m₁}r₁ⁿ · g^{m₂}r₂ⁿ = g^{m₁+m₂}(r₁r₂)ⁿ = E(m₁+m₂) mod n²`. And `E(m)^k = E(km)`.

**Q6. How do you compute an average if Paillier can't divide?**
The cloud returns E(Σx) and the group size n is public, so the hospital computes Σx / n after decryption. No
ciphertext division is needed.

**Q7. How do you get standard deviation, when Paillier can't multiply ciphertexts?**
The hospital encrypts x² as an extra column. The cloud sums both. After decryption:
`Var = (n·Σx² − (Σx)²) / n²`, done exactly in BigInt. It costs nearly double the ciphertexts but needs no extra round or new crypto.

**Q8. How are decimals handled?**
Fixed-point: bills ×100, BMI ×10, the rest ×1, rounded to integers before encryption. Sums stay exact integers, which is
why decrypted and plaintext sums match to the unit.

**Q9. Why is 2048 the default key length?**
Our benchmark: 2048-bit gave sub-5-minute aggregation for 2M records, while 3072 roughly doubled the latency; 1024 is below
current recommendations (NIST treats RSA-1024-equivalent security as deprecated). 2048 ≈ 112-bit security.

**Q10. Why is a ciphertext twice the key size?**
Ciphertexts live modulo n², so a 2048-bit key gives 4096-bit (512-byte) ciphertexts.

**Q11. Is Paillier deterministic? Why does that matter?**
No. Each encryption uses fresh random r, so two patients with the same age get unrelated ciphertexts. Otherwise the cloud
could count equal values (frequency analysis).

**Q12. Why a new key per campaign?**
Key rotation per analytics campaign (Crypto Design §2.1). A leaked key exposes one campaign, not the history.

---

## C. Verifiability

**Q13. Difference between individual and universal verifiability?**
Individual: the hospital checks its own records were stored as uploaded and used in its query (receipts, inclusion proofs,
root and count checks). Universal: anyone with only public data can check the log, the input set, the arithmetic and the
decryption (four checks run in the auditor's browser).

**Q14. What does the Merkle tree give you?**
One 32-byte root commits to every record. If the cloud drops, adds, substitutes or relabels a record, the root changes.
An inclusion proof for one record is only log₂N hashes (10 for 1,000 records).

**Q15. Why do the leaves include department, ward etc.?**
Those labels are in the clear so the cloud can group. If only the ciphertext were hashed, the cloud could move a record
to another group without changing the root.

**Q16. How can an auditor check a decryption without the private key?**
Paillier decryption also reveals the randomness r. The hospital publishes (m, r); anyone checks `gᵐ·rⁿ ≡ C (mod n²)`.
Encryption is a bijection, so no other m fits that C. Even the hospital can't misreport to a regulator.

**Q17. Doesn't publishing r leak something?**
It's the r of the *aggregate*, i.e. the product of the records' random factors, which is itself uniformly random.
It says nothing about any single record.

**Q18. What stops the cloud from rewriting history?**
Each board entry includes the previous entry's hash and is signed with the cloud's P-256 key. Editing any entry breaks the
chain and every later link; the hospital pins the key, so the cloud can't swap it either.

**Q19. Can a dishonest cloud still cheat?**
It can *deviate*, but not *silently*. Demo: the admin fault switch. *Drop* → hospital rejects (root and count mismatch),
auditor's input-set check fails. *Tamper* → the root still matches but the hospital's plaintext recomputation and the
auditor's product check both fail. A cloud that simply refuses to answer is an availability failure, not a hidden one.

**Q20. Why does the hospital recompute from plaintext if it trusts the maths?**
Because it can, cheaply, and it catches a tampered ciphertext inside the correct input set, which the root alone can't.
It is also how we show accuracy: difference 0 on every sum.

---

## D. Privacy of what is revealed

**Q21. What does the cloud learn?**
Per record: seven coarse labels (department, ward, admission type, insurance, month, sex, age band). Per query: group
sizes. Never identifiers, exact ages or values.

**Q22. Aren't those labels quasi-identifiers?**
Yes. That is the main trade-off (AD-3). Mitigations: labels are coarse (age band, month), groups under k=10 are withheld,
and the true identifiers never leave. Stronger options: encrypted one-hot group indicators, or differential-privacy noise
on released aggregates.

**Q23. What is k-min and why 10?**
The cloud won't release a group with fewer than k records (Verifiability V4), so an "average" can't be one patient's value.
10 is a common small-cell suppression threshold in health statistics; it's configurable (`K_MIN`).

**Q24. Can two queries be combined to isolate someone (differencing attack)?**
Queries always run over the whole committed set and small groups are withheld, which limits it, but it isn't a formal
guarantee. Differential privacy is the proper fix and is listed as future work in the SRS.

---

## E. Architecture and implementation

**Q25. Why two backend services?**
To make the trust boundary physical: the owner has the CSV and the keys but no database access; the cloud has the
database but has never received a key. They talk only through the cloud's public API.

**Q26. Why Node for crypto?**
Requested stack, and native BigInt is enough for Paillier. The cost is speed: ~44 ms per 2048-bit encryption single-threaded,
so encryption runs on a worker-thread pool.

**Q27. Why is the auditor's verification in the browser?**
A verify endpoint on the cloud would be the cloud checking itself. In the browser (Web Worker) the auditor installs nothing
and runs independent code over public data only.

**Q28. How do the three parties agree on hashes?**
One shared module (`shared/protocol.js`) imported by the owner, the cloud and the browser, using `@noble` libraries that
behave identically in Node and browsers.

**Q29. Why isn't the board payload a MySQL JSON column?**
MySQL normalises JSON (key order, whitespace). The bytes would change and every hash and signature would break.
It's stored as the exact string that was signed.

**Q30. How are sessions handled?**
Random 256-bit bearer tokens in a `sessions` table with expiry; passwords with scrypt. The hospital has its own separate
login; the browser keeps the two sessions apart.

**Q31. Why sample the dataset rather than encrypt all 540k rows?**
At 2048 bits and 26 values per row that's 14M encryptions (~7 GB of ciphertext) and hours of CPU. A uniform reservoir sample
is statistically representative and shows the same behaviour.

**Q32. How is the database seeded?**
It isn't, beyond the three login accounts. Records only ever arrive as ciphertext through a campaign.

---

## F. Results and evaluation

**Q33. How do you know the results are accurate?**
Every decrypted sum is compared with the sum computed directly from plaintext: the accuracy ledger shows 0 difference on
all of them, because fixed-point integers make the arithmetic exact.

**Q34. What about storage overhead?**
Per encrypted measure, ciphertext / source-row bytes: ~1.4× at 1024 bits and ~2.9× at 2048 bits for our ~179-byte rows,
inside the SRS budget of 11×. Per whole row with 26 values it's much larger, which is the price of encrypting 14 measures
plus their squares. (See `performance.md` for the measured table.)

**Q35. What limits scalability?**
Encryption on the hospital side (CPU-bound modular exponentiation), and the cloud loading a whole campaign into memory per query.
Both are embarrassingly parallel: more worker threads / nodes, and streaming by record range.

**Q36. What would you do with more time?**
Differential privacy on outputs; threshold Paillier for multi-hospital studies; streaming aggregation across workers;
TLS/mTLS inside the deployment; HSM-backed key storage; dark mode.

---

## G. Curveballs

**Q37. If the cloud is honest-but-curious, why bother with verifiability?**
The assumption covers confidentiality. Verifiability turns a violation of the *behavioural* assumption into a detectable
event instead of a wrong number in a report.

**Q38. Could the hospital just lie about its plaintext?**
It could lie about what it uploaded, but not about what the ciphertexts decrypt to: the (m, r) proof binds the published
number to the signed ciphertext sum.

**Q39. What happens if the cloud's signing key is lost?**
A new key would not match the hospital's pin, so the hospital refuses new results until the key is re-established out of
band. Old entries still verify against the old key.

**Q40. Why not use a blockchain for the bulletin board?**
The properties needed are append-only + tamper-evident + attributable. A hash chain with signatures gives those with one
writer. A blockchain adds consensus among mutually distrusting writers, which a single-cloud deployment doesn't need.
