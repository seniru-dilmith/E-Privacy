// Synthetic hospital admissions for E-Privacy.
// Usage: node data/generate.js [rows] [seed]
// Output is deterministic for a given (rows, seed) pair.
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROWS = Number(process.argv[2] ?? 540000);
const SEED = Number(process.argv[3] ?? 20260929);
const OUT = fileURLToPath(new URL('./hospital_admissions.csv', import.meta.url));

// mulberry32
let s = SEED >>> 0;
const rand = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const normal = (mu = 0, sd = 1) => mu + sd * Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const lognormal = (mu, sd) => Math.exp(normal(mu, sd));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const weighted = (entries) => {
  let r = rand() * entries.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of entries) if ((r -= w) <= 0) return v;
  return entries[entries.length - 1][0];
};
const poisson = (lambda) => {
  // Knuth; lambdas here stay small enough
  let k = 0, p = 1;
  const l = Math.exp(-lambda);
  do { k++; p *= rand(); } while (p > l);
  return k - 1;
};
const logistic = (z) => 1 / (1 + Math.exp(-z));

// ageMu/ageSd: age at admission, los: log-mean of stay (days), icu: base ICU probability,
// med: medication cost per day (LKR), fee: procedure fee (LKR, elective-weighted)
const DEPARTMENTS = {
  'Cardiology':        { w: 11, ageMu: 62, ageSd: 12, los: 1.45, icu: 0.16, med: 5200, fee: 420000, emerg: 0.62 },
  'Orthopaedics':      { w: 10, ageMu: 52, ageSd: 19, los: 1.35, icu: 0.03, med: 2600, fee: 380000, emerg: 0.35 },
  'General Medicine':  { w: 20, ageMu: 56, ageSd: 18, los: 1.25, icu: 0.05, med: 2100, fee: 20000,  emerg: 0.72 },
  'General Surgery':   { w: 13, ageMu: 48, ageSd: 17, los: 1.30, icu: 0.06, med: 2900, fee: 260000, emerg: 0.45 },
  'Paediatrics':       { w: 10, ageMu: 0,  ageSd: 0,  los: 0.95, icu: 0.04, med: 1300, fee: 15000,  emerg: 0.66 },
  'Obstetrics':        { w: 11, ageMu: 29, ageSd: 5,  los: 0.90, icu: 0.01, med: 1500, fee: 95000,  emerg: 0.40 },
  'Neurology':         { w: 6,  ageMu: 60, ageSd: 16, los: 1.60, icu: 0.12, med: 4100, fee: 60000,  emerg: 0.70 },
  'Oncology':          { w: 7,  ageMu: 58, ageSd: 13, los: 1.70, icu: 0.07, med: 9800, fee: 180000, emerg: 0.25 },
  'Respiratory':       { w: 7,  ageMu: 57, ageSd: 20, los: 1.40, icu: 0.10, med: 2700, fee: 25000,  emerg: 0.78 },
  'Nephrology':        { w: 5,  ageMu: 55, ageSd: 14, los: 1.50, icu: 0.08, med: 3600, fee: 70000,  emerg: 0.55 },
};
const DEPT_ENTRIES = Object.entries(DEPARTMENTS).map(([k, v]) => [k, v.w]);
const WARD_DAILY = { 'General': 4500, 'Semi-Private': 11000, 'Private': 22000, 'HDU': 38000, 'ICU': 0 };
const ICU_HOURLY = 5200;
const LAB_FEE = 1850;

const FIRST_M = ['Kasun', 'Nuwan', 'Chamara', 'Tharindu', 'Dinesh', 'Ruwan', 'Sampath', 'Lahiru', 'Pradeep', 'Mahesh',
  'Arjun', 'Suresh', 'Karthik', 'Rizwan', 'Imran', 'Fazil', 'Janaka', 'Asanka', 'Buddhika', 'Isuru', 'Dilan', 'Hasitha'];
const FIRST_F = ['Nadeesha', 'Dilini', 'Sanduni', 'Chathuri', 'Iresha', 'Kavindi', 'Tharushi', 'Nimali', 'Anjali', 'Priya',
  'Lakshmi', 'Fathima', 'Shazna', 'Hiruni', 'Sachini', 'Madhavi', 'Rashmi', 'Yasodha', 'Gayani', 'Thilini', 'Nethmi'];
