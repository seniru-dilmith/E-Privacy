import express from 'express';
import { DIMENSIONS, cipherColumns, cipherWidth, leafHash, merkleRoot, merkleProof } from '@e-privacy/shared';
import { pool, one, all } from './db.js';
import { allow, login, logout, syncUsers } from './auth.js';
import * as board from './board.js';
import { runQuery, fault } from './compute.js';

const app = express();
app.use(express.json({ limit: '64mb' }));

const anyRole = allow('owner', 'auditor', 'admin');

app.post('/auth/login', login);
app.post('/auth/logout', anyRole, logout);
app.get('/me', anyRole, (req, res) => res.json(req.user));

// ---- bulletin board ----

app.get('/board/key', (req, res) => res.json({ publicKey: board.boardPublicKey, curve: 'P-256' }));

app.get('/board', anyRole, async (req, res) => {
  res.json(await board.entries({ after: Number(req.query.after) || 0, limit: Math.min(Number(req.query.limit) || 500, 2000) }));
});

app.get('/board/:seq', anyRole, async (req, res) => {
  const e = await board.entry(Number(req.params.seq));
  if (!e) return res.status(404).json({ error: 'No such entry' });
  res.json(e);
});

// ---- campaigns ----

const campaignRow = (id) => one('SELECT * FROM campaigns WHERE id = ?', [id]);

app.get('/campaigns', anyRole, async (req, res) => {
  res.json(await all(`SELECT id, name, key_bits, record_count, plaintext_bytes, merkle_root, status, created_at, metrics,
    (SELECT COALESCE(SUM(LENGTH(cipher)), 0) FROM records r WHERE r.campaign_id = c.id) AS cipher_bytes
    FROM campaigns c ORDER BY id DESC`));
});

app.get('/campaigns/:id', anyRole, async (req, res) => {
  const c = await campaignRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'No such campaign' });
  res.json(c);
});

const HEX = /^[0-9a-f]+$/;

app.post('/campaigns', allow('owner'), async (req, res) => {
  const { name, keyBits, n, g, metrics, plaintextBytes } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() || name.length > 120) return res.status(400).json({ error: 'Name is required' });
  if (![1024, 2048, 3072].includes(keyBits)) return res.status(400).json({ error: 'Key length must be 1024, 2048 or 3072' });
  if (!HEX.test(n ?? '') || !HEX.test(g ?? '')) return res.status(400).json({ error: 'Public key must be hex' });
  if (!Array.isArray(metrics) || !metrics.length) return res.status(400).json({ error: 'Pick at least one measure' });

  const [r] = await pool.query(
    'INSERT INTO campaigns (name, key_bits, n, g, metrics, plaintext_bytes) VALUES (?, ?, ?, ?, ?, ?)',
    [name.trim(), keyBits, n, g, JSON.stringify(metrics), Number(plaintextBytes) || 0],
  );
  // Publishing the public key lets any auditor re-check the arithmetic later.
  const entry = await board.append('campaign_opened', r.insertId, { campaign: r.insertId, name: name.trim(), key_bits: keyBits, n, g, metrics });
  res.status(201).json({ id: r.insertId, entry });
});

app.post('/campaigns/:id/records', allow('owner'), async (req, res) => {
  const c = await campaignRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'No such campaign' });
  if (c.status !== 'uploading') return res.status(409).json({ error: 'Campaign is already committed' });

  const expected = cipherColumns(c.metrics).length * cipherWidth(c.key_bits);
  const records = req.body?.records;
  if (!Array.isArray(records) || !records.length || records.length > 5000) return res.status(400).json({ error: 'Send 1-5000 records per batch' });

  const rows = [];
  for (const rec of records) {
    const cipher = Buffer.from(String(rec.cipher ?? ''), 'base64');
    const bad = !Number.isInteger(rec.seq) || rec.seq < 0 || cipher.length !== expected
      || DIMENSIONS.some((d) => typeof rec.dims?.[d] !== 'string' || rec.dims[d].length > 32);
    if (bad) return res.status(400).json({ error: `Malformed record ${rec.seq}` });
    rows.push([c.id, rec.seq, ...DIMENSIONS.map((d) => rec.dims[d]), cipher, leafHash(rec.dims, cipher)]);
  }
  await pool.query(`INSERT INTO records (campaign_id, seq, ${DIMENSIONS.join(', ')}, cipher, leaf_hash) VALUES ?`, [rows]);
  res.locals.records = rows.length;
  res.json({ stored: rows.length, leaves: rows.map((r) => r[r.length - 1]) });
});

// Seals the input set: the signed Merkle root is the owner's receipt.
app.post('/campaigns/:id/commit', allow('owner'), async (req, res) => {
  const c = await campaignRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'No such campaign' });
  if (c.status !== 'uploading') return res.status(409).json({ error: 'Campaign is already committed' });

  const leaves = (await all('SELECT leaf_hash FROM records WHERE campaign_id = ? ORDER BY seq', [c.id])).map((r) => r.leaf_hash);
  const root = merkleRoot(leaves);
  await pool.query("UPDATE campaigns SET status = 'committed', merkle_root = ?, record_count = ? WHERE id = ?", [root, leaves.length, c.id]);
  const entry = await board.append('batch_committed', c.id, { campaign: c.id, root, count: leaves.length });
  res.locals.records = leaves.length;
  res.json({ root, count: leaves.length, entry });
});

