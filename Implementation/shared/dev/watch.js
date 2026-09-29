// Dev-only restarter: node shared/dev/watch.js <entry> <dir>...
// Used instead of `node --watch`, which talks to worker threads and crashes
// libraries (paillier-bigint's prime generation) that run their own workers.
import { spawn } from 'node:child_process';
import { watch, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [entry, ...dirs] = process.argv.slice(2);
let child;
let timer;

function start() {
  child = spawn(process.execPath, ['--env-file-if-exists=.env.local', entry], { stdio: 'inherit' });
}

function restart(file) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`[watch] ${file} changed, restarting`);
    child.once('exit', start);
    child.kill();
  }, 150);
}

// One non-recursive watcher per directory: a directory watch keeps working when
// an editor saves by replacing the file, which a recursive watch on Linux misses.
// ponytail: directories created after start aren't watched; restart the script.
function watchTree(dir) {
  watch(dir, (_, file) => file && restart(file));
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory() && d.name !== 'node_modules') watchTree(join(dir, d.name));
  }
}
dirs.forEach(watchTree);
process.on('SIGINT', () => { child.kill(); process.exit(0); });
process.on('SIGTERM', () => { child.kill(); process.exit(0); });
start();