const LAST = ['Perera', 'Fernando', 'Silva', 'Jayasinghe', 'Bandara', 'Wickramasinghe', 'Rathnayake', 'Gunawardena',
  'Dissanayake', 'Herath', 'Senanayake', 'Kumara', 'Wijesekara', 'Rajapaksha', 'Ekanayake', 'Karunaratne',
  'Sivakumar', 'Navaratnam', 'Mohamed', 'Hameed', 'Liyanage', 'Amarasinghe', 'Weerasinghe', 'Abeysekera'];
const POSTCODES = ['00100', '00300', '00500', '00700', '10100', '10250', '10400', '11010', '11160', '11500', '12000',
  '20000', '20400', '30000', '40000', '50000', '60000', '70000', '80000', '81000', '82000', '90000', '91000', '32000'];

const START = Date.UTC(2025, 0, 1);
const DAYS = 546; // Jan 2025 - Jun 2026
const DAY_MS = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

const HEADER = [
  'admission_id', 'patient_name', 'national_id', 'date_of_birth', 'postcode', 'sex',
  'admission_date', 'discharge_date', 'department', 'ward_type', 'admission_type', 'insurance_type',
  'age', 'length_of_stay_days', 'icu_hours', 'comorbidity_count', 'lab_tests_count',
  'systolic_bp', 'diastolic_bp', 'heart_rate', 'bmi', 'blood_glucose',
  'medication_cost', 'total_charges', 'readmitted_30d', 'in_hospital_death',
];

