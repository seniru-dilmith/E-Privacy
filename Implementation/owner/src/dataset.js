import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { ageBand } from '@e-privacy/shared';

const FILE = process.env.DATASET;
let header = null;
let totalRows = null;

// Fields in the CSV never contain commas or quotes, so a plain split is exact.
function parse(line) {
  const f = line.split(',');
  const row = Object.fromEntries(header.map((h, i) => [h, f[i]]));
  row.admission_month = row.admission_date.slice(0, 7);
  row.age_band = ageBand(Number(row.age));
  return row;
}

async function* lines() {
  const rl = createInterface({ input: createReadStream(FILE), crlfDelay: Infinity });
  let i = -1;
  for await (const line of rl) {
    if (i === -1) header = line.split(',');
    else if (line) yield [i, line];
    i++;
  }
}

export async function info() {
  if (totalRows === null) {
    let n = 0;
    for await (const _ of lines()) n++;
    totalRows = n;
  }
  return { file: FILE.split('/').pop(), rows: totalRows, bytes: (await stat(FILE)).size, columns: header };
}

// Uniform random sample without replacement (reservoir), returned in file order.
export async function sample(k) {
  const picked = [];
  let seen = 0;
  for await (const [i, line] of lines()) {
    seen++;
    if (picked.length < k) picked.push([i, line]);
    else {
      const j = Math.floor(Math.random() * seen);
      if (j < k) picked[j] = [i, line];
    }
  }
  picked.sort((a, b) => a[0] - b[0]);
  return picked.map(([index, line]) => ({ index, bytes: Buffer.byteLength(line) + 1, row: parse(line) }));
}

export async function load(indexes) {
  const want = new Set(indexes);
  const out = [];
  for await (const [i, line] of lines()) if (want.has(i)) out.push(parse(line));
  return out;
}
