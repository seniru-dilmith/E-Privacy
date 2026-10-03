# Dataset — `data/generate.js` and `hospital_admissions.csv`

## What it is

540,000 synthetic hospital admissions (Jan 2025 – Jun 2026), 26 columns, 96.7 MB. It replaces the earlier
`financial_dataset_100mb.csv` (2M rows × 4 columns: id, timestamp, account, amount). The financial file had one numeric
column with a uniform distribution, which is enough to benchmark encryption but gives nothing to visualise or compare.

The generator is plain Node (no dependencies) with a seeded PRNG, so `node data/generate.js` always produces the same file,
byte for byte. That makes results reproducible across machines and lets the file be regenerated instead of trusted.

```bash
node data/generate.js              # 540,000 rows, seed 20260929
node data/generate.js 20000 42     # smaller file, other seed
```

## Columns and how each one is treated

| Column | Role in E-Privacy | Leaves the hospital? |
|---|---|---|
| `admission_id`, `patient_name`, `national_id`, `date_of_birth`, `postcode` | direct / strong identifiers | **never**: dropped before encryption |
| `department`, `ward_type`, `admission_type`, `insurance_type`, `sex` | coarse grouping dimensions | yes, in clear, k-min protected |
| `admission_date` → `admission_month` | grouping dimension (month only) | month only |
| `age` → `age_band` | grouping dimension (6 bands) | band in clear, exact age encrypted |
| `discharge_date` | not used by the engine | never |
| `age`, `length_of_stay_days`, `icu_hours`, `comorbidity_count`, `lab_tests_count`, `systolic_bp`, `diastolic_bp`, `heart_rate`, `bmi`, `blood_glucose`, `medication_cost`, `total_charges` | continuous / count measures | only as Paillier ciphertext (plus ciphertext of x²) |
| `readmitted_30d`, `in_hospital_death` | 0/1 outcome flags | only as ciphertext; sums give counts, means give rates |

The identifier columns are there on purpose: they are what a linkage attack (Pre-Study §5) would use, and the system
shows they never cross the trust boundary.

## What is computed from the encrypted columns

The cloud computes one thing on ciphertext: per group, Σ of each requested column (`Π cᵢ mod n²`), plus the group size
in the clear. Everything else is derived by the owner after decryption:

| Encrypted column | Statistic (owner side) | Shown on Analysis |
|---|---|---|
| `length_of_stay_days` | mean ± s.d. | headline, per department, monthly trend |
| `total_charges` (×100) | mean ± s.d. | headline "mean bill", per department, monthly trend, ward × admission-type heatmap |
| `systolic_bp`, `heart_rate`, `bmi` (×10), `blood_glucose` | mean ± s.d. | overall table, per age band |
| `age`, `icu_hours`, `comorbidity_count`, `lab_tests_count`, `diastolic_bp`, `medication_cost` (×100) | mean ± s.d. | overall table |
| `readmitted_30d`, `in_hospital_death` | Σ = count, Σ ÷ n = rate | headline, per department |

Mean = Σx ÷ n; s.d. from `n·Σx² − (Σx)²`, which is why the continuous columns also carry E(x²). Medians,
percentiles and min/max are not possible: Paillier only adds.

## How the values are generated

Each row is built so that columns relate the way they do in real hospital data, which is what makes the charts meaningful:

- **Department** is drawn by weight (General Medicine most common, Nephrology least). It drives the age distribution
  (Paediatrics 0–17 log-normal, Obstetrics ~29 ± 5, Cardiology ~62 ± 12), the log-mean length of stay, the base ICU
  probability, the medication cost per day and the procedure fee.
- **Admission type**: Emergency probability per department (Respiratory 78 %, Oncology 25 %); the rest Elective or Transfer.
- **Ward**: ICU probability rises with emergency admission, comorbidities and age > 70; HDU is a band above ICU;
  otherwise the ward follows insurance (Private insurance → mostly Private rooms, Government → mostly General).
- **Length of stay**: log-normal, shifted up by comorbidities and ICU/HDU stay.
- **ICU hours**: log-normal around 52 h for ICU patients, capped at the stay length.
- **Vitals**: systolic BP rises with age, comorbidities and Cardiology; diastolic follows systolic; children have higher
  heart rates; BMI depends on age and sex; glucose rises with a diabetic flag driven by comorbidities and BMI.
- **Money** (LKR): medication = LOS × department rate × noise + ICU hours × 850; total = ward daily rate × LOS + ICU hours ×
  5,200 + labs × 1,850 + medication + procedure fee (mostly for elective admissions) + noise.
- **Outcomes**: in-hospital death and 30-day readmission are logistic in age, comorbidities, ICU, department and
  emergency admission; a patient who died is never readmitted.
- **Seasonality**: 35 % of Respiratory admissions fall inside the monsoon windows, which shows up in the monthly view.
- **Identifiers**: Sri Lankan-style names, new-format 12-digit NICs consistent with birth year/day and sex
  (+500 for female), dates of birth consistent with age at admission.

Resulting shape (20k-row check during development): Cardiology mean bill ≈ LKR 509k and mortality ≈ 5 %,
Paediatrics mean age ≈ 4.7 and bill ≈ LKR 81k, Oncology and Nephrology readmission ≈ 18–19 %, ICU share ≈ 8 %.

## Decisions

### Size: 540k rows, not 2M
- **Options:** keep 2M rows (as in the benchmark), ~500k rows, ~20k rows.
- **Chosen:** 540k rows / 96.7 MB.
- **Why:** GitHub rejects files over 100 MB. 2M rows × 26 columns would be ~350 MB and need Git LFS. Encrypting 2M rows at
  2048 bits with 26 values each is not realistic on a laptop anyway, so the system samples campaigns from the file (next point).
- **Cons:** not the same N as the benchmark in the crypto design (2M); scaling claims are argued, not demonstrated.

### Campaigns sample the file instead of encrypting all of it
- **Options:** encrypt the whole file once; encrypt a prefix; random sample per campaign.
- **Chosen:** uniform reservoir sample, chosen size per campaign.
- **Why:** 540k × 26 ciphertexts at 2048 bits is ~7 GB of ciphertext and hours of CPU. A random sample is representative
  across months and departments, which a prefix would not be. Reservoir sampling needs one pass and O(k) memory.

### Fixed-point encoding
Paillier works on integers mod n. Each measure has a scale (`charges ×100`, `bmi ×10`, others ×1) and is encoded as
`round(x × scale)`. All values are non-negative, so no signed encoding is needed. Sums stay exact integers, which is
what lets the accuracy ledger show a difference of exactly 0.

### Squares for standard deviation
Paillier cannot multiply two ciphertexts, so the cloud cannot compute Σx² from E(x). The owner encrypts x² as an extra
column when "spread" is on. Then `Var = (n·Σx² − (Σx)²) / n²` is computed with BigInt after decryption, exactly. This is
the SRS's "secondary protocol" for variance, done in one round. Cost: nearly double the ciphertexts. Flags don't need it
(variance of a 0/1 variable is p(1−p)).
