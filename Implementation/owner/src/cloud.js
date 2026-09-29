// Client for the untrusted cloud gateway. Only ciphertext, public keys and
// coarse dimensions ever go through here.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = process.env.CLOUD_URL;
const PIN_FILE = join(process.env.KEY_DIR, 'cloud-board-key.txt');
let token = null;

async function signIn() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: process.env.CLOUD_OWNER_USER, password: process.env.CLOUD_OWNER_PASSWORD }),
  });
  if (!res.ok) throw new Error(`cloud login failed (${res.status})`);
  token = (await res.json()).token;
}

export async function cloud(method, path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token) await signIn();
    const res = await fetch(BASE + path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body && { 'content-type': 'application/json' }) },
      body: body && JSON.stringify(body),
    });
    if (res.status === 401 && attempt === 0) { token = null; continue; }
    const data = res.status === 204 ? null : await res.json();
    if (!res.ok) throw Object.assign(new Error(data?.error ?? `cloud returned ${res.status}`), { status: res.status });
    return data;
  }
}

// ponytail: trust-on-first-use pin of the board's signing key. Distribute the
// key out of band (or via a CA) if the first contact itself can't be trusted.
export async function pinnedBoardKey() {
  const { publicKey } = await fetch(`${BASE}/board/key`).then((r) => r.json());
  const pinned = await readFile(PIN_FILE, 'utf8').catch(() => null);
  if (!pinned) {
    await writeFile(PIN_FILE, publicKey);
    return publicKey;
  }
  if (pinned.trim() !== publicKey) throw new Error('Cloud board key changed since it was pinned');
  return pinned.trim();
}
