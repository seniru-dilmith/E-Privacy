import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRandomKeys } from 'paillier-bigint';
import * as P from './protocol.js';

test('aggregate over ciphertext decrypts to the plaintext sum, and the decryption proof holds', async () => {
  const { publicKey, privateKey } = await generateRandomKeys(1024, true);
  const values = [48250n, 1200n, 999999n, 0n, 73n];
  const C = P.aggregate(values.map((v) => publicKey.encrypt(v)), publicKey._n2);
  const m = privateKey.decrypt(C);
  assert.equal(m, values.reduce((a, b) => a + b));

  const r = privateKey.getRandomFactor(C);
  const { n, g } = publicKey;
  assert.ok(P.verifyDecryption({ n, g, C, m, r }));
  assert.ok(!P.verifyDecryption({ n, g, C, m: m + 1n, r }));
});

test('merkle proofs verify for every leaf and fail after tampering', () => {
  const leaves = Array.from({ length: 11 }, (_, i) => P.sha256hex(`leaf-${i}`));
  const root = P.merkleRoot(leaves);
  leaves.forEach((leaf, i) => assert.ok(P.verifyProof(leaf, P.merkleProof(leaves, i), root)));

  const tampered = leaves.with(4, P.sha256hex('other'));
  assert.notEqual(P.merkleRoot(tampered), root);
  assert.ok(!P.verifyProof(tampered[4], P.merkleProof(leaves, 4), root));
  // dropping the last leaf must change the root too
  assert.notEqual(P.merkleRoot(leaves.slice(0, -1)), root);
});

test('leaf hash binds dimensions to ciphertext', () => {
  const dims = Object.fromEntries(P.DIMENSIONS.map((d) => [d, 'x']));
  const bytes = P.bigintToBytes(123456789n, 32);
  assert.notEqual(P.leafHash(dims, bytes), P.leafHash({ ...dims, department: 'y' }, bytes));
});

test('board chain detects edits and forged signatures', () => {
  const key = P.newSigningKey();
  const pub = P.publicKeyOf(key);
  const entries = [];
  let prev = P.GENESIS;
  for (let seq = 1; seq <= 3; seq++) {
    const e = { seq, kind: 'note', prev_hash: prev, payload: JSON.stringify({ seq }) };
    e.hash = P.entryHash(e);
    e.sig = P.signHash(e.hash, key);
    entries.push(e);
    prev = e.hash;
  }
  assert.equal(P.verifyChain(entries, pub), null);

  const edited = entries.map((e) => ({ ...e }));
  edited[1].payload = '{"seq":99}';
  assert.equal(P.verifyChain(edited, pub).seq, 2);

  assert.equal(P.verifyChain(entries, P.publicKeyOf(P.newSigningKey())).seq, 1);
});
