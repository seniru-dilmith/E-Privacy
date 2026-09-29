import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

const size = Math.max(1, availableParallelism() - 1);
const idle = [];
const queue = [];
const pending = new Map();
let nextId = 0;

for (let i = 0; i < size; i++) {
  const w = new Worker(new URL('./worker.js', import.meta.url));
  w.on('message', ({ id, result, error }) => {
    const { resolve, reject } = pending.get(id);
    pending.delete(id);
    error ? reject(new Error(error)) : resolve(result);
    idle.push(w);
    drain();
  });
  idle.push(w);
}

function drain() {
  while (idle.length && queue.length) idle.pop().postMessage(queue.shift());
}

export const poolSize = size;

export function run(type, key, items) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    queue.push({ id, type, key, items });
    drain();
  });
}

// Splits items into chunks, runs them in parallel, keeps the original order.
export async function map(type, key, items, chunk, onChunk) {
  const parts = [];
  for (let i = 0; i < items.length; i += chunk) parts.push(items.slice(i, i + chunk));
  const out = await Promise.all(parts.map(async (part) => {
    const r = await run(type, key, part);
    onChunk?.(part.length);
    return r;
  }));
  return out.flat();
}
