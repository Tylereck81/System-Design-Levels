// Merges the Node tests' coverage (NODE_V8_COVERAGE in coverage/node-v8) with the browser tests' (added by
// tests/fixtures.js), writes the HTML report to coverage/report/index.html, prints lines and branches per folder and
// the files with the most untested lines, and fails if a folder falls below its minimum.
// Run by tests/coverage/run.mjs (npm run coverage); CI runs it on its own after the test steps.
// Writing the report uses up the browser data, so a second report needs the browser tests run again.
// A run of some specs only (npm run coverage -- tests/level-03.spec.js) is for reading the report; it fails the minimums.
import { existsSync } from 'node:fs';
import { MCR } from 'monocart-coverage-reports';
import { coverageOptions, NODE_RAW_DIR } from './options.mjs';

/**
 * Percent of lines and branches the tests run, per folder: the values measured when coverage was added, rounded down.
 * Coverage can only go up: when tests raise a folder's numbers, raise its minimums here in the same change.
 * A file counts under the longest folder its path starts with, so `js/` holds only the files no longer entry claims.
 */
const MINIMUMS = {
  'js/engine/': { lines: 93, branches: 90 }, // 2026-11-08: 93.09%, 90.71%
  'js/ui/': { lines: 91, branches: 93 }, // 91.81%, 93.01%
  'js/': { lines: 90, branches: 90 }, // 90.73%, 90.59%
  'levels/': { lines: 97, branches: 80 }, // 97.83%, 80.64%
};
const METRICS = ['lines', 'branches'];
const UNTESTED_SHOWN = 10;
const FOLDERS = Object.keys(MINIMUMS).sort((a, b) => b.length - a.length); // longest first

/** The MINIMUMS key a file is counted under, or undefined. */
const folderOf = (path) => FOLDERS.find((dir) => path.startsWith(dir));

const pct = ({ covered, total }) => (total ? (100 * covered) / total : 100);

/** Covered and total lines and branches per folder. */
function totalsByFolder(files) {
  const totals = Object.fromEntries(Object.keys(MINIMUMS).map((dir) => [dir,
    Object.fromEntries(METRICS.map((m) => [m, { covered: 0, total: 0 }]))]));
  for (const file of files) {
    const dir = folderOf(file.sourcePath);
    if (!dir) continue;
    for (const m of METRICS) {
      totals[dir][m].covered += file.summary[m].covered;
      totals[dir][m].total += file.summary[m].total;
    }
  }
  return totals;
}

/** Lines naming each folder whose coverage is below its minimum; empty when all pass. */
function checkMinimums(totals) {
  const failures = [];
  console.log('\nCoverage per folder (minimum in brackets):');
  for (const [dir, metrics] of Object.entries(totals)) {
    const cells = METRICS.map((m) => {
      const value = pct(metrics[m]);
      if (value < MINIMUMS[dir][m]) failures.push(`${dir} ${m}: ${value.toFixed(2)}%, minimum ${MINIMUMS[dir][m]}%`);
      return `${m} ${value.toFixed(2)}% (${MINIMUMS[dir][m]}%)`;
    });
    console.log(`  ${dir.padEnd(18)} ${cells.join('   ')}`);
  }
  return failures;
}

function printLeastTested(files) {
  const untested = files
    .map((f) => ({ path: f.sourcePath, lines: f.summary.lines.total - f.summary.lines.covered }))
    .filter((f) => f.lines > 0)
    .sort((a, b) => b.lines - a.lines)
    .slice(0, UNTESTED_SHOWN);
  console.log(`\nMost untested lines (top ${UNTESTED_SHOWN}):`);
  for (const f of untested) console.log(`  ${String(f.lines).padStart(5)}  ${f.path}`);
}

const mcr = MCR(coverageOptions);
// Both halves or no report: numbers from one half alone would read as a huge drop, or hide one.
if (!existsSync(NODE_RAW_DIR) || !mcr.hasCache()) {
  console.error('Coverage needs both test runs first: npm run coverage runs them '
    + '(Node tests with NODE_V8_COVERAGE=coverage/node-v8, browser tests with COVERAGE=1).');
  process.exit(1);
}
await mcr.addFromDir(NODE_RAW_DIR);
const results = await mcr.generate();
printLeastTested(results.files);
const failures = checkMinimums(totalsByFolder(results.files));
console.log(`\nReport: ${results.reportPath}`);
if (failures.length) {
  console.error(`\nCoverage fell below its minimum:\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
}
