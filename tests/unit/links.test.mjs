// js/engine/links.js: queries per new link and the traffic that reaches a URL shortener, worked out by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREATE_QUERIES, linkTraffic } from '../../js/engine/links.js';
import { fields } from './near.mjs';

test('queries per new link: an insert, a lookup + insert, or an insert + 1% false-positive lookups', () => {
  assert.deepEqual(CREATE_QUERIES, { base62: 1, hash: 2, bloom: 1.01 }); // 1 + 0.01
});

const base = { qps: 1000, writes: 0.1, repeat: 0.5 }; // 900 clicks and 100 new links a second

test('302 redirect: every request reaches the servers', () => {
  fields(linkTraffic({ permanent: false, limit: false }, base), { qps: 1000, writes: 0.1, hot: 0, counted: 1, bots: 0 });
});

test('301 redirect: browsers answer repeat clicks, so fewer reach and fewer are counted', () => {
  // 900 × 0.5 = 450 clicks + 100 creations = 550; writes 100 / 550; counted 450 / 900.
  fields(linkTraffic({ permanent: true, limit: false }, base), { qps: 550, writes: 100 / 550, counted: 0.5 });
});

test('a viral link: its new visitors all reach the servers', () => {
  // 450 + 450 viral = 900 clicks reach; hot 450 / 900; counted 900 / (900 + 450); total 1,000.
  fields(linkTraffic({ permanent: true, limit: false }, { ...base, viral: 450 }), { qps: 1000, hot: 0.5, counted: 900 / 1350, writes: 0.1 });
});

test('a bulk account: let through without a limit, turned away with one', () => {
  // 1,000 + 200 = 1,200; writes (100 + 200) / 1,200 = 0.25.
  fields(linkTraffic({ permanent: false, limit: false }, { ...base, bulk: 200 }), { qps: 1200, writes: 0.25, bots: 200 });
  fields(linkTraffic({ permanent: false, limit: true }, { ...base, bulk: 200 }), { qps: 1000, writes: 0.1, bots: 0 });
});

test('no traffic: shares are 0, and every (absent) click counts as reached', () => {
  fields(linkTraffic({ permanent: true, limit: false }, { qps: 0, writes: 0.1, repeat: 0.5 }), { qps: 0, writes: 0, hot: 0, counted: 1 });
});
