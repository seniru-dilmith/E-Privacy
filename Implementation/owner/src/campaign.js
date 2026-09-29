// Data Owner workflow: key generation, encryption, upload with receipts,
// and verified decryption of cloud results. Private keys never leave /keys.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { generateRandomKeys } from 'paillier-bigint';
import {
  DIMENSIONS, METRIC, cipherColumns, cipherWidth, bigintToBytes,
  leafHash, merkleRoot, verifyProof, entryHash, verifySig,
} from '@e-privacy/shared';
import * as dataset from './dataset.js';
import * as pool from './pool.js';
import { cloud, pinnedBoardKey } from './cloud.js';

const KEY_DIR = process.env.KEY_DIR;
const UPLOAD_BATCH = 250;
const keyFile = (id) => join(KEY_DIR, `campaign-${id}.json`);

export const readState = async (id) => JSON.parse(await readFile(keyFile(id), 'utf8'));
const writeState = (s) => writeFile(keyFile(s.id), JSON.stringify(s), { mode: 0o600 });

export async function listStates() {
  const files = (await readdir(KEY_DIR)).filter((f) => /^campaign-\d+\.json$/.test(f));
  const states = await Promise.all(files.map((f) => readFile(join(KEY_DIR, f), 'utf8').then(JSON.parse)));
  // Never hand key material to the UI.
  return states.map(({ key, indexes, leaves, ...rest }) => rest).sort((a, b) => b.id - a.id);
}

export const encode = (metric, raw) => BigInt(Math.round(Number(raw) * METRIC[metric].scale));

function plaintextColumns(row, columns) {
  return columns.map(({ metric, squared }) => {
    const v = encode(metric, row[metric]);
    return (squared ? v * v : v).toString();
  });
}

const dims = (row) => Object.fromEntries(DIMENSIONS.map((d) => [d, row[d]]));

// ---- campaign creation job ----

export const jobs = new Map();

