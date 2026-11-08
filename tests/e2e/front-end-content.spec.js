import { test, expect } from '../fixtures.js';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Everything that ships to players.
const SHIPPED = ['index.html', 'README.md', 'package.json', 'css', 'js', 'levels'];

// Lessons cite topics and public standards, not numbered sections of a reference text.
const FORBIDDEN = [
  { re: /\bbook\b/i, why: 'mentions a reference text' },
  { re: /\bch(apter)?\.?\s?\d+\b/i, why: 'cites a section number' },
  { re: /\bfig(ure)?\.?\s?\d+-\d+/i, why: 'cites a figure number' },
  { re: /\btable\s\d+-\d+/i, why: 'cites a table number' },
];

// Optional local list of extra phrases, one per line. Not part of the repo.
const LOCAL_LIST = 'docs/front-end-forbidden.txt';
if (existsSync(LOCAL_LIST)) {
  for (const phrase of readFileSync(LOCAL_LIST, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)) {
    FORBIDDEN.push({ re: new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), why: 'uses a listed phrase' });
  }
}

function files(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
}

test('shipped files cite topics, not numbered sections or listed phrases', () => {
  const hits = [];
  for (const file of SHIPPED.flatMap(files)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const { re, why } of FORBIDDEN) {
        const m = line.match(re);
        if (m) hits.push(`${file}:${i + 1} ${why}: "${m[0]}"`);
      }
    });
  }
  expect(hits, hits.join('\n')).toEqual([]);
});
