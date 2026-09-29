// Access control & policy gateway (FR-4). Every authenticated request is
// written to query_log with its outcome, so audits can replay who asked what.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { pool, one } from './db.js';

const scryptAsync = promisify(scrypt);
const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 8);

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function checkPassword(password, stored) {
  const [, salt, key] = stored.split('$');
  const got = await scryptAsync(password, Buffer.from(salt, 'hex'), 32);
  return timingSafeEqual(got, Buffer.from(key, 'hex'));
}

// Accounts come from the environment; re-hashed on each start so a changed
// .env password takes effect without touching the database.
export async function syncUsers() {
  const accounts = [
    [process.env.CLOUD_OWNER_USER, process.env.CLOUD_OWNER_PASSWORD, 'owner'],
    [process.env.AUDITOR_USER, process.env.AUDITOR_PASSWORD, 'auditor'],
    [process.env.ADMIN_USER, process.env.ADMIN_PASSWORD, 'admin'],
  ];
  for (const [username, password, role] of accounts) {
    if (!username || !password) throw new Error(`missing credentials for ${role} account`);
    await pool.query(
      'INSERT INTO users (username, role, pass_hash) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role), pass_hash = VALUES(pass_hash)',
      [username, role, await hashPassword(password)],
    );
  }
}

export async function login(req, res) {
  const { username, password } = req.body ?? {};
  const user = typeof username === 'string' && await one('SELECT * FROM users WHERE username = ?', [username]);
  const ok = user && typeof password === 'string' && await checkPassword(password, user.pass_hash);
  await logRequest({ username, action: 'login', outcome: ok ? 'allowed' : 'denied' });
  if (!ok) return res.status(401).json({ error: 'Wrong username or password' });

  const token = randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, NOW() + INTERVAL ? HOUR)', [token, user.id, TTL_HOURS]);
  res.json({ token, username: user.username, role: user.role });
}

export async function logout(req, res) {
  await pool.query('DELETE FROM sessions WHERE token = ?', [req.token]);
  res.status(204).end();
}

export function logRequest({ username = null, role = null, action, campaignId = null, detail = null, records = null, ms = null, outcome }) {
  return pool.query(
    'INSERT INTO query_log (username, role, action, campaign_id, detail, records, ms, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [username, role, action, campaignId, detail?.slice(0, 255) ?? null, records, ms, outcome],
  ).catch((err) => console.error('query_log write failed', err.message));
}

// allow(...roles) authenticates the bearer token and enforces the role policy.
export const allow = (...roles) => async (req, res, next) => {
  const started = Date.now();
  const action = `${req.method} ${req.route?.path ?? req.path}`;
  const token = req.get('authorization')?.replace(/^Bearer /, '');
  const user = token && await one(
    'SELECT u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > NOW()',
    [token],
  );

  if (!user || !roles.includes(user.role)) {
    await logRequest({ username: user?.username, role: user?.role, action, outcome: 'denied', detail: user ? 'role not permitted' : 'no valid session' });
    return res.status(user ? 403 : 401).json({ error: user ? 'Your role is not allowed to do this' : 'Please sign in' });
  }

  req.user = user;
  req.token = token;
  res.on('finish', () => logRequest({
    username: user.username,
    role: user.role,
    action,
    campaignId: req.params.id ? Number(req.params.id) : null,
    detail: res.locals.detail,
    records: res.locals.records,
    ms: Date.now() - started,
    outcome: res.statusCode < 400 ? 'allowed' : res.statusCode < 500 ? 'denied' : 'error',
  }));
  next();
};