// Paged ciphertext listing, for auditors rebuilding the root and the sums.
app.get('/campaigns/:id/records', allow('auditor', 'owner'), async (req, res) => {
  const after = Number(req.query.after ?? -1);
  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  const rows = await all(
    `SELECT seq, ${DIMENSIONS.join(', ')}, cipher FROM records WHERE campaign_id = ? AND seq > ? ORDER BY seq LIMIT ?`,
    [req.params.id, after, limit],
  );
  res.locals.records = rows.length;
  res.json(rows.map((r) => ({ seq: r.seq, dims: Object.fromEntries(DIMENSIONS.map((d) => [d, r[d]])), cipher: r.cipher.toString('base64') })));
});

// Inclusion proof for one record (individual verifiability, "stored as uploaded").
app.get('/campaigns/:id/records/:seq/proof', allow('owner', 'auditor'), async (req, res) => {
  const rows = await all('SELECT seq, leaf_hash FROM records WHERE campaign_id = ? ORDER BY seq', [req.params.id]);
  const index = rows.findIndex((r) => r.seq === Number(req.params.seq));
  if (index < 0) return res.status(404).json({ error: 'No such record' });
  const leaves = rows.map((r) => r.leaf_hash);
  res.json({ seq: rows[index].seq, index, leaf: leaves[index], proof: merkleProof(leaves, index), root: merkleRoot(leaves) });
});

// ---- analytics ----

app.post('/campaigns/:id/query', allow('owner'), async (req, res) => {
  const c = await campaignRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'No such campaign' });
  if (c.status !== 'committed') return res.status(409).json({ error: 'Campaign is not committed yet' });

  const started = Date.now();
  const result = await runQuery(c, { groupBy: req.body?.groupBy ?? [], metrics: req.body?.metrics ?? [] });
  const entry = await board.append('query_result', c.id, { ...result, compute_ms: Date.now() - started });
  res.locals.records = result.total;
  res.locals.detail = `group by ${result.group_by.join(', ') || 'none'}; ${result.metrics.length} columns${fault.mode !== 'off' ? `; fault=${fault.mode}` : ''}`;
  res.json(entry);
});

// The owner publishes (m, r) for each decrypted sum so auditors can check
// g^m * r^n = C without the private key.
app.post('/campaigns/:id/decryptions', allow('owner'), async (req, res) => {
  const { query_seq: querySeq, values } = req.body ?? {};
  const q = await board.entry(Number(querySeq));
  if (!q || q.kind !== 'query_result' || q.campaign_id !== Number(req.params.id)) return res.status(400).json({ error: 'Unknown query entry' });
  if (!Array.isArray(values) || values.some((v) => !HEX.test(v.m ?? '') || !HEX.test(v.r ?? ''))) return res.status(400).json({ error: 'values must carry hex m and r' });
  const entry = await board.append('decryption_published', q.campaign_id, { campaign: q.campaign_id, query_seq: q.seq, values });
  res.json(entry);
});

// ---- operator monitoring (FR-8): no key material, no plaintext ----

app.get('/metrics', allow('admin'), async (req, res) => {
  const [recent, perMinute, byAction, storage, tables, totals] = await Promise.all([
    all('SELECT id, at, username, role, action, campaign_id, detail, records, ms, outcome FROM query_log ORDER BY id DESC LIMIT 200'),
    all(`SELECT DATE_FORMAT(at, '%Y-%m-%d %H:%i') AS minute, COUNT(*) AS requests, SUM(outcome = 'denied') AS denied
         FROM query_log WHERE at > NOW() - INTERVAL 60 MINUTE GROUP BY minute ORDER BY minute`),
    all(`SELECT action, COUNT(*) AS calls, ROUND(AVG(ms)) AS avg_ms, MAX(ms) AS max_ms, SUM(COALESCE(records, 0)) AS records
         FROM query_log WHERE ms IS NOT NULL GROUP BY action ORDER BY calls DESC`),
    all(`SELECT c.id, c.name, c.key_bits, c.record_count, c.plaintext_bytes, COALESCE(SUM(LENGTH(r.cipher)), 0) AS cipher_bytes
         FROM campaigns c LEFT JOIN records r ON r.campaign_id = c.id GROUP BY c.id ORDER BY c.id`),
    all(`SELECT table_name AS name, data_length + index_length AS bytes, table_rows AS approx_rows
         FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY bytes DESC`),
    one(`SELECT COUNT(*) AS requests, SUM(outcome = 'denied') AS denied, SUM(outcome = 'error') AS errors FROM query_log`),
  ]);
  res.json({ recent, perMinute, byAction, storage, tables, totals, fault: fault.mode, kMin: Number(process.env.K_MIN || 10) });
});

app.put('/admin/fault', allow('admin'), (req, res) => {
  const mode = req.body?.mode;
  if (!['off', 'drop', 'tamper'].includes(mode)) return res.status(400).json({ error: 'mode must be off, drop or tamper' });
  fault.mode = mode;
  res.locals.detail = `fault=${mode}`;
  res.json(fault);
});

app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
});

async function start() {
  for (let attempt = 1; ; attempt++) {
    try {
      await syncUsers();
      break;
    } catch (err) {
      if (attempt >= 20) throw err;
      console.log(`waiting for database (${err.code ?? err.message})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const port = Number(process.env.PORT || 5000);
  app.listen(port, () => console.log(`cloud gateway on :${port}, board key ${board.boardPublicKey.slice(0, 16)}…`));
}

start();