function row(i) {
  const deptName = weighted(DEPT_ENTRIES);
  const d = DEPARTMENTS[deptName];

  // Respiratory admissions peak in the monsoon months (May-Jul, Nov-Dec)
  let dayOffset = Math.floor(rand() * DAYS);
  if (deptName === 'Respiratory' && rand() < 0.35) {
    const peaks = [[120, 210], [304, 365], [485, 546]];
    const [a, b] = pick(peaks);
    dayOffset = a + Math.floor(rand() * (b - a));
  }
  const admitMs = START + dayOffset * DAY_MS;

  const sex = deptName === 'Obstetrics' ? 'F' : rand() < 0.49 ? 'F' : 'M';
  const age = deptName === 'Paediatrics'
    ? Math.floor(clamp(lognormal(1.3, 0.9), 0, 17))
    : Math.round(clamp(normal(d.ageMu, d.ageSd), deptName === 'Obstetrics' ? 17 : 18, 97));

  const comorb = Math.min(9, poisson(0.15 + Math.max(0, age - 20) / 22));
  const admissionType = rand() < d.emerg ? 'Emergency' : rand() < 0.85 ? 'Elective' : 'Transfer';
  const insurance = weighted([['Government', 46], ['Private Insurance', 26], ['Corporate', 14], ['Self-Pay', 14]]);

  const pIcu = clamp(d.icu * (admissionType === 'Emergency' ? 1.25 : 0.6) * (1 + comorb * 0.12) * (age > 70 ? 1.3 : 1), 0, 0.6);
  let ward;
  const r = rand();
  if (r < pIcu) ward = 'ICU';
  else if (r < pIcu * 1.8) ward = 'HDU';
  else if (insurance === 'Private Insurance' || insurance === 'Corporate') ward = weighted([['Private', 45], ['Semi-Private', 40], ['General', 15]]);
  else if (insurance === 'Self-Pay') ward = weighted([['Private', 20], ['Semi-Private', 40], ['General', 40]]);
  else ward = weighted([['General', 82], ['Semi-Private', 15], ['Private', 3]]);

  const los = Math.max(1, Math.round(lognormal(d.los + 0.07 * comorb + (ward === 'ICU' ? 0.45 : ward === 'HDU' ? 0.2 : 0), 0.5)));
  const icuHours = ward === 'ICU'
    ? Math.round(clamp(lognormal(Math.log(52), 0.6), 6, los * 24))
    : ward === 'HDU' ? Math.round(clamp(lognormal(Math.log(10), 0.7), 0, los * 12)) : 0;
  const labs = poisson(Math.min(60, 2.5 + 1.4 * los + (icuHours > 0 ? 6 : 0) + comorb * 0.6));

  const child = age < 13;
  const systolic = Math.round(clamp((child ? 98 + age * 1.3 : 108 + 0.42 * age) + 3.5 * comorb + (deptName === 'Cardiology' ? 7 : 0) + normal(0, 12), 70, 230));
  const diastolic = Math.round(clamp(0.52 * systolic + 12 + normal(0, 7), 40, 135));
  const heartRate = Math.round(clamp((child ? 118 - age * 3.5 : 76) + (ward === 'ICU' ? 11 : 0) + normal(0, 11), 40, 190));
  const bmi = +(age < 18
    ? clamp(15 + age * 0.35 + normal(0, 2.2), 11, 38)
    : clamp(normal(24.8 + (sex === 'F' ? 0.6 : 0) + Math.min(age, 60) * 0.02, 4.3), 14, 52)).toFixed(1);
  const diabetic = rand() < clamp(0.03 + comorb * 0.06 + Math.max(0, bmi - 27) * 0.012, 0, 0.7);
  const glucose = Math.round(clamp(92 + (diabetic ? lognormal(Math.log(90), 0.45) : 0) + (bmi - 25) * 1.2 + normal(0, 14), 55, 480));

  const medication = +(los * d.med * lognormal(0, 0.35) + icuHours * 850).toFixed(2);
  const fee = d.fee * (admissionType === 'Elective' ? lognormal(0, 0.25) : rand() < 0.4 ? lognormal(-0.2, 0.3) : 0);
  const total = +Math.max(
    1500,
    WARD_DAILY[ward] * los + icuHours * ICU_HOURLY + labs * LAB_FEE + medication + fee + normal(0, 3500),
  ).toFixed(2);

  const died = rand() < logistic(-6.6 + 0.05 * (age - 50) + 0.32 * comorb + (ward === 'ICU' ? 2.4 : ward === 'HDU' ? 1.1 : 0)
    + (deptName === 'Oncology' ? 1.0 : 0) + (admissionType === 'Emergency' ? 0.5 : 0) + (age < 1 ? 1.2 : 0));
  const readmit = !died && rand() < logistic(-3.1 + 0.014 * (age - 50) + 0.27 * comorb + 0.04 * los
    + (admissionType === 'Emergency' ? 0.3 : 0) + (deptName === 'Nephrology' || deptName === 'Oncology' ? 0.55 : 0));

  const dobMs = admitMs - (age * 365.25 + Math.floor(rand() * 365)) * DAY_MS;
  const dob = new Date(dobMs);
  const doy = Math.floor((dobMs - Date.UTC(dob.getUTCFullYear(), 0, 1)) / DAY_MS) + 1;
  const nic = `${dob.getUTCFullYear()}${String(doy + (sex === 'F' ? 500 : 0)).padStart(3, '0')}${String(Math.floor(rand() * 1e5)).padStart(5, '0')}`;
  const name = `${pick(sex === 'F' ? FIRST_F : FIRST_M)} ${pick(LAST)}`;

  return [
    `ADM-${String(1000000 + i)}`, name, nic, iso(dobMs), pick(POSTCODES), sex,
    iso(admitMs), iso(admitMs + los * DAY_MS), deptName, ward, admissionType, insurance,
    age, los, icuHours, comorb, labs, systolic, diastolic, heartRate, bmi, glucose,
    medication.toFixed(2), total.toFixed(2), readmit ? 1 : 0, died ? 1 : 0,
  ].join(',');
}

const out = createWriteStream(OUT);
out.write(HEADER.join(',') + '\n');
let buf = [];
for (let i = 0; i < ROWS; i++) {
  buf.push(row(i));
  if (buf.length === 5000) {
    if (!out.write(buf.join('\n') + '\n')) await new Promise((r) => out.once('drain', r));
    buf = [];
  }
}
if (buf.length) out.write(buf.join('\n') + '\n');
out.end(() => console.log(`wrote ${ROWS} rows to ${OUT}`));
