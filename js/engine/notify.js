// A notification system: what its workers deliver on time, what they lose or send twice, and who gets what.

/** Share of notifications on each channel (12 million push, 2 million SMS, 6 million emails a day). */
export const SHARES = { push: 0.6, sms: 0.1, email: 0.3 };
/** A worker machine sends one notification at a time, 10 ms each; a send to a provider that is down waits 1 s. */
export const SEND_MS = 10;
export const TIMEOUT_MS = 1000;
/** Share of notifications addressed to a user who opted out of that channel. */
export const OPT_OUT = 0.05;
/** A marketing blast: twice the normal traffic in extra promotions, to users who already got today's. */
export const BLAST = 2;
/** Share of notifications a crashing worker had taken from its queue but not yet confirmed. */
export const IN_FLIGHT = 0.02;

/**
 * What the workers do with `rate` notification requests a second. The notification servers can skip users who opted
 * out (check) and drop a blast to users at their daily limit (limit). With one shared queue every worker takes every
 * channel, so while the SMS provider is down each SMS holds a worker for the timeout; with a queue per channel the
 * machines are split by traffic and only the SMS queue stalls. A failed send is lost unless the notification log
 * lets it be retried (it then waits in its queue). When workers crash, what they held in flight is lost, or with the
 * log resent; half of it had already gone out, so it arrives twice unless duplicates are dropped by event ID.
 * Returns served (share of requests handled on time: sent, or rightly skipped), others (push and email sent on
 * time), lost, waiting (SMS kept for retry), dup, optSent (sent to users who opted out) and spam (blast sent).
 */
export function notifyOutcome({ perChannel, workers, check, limit, retry, dedupe }, { rate, smsDown = false, blast = false, crash = false }) {
  const skip = check ? OPT_OUT : 0, extra = blast && !limit ? rate * BLAST : 0;
  const send = rate * (1 - skip) + extra; // notifications the workers must send
  const ms = (ch) => (smsDown && ch === 'sms' ? TIMEOUT_MS : SEND_MS);
  const ok = {}; // share of each channel's sends that go out on time
  if (perChannel) for (const ch in SHARES) ok[ch] = Math.min(1, workers * SHARES[ch] * 1000 / ms(ch) / (send * SHARES[ch]));
  else {
    const avg = Object.keys(SHARES).reduce((a, ch) => a + SHARES[ch] * ms(ch), 0), all = Math.min(1, workers * 1000 / avg / send);
    for (const ch in SHARES) ok[ch] = all;
  }
  if (smsDown) ok.sms = 0; // the provider sends nothing
  const sent = Object.keys(SHARES).reduce((a, ch) => a + SHARES[ch] * ok[ch], 0);
  const failedSms = smsDown ? SHARES.sms : 0, held = crash ? IN_FLIGHT : 0;
  return {
    served: skip + (1 - skip) * sent, // of the real requests; a blast's sends only take the workers' time
    others: (SHARES.push * ok.push + SHARES.email * ok.email) / (SHARES.push + SHARES.email),
    lost: retry ? 0 : failedSms + held,
    waiting: retry ? failedSms : 0,
    dup: retry && !dedupe ? held / 2 : 0,
    optSent: check ? 0 : OPT_OUT,
    spam: extra > 0,
  };
}
