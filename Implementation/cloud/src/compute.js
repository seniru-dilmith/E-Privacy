// Homomorphic compute engine (FR-3). Sums are products of ciphertexts mod n^2;
// no key material other than the public modulus is ever available here.
import { DIMENSIONS, cipherColumns, cipherWidth, splitCipher, aggregate, merkleRoot } from '@e-privacy/shared';
import { all } from './db.js';

const K_MIN = Number(process.env.K_MIN || 10);

// Demonstration switch for the Verifiability report: 'drop' leaves one record
// out of the input set, 'tamper' doubles one ciphertext. Admin-only.
export const fault = { mode: 'off' };

export async function runQuery(campaign, { groupBy = [], metrics = [] }) {
  const bad = groupBy.find((d) => !DIMENSIONS.includes(d)) ?? metrics.find((m) => !campaign.metrics.some((cm) => cm.name === m));
  if (bad || groupBy.length > 2 || !metrics.length) throw Object.assign(new Error(`Unsupported query field ${bad ?? ''}`.trim()), { status: 400 });

  const n = BigInt('0x' + campaign.n);
  const n2 = n * n;
  const width = cipherWidth(campaign.key_bits);
  const columns = cipherColumns(campaign.metrics);
  const wanted = columns.map((c, i) => [c, i]).filter(([c]) => metrics.includes(c.metric));

  // ponytail: loads the whole campaign in memory (~13 KB/record at 2048-bit);
  // stream by seq range and fan out to worker_threads past ~100k records.
  let rows = await all(
    `SELECT seq, ${DIMENSIONS.join(', ')}, cipher, leaf_hash FROM records WHERE campaign_id = ? ORDER BY seq`,
    [campaign.id],
  );
  if (fault.mode === 'drop') rows = rows.slice(1);

  const groups = new Map();
  for (const row of rows) {
    const key = Object.fromEntries(groupBy.map((d) => [d, row[d]]));
    const id = JSON.stringify(key);
    if (!groups.has(id)) groups.set(id, { key, cols: wanted.map(() => []) });
    const cells = splitCipher(row.cipher, width);
    const g = groups.get(id);
    wanted.forEach(([, i], j) => g.cols[j].push(cells[i]));
  }

  if (fault.mode === 'tamper' && rows.length) {
    const first = groups.values().next().value;
    first.cols[0][0] = (first.cols[0][0] * first.cols[0][0]) % n2;
  }

  const released = [];
  let suppressed = 0;
  for (const g of [...groups.values()].sort((a, b) => JSON.stringify(a.key).localeCompare(JSON.stringify(b.key)))) {
    const count = g.cols[0].length;
    if (count < K_MIN) { suppressed++; continue; }
    const sums = {};
    wanted.forEach(([c], j) => { sums[c.squared ? `${c.metric}^2` : c.metric] = aggregate(g.cols[j], n2).toString(16); });
    released.push({ key: g.key, n: count, sums });
  }

  return {
    campaign: campaign.id,
    // Root and size of the input set actually aggregated; the owner compares
    // these with its receipt, so a dropped or extra record is caught here.
    root: merkleRoot(rows.map((r) => r.leaf_hash)),
    total: rows.length,
    group_by: groupBy,
    metrics: wanted.map(([c]) => (c.squared ? `${c.metric}^2` : c.metric)),
    k_min: K_MIN,
    suppressed,
    groups: released,
  };
}
