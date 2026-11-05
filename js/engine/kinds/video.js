// A video platform (video.js): its settings, the upload service, the transcoding servers and delivery's monthly bill.
import { COMPONENTS, optionOf, isOn } from '../catalog.js';
import { videoOutcome, API_SERVERS } from '../video.js';

/** A video platform's settings, from its upload service, transcoding servers and delivery (any may be missing). */
export function videoSettingsOf(up, tc, sv) {
  return {
    presigned: isOn(up, 'url'), chunks: isOn(up, 'chunks'), retry: isOn(tc, 'retry'), popularOnly: isOn(sv, 'deliver'),
    workers: tc ? optionOf(tc, 'workers').count : 0,
  };
}

/**
 * The upload service and the transcoding servers: each passes on the share of videos that get through it (uploads that
 * arrive; videos transcoded and not lost).
 */
function step(n, L, ctx) {
  const c = COMPONENTS[n.type], o = ctx.outcomes.video, up = c.video === 'upload';
  // Uploads through the API servers are limited by their links.
  const ok = up ? o.uploaded : o.transcoded, cap = up ? (o.apiLoad ? L / o.apiLoad : c.cap) : c.cap * o.workers;
  ctx.settle(n, L * ok, { load: L, cap, util: L / cap, ms: c.base, mult: 1, base: c.base, unit: c.unit, drop: 1 - ok, video: o });
  ctx.forward(n, L * ok);
}

const workersOf = (n) => videoSettingsOf(null, n, null).workers;

/** The upload service. It runs on API_SERVERS API servers, so one failing does not stop it. */
export const videoUpload = {
  id: 'video-upload',
  matches: (c) => c.video === 'upload',
  outcome: 'video',
  step,
  redundant: () => API_SERVERS > 1,
};

/** The transcoding servers. Each worker costs the type's price. */
export const videoTranscode = {
  id: 'video-transcode',
  matches: (c) => c.video === 'transcode',
  outcome: 'video',
  step,
  cost: (n) => COMPONENTS[n.type].cost * workersOf(n),
  redundant: (n) => workersOf(n) > 1,
};

/** Delivery: a managed service whose cost is the month's streaming bill. */
export const videoServe = {
  id: 'video-serve',
  matches: (c) => c.video === 'serve',
  cost: (n) => Math.round(videoOutcome(videoSettingsOf(null, null, n), { rate: 1 }).bill),
};
