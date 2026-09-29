import express from 'express';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { METRICS, METRIC, DIMENSIONS } from '@e-privacy/shared';
import * as dataset from './dataset.js';
import { startCampaign, jobs, listStates, analyze, checkRecord, readState } from './campaign.js';
import { poolSize } from './pool.js';

const app = express();
app.use(express.json());

// The hospital's own sign-in; it has nothing to do with the cloud's accounts.
const sessions = new Map();
const TTL_MS = 8 * 3600 * 1000;
const digest = (s) => createHash('sha256').update(String(s)).digest();

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  const ok = timingSafeEqual(digest(username), digest(process.env.OWNER_USER))
    & timingSafeEqual(digest(password), digest(process.env.OWNER_PASSWORD));
  if (!ok) return res.status(401).json({ error: 'Wrong username or password' });
  const token = randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + TTL_MS);
  res.json({ token, username, role: 'owner' });
});

app.use((req, res, next) => {
  const token = req.get('authorization')?.replace(/^Bearer /, '');
  if (!token || !(sessions.get(token) > Date.now())) return res.status(401).json({ error: 'Please sign in' });
  req.token = token;
  next();
});

app.post('/auth/logout', (req, res) => {
  sessions.delete(req.token);
  res.status(204).end();
});

app.get('/dataset', async (req, res) => {
  res.json({
    ...(await dataset.info()),
    metrics: METRICS,
    dimensions: DIMENSIONS,
    defaultKeyBits: Number(process.env.DEFAULT_KEY_BITS || 2048),
    threads: poolSize,
  });
});

app.post('/campaigns', async (req, res) => {
  const { name, rows, keyBits, metrics, spread = true } = req.body ?? {};
  const { rows: available } = await dataset.info();
  if (typeof name !== 'string' || !name.trim() || name.length > 120) return res.status(400).json({ error: 'Give the campaign a name' });
  if (!Number.isInteger(rows) || rows < 20 || rows > available) return res.status(400).json({ error: `Rows must be between 20 and ${available}` });
  if (![1024, 2048, 3072].includes(keyBits)) return res.status(400).json({ error: 'Key length must be 1024, 2048 or 3072' });
  if (!Array.isArray(metrics) || !metrics.length || metrics.some((m) => !METRIC[m])) return res.status(400).json({ error: 'Pick at least one measure' });
  if ([...jobs.values()].some((j) => !['done', 'failed'].includes(j.phase))) return res.status(409).json({ error: 'Another campaign is still being prepared' });
  res.status(202).json(startCampaign({ name: name.trim(), rows, keyBits, metrics, spread: Boolean(spread) }));
});

app.get('/jobs', (req, res) => res.json([...jobs.values()].reverse()));
app.get('/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  job ? res.json(job) : res.status(404).json({ error: 'No such job' });
});

app.get('/campaigns', async (req, res) => res.json(await listStates()));

app.get('/campaigns/:id', async (req, res) => {
  const { key, indexes, leaves, ...rest } = await readState(Number(req.params.id));
  res.json({ ...rest, publicKey: { n: key.n, g: key.g } });
});

app.post('/campaigns/:id/analyze', async (req, res) => {
  const { groupBy = [], metrics = [] } = req.body ?? {};
  if (!Array.isArray(groupBy) || !Array.isArray(metrics)) return res.status(400).json({ error: 'groupBy and metrics must be lists' });
  res.json(await analyze(Number(req.params.id), { groupBy, metrics }));
});

app.get('/campaigns/:id/records/:seq/check', async (req, res) => {
  res.json(await checkRecord(Number(req.params.id), Number(req.params.seq)));
});

app.use((err, req, res, next) => {
  if (err.code === 'ENOENT') return res.status(404).json({ error: 'No such campaign on this host' });
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status && err.status < 500 ? err.status : 502).json({ error: err.message });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`owner agent on :${port} with ${poolSize} crypto threads`));