export function startCampaign({ name, rows, keyBits, metrics, spread }) {
  const job = {
    id: randomUUID(), name, rows, keyBits, phase: 'sampling', done: 0, total: rows,
    startedAt: Date.now(), log: [], tape: [], campaignId: null, error: null,
  };
  jobs.set(job.id, job);
  const note = (text) => job.log.push({ at: Date.now(), text });

  (async () => {
    const boardKey = await pinnedBoardKey();
    const spec = metrics.map((m) => ({ name: m, scale: METRIC[m].scale, squared: spread && METRIC[m].squared }));
    const columns = cipherColumns(spec);

    const picked = await dataset.sample(rows);
    note(`Sampled ${picked.length.toLocaleString()} admissions from the local dataset`);

    job.phase = 'keygen';
    let t = Date.now();
    const { publicKey, privateKey } = await generateRandomKeys(keyBits, true);
    const key = {
      n: publicKey.n.toString(16), g: publicKey.g.toString(16),
      lambda: privateKey.lambda.toString(16), mu: privateKey.mu.toString(16),
      p: privateKey._p.toString(16), q: privateKey._q.toString(16),
    };
    note(`Generated a ${keyBits}-bit Paillier keypair in ${Date.now() - t} ms (private half stays on this host)`);

    const plaintextBytes = picked.reduce((a, p) => a + p.bytes, 0);
    const { id } = await cloud('POST', '/campaigns', { name, keyBits, n: key.n, g: key.g, metrics: spec, plaintextBytes });
    job.campaignId = id;
    const state = {
      id, name, keyBits, metrics: spec, count: picked.length, plaintextBytes, createdAt: new Date().toISOString(),
      key, indexes: picked.map((p) => p.index), leaves: null, receipt: null, boardKey,
    };
    await writeState(state);
    note(`Opened campaign #${id} on the cloud and published the public key`);

    job.phase = 'encrypting';
    job.total = picked.length;
    t = Date.now();
    const plain = picked.map((p) => plaintextColumns(p.row, columns));
    const ciphers = await pool.map('encrypt', { n: key.n, g: key.g }, plain, 8, (k) => {
      job.done += k;
      job.rate = job.done / ((Date.now() - t) / 1000);
    });
    job.tape = ciphers.slice(0, 6).map((row) => row[0].slice(0, 96));
    note(`Encrypted ${(picked.length * columns.length).toLocaleString()} values in ${((Date.now() - t) / 1000).toFixed(1)} s on ${pool.poolSize} threads`);

    // Spot-check before anything leaves the building (Verifiability, "encrypted as intended").
    job.phase = 'spot-check';
    const checks = Math.max(5, Math.ceil(picked.length * 0.01));
    const sampleIdx = Array.from({ length: checks }, () => Math.floor(Math.random() * picked.length));
    const decrypted = await pool.map('decrypt', key, sampleIdx.map((i) => ciphers[i][0]), 4);
    const mismatch = sampleIdx.findIndex((i, j) => BigInt('0x' + decrypted[j].m) !== BigInt(plain[i][0]));
    if (mismatch >= 0) throw new Error(`Spot-check failed on sampled record ${sampleIdx[mismatch]}; nothing was uploaded`);
    note(`Spot-check: decrypted ${checks} random ciphertexts, all match the source rows`);

    job.phase = 'uploading';
    job.done = 0;
    const width = cipherWidth(keyBits);
    const records = picked.map((p, seq) => {
      const blob = new Uint8Array(columns.length * width);
      ciphers[seq].forEach((c, j) => blob.set(bigintToBytes(BigInt('0x' + c), width), j * width));
      return { seq, dims: dims(p.row), blob };
    });
    const leaves = records.map((r) => leafHash(r.dims, r.blob));
    for (let i = 0; i < records.length; i += UPLOAD_BATCH) {
      const batch = records.slice(i, i + UPLOAD_BATCH);
      const res = await cloud('POST', `/campaigns/${id}/records`, {
        records: batch.map((r) => ({ seq: r.seq, dims: r.dims, cipher: Buffer.from(r.blob).toString('base64') })),
      });
      const off = res.leaves.findIndex((l, j) => l !== leaves[i + j]);
      if (off >= 0) throw new Error(`Cloud hashed record ${i + off} differently from us`);
      job.done += batch.length;
    }
    note(`Uploaded ${records.length.toLocaleString()} encrypted records; every stored leaf hash matched ours`);

    job.phase = 'committing';
    const receipt = await cloud('POST', `/campaigns/${id}/commit`);
    const localRoot = merkleRoot(leaves);
    if (receipt.root !== localRoot || receipt.count !== records.length) throw new Error('Signed receipt root does not match our own Merkle root');
    if (entryHash(receipt.entry) !== receipt.entry.hash || !verifySig(receipt.entry.hash, receipt.entry.sig, boardKey)) {
      throw new Error('Receipt signature did not verify against the pinned board key');
    }
    Object.assign(state, { leaves, receipt: { root: localRoot, count: records.length, seq: receipt.entry.seq, hash: receipt.entry.hash, sig: receipt.entry.sig } });
    await writeState(state);
    note(`Receipt #${receipt.entry.seq} verified: root ${localRoot.slice(0, 16)}… signed by the cloud`);

    job.phase = 'done';
    job.finishedAt = Date.now();
  })().catch((err) => {
    job.phase = 'failed';
    job.error = err.message;
    note(`Stopped: ${err.message}`);
  });

  return job;
}

// ---- analysis ----

const rowsCache = new Map();
async function plaintextRows(state) {
  if (!rowsCache.has(state.id)) rowsCache.set(state.id, await dataset.load(state.indexes));
  return rowsCache.get(state.id);
}

