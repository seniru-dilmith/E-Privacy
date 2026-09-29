// Protocol pieces that the owner, the cloud and the auditor's browser must
// agree on byte for byte: record layout, leaf/Merkle hashing, the board's
// hash chain and signatures, and the public check of a Paillier decryption.
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from '@noble/hashes/utils';
import { p256 } from '@noble/curves/p256';

export { bytesToHex, hexToBytes };

// Coarse attributes the cloud may group by. Everything identifying stays
// with the owner; everything measured is encrypted.
export const DIMENSIONS = ['department', 'ward_type', 'admission_type', 'insurance_type', 'admission_month', 'sex', 'age_band'];

// scale: fixed-point factor applied before encryption.
// squared: owner also uploads E(x^2) so the variance can be recovered.
export const METRICS = [
  { name: 'age',                 label: 'Age',                  unit: 'yrs',   scale: 1,   squared: true },
  { name: 'length_of_stay_days', label: 'Length of stay',       unit: 'days',  scale: 1,   squared: true },
  { name: 'icu_hours',           label: 'ICU time',             unit: 'h',     scale: 1,   squared: true },
  { name: 'comorbidity_count',   label: 'Comorbidities',        unit: '',      scale: 1,   squared: true },
  { name: 'lab_tests_count',     label: 'Lab tests',            unit: '',      scale: 1,   squared: true },
  { name: 'systolic_bp',         label: 'Systolic BP',          unit: 'mmHg',  scale: 1,   squared: true },
  { name: 'diastolic_bp',        label: 'Diastolic BP',         unit: 'mmHg',  scale: 1,   squared: true },
  { name: 'heart_rate',          label: 'Heart rate',           unit: 'bpm',   scale: 1,   squared: true },
  { name: 'bmi',                 label: 'BMI',                  unit: 'kg/m²', scale: 10,  squared: true },
  { name: 'blood_glucose',       label: 'Blood glucose',        unit: 'mg/dL', scale: 1,   squared: true },
  { name: 'medication_cost',     label: 'Medication cost',      unit: 'LKR',   scale: 100, squared: true },
  { name: 'total_charges',       label: 'Total charges',        unit: 'LKR',   scale: 100, squared: true },
  { name: 'readmitted_30d',      label: '30-day readmission',   unit: '',      scale: 1,   squared: false, flag: true },
  { name: 'in_hospital_death',   label: 'In-hospital mortality', unit: '',     scale: 1,   squared: false, flag: true },
];
export const METRIC = Object.fromEntries(METRICS.map((m) => [m.name, m]));

export function ageBand(age) {
  if (age < 18) return '0-17';
  if (age < 35) return '18-34';
  if (age < 50) return '35-49';
  if (age < 65) return '50-64';
  if (age < 80) return '65-79';
  return '80+';
}

// Column layout of one record's cipher blob: each chosen metric, then its square if kept.
export function cipherColumns(metrics) {
  const cols = [];
  for (const m of metrics) {
    cols.push({ metric: m.name, squared: false });
    if (m.squared) cols.push({ metric: m.name, squared: true });
  }
  return cols;
}

export const cipherWidth = (keyBits) => keyBits / 4; // ciphertexts live mod n^2

export function bigintToBytes(x, width) {
  const hex = x.toString(16).padStart(width * 2, '0');
  if (hex.length > width * 2) throw new RangeError('value wider than slot');
  return hexToBytes(hex);
}
export const bytesToBigint = (b) => BigInt('0x' + (bytesToHex(b) || '0'));

export function splitCipher(blob, width) {
  const out = [];
  for (let i = 0; i < blob.length; i += width) out.push(bytesToBigint(blob.subarray(i, i + width)));
  return out;
}

export const sha256hex = (data) => bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));

// Leaf binds the grouping dimensions to the ciphertexts, so the cloud can't
// quietly move a record into another group.
export function leafHash(dims, cipherBytes) {
  const label = utf8ToBytes(DIMENSIONS.map((d) => dims[d]).join('|'));
  return bytesToHex(sha256(concatBytes(Uint8Array.of(0), label, Uint8Array.of(0), cipherBytes)));
}

const node = (l, r) => bytesToHex(sha256(concatBytes(Uint8Array.of(1), hexToBytes(l), hexToBytes(r))));

// An odd node is carried up unchanged rather than duplicated, which avoids the
// duplicate-leaf ambiguity of Bitcoin-style trees.
function levels(leaves) {
  const out = [leaves];
  while (out[out.length - 1].length > 1) {
    const prev = out[out.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? node(prev[i], prev[i + 1]) : prev[i]);
    out.push(next);
  }
  return out;
}

export function merkleRoot(leaves) {
  if (!leaves.length) return sha256hex('');
  const lv = levels(leaves);
  return lv[lv.length - 1][0];
}

export function merkleProof(leaves, index) {
  const proof = [];
  for (const level of levels(leaves).slice(0, -1)) {
    const sib = index ^ 1;
    if (sib < level.length) proof.push({ side: sib < index ? 'L' : 'R', hash: level[sib] });
    index >>= 1;
  }
  return proof;
}

export function verifyProof(leaf, proof, root) {
  let h = leaf;
  for (const { side, hash } of proof) h = side === 'L' ? node(hash, h) : node(h, hash);
  return h === root;
}

// ---- bulletin board ----

export const GENESIS = '0'.repeat(64);

export const entryHash = ({ seq, kind, prev_hash, payload }) => sha256hex(`${seq}\n${kind}\n${prev_hash}\n${payload}`);

export const signHash = (hashHex, privHex) => p256.sign(hexToBytes(hashHex), hexToBytes(privHex)).toCompactHex();

export function verifySig(hashHex, sigHex, pubHex) {
  try {
    return p256.verify(sigHex, hexToBytes(hashHex), hexToBytes(pubHex));
  } catch {
    return false;
  }
}

export const newSigningKey = () => bytesToHex(p256.utils.randomPrivateKey());
export const publicKeyOf = (privHex) => bytesToHex(p256.getPublicKey(hexToBytes(privHex), true));

// Returns null when the whole chain holds, else { seq, reason } for the first break.
export function verifyChain(entries, pubHex) {
  let prev = GENESIS;
  for (const [i, e] of entries.entries()) {
    if (e.seq !== i + 1) return { seq: e.seq, reason: 'sequence gap' };
    if (e.prev_hash !== prev) return { seq: e.seq, reason: 'broken link to previous entry' };
    if (entryHash(e) !== e.hash) return { seq: e.seq, reason: 'entry content does not match its hash' };
    if (!verifySig(e.hash, e.sig, pubHex)) return { seq: e.seq, reason: 'bad signature' };
    prev = e.hash;
  }
  return null;
}

// ---- Paillier, public side ----

export function modPow(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}

export function aggregate(ciphers, n2) {
  let acc = 1n;
  for (const c of ciphers) acc = (acc * c) % n2;
  return acc;
}

// Anyone holding the public key can confirm that C decrypts to m, given the
// randomness r the owner recovered: g^m * r^n == C (mod n^2).
export function verifyDecryption({ n, g, C, m, r }) {
  const n2 = n * n;
  return (modPow(g, m, n2) * modPow(r, n, n2)) % n2 === C % n2;
}
