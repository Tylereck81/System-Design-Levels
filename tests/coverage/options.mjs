// Shared settings for the coverage report (npm run coverage). The browser fixture (tests/fixtures.js) adds each
// test's coverage with these options, and tests/coverage/report.mjs merges it with the Node tests' coverage.
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const COVERAGE_DIR = resolve(ROOT, 'coverage');
export const NODE_RAW_DIR = resolve(COVERAGE_DIR, 'node-v8'); // NODE_V8_COVERAGE writes the Node tests' data here
export const REPORT_DIR = resolve(COVERAGE_DIR, 'report');

/** The game's code, measured from the repo root. */
const SCOPE = ['js/', 'levels/'];

/**
 * The file a coverage entry belongs to, relative to the repo root with forward slashes, or null for anything that is
 * not a file of this repo. Browser entries are served URLs (http://localhost:4199/js/x.js), Node entries are file URLs,
 * so both name the same file the same way and their coverage merges.
 */
export function repoPath(url) {
  let path;
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') {
      path = relative(ROOT, fileURLToPath(u));
      if (path.startsWith('..')) return null;
    } else if (u.protocol === 'http:') {
      path = decodeURIComponent(u.pathname).slice(1);
    } else return null;
  } catch { return null; }
  return path.split(sep).join('/');
}

const inScope = (path) => path != null && SCOPE.some((dir) => path.startsWith(dir));

export const coverageOptions = {
  name: 'System Design Levels coverage',
  outputDir: REPORT_DIR,
  reports: ['v8', 'console-summary'],
  cleanCache: false, // browser test workers share the cache; only tests/coverage/run.mjs clears it
  entryFilter: (entry) => inScope(repoPath(entry.url)),
  sourcePath: (filePath, info) => repoPath(info.url) ?? filePath,
  all: { dir: SCOPE.map((dir) => resolve(ROOT, dir)), filter: '**/*.js' }, // files no test loads count as 0%
};
