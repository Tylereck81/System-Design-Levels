// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 16: Notification system.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt, percent } from '../js/format.js';
import { servedGoal, costGoal, servedAtLeast, fmtPct } from './shared/goals.js';
import { SHARES, SEND_MS, TIMEOUT_MS, OPT_OUT, BLAST, IN_FLIGHT } from '../js/engine/notify.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { panel, queueCells } from './shared/figures.js';
import { COMPONENTS } from '../js/engine/catalog.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 1000, servedPct: 99 };
const BUDGET = 700;
const RATE = 460; // notification requests a second at the peak

// ---------------- Lesson ----------------
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
const notifier = COMPONENTS.notifier;
const nqueue = COMPONENTS.nqueue;
const nworker = COMPONENTS.nworker;
/** Seconds in a day. */
const DAY_S = 86400;
/** How many channels there are, and so how many queues a queue per channel makes. */
const CHANNELS = Object.keys(SHARES).length;

// Scope example (ours): 8 million push, 3 million SMS, 4 million email a day (the mission uses 12 + 2 + 6).
// 15,000,000 ÷ 86,400 = 173.6, about 174 a second; × 2 = 348 at the peak; 348 ÷ 100 a worker = 3.48, so 4 workers.
const sc = { push: 8, sms: 3, email: 4 };
sc.total = sc.push + sc.sms + sc.email;
sc.avg = Math.round((sc.total * 1e6) / DAY_S);
sc.peak = sc.avg * 2;
sc.workers = Math.ceil(sc.peak / nworker.cap);

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 16 · Part 3: Design real systems',
    title: 'Notification system',
    story: 'A food delivery app tells people about their orders: by push, by text and by email. Millions go out every day through outside services you do not control. Each must arrive, on time, and only to people who want it.',
    picture: 'figBuilt',
    alt: 'The finished design: app services call notification servers, which check settings and limits and put each notification on a push, SMS or email queue. Workers take them from the queues and hand them to outside providers, keeping a log.',
    outcomes: [
      'turn daily notification counts into a rate',
      'trace a notification from app to phone',
      'isolate a failing provider with a queue per channel',
      'respect opt-outs and limit how often users are notified',
      'lose nothing without sending anything twice',
    ],
  },
  last: 'Level 15 sent requests to other people\'s servers. Now the requests go to people, through outside services that can fail at any time.',
  parts: [
    {
      title: 'A queue per channel',
      mission: 0,
      minutes: 10,
      lead: 'The notification itself is easy. Delivering millions of them through services you do not run is the design.',
      newParts: [
        { type: 'notifier', before: 1, what: 'The servers your app\'s services call to send a notification.', does: 'Look up the user\'s device, phone or email, fill in a template, and put the notification on a queue.', game: `$${notifier.cost} a month. Takes ${fmt(notifier.cap)} requests/s.` },
        { type: 'nqueue', before: 1, what: 'Queues that hold notifications between steps.', does: 'Keep notifications until a worker takes them, so bursts and slow providers never reach the notification servers.', game: `$${nqueue.cost} a month.` },
        { type: 'nworker', before: 1, what: 'Machines that send notifications.', does: 'Take notifications from the queues and hand each to the right outside provider.', game: `$${nworker.cost} a month each. Sends ${nworker.cap} a second.` },
        { type: 'provider', before: 1, what: 'Outside services that deliver: phone makers\' push services, an SMS gateway, an email service.', does: 'Deliver to the phone or inbox. You do not run them, and any can fail.', game: 'No monthly cost here.' },
      ],
      sections: [
        {
          title: 'Scope it: how many notifications a second?',
          hook: `Ask which channels, how fast they must arrive, and how many a day. Say: push, SMS and email; as soon as possible, a little late is fine; ${sc.push} million push, ${sc.sms} million texts and ${sc.email} million emails a day.`,
          body: [
            {
              calc: {
                formula: `Rate = notifications a day ÷ ${fmt(DAY_S)}, then × 2 for the peak.`,
                rows: [
                  { label: 'A day', work: `${sc.push} million + ${sc.sms} million + ${sc.email} million`, result: `${sc.total} million notifications` },
                  { label: 'Average', work: `${sc.total} million ÷ ${fmt(DAY_S)} s`, result: `${sc.avg} a second`, approx: true },
                  { label: 'Peak', work: `${sc.avg} a second × 2`, result: `${sc.peak} a second` },
                ],
                result: `Plan for about ${sc.peak} a second. At ${nworker.cap} a second for each worker, ${sc.workers} workers only just keep up; plan ${sc.workers + 1}.`,
              },
            },
          ],
          takeaway: 'Add the channels, divide by a day\'s seconds, and double for the peak.',
          quiz: [9],
        },
        {
          title: 'How does a notification reach a phone?',
          hook: 'You cannot reach a phone directly. Only its maker\'s push service can, and it needs to know which app on which phone.',
          body: [
            {
              figure: 'figPath',
              alt: 'The order service calls the notification server. The server looks up the user\'s device token and settings, and puts the notification on the push queue. A worker takes it and sends it to the phone maker\'s push service, which shows it on the phone.',
              caption: 'From your service to the phone, in six steps',
            },
            { p: 'When the app is installed it registers and gets a <b>device token</b>: the address of that app on that phone. You store it with the user. A user with three devices has three tokens. Texts need a phone number and emails an address, collected at sign-up.' },
            { p: 'Messages follow <b>templates</b> with blanks, such as "Your order from [shop] is on its way", so nothing is written from scratch. And only your own services may call the notification API, or anyone could send spam through it.' },
          ],
          takeaway: 'Push needs a device token, and every message starts from a template.',
          quiz: [1, 7, 8],
        },
        {
          title: 'Why give each channel its own queue?',
          hook: 'Providers fail. When the SMS gateway stops answering, what happens to push and email?',
          body: [
            {
              figure: 'figQueues',
              alt: 'With one shared queue, messages for every channel wait behind SMS messages that cannot be sent while the SMS provider is down. With a queue for each channel, only the SMS queue grows, and push and email keep flowing.',
              caption: 'One stuck provider stalls one queue, not all of them',
            },
            { p: 'With one shared queue, workers get stuck on texts that cannot be sent, and everything behind them waits. With a <b>queue per channel</b>, an outage only backs up its own queue. The queues also absorb bursts, so the notification servers never wait on a provider.' },
          ],
          takeaway: 'A queue per channel keeps one provider\'s outage from stalling the others.',
          quiz: [0],
        },
      ],
      checks: [
        {
          q: 'All channels share one queue. The email service slows to a crawl. What do push users notice?',
          options: [
            { t: 'Nothing: push uses a different provider', why: 'The provider is different, but the queue is shared, so push waits behind emails.' },
            { t: 'Late notifications', right: true, why: 'Workers spend their time on slow emails, and push messages wait behind them in the same queue.' },
          ],
        },
      ],
      youWill: [
        'estimate notifications a second (Play stays locked until you do)',
        `connect notification servers, queues, workers and providers, and send ${targets.servedPct}% on time`,
        'take the SMS provider down: push and email must stay on time',
        `stay within $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'The SMS outage only backed up the SMS queue. Push and email went out as usual.',
        number: [`${CHANNELS} queues`, 'one per channel'],
        next: `${percent(OPT_OUT)} of requests are for users who switched that channel off, and marketing wants to send one more promotion.`,
      },
    },
    {
      title: 'Respect your users',
      mission: 1,
      minutes: 5,
      lead: 'A notification the user did not want is worse than none.',
      sections: [
        {
          title: 'Who decides whether a user gets a notification?',
          hook: `The user does. Each user can switch each channel on or off, and that setting is stored with them. Here ${percent(OPT_OUT)} of requests are for users who switched that channel off.`,
          body: [
            { ul: [
              '<b>Check the setting first.</b> The notification server looks up the user\'s choice for that channel before anything is queued. A user who opted out gets nothing, and the message costs nothing further.',
              '<b>Limit how often.</b> Cap how many notifications, especially promotions, a user gets in a day. People who are flooded switch notifications off for good, and then even their order updates stop.',
            ] },
          ],
          takeaway: 'Check each user\'s settings and daily limit before a notification is queued.',
          quiz: [4, 5],
        },
      ],
      checks: [
        {
          q: 'Where should an opt-out be checked?',
          options: [
            { t: 'On the phone, after it arrives', why: 'Then you have already sent it, paid for it, and annoyed the user.' },
            { t: 'In the notification server, before queuing', right: true, why: 'Early, once, and before any work or cost is spent.' },
          ],
        },
      ],
      youWill: [
        'never notify a user who opted out',
        'let marketing send a blast: nobody may be flooded, and orders still go out on time',
        `stay within $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'Users who opted out were skipped, and the blast was cut down to each user\'s daily limit.',
        number: [percent(OPT_OUT), 'of requests skipped because the user opted out'],
        next: 'Workers crash now and then, and whatever they had taken from the queue disappears with them.',
      },
    },
    {
      title: 'Never lose one',
      mission: 2,
      minutes: 7,
      lead: 'A notification may be late. It may not be lost. And it should not arrive twice.',
      sections: [
        {
          title: 'How to make sure no notification is lost',
          hook: 'A worker takes a notification from the queue and crashes before sending it. Where is the notification now?',
          body: [
            { p: 'Nowhere, unless you kept a record. So write every notification to a <b>notification log</b> before it is sent, and mark it done when the provider confirms. Anything not confirmed is <b>retried</b>. If a send keeps failing, an alert goes to the engineers.' },
          ],
          takeaway: 'Log every notification and retry until the provider confirms it.',
          quiz: [2],
        },
        {
          title: 'Why can a notification arrive twice?',
          hook: 'A worker sends a notification, and crashes before it can mark it done.',
          body: [
            { p: 'The log says "not confirmed", so it is retried, and the user gets it twice. You cannot tell from outside whether the crash came before or after the send. That is why sending <b>exactly once</b> is impossible across machines.' },
            { p: 'Give each notification a unique <b>event ID</b>. Before sending, the worker checks whether that ID was already sent, and drops it if so. This <b>dedupe</b> check makes duplicates rare.' },
            { p: 'Watch the number of notifications waiting in the queues. If it keeps growing, the workers are falling behind.' },
          ],
          takeaway: 'Exactly once is impossible, so retry and drop event IDs already sent.',
          quiz: [3, 6],
        },
      ],
      checks: [
        {
          q: 'A worker crashes just after the provider accepted a notification. The retry sends it again. What stops the user seeing it twice?',
          options: [
            { t: 'Nothing can', why: 'A check on the event ID can, if the send was recorded.' },
            { t: 'A check that drops event IDs already sent', right: true, why: 'The second attempt finds the ID recorded and is dropped.' },
          ],
        },
      ],
      youWill: [
        'crash the workers with the Break it button',
        'make sure nothing is lost and nothing is sent twice',
        `stay within $${fmt(BUDGET)} a month`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The finished design: app services call notification servers, which check settings and limits and put each notification on a push, SMS or email queue. Workers hand them to outside providers, keeping a log.',
    say: [
      '"Each channel has its own queue and workers, so one provider\'s outage stalls only that channel."',
      '"Settings and per-user limits are checked before anything is queued."',
      '"Every notification is logged and retried, and an event ID check drops duplicates."',
    ],
    numbers: [
      [fmt(DAY_S), 'seconds in a day'],
      [percent(OPT_OUT), 'of requests were for users who opted out'],
    ],
    loop: `The interview steps: ${scope} (notifications a second), ${sketch} (servers, queues, workers, providers), ${deep} (settings, limits, log and dedupe), ${stress} (a provider outage, a blast, crashed workers).`,
    broken: 'Level 17 sends every new post to everyone who follows its author, and some authors have millions of followers.',
  },
};

// ---------------- Lesson pictures ----------------
/**
 * One push notification in six numbered steps: the order service calls the notification server, which looks up the
 * user's token and settings and queues it; a worker takes it and sends it to the push service, which reaches the phone.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawPath(f, svg) {
  const { figNode, figArrow, figSvg } = f;
  figSvg(svg, 480);
  figNode(svg, 'users', 120, 50, 'Order service', 'Order picked up');
  figNode(svg, 'notifier', 520, 50, 'Notification server', 'Checks, fills in');
  figArrow(svg, 214, 50, 426, 50, 'calls the API', '1', 262, 42);
  figNode(svg, 'db', 120, 180, 'User data', 'Tokens, settings');
  figArrow(svg, 440, 80, 214, 165, 'looks up', '2', 236, 118);
  figNode(svg, 'nqueue', 520, 180, 'Push queue', 'Waits its turn');
  figArrow(svg, 520, 80, 520, 150, 'queues it', '3', 548, 119);
  figNode(svg, 'nworker', 520, 310, 'Worker', 'Takes, then sends');
  figArrow(svg, 520, 210, 520, 280, 'takes it', '4', 548, 249);
  figNode(svg, 'provider', 120, 310, 'Push service', 'The phone maker\'s');
  figArrow(svg, 426, 310, 214, 310, 'sends it', '5', 262, 302);
  figNode(svg, 'users', 120, 440, 'The user\'s phone', '"On its way"');
  figArrow(svg, 120, 340, 120, 410, 'shows it', '6', 148, 379);
}

/**
 * The SMS provider is down. One shared queue: the workers are stuck on SMS sends and push and email wait behind them.
 * A queue per channel: only the SMS queue backs up, and push and email flow to their providers.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawQueues(f, svg) {
  const CELL = 48; // wide enough for "email"
  const { figNode, figArrow, figLabel, figSvg, svgEl } = f;
  const downNode = (type, x, y, name, sub) => figNode(svgEl('g', { class: 'fig-down' }, svg), type, x, y, name, sub);
  figSvg(svg, 496);
  panel(f, svg, 10, 220, 'One shared queue: everything waits behind SMS');
  queueCells(f, svg, 24, 80, ['email', 'push', 'email', 'push', 'SMS', 'SMS'], CELL);
  figArrow(svg, 316, 80, 344, 80, '', null, 0, 0);
  figNode(svg, 'nworker', 440, 80, 'Workers', 'Stuck on SMS');
  figLabel(svg, 168, 124, 'push and email wait behind SMS');
  figArrow(svg, 440, 110, 440, 150, 'waiting', null, 452, 136);
  downNode('provider', 440, 180, 'SMS provider', 'Not answering');
  panel(f, svg, 246, 240, 'A queue per channel: only SMS waits');
  const rows = [['push', 'Push service', 'Sending'], ['SMS', 'SMS provider', 'Not answering'], ['email', 'Email service', 'Sending']];
  rows.forEach(([channel, name, sub], i) => {
    const y = 296 + 70 * i;
    const waiting = Array(channel === 'SMS' ? 5 : 2).fill(channel);
    queueCells(f, svg, 312 - CELL * waiting.length, y, waiting, CELL);
    figArrow(svg, 316, y, 344, y, '', null, 0, 0);
    if (channel === 'SMS') downNode('provider', 440, y, name, sub);
    else figNode(svg, 'provider', 440, y, name, sub);
  });
}

/**
 * The finished design, drawn for the intro and again for the wrap-up: app services call the notification servers,
 * which fill a queue per channel; the worker pool logs each notification and sends it to the providers.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { figNode, figArrow, figSvg } = f;
  figSvg(svg, 480);
  figNode(svg, 'users', 110, 45, 'App services', 'Orders, payments');
  figNode(svg, 'notifier', 420, 45, 'Notification servers', 'Settings, limits');
  figArrow(svg, 204, 45, 326, 45, 'API calls', null, 265, 37, 'middle');
  [['Push queue', 'Push messages'], ['SMS queue', 'Text messages'], ['Email queue', 'Email messages']].forEach(([name, sub], i) => {
    const x = 110 + 210 * i;
    figNode(svg, 'nqueue', x, 175, name, sub);
    figArrow(svg, 380 + 40 * i, 75, x, 145, '', null, 0, 0);
    figArrow(svg, x, 205, 170 + 65 * i, 275, '', null, 0, 0);
  });
  figNode(svg, 'nworker', 220, 305, 'Worker pool', 'Retry, dedupe');
  figNode(svg, 'db', 530, 305, 'Notification log', 'Every send');
  figArrow(svg, 314, 305, 436, 305, 'log first', null, 375, 297, 'middle');
  figNode(svg, 'provider', 220, 435, 'Providers', 'Push, SMS, email');
  figArrow(svg, 220, 335, 220, 405, 'sends', null, 232, 374);
  figNode(svg, 'users', 530, 435, 'Phones and inboxes', 'Your users');
  figArrow(svg, 314, 435, 436, 435, 'deliver', null, 375, 427, 'middle');
}

const served99 = servedAtLeast(targets.servedPct);
const sentGoal = servedGoal(targets, { text: `Send ${targets.servedPct}% of notifications on time` });
/** @type {Goal} */
const optGoal = { id: 'optout', type: 'metric', text: 'Nothing sent to users who opted out', test: (m) => !!m.notify && m.notify.optSent === 0, val: (m) => (m.notify ? fmtPct(100 * m.notify.optSent) : '—') };
const ON_OFF = (what, offName, offSub, offNote, onName, onSub, onNote) => [
  { id: 'off', name: offName, sub: offSub, note: offNote, log: `${what}: ${offName.toLowerCase()}.` },
  { id: 'on', name: onName, sub: onSub, note: onNote, log: `${what}: ${onName.toLowerCase()}.` },
];

/** @type {Level} */
export default {
  id: 16,
  saveKey: 'sdl-level16-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
  targets,
  workload: { notify: true },

  // The mock interview's brief and self-check list for this problem (see mock.js).
  mock: {
    title: 'Notification system',
    brief: 'Design a notification system that sends push notifications, SMS and email for an app\'s services: 12 million push, 2 million SMS and 6 million emails a day. Soft real-time; users can opt out.',
    checklist: [
      'Estimated notifications a second (about 231, 463 at the peak)',
      'Used a queue per channel with workers, so one provider\'s outage doesn\'t stop the others',
      'Named the outside providers, and how device tokens are gathered',
      'Kept a notification log with retries, so nothing is lost',
      'Dropped duplicates by event ID, and said exactly-once isn\'t possible',
      'Checked opt-outs and limited notifications per user',
    ],
  },

  components: {
    users: {
      name: 'Services', sub: 'Ask for notifications',
      desc: `The app's own services: orders, payments, marketing. They call POST /v1/notifications to tell a user something, such as "your order is on its way". ${Math.round(100 * SHARES.push)}% go out as push, ${Math.round(100 * SHARES.sms)}% as SMS, ${Math.round(100 * SHARES.email)}% as email.`,
    },
    notifier: {
      name: 'Notification server', short: 'Checks, builds, queues',
      desc: 'Takes each request, looks up the user\'s device token, phone or email (from a cache or database), fills in a template, and puts the notification on a queue. Only the app\'s own services may call it. $150 a month.',
      subOf: (n) => [n.check === 'on' ? 'checks opt-outs' : 'no opt-out check', n.limit === 'on' ? 'per-user limit' : 'no limit'].join(' · '),
      choices: [
        { key: 'check', label: 'Notification settings', options: ON_OFF('Opt-outs', 'Send to everyone', 'no check', 'Every request is sent, even to users who turned that channel off.', 'Check opt-outs', 'skip users who opted out', `Before queuing, read the user's settings (user_id, channel, opt_in) and skip anyone who opted out: ${Math.round(100 * OPT_OUT)}% of requests here.`) },
        { key: 'limit', label: 'Per-user limit', options: ON_OFF('Per-user limit', 'No limit', 'any number a day', 'A user can get any number of notifications.', 'Limit per user', 'a few promotions a day', 'Each user gets at most a few promotions a day; more are dropped. Too many and users turn notifications off.') },
      ],
    },
    nqueue: {
      name: 'Message queues', short: 'Buffer between steps',
      desc: 'Hold notifications until a worker takes them, so a burst or a slow provider doesn\'t reach the notification servers. A managed service, $50 a month.',
      subOf: (n) => (n.layout === 'channel' ? 'a queue per channel' : 'one shared queue'),
      choices: [
        {
          key: 'layout', label: 'Queues',
          options: [
            { id: 'one', name: 'One shared queue', sub: 'every worker, every channel', note: 'Push, SMS and email wait in one queue, and any worker takes any of them. If one provider is slow, its sends hold up everyone\'s.', log: 'Notifications now share one queue.' },
            { id: 'channel', name: 'A queue per channel', sub: 'push, SMS, email apart', note: 'Each channel has its own queue and its own share of the workers. A provider outage only backs up its own queue.', log: 'Each channel now has its own queue.' },
          ],
        },
      ],
    },
    nworker: {
      name: 'Worker pool', short: 'Send to providers',
      desc: `Machines that take notifications from the queues and send them to the providers, one at a time, ${SEND_MS} ms each. $90 a month per machine.`,
      subOf: (n) => `${Number(n.count) || 4} machines${n.log === 'on' ? ' · log' : ''}${n.dedupe === 'on' ? ' · dedupe' : ''}`,
      choices: [
        { key: 'count', label: 'Machines', options: [2, 3, 4, 5, 6, 8].map((k) => ({ id: String(k), name: `${k} machines`, sub: `$${fmt(k * 90)} a month`, note: `${k} worker machines, ${fmt(k * 1000 / SEND_MS)} sends a second in all.`, log: `Workers set to ${k} machines.` })) },
        { key: 'log', label: 'Notification log', options: ON_OFF('Notification log', 'No log', 'a failed send is gone', 'A notification that fails, or is lost when a worker crashes, is gone.', 'Log and retry', 'resend what failed', 'Every notification is written to a log first. One that fails, or wasn\'t confirmed, goes back on its queue and is retried; after a few tries, an alert.') },
        { key: 'dedupe', label: 'Duplicates', options: ON_OFF('Duplicate check', 'Send every event', 'no check', 'An event resent after a crash goes out again, even if it had already been sent.', 'Drop seen event IDs', 'send each event once', 'Before sending, check the event ID: if it was already sent, drop it. Not exactly once, but close.') },
      ],
    },
    provider: {
      name: 'Providers', short: 'Push, SMS, email services',
      desc: 'Outside services that deliver to devices: the phone makers\' push services (with a device token), an SMS gateway, an email service. You don\'t run them, and any of them can fail.',
    },
  },
  palette: ['notifier', 'nqueue', 'nworker', 'provider'],
  limits: { notifier: 1, nqueue: 1, nworker: 1, provider: 1 },
  limitMsg: {
    notifier: 'One notification server box is enough here.',
    nqueue: 'One queue box is enough: choose shared or per channel in the inspector.',
    nworker: 'One worker box is enough: set its machines in the inspector.',
    provider: 'One providers box stands for all the outside services.',
  },
  // Services → notification server → one shared queue → 4 workers → providers.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 50 },
    { id: 'n', type: 'notifier', x: 380, y: 155, check: 'off', limit: 'off' },
    { id: 'q', type: 'nqueue', x: 380, y: 260, layout: 'one' },
    { id: 'w', type: 'nworker', x: 380, y: 365, count: '4', log: 'off', dedupe: 'off' },
    { id: 'p', type: 'provider', x: 380, y: 470 },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'n' }, { id: 's2', from: 'n', to: 'q' }, { id: 's3', from: 'q', to: 'w' }, { id: 's4', from: 'w', to: 'p' },
  ],
  slots: { notifier: { x: 380, y: 155 }, nqueue: { x: 380, y: 260 }, nworker: { x: 380, y: 365 }, provider: { x: 380, y: 470 } },

  connections: {
    ok: {
      'notifier|users': { from: 'users', to: 'notifier', label: 'API calls', desc: 'Services call the notification server\'s API.' },
      'notifier|nqueue': { from: 'notifier', to: 'nqueue', label: 'events', desc: 'Each notification goes on a queue as an event with an ID.' },
      'nqueue|nworker': { from: 'nqueue', to: 'nworker', label: 'events', desc: 'Workers take events from the queues.' },
      'nworker|provider': { from: 'nworker', to: 'provider', label: 'sends', desc: 'Workers send each notification to its provider.' },
    },
    bad: {
      'nqueue|users': 'Services call the notification server, which checks and queues.',
      'nworker|users': 'Services call the notification server, which checks and queues.',
      'provider|users': 'Services never call providers directly: the notification server and workers do.',
      'notifier|nworker': 'Put a queue between them, so a burst or a slow provider doesn\'t reach the notification server.',
      'notifier|provider': 'Put a queue and workers between them, so a slow provider doesn\'t block the server.',
      'nqueue|provider': 'Queues don\'t send: workers take from them and send to providers.',
    },
  },

  missions: [
    {
      title: 'A queue per channel', ref: 'High-level design', qps: RATE, budget: BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 230, hi: 232,
        prompt: '<b>Estimate before you build.</b> A food delivery app sends 12 million push notifications, 2 million SMS and 6 million emails a day. How many notifications a second on average?',
        label: 'Notifications a second',
        placeholder: 'e.g. 100',
        acceptedHtml: `<p><b>Estimate accepted.</b></p><div class="calc">12 + 2 + 6 = 20 million a day<br>20,000,000 ÷ 86,400 ≈ 231 a second<br>About ${fmt(RATE)} at a 2× peak</div>`,
        acceptedLog: 'Estimate accepted: about 231 a second. Play is unlocked.',
        notNumber: 'Type the notifications a second as a number, for example 100.',
        hints: [
          { test: (v) => v >= 460 && v <= 465, text: 'That is the peak. The question is the average over a day.' },
          { test: (v) => v >= 138 && v <= 140, text: 'That is push only. Add SMS and email: 20 million in all.' },
        ],
        fallback: 'Not quite. Add the three channels, then divide by 86,400 seconds in a day.',
      },
      story: `A food delivery app tells users about their orders: ${fmt(RATE)} notifications a second at dinner time. All channels share one queue. Send them on time, and keep push and email going when the SMS provider goes down.`,
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate notifications a second' },
        sentGoal, costGoal(BUDGET),
        { id: 'sms', type: 'exp', text: 'Break it: the SMS provider goes down; push and email still on time' },
      ],
      hint: `Four workers send ${fmt(4 * 1000 / SEND_MS)} a second: add one. Then give each channel its own queue, so SMS sends stuck waiting ${fmt(TIMEOUT_MS)} ms don't hold up push and email.`,
      takeaway: 'With a queue per channel, the SMS outage only backed up the SMS queue: push and email went out as usual. Queues also absorb bursts, so the notification servers never wait on a provider.',
    },
    {
      title: 'Respect your users', ref: 'Settings and rate limits', qps: RATE, budget: BUDGET,
      story: `${Math.round(100 * OPT_OUT)}% of requests are for users who turned that channel off. And marketing likes to send one more promotion. Never notify a user who opted out, and survive a marketing blast without flooding anyone.`,
      goals: [
        optGoal, sentGoal, costGoal(BUDGET),
        { id: 'blast', type: 'exp', text: 'Break it: marketing sends a blast; nobody flooded, still on time' },
      ],
      hint: 'On the notification server, check each user\'s settings before queuing, and limit how many promotions a user gets a day.',
      takeaway: 'The settings check skipped users who opted out, and the per-user limit dropped the blast before it reached a queue. Users who are flooded turn notifications off for good.',
    },
    {
      title: 'Never lose one', ref: 'Reliability', qps: RATE, budget: BUDGET,
      story: 'A notification can be late, or arrive out of order, but must never be lost. Workers crash now and then, and what they had taken from the queue disappears with them. Lose nothing, and don\'t send anything twice.',
      goals: [
        optGoal, sentGoal, costGoal(BUDGET),
        { id: 'crash', type: 'exp', text: 'Break it: workers crash; nothing lost, nothing sent twice' },
      ],
      hint: 'Write every notification to a log and resend what wasn\'t confirmed. Some of those had gone out just before the crash: drop event IDs already sent.',
      takeaway: 'The log let the unconfirmed notifications be resent, and the event-ID check dropped the ones that had already gone out. Exactly-once delivery isn\'t possible across machines; a log plus dedupe gets close.',
    },
  ],

  // Break-it experiments. An event only checks its outcome; smsDown, blast and crash change the outcome while it runs.
  experiments: [
    {
      id: 'sms', kind: 'event', smsDown: true,
      label: 'SMS provider goes down', labelOn: 'SMS provider is back',
      needsDesign: 'Build the pipeline first: services, notification server, queue, workers and providers.',
      on: `The SMS provider stops answering: each SMS send waits ${fmt(TIMEOUT_MS)} ms, then fails.`, onTone: 'bad',
      off: 'The SMS provider is back.',
      expect: (m) => !!m.notify && m.notify.others >= 0.99,
      notMet: (m) => `Only ${fmtPct(100 * m.notify.others)} of push and email went out on time: on one shared queue, every worker gets stuck on SMS sends. Give each channel its own queue.`,
      observed: (m) => `Observed: SMS stopped, and ${fmtPct(100 * m.notify.others)} of push and email still went out on time.`,
    },
    {
      id: 'blast', kind: 'event', blast: true,
      label: 'Marketing sends a blast', labelOn: 'Stop the blast',
      needsDesign: 'Build the pipeline first: services, notification server, queue, workers and providers.',
      on: `Marketing sends another promotion to everyone: ${BLAST}× the normal traffic, to users who already got today's.`, onTone: 'bad',
      off: 'The blast is over.',
      expect: (m) => !!m.notify && !m.notify.spam && served99(m),
      notMet: (m) => `Users are flooded, and only ${fmtPct(m.servedPct)} of real notifications go out on time: the blast fills the queue. Limit each user's promotions.`,
      observed: () => 'Observed: the per-user limit dropped the blast, and real notifications went out on time.',
    },
    {
      id: 'crash', kind: 'event', crash: true,
      label: 'Workers crash', labelOn: 'Workers recover',
      needsDesign: 'Build the pipeline first: services, notification server, queue, workers and providers.',
      on: `Workers keep crashing and restarting; each time, what they had taken from the queue (${Math.round(100 * IN_FLIGHT)}% of notifications) is unconfirmed.`, onTone: 'bad',
      off: 'The workers are stable again.',
      expect: (m) => !!m.notify && m.notify.lost === 0 && m.notify.dup === 0,
      notMet: (m) => (m.notify.lost > 0
        ? `${fmtPct(100 * m.notify.lost)} of notifications are lost with the crashed workers. Log every notification and retry what wasn't confirmed.`
        : `${fmtPct(100 * m.notify.dup)} of notifications arrive twice: some resent ones had gone out before the crash. Drop event IDs already sent.`),
      observed: () => 'Observed: workers crashed, nothing was lost, and nothing arrived twice.',
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    noWeb: 'Connect the services to the notification server.',
    levelComplete: levelComplete(16),
  },

  quiz: {
    passScore: 8,
    passText: passText(16, 'News feed'),
    failText,
    questions: [
      { q: 'Why give each channel its own queue?', o: ['Queues are cheaper that way', 'A provider outage only stalls its own queue', 'Each worker then needs fewer machines behind it', 'Messages arrive in order'], a: 1, e: 'With one shared queue, sends to a dead SMS provider hold up the workers for everyone. A queue per channel keeps push and email moving.', r: 'Why give each channel its own queue?' },
      { q: 'What does a push notification to a phone need besides the message?', o: ['The user\'s password', 'The phone number', 'The user\'s email address', 'A device token'], a: 3, e: 'The phone maker\'s push service delivers to a device identified by a device token, which the app registers when it is installed.', r: 'How does a notification reach a phone?' },
      { q: 'A notification must never be lost. What makes that possible?', o: ['A notification log and retries', 'A faster provider', 'Bigger queues', 'Sending every notification twice, to be sure'], a: 0, e: 'Write each notification to a log; if a send fails or isn\'t confirmed, put it back on the queue and retry, then alert after a few tries.', r: 'How to make sure no notification is lost' },
      { q: 'Can a notification system deliver exactly once?', o: ['Yes, with a big enough queue', 'Yes, as long as the provider confirms each one', 'No, but dedupe by event ID gets close', 'No, so duplicates are ignored'], a: 2, e: 'Across machines a send can succeed just before a crash, then be retried. Checking event IDs already sent catches most of those duplicates.', r: 'Why can a notification arrive twice?' },
      { q: 'Where is a user\'s opt-out checked?', o: ['By the provider', 'On the user\'s phone', 'By the notification server, before queuing', 'Only for emails, since push has its own settings'], a: 2, e: 'The notification server reads the settings table (user_id, channel, opt_in) and skips users who opted out before anything is queued.', r: 'Who decides whether a user gets a notification?' },
      { q: 'Why limit how many notifications one user gets?', o: ['Providers charge by user', 'Flooded users turn notifications off', 'Queues can only hold a few messages for each user', 'Phones can show only one'], a: 1, e: 'Too many notifications and users disable them, or uninstall. A per-user limit protects the channel.', r: 'Who decides whether a user gets a notification?' },
      { q: 'Which number shows workers falling behind?', o: ['Notifications waiting in the queues', 'Average email size', 'Number of providers', 'Templates that are currently kept in the cache'], a: 0, e: 'Monitor the queued notifications. If the count keeps growing, workers aren\'t keeping up: add workers.', r: 'Why can a notification arrive twice?' },
      { q: 'What does a notification template save?', o: ['Provider fees', 'Device tokens', 'Space in the queues while the workers are busy', 'Building each message from scratch'], a: 3, e: 'A template holds the fixed text and layout; each notification fills in its parameters. Consistent format, fewer mistakes, less work.', r: 'How does a notification reach a phone?' },
      { q: 'Why should only the app\'s own services call the notification API?', o: ['To keep the API fast', 'To stop spam sent through it', 'The providers require it for every single request', 'To save bandwidth'], a: 1, e: 'An open API would let anyone send notifications to your users. Authenticate callers (for example with an app key and secret).', r: 'How does a notification reach a phone?' },
      { q: '12 million push, 2 million SMS and 6 million emails a day. About how many a second at a 2× peak?', o: ['231', '139', '463', '926'], a: 2, e: '20 million ÷ 86,400 ≈ 231 a second on average; twice that at the peak ≈ 463.', r: 'Scope it: how many notifications a second?' },
    ],
  },

  lesson,

  drawFigures(f) {
    const { $ } = f;
    drawPath(f, $('figPath'));
    drawQueues(f, $('figQueues'));
    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
