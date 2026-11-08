// tests/coverage/options.mjs: Node and browser coverage of the same file merge only if both name it by the same repo
// path; anything outside the repo is left out of the report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { repoPath } from '../coverage/options.mjs';

const ROOT = resolve(import.meta.dirname, '../..');

test('a served URL and a file URL of the same file give the same repo path', () => {
  const fromBrowser = repoPath('http://localhost:4199/js/engine/model.js');
  const fromNode = repoPath(pathToFileURL(resolve(ROOT, 'js/engine/model.js')).href);
  assert.equal(fromBrowser, 'js/engine/model.js');
  assert.equal(fromNode, 'js/engine/model.js');
});

test('a served URL is decoded and loses its query', () => {
  assert.equal(repoPath('http://localhost:4199/levels/level%2001.js?v=2'), 'levels/level 01.js');
});

test('files outside the repo, and URLs that are not files, have no repo path', () => {
  assert.equal(repoPath(pathToFileURL(resolve(ROOT, '..', 'other.js')).href), null);
  assert.equal(repoPath('node:internal/modules/run_main'), null);
  assert.equal(repoPath('not a url'), null);
});
