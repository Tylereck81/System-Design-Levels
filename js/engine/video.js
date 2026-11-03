// A video platform: uploads that arrive, videos transcoded, and the monthly bill for streaming them.

/** Size of an uploaded video (MB), views a day, and GB streamed per view. */
export const VIDEO_MB = 250;
export const VIEWS_DAY = 24e6;
export const VIEW_GB = 0.25;
/** API servers that would carry uploads (each with 1 Gbps, 125 MB/s). */
export const API_SERVERS = 4;
export const API_MBPS = 125;
/** Share of whole-file uploads that fail on a phone's connection: normally, and on patchy networks. */
export const FAIL = 0.05;
export const PATCHY_FAIL = 0.4;
/** Videos a second one transcoding server finishes (it encodes the segments in parallel). */
export const TRANSCODE_RATE = 1;
/** Share of the videos in transcoding that a dying worker held. */
export const IN_FLIGHT = 0.1;
/** Share of views on the most popular videos; $ per GB from the CDN and from your own storage servers. */
export const POPULAR = 0.8;
export const CDN_GB = 0.02;
export const OWN_GB = 0.002;

/**
 * The outcome for `rate` uploads a second. Through the API servers, every byte crosses their 1 Gbps links; with a
 * pre-signed URL the phone sends straight to storage. A whole-file upload that fails starts again from zero and often
 * never finishes (counted as failed); resumable chunks retry only the chunk. Transcoding servers finish
 * TRANSCODE_RATE videos a second each; when one dies, its videos are lost unless their tasks are retried on another.
 * Returns uploaded (share that arrive), transcoded (share of those published), lost, apiLoad (share of API capacity),
 * and streamGB and bill (a month, at `growth` × today's views).
 */
export function videoOutcome({ presigned, chunks, workers, retry, popularOnly }, { rate, patchy = false, dies = false, growth = 1 }) {
  const apiCap = presigned ? Infinity : API_SERVERS * API_MBPS / VIDEO_MB; // videos a second through the API servers
  const failed = chunks ? 0 : patchy ? PATCHY_FAIL : FAIL;
  const uploaded = Math.min(1, apiCap / rate) * (1 - failed);
  const healthy = workers - (dies ? 1 : 0), arriving = rate * uploaded;
  const lost = dies && !retry ? IN_FLIGHT : 0;
  const transcoded = arriving ? Math.min(1, healthy * TRANSCODE_RATE / arriving) * (1 - lost) : 1;
  const streamGB = VIEWS_DAY * growth * VIEW_GB * 30;
  const bill = streamGB * (popularOnly ? POPULAR * CDN_GB + (1 - POPULAR) * OWN_GB : CDN_GB);
  return { uploaded, transcoded, lost, failed, apiLoad: Number.isFinite(apiCap) ? rate / apiCap : 0, streamGB, bill };
}
