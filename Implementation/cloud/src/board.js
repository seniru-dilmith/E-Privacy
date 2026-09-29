// Append-only bulletin board (FR-6, Verifiability V2/V3): each entry is
// SHA-256 chained to the previous one and signed with the cloud's P-256 key.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { newSigningKey, publicKeyOf, entryHash, signHash, GENESIS } from '@e-privacy/shared';
import { pool, one, all } from './db.js';

const KEY_FILE = process.env.SIGNING_KEY_FILE;
mkdirSync(dirname(KEY_FILE), { recursive: true });
if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, newSigningKey(), { mode: 0o600 });
const signingKey = readFileSync(KEY_FILE, 'utf8').trim();
export const boardPublicKey = publicKeyOf(signingKey);

// ponytail: in-process lock, fine for one cloud replica; with several, take
// SELECT ... FOR UPDATE on the last row instead (seq is the primary key, so a
// fork would fail loudly either way).
let tail = Promise.resolve();

export function append(kind, campaignId, body) {
  const run = tail.then(async () => {
    const last = await one('SELECT seq, hash FROM board ORDER BY seq DESC LIMIT 1');
    const entry = {
      seq: (last?.seq ?? 0) + 1,
      kind,
      prev_hash: last?.hash ?? GENESIS,
      payload: JSON.stringify({ ...body, at: new Date().toISOString() }),
    };
    entry.hash = entryHash(entry);
    entry.sig = signHash(entry.hash, signingKey);
    await pool.query(
      'INSERT INTO board (seq, kind, campaign_id, payload, prev_hash, hash, sig) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [entry.seq, kind, campaignId, entry.payload, entry.prev_hash, entry.hash, entry.sig],
    );
    return { ...entry, campaign_id: campaignId };
  });
  tail = run.catch(() => {});
  return run;
}

export const entries = ({ after = 0, limit = 500 } = {}) =>
  all('SELECT seq, kind, campaign_id, payload, prev_hash, hash, sig, created_at FROM board WHERE seq > ? ORDER BY seq LIMIT ?', [after, limit]);

export const entry = (seq) => one('SELECT seq, kind, campaign_id, payload, prev_hash, hash, sig, created_at FROM board WHERE seq = ?', [seq]);
