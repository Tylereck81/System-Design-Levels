// Shared settings for the coverage report (npm run coverage). The browser fixture (tests/fixtures.js) adds each
// test's coverage with these options, and tests/coverage/report.mjs merges it with the Node tests' coverage.
import { readFileSync } from 'node:fs';
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

const onDisk = new Map();
/**
 * Whether a browser entry's source is the file as it is on disk. A test that serves a changed copy of a file (a level
 * with extra lines, see serveLessonWith in tests/shared-checks.js) would otherwise add that copy as one more file,
 * with its own untested lines. Node entries carry no source here; they are always the file on disk.
 */
function unchanged(path, source) {
  if (source === undefined) return true;
  if (!onDisk.has(path)) onDisk.set(path, readFileSync(resolve(ROOT, path), 'utf8'));
  return source === onDisk.get(path);
}

export const coverageOptions = {
  name: 'System Design Levels coverage',
  outputDir: REPORT_DIR,
  reports: ['v8', 'console-summary'],
  cleanCache: false, // browser test workers share the cache; only tests/coverage/run.mjs clears it
  entryFilter: (entry) => { const path = repoPath(entry.url); return inScope(path) && unchanged(path, entry.source); },
  sourcePath: (filePath, info) => repoPath(info.url) ?? filePath,
  all: { dir: SCOPE.map((dir) => resolve(ROOT, dir)), filter: '**/*.js' }, // files no test loads count as 0%
};
