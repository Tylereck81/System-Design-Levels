// npm run coverage: runs the Node tests and the Chromium browser tests with coverage on, then writes the merged report
// (tests/coverage/report.mjs). Arguments go to Playwright: npm run coverage -- tests/level-03.spec.js
// Fails if any test fails or a folder's coverage falls below its minimum.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { COVERAGE_DIR, NODE_RAW_DIR } from './options.mjs';

/** Runs a command with extra environment variables; true when it passed. */
function run(command, env = {}) {
  console.log(`\n> ${command}`);
  const { status } = spawnSync(command, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  return status === 0;
}

rmSync(COVERAGE_DIR, { recursive: true, force: true }); // never report on an earlier run's data
const unit = run('npm run test:unit', { NODE_V8_COVERAGE: NODE_RAW_DIR });
const e2e = run(['npm run test:e2e --', ...process.argv.slice(2)].join(' '), { COVERAGE: '1' });
const report = run('node tests/coverage/report.mjs');
if (!unit || !e2e) console.error('\nSome tests failed: coverage counts only what ran before the failure.');
process.exitCode = unit && e2e && report ? 0 : 1;
