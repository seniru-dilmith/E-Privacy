// Universal verifiability, run entirely in the auditor's browser. Uses only
// the public board, the published ciphertexts and the Paillier public keys;
// nothing here trusts the cloud's own arithmetic.
import {
  verifyChain, leafHash, merkleRoot, cipherColumns, cipherWidth, splitCipher,
  aggregate, verifyDecryption,
} from '@e-privacy/shared';

let token;
const say = (msg) => postMessage(msg);

async function get(path) {
  const res = await fetch(`/api/cloud${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function allBoard() {
  const out = [];
  for (;;) {
    const page = await get(`/board?after=${out.at(-1)?.seq ?? 0}&limit=2000`);
    out.push(...page);
    if (page.length < 2000) return out;
  }
}

async function allRecords(campaign) {
  const out = [];
  for (;;) {
    const page = await get(`/campaigns/${campaign}/records?after=${out.at(-1)?.seq ?? -1}&limit=2000`);
    out.push(...page);
    say({ type: 'progress', stage: 'input', text: `campaign #${campaign}: ${out.length.toLocaleString()} records fetched` });
    if (page.length < 2000) return out;
  }
}

function report(id, failures, total, extra = '') {
  say({ type: 'check', id, ok: failures.length === 0, total, failures: failures.slice(0, 50), failed: failures.length, extra });
}

async function run(campaignFilter) {
  const { publicKey } = await get('/board/key');
  const entries = await allBoard();
  say({ type: 'progress', stage: 'chain', text: `${entries.length} board entries` });

  // 1. log integrity
  const broken = verifyChain(entries, publicKey);
  report('chain', broken ? [`#${broken.seq}: ${broken.reason}`] : [], entries.length, `signer ${publicKey.slice(0, 16)}…`);

  const parsed = entries.map((e) => ({ ...e, body: JSON.parse(e.payload) }));
  const opened = parsed.filter((e) => e.kind === 'campaign_opened' && (!campaignFilter || e.campaign_id === campaignFilter));

  const inputFail = [];
  const computeFail = [];
  const decryptFail = [];
  let inputs = 0;
  let sums = 0;
  let proofs = 0;

  for (const open of opened) {
    const id = open.campaign_id;
    const { n: nHex, g: gHex, key_bits: bits, metrics } = open.body;
    const n = BigInt('0x' + nHex);
    const g = BigInt('0x' + gHex);
    const n2 = n * n;
    const commit = parsed.find((e) => e.kind === 'batch_committed' && e.campaign_id === id);
    if (!commit) continue;

    // 2. input set: rebuild the Merkle root from what the cloud publishes
    const records = await allRecords(id);
    const width = cipherWidth(bits);
    const cols = cipherColumns(metrics);
    const blobs = records.map((r) => fromBase64(r.cipher));
    const root = merkleRoot(records.map((r, i) => leafHash(r.dims, blobs[i])));
    inputs++;
    if (root !== commit.body.root || records.length !== commit.body.count) {
      inputFail.push(`campaign #${id}: published ciphertexts give root ${root.slice(0, 12)}…, receipt #${commit.seq} says ${commit.body.root.slice(0, 12)}…`);
    }

    const cells = blobs.map((b) => splitCipher(b, width));
    const queries = parsed.filter((e) => e.kind === 'query_result' && e.campaign_id === id);
    for (const q of queries) {
      const body = q.body;
      if (body.root !== commit.body.root || body.total !== commit.body.count) {
        inputFail.push(`query #${q.seq}: aggregated ${body.total} records under root ${body.root.slice(0, 12)}…, not the committed set`);
      }
      // 3. computation: recompute every released product from public ciphertexts
      say({ type: 'progress', stage: 'compute', text: `query #${q.seq}: recomputing ${body.groups.length * body.metrics.length} sums` });
      for (const grp of body.groups) {
        const members = records.map((r, i) => i).filter((i) => body.group_by.every((d) => records[i].dims[d] === grp.key[d]));
        if (members.length !== grp.n) computeFail.push(`query #${q.seq} ${JSON.stringify(grp.key)}: n=${grp.n} but ${members.length} records match`);
        for (const col of body.metrics) {
          const [metric, sq] = col.split('^');
          const idx = cols.findIndex((c) => c.metric === metric && c.squared === Boolean(sq));
          const C = aggregate(members.map((i) => cells[i][idx]), n2);
          sums++;
          if (C.toString(16) !== grp.sums[col]) computeFail.push(`query #${q.seq} ${Object.values(grp.key).join(' · ') || 'all'} / ${col}: product of ciphertexts ≠ published C`);
        }
      }

      // 4. decryption: g^m · r^n ≡ C (mod n²) for every published plaintext
      for (const d of parsed.filter((e) => e.kind === 'decryption_published' && e.body.query_seq === q.seq)) {
        for (const [k, v] of d.body.values.entries()) {
          const C = BigInt('0x' + body.groups[v.group].sums[v.column]);
          proofs++;
          if (!verifyDecryption({ n, g, C, m: BigInt('0x' + v.m), r: BigInt('0x' + v.r) })) {
            decryptFail.push(`proof #${d.seq} value ${k} (${v.column}): g^m·r^n does not equal C`);
          }
          if (proofs % 25 === 0) say({ type: 'progress', stage: 'decrypt', text: `${proofs} decryption proofs checked` });
        }
      }
    }
  }

  report('input', inputFail, inputs, `${inputs} campaign(s) rebuilt from published ciphertexts`);
  report('compute', computeFail, sums, `${sums.toLocaleString()} encrypted sums recomputed`);
  report('decrypt', decryptFail, proofs, `${proofs.toLocaleString()} published plaintexts checked`);
  say({ type: 'done' });
}

onmessage = async ({ data }) => {
  token = data.token;
  try {
    await run(data.campaign ?? null);
  } catch (err) {
    say({ type: 'error', message: err.message });
  }
};
