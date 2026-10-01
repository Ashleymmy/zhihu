#!/usr/bin/env node
// Local guard for sensitive files in every commit reachable from a pushed ref.
// Intentionally inspect history: deleting a debug file in a later commit is insufficient.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const blocked = (path) =>
  /(^|\/)\.dsh-debug\//.test(path) ||
  /(^|\/)cloudbaserc\.json$/.test(path) ||
  /\.(?:key|p12|pfx)$/.test(path) ||
  (/(^|\/)\.env(?:\.[^/]*)?$/.test(path) && !/\.(?:example|sample)$/.test(path));
try {
  const refs = process.argv[2] === '--check'
    ? process.argv.slice(3)
    : fs.readFileSync(0, 'utf8').trim().split('\n').filter(Boolean).map(line => line.split(/\s+/)[1]);
  const paths = new Set();
  for (const ref of refs.filter(ref => !/^0+$/.test(ref))) {
    const output = execFileSync('git', ['-c', 'core.quotePath=false', 'rev-list', '--objects', ref, '--'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    for (const line of output.split('\n')) {
      const path = line.slice(line.indexOf(' ') + 1);
      if (blocked(path)) paths.add(path);
    }
  }
  if (paths.size) {
    console.error('Push blocked: sensitive configuration/debug files remain in this branch history.');
    for (const path of paths) console.error('  ' + path);
    console.error('Use a clean branch or remove sensitive history after review; do not merely delete the current files.');
    process.exitCode = 1;
  }
} catch {
  console.error('Push safety check could not complete; no push was allowed.');
  process.exitCode = 1;
}