export async function analyze(id, { groupBy = [], metrics = [] }) {
  const state = await readState(id);
  if (!state.receipt) throw Object.assign(new Error('Campaign has no verified receipt yet'), { status: 409 });
  const t0 = Date.now();
  const entry = await cloud('POST', `/campaigns/${id}/query`, { groupBy, metrics });
  const cloudMs = Date.now() - t0;
  const payload = JSON.parse(entry.payload);

  // Individual verifiability: is this the signed answer over *our* records?
  const onBoard = await cloud('GET', `/board/${entry.seq}`);
  const checks = [
    { id: 'signature', label: 'Result entry is signed by the pinned cloud key', ok: entryHash(entry) === entry.hash && verifySig(entry.hash, entry.sig, state.boardKey) },
    { id: 'published', label: 'Returned result is identical to the one on the board', ok: onBoard.hash === entry.hash && onBoard.payload === entry.payload },
    { id: 'root', label: 'Input set root equals our upload receipt', ok: payload.root === state.receipt.root, detail: `${payload.root.slice(0, 12)}… vs ${state.receipt.root.slice(0, 12)}…` },
    { id: 'count', label: 'Record count equals what we uploaded', ok: payload.total === state.count, detail: `${payload.total} vs ${state.count}` },
  ];

  // Decrypt every released sum, recovering r so the result can be proven publicly.
  const t1 = Date.now();
  const flat = payload.groups.flatMap((g, gi) => payload.metrics.map((col) => ({ gi, col, c: g.sums[col] })));
  const opened = await pool.map('decrypt', state.key, flat.map((f) => f.c), 6);
  const decryptMs = Date.now() - t1;

  // Recompute the same sums from our plaintext copy.
  const t2 = Date.now();
  const rows = await plaintextRows(state);
  const plainSums = new Map();
  for (const row of rows) {
    const k = JSON.stringify(Object.fromEntries(groupBy.map((d) => [d, row[d]])));
    if (!plainSums.has(k)) plainSums.set(k, { n: 0, sums: Object.fromEntries(payload.metrics.map((c) => [c, 0n])) });
    const g = plainSums.get(k);
    g.n++;
    for (const col of payload.metrics) {
      const [metric, sq] = col.split('^');
      const v = encode(metric, row[metric]);
      g.sums[col] += sq ? v * v : v;
    }
  }
  const plaintextMs = Date.now() - t2;

  const groups = payload.groups.map((g) => ({ key: g.key, n: g.n, sums: {}, plain: plainSums.get(JSON.stringify(g.key)) }));
  flat.forEach((f, i) => { groups[f.gi].sums[f.col] = BigInt('0x' + opened[i].m); });

  const accuracy = [];
  for (const g of groups) {
    for (const col of payload.metrics) {
      const expected = g.plain?.sums[col] ?? 0n;
      accuracy.push({ key: g.key, column: col, decrypted: g.sums[col].toString(), plaintext: expected.toString(), diff: (g.sums[col] - expected).toString() });
    }
  }
  const mismatches = accuracy.filter((a) => a.diff !== '0').length;
  checks.push({ id: 'plaintext', label: 'Every decrypted sum equals our own plaintext recomputation', ok: mismatches === 0, detail: `${mismatches} of ${accuracy.length} differ` });

  const accepted = checks.every((c) => c.ok);
  let proofSeq = null;
  if (accepted) {
    const proof = await cloud('POST', `/campaigns/${id}/decryptions`, {
      query_seq: entry.seq,
      values: flat.map((f, i) => ({ group: f.gi, column: f.col, m: opened[i].m, r: opened[i].r })),
    });
    proofSeq = proof.seq;
  }

  return {
    accepted,
    checks,
    querySeq: entry.seq,
    proofSeq,
    suppressed: payload.suppressed,
    kMin: payload.k_min,
    timings: { cloudMs, computeMs: payload.compute_ms, decryptMs, plaintextMs, decryptions: flat.length },
    // Only released once every check passes.
    groups: accepted ? groups.map((g) => ({ key: g.key, n: g.n, stats: stats(g, payload.metrics) })) : [],
    accuracy,
  };
}

// mean and population s.d. from exact integer sums: var * n^2 = n * sum(x^2) - sum(x)^2
function stats(g, cols) {
  const out = {};
  const n = BigInt(g.n);
  for (const col of cols) {
    if (col.includes('^')) continue;
    const { scale, flag } = METRIC[col];
    const s = g.sums[col];
    const entry = { sum: Number(s) / scale, mean: Number(s) / scale / g.n };
    const s2 = g.sums[`${col}^2`];
    if (s2 !== undefined) entry.sd = Math.sqrt(Number(n * s2 - s * s)) / g.n / scale;
    else if (flag) entry.sd = Math.sqrt(entry.mean * (1 - entry.mean));
    out[col] = entry;
  }
  return out;
}

// ---- individual verifiability: is record #seq still stored as uploaded? ----

export async function checkRecord(id, seq) {
  const state = await readState(id);
  const got = await cloud('GET', `/campaigns/${id}/records/${seq}/proof`);
  const ours = state.leaves?.[seq];
  return {
    seq,
    ourLeaf: ours,
    cloudLeaf: got.leaf,
    root: got.root,
    receiptRoot: state.receipt?.root,
    proof: got.proof,
    leafMatches: got.leaf === ours,
    proofValid: verifyProof(ours, got.proof, state.receipt?.root),
  };
}
