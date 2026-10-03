<div align="center">

# E-Privacy

**Privacy-preserving analytics for hospital data.**
Statistics are computed in an untrusted cloud without the cloud ever seeing a single patient's value,
and anyone can check that the results are complete and correct.

![Paillier 2048-bit](https://img.shields.io/badge/encryption-Paillier%202048--bit-0f6b5c)
![Verifiable](https://img.shields.io/badge/audit-publicly%20verifiable-33498f)
![Vue 3](https://img.shields.io/badge/frontend-Vue%203-42b883)
![Node.js](https://img.shields.io/badge/backend-Node.js%20%2B%20Express-3c873a)
![MySQL](https://img.shields.io/badge/database-MySQL%208-00758f)
![Docker](https://img.shields.io/badge/runs%20with-Docker%20Compose-2496ed)

</div>

---

## The problem

Hospitals want answers like *"what is the average length of stay in cardiology?"* or *"how does the 30-day readmission
rate differ between departments?"*, and they increasingly rely on cloud infrastructure to compute them.

Data is usually protected **at rest** (disk encryption) and **in transit** (TLS). But to compute anything, a normal
analytics server has to **decrypt** the records first. For that moment the plaintext sits in the server's memory, open to
insiders, compromised hosts and memory-scraping malware. This is the *data-in-use gap*.

> [!IMPORTANT]
> Removing names and ID numbers is not enough. Postcode, date of birth and sex together re-identify most people when
> joined with public records. This is known as a **linkage attack**.

## The idea

> [!TIP]
> **Compute on data that stays encrypted.** With an *additively homomorphic* cipher, multiplying two ciphertexts gives
> the encryption of the **sum** of their values. The cloud can add up thousands of encrypted bills, stays or outcomes
> and return an encrypted total. Only the hospital, which holds the private key, can read it.

E-Privacy builds a complete system around that idea, and adds what a real deployment needs: access control, a
tamper-evident audit trail, and proofs that the cloud didn't cheat.

## How it works

| | Step | Where | What happens |
|:-:|---|---|---|
| 🔑 | **Keys** | Hospital | A fresh Paillier keypair per analytics campaign. The private key never leaves the hospital. |
| 🔒 | **Encrypt** | Hospital | Names, ID numbers, birth dates and postcodes are dropped. Every clinical and billing measure is encrypted. |
| 🧾 | **Receipt** | Cloud → Hospital | The cloud stores the ciphertext and signs a Merkle-tree receipt over every record it received. |
| ➕ | **Aggregate** | Cloud | Grouped sums are computed directly on ciphertext. Tiny groups are withheld so no individual can be singled out. |
| ✅ | **Verify & decrypt** | Hospital | The result is accepted only after five independent checks; then it is decrypted and charted. |
| 🌍 | **Audit** | Anyone | A public, signed, hash-chained bulletin board lets any auditor re-check every step, without any key. |

> [!NOTE]
> The cloud can still misbehave, but it **cannot do so silently**. Dropping a record, adding one, altering a
> ciphertext or rewriting its log is caught by the hospital, the auditor, or both. The application ships with a
> switch that makes the cloud cheat on purpose, so you can see this happen.

## What you can do with it

- **Hospital records office**: choose a sample of admissions and a key length, see the exact rows sampled, watch them
  being encrypted, and explore the decrypted results: department comparisons, monthly trends, ward costs, vital
  signs by age band, and an accuracy ledger showing every decrypted sum matches the source data exactly.
- **Auditor**: replay the entire public record in the browser and confirm the log, the input data, the arithmetic
  and every published result.
- **Operator**: monitor traffic, latency and ciphertext storage, and browse the cloud database itself, without ever
  seeing a key or a patient value.

## Security goals

<details>
<summary><b>Confidentiality</b>: no plaintext outside the hospital</summary>
<br>

Encryption and decryption happen only inside the hospital's own service. The cloud receives public keys, ciphertext and
a few coarse grouping labels (department, ward, month, age band …), never identifiers or measured values.

</details>

<details>
<summary><b>Integrity</b>: changes are detectable</summary>
<br>

Every stored record is a leaf of a Merkle tree whose root the cloud signs on upload. Any substituted, missing, extra
or re-labelled record changes that root.

</details>

<details>
<summary><b>Anonymity</b>: aggregates only</summary>
<br>

Only group statistics are ever released, and groups below a minimum size are withheld by policy. Direct identifiers
never leave the hospital, so there is nothing to link.

</details>

<details>
<summary><b>Verifiability</b>: individual and universal</summary>
<br>

*Individually*, the hospital proves its own records were stored as uploaded and used in its query.
*Universally*, any auditor checks the signed log, rebuilds the input set, recomputes every encrypted sum and verifies
every published result with only public information. Even the hospital cannot misreport a result.

</details>

## Why Paillier?

| Approach | Computes without decrypting? | Storage (2M records, 2048-bit) | Verdict |
|---|:-:|:-:|---|
| Decrypt → compute → re-encrypt (RSA) | ❌ | – | leaves the data-in-use gap open |
| Fully homomorphic encryption (CKKS) | ✅ | ~617 GB | far too heavy for sums and averages |
| **Partially homomorphic (Paillier)** | ✅ | **~1 GB** | ✔ chosen: the narrowest scheme that does the job |

<sub>Figures from the project's own benchmark, reported in the Cryptographic Design document.</sub>

## The dataset

A synthetic but realistic **hospital admissions** dataset of 540,000 records across ten departments, with patient
identifiers, admission details, vital signs, lab and ICU usage, costs, and outcomes such as 30-day readmission and
in-hospital mortality. The columns are correlated the way real hospital data is, which makes the analytics meaningful.
No real patient data is used anywhere.

## Project documents

| Document | Covers |
|---|---|
| [Pre-Study](Documents/Pre-Study.tex) | security requirements and why conventional analytics fall short |
| [Systems Requirements Specification](Documents/Proposal.tex) | architecture, functional and non-functional requirements |
| [Cryptographic Design](Documents/CryptographicDesign.tex) | Paillier, key management, benchmark against RSA and FHE |
| [Verifiability](Documents/Verifiability.tex) | individual and universal verifiability, bulletin board protocol |
| [Implementation](Implementation/README.md) | the working system and how to run it |

## Status

- [x] Security requirements study
- [x] Requirements specification
- [x] Cryptographic design and benchmarking
- [x] Verifiability design
- [x] Working implementation with encryption, verification, auditing and monitoring
- [ ] Differential-privacy noise on released results
- [ ] Multi-hospital studies with threshold decryption

> [!CAUTION]
> This is an academic project. It demonstrates the design end to end, but it has not been security-audited for use
> with real patient data.

## Team

**Dilmith D. L. S.** · **Hansana O. G. V.** · **Vidyananda H. K. H.**
