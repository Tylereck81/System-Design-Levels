// Component kinds (js/engine/kinds/): they import only the catalog and modules that import nothing, so components.js
// and model.js can import them without a cycle and they load in Node without a level or a page. Costs and redundancy
// below are worked out by hand from each type's catalog entry (js/engine/catalog.js) at its default choices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENGINE, importsOf } from './imports.mjs';

const DIR = new URL('kinds/', ENGINE);
const FILES = readdirSync(fileURLToPath(DIR)).filter((f) => f.endsWith('.js'));
// Loaded inside the tests, so a kind file that breaks the boundary fails the first test by name, not the whole file.
const kinds = () => import(new URL('index.js', DIR));

test('kind files import only the catalog and modules that import nothing', () => {
  assert.ok(FILES.includes('index.js') && FILES.length > 1);
  for (const file of FILES) {
    const url = new URL(file, DIR);
    for (const spec of importsOf(url)) {
      if (spec === '../catalog.js') continue;
      if (file === 'index.js' && spec.startsWith('./')) continue; // the index lists the kind files, checked themselves
      assert.deepEqual(importsOf(new URL(spec, url)), [], `${file}: ${spec} must not import anything`);
    }
  }
});

test('every kind has its own id and describes at least one component type', async () => {
  const [{ KINDS }, { COMPONENTS }] = await Promise.all([kinds(), import(new URL('catalog.js', ENGINE))]);
  const ids = KINDS.map((k) => k.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const k of KINDS) assert.ok(Object.values(COMPONENTS).some((c) => k.matches(c)), `${k.id} matches no component type`);
  // costOf asks the kind before its sharded, clustered and quorum branches, so no kind may take one of those types.
  for (const [type, c] of Object.entries(COMPONENTS)) {
    assert.ok(KINDS.filter((k) => k.matches(c)).length <= 1, `${type} matches two kinds: the second would never run`);
    if (c.sharded || c.clustered || c.quorum) assert.ok(!KINDS.some((k) => k.matches(c)), `${type} has its own costOf branch`);
  }
});

test('kindOf finds a type\'s kind by its catalog flag, and null for generic or unknown types', async () => {
  const { kindOf } = await kinds();
  assert.equal(kindOf({ type: 'nworker' }).id, 'notify-worker');
  assert.equal(kindOf({ type: 'trie' }).id, 'typeahead-trie');
  assert.equal(kindOf({ type: 'vserve' }).id, 'video-serve');
  assert.equal(kindOf({ type: 'notifier' }), null); // a notification server follows the generic rules
  assert.equal(kindOf({ type: 'web' }), null);
  assert.equal(kindOf({ type: 'no-such-type' }), null);
});

test('a kind prices its type from its settings', async () => {
  const { kindOf } = await kinds();
  const cost = (n, nodes = [n]) => kindOf(n).cost(n, 0, nodes);
  assert.equal(cost({ type: 'nworker' }), 360);          // $90 × 4 workers
  assert.equal(cost({ type: 'chatsrv' }), 900);          // $300 × 3 servers
  assert.equal(cost({ type: 'tapi' }), 800);             // $200 × 4 API servers
  assert.equal(cost({ type: 'trie' }), 1000);            // $300 × 3 shards + $100 weekly rebuild
  assert.equal(cost({ type: 'trie', rebuild: 'hourly', shards: '1' }), 800); // $300 × 1 + $500
  assert.equal(cost({ type: 'transcoder' }), 5000);      // $500 × 10 workers
  assert.equal(cost({ type: 'blocksrv' }), 600);         // $300 × 2 servers
  assert.equal(cost({ type: 'pollsrv' }), 1600);         // $400 × 4 servers
  assert.equal(cost({ type: 'feedsvc' }), 500);          // $300 + $100 × 2 fanout workers
  // Streaming: 24M views a day × 0.25 GB × 30 days = 180M GB a month, at $0.02 from the CDN; popular-only sends 80%
  // from the CDN and 20% from own servers at $0.002: 180M × (0.016 + 0.0004) = $2,952,000.
  assert.equal(cost({ type: 'vserve' }), 3600000);
  assert.equal(cost({ type: 'vserve', deliver: 'popular' }), 2952000);
  // The feed cache holds feeds only when posts are fanned out on write: 15M users × 500 entries × 16 bytes (IDs) =
  // 120 GB at $2 = $240. Built at read time (the default, or with no feed service), it holds nothing.
  const cache = { type: 'feedcache', store: 'ids' };
  assert.equal(cost(cache, [cache, { type: 'feedsvc', fanout: 'write' }]), 240);
  assert.equal(cost(cache, [cache, { type: 'feedsvc' }]), 0);
  assert.equal(cost(cache), 0);
});

test('a kind is redundant when one of its machines can fail', async () => {
  const { kindOf } = await kinds();
  const redundant = (n) => !!kindOf(n).redundant?.(n);
  assert.equal(redundant({ type: 'trie' }), true);              // 3 shards
  assert.equal(redundant({ type: 'trie', shards: '1' }), false); // one shard holds every prefix
  assert.equal(redundant({ type: 'chatsrv', count: '2' }), true);
  assert.equal(redundant({ type: 'vupload' }), true);           // it runs on the API servers
  assert.equal(redundant({ type: 'feedsvc' }), false);          // one feed service
});
