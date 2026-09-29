// Runs inside the trusted domain only. Paillier work is CPU-bound, so it is
// spread across worker threads (see pool.js).
import { parentPort } from 'node:worker_threads';
import { PublicKey, PrivateKey } from 'paillier-bigint';

const big = (hex) => BigInt('0x' + hex);

parentPort.on('message', ({ id, type, key, items }) => {
  try {
    const pub = new PublicKey(big(key.n), big(key.g));
    let result;
    if (type === 'encrypt') {
      // items: array of rows, each an array of decimal plaintext strings
      result = items.map((row) => row.map((m) => pub.encrypt(BigInt(m)).toString(16)));
    } else if (type === 'decrypt') {
      const priv = new PrivateKey(big(key.lambda), big(key.mu), pub, big(key.p), big(key.q));
      // items: hex ciphertexts; r is recovered so the result can be proven publicly
      result = items.map((c) => ({ m: priv.decrypt(big(c)).toString(16), r: priv.getRandomFactor(big(c)).toString(16) }));
    } else {
      throw new Error(`unknown task ${type}`);
    }
    parentPort.postMessage({ id, result });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
