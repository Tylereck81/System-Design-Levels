// js/engine/video.js: uploads that arrive, videos transcoded and the streaming bill, worked out by hand.
// Constants: 250 MB a video; 4 API servers × 125 MB/s = 500 MB/s = 2 videos/s; 5% (40% patchy) whole-file failures;
// 1 video/s a transcoder; 10% in flight; 24M views × 0.25 GB; $0.02/GB CDN, $0.002/GB own; 80% of views popular.
import { test } from 'node:test';
import { videoOutcome } from '../../js/engine/video.js';
import { fields } from './near.mjs';

const cfg = (o) => ({ presigned: false, chunks: false, workers: 2, retry: false, popularOnly: false, ...o });
// A month: 24e6 × 0.25 GB × 30 = 180e6 GB; all from the CDN: 180e6 × 0.02 = $3.6M.
const MONTH_GB = 180e6;

test('through the API servers within capacity: 5% of whole-file uploads fail', () => {
  // 1 / 2 of API capacity; 0.95 arrive; 2 transcoders ≥ 0.95/s.
  fields(videoOutcome(cfg(), { rate: 1 }), { uploaded: 0.95, transcoded: 1, lost: 0, failed: 0.05, apiLoad: 0.5, streamGB: MONTH_GB, bill: 3.6e6 });
});

test('API servers overloaded and too few transcoders', () => {
  // 4/s on 2/s: 0.5 × 0.95 = 0.475; 1.9 arrive/s on 1 transcoder → 1 / 1.9.
  fields(videoOutcome(cfg({ workers: 1 }), { rate: 4 }), { uploaded: 0.475, apiLoad: 2, transcoded: 1 / 1.9 });
});

test('pre-signed URL and resumable chunks: everything arrives; patchy networks hurt whole files', () => {
  fields(videoOutcome(cfg({ presigned: true, chunks: true }), { rate: 4, patchy: true }), { uploaded: 1, failed: 0, apiLoad: 0 });
  fields(videoOutcome(cfg({ presigned: true }), { rate: 1, patchy: true }), { uploaded: 0.6, failed: 0.4 }); // 1 − 0.4
});

test('a transcoder dies: 10% lost unless retried', () => {
  // 1 healthy × 1/s for 1 arriving → 1 × (1 − 0.1) = 0.9.
  const up = { presigned: true, chunks: true };
  fields(videoOutcome(cfg(up), { rate: 1, dies: true }), { transcoded: 0.9, lost: 0.1 });
  fields(videoOutcome(cfg({ ...up, retry: true }), { rate: 1, dies: true }), { transcoded: 1, lost: 0 });
});

test('the bill: popular videos from the CDN, the rest from own servers; growth scales it', () => {
  // 180e6 × (0.8 × 0.02 + 0.2 × 0.002 = 0.0164) = $2.952M.
  fields(videoOutcome(cfg({ popularOnly: true }), { rate: 1 }), { bill: 2.952e6 });
  fields(videoOutcome(cfg(), { rate: 1, growth: 2 }), { streamGB: 2 * MONTH_GB, bill: 7.2e6 });
});

test('no uploads: nothing to transcode counts as all done', () => {
  fields(videoOutcome(cfg(), { rate: 0 }), { transcoded: 1, apiLoad: 0 });
});
