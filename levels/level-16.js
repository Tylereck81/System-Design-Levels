// Level 16: Notification system.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt } from '../js/format.js';
import { SHARES, SEND_MS, TIMEOUT_MS, OPT_OUT, BLAST, IN_FLIGHT } from '../js/engine/notify.js';
import level2 from './level-02.js';
import level10 from './level-10.js';

const targets = { latencyMs: 1000, servedPct: 99 };
const BUDGET = 700;
const RATE = 460; // notification requests a second at the peak

const pct = (x) => x.toFixed(1) + '%';
const costGoal = (max) => ({ id: 'cost', type: 'struct', text: `Spend at most $${fmt(max)} per month`, test: (g) => g.cost <= max, val: (m, g) => '$' + fmt(g.cost) });
const served99 = (m) => m.servedPct >= targets.servedPct;
const servedGoal = { id: 'served', type: 'metric', text: `Send ${targets.servedPct}% of notifications on time`, test: served99, val: (m) => pct(m.servedPct) };
const optGoal = { id: 'optout', type: 'metric', text: 'Nothing sent to users who opted out', test: (m) => !!m.notify && m.notify.optSent === 0, val: (m) => (m.notify ? pct(100 * m.notify.optSent) : '—') };
const ON_OFF = (what, offName, offSub, offNote, onName, onSub, onNote) => [
  { id: 'off', name: offName, sub: offSub, note: offNote, log: `${what}: ${offName.toLowerCase()}.` },
  { id: 'on', name: onName, sub: onSub, note: onNote, log: `${what}: ${onName.toLowerCase()}.` },
];

export default {
  id: 16,
  saveKey: 'sdl-level16-v1',
  saveVersion: 1,
  targets,
  workload: { notify: true },

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
        servedGoal, costGoal(BUDGET),
        { id: 'sms', type: 'exp', text: 'Break it: the SMS provider goes down; push and email still on time' },
      ],
      hint: `Four workers send ${fmt(4 * 1000 / SEND_MS)} a second: add one. Then give each channel its own queue, so SMS sends stuck waiting ${fmt(TIMEOUT_MS)} ms don't hold up push and email.`,
      takeaway: 'With a queue per channel, the SMS outage only backed up the SMS queue: push and email went out as usual. Queues also absorb bursts, so the notification servers never wait on a provider.',
    },
    {
      title: 'Respect your users', ref: 'Settings and rate limits', qps: RATE, budget: BUDGET,
      story: `${Math.round(100 * OPT_OUT)}% of requests are for users who turned that channel off. And marketing likes to send one more promotion. Never notify a user who opted out, and survive a marketing blast without flooding anyone.`,
      goals: [
        optGoal, servedGoal, costGoal(BUDGET),
        { id: 'blast', type: 'exp', text: 'Break it: marketing sends a blast; nobody flooded, still on time' },
      ],
      hint: 'On the notification server, check each user\'s settings before queuing, and limit how many promotions a user gets a day.',
      takeaway: 'The settings check skipped users who opted out, and the per-user limit dropped the blast before it reached a queue. Users who are flooded turn notifications off for good.',
    },
    {
      title: 'Never lose one', ref: 'Reliability', qps: RATE, budget: BUDGET,
      story: 'A notification can be late, or arrive out of order, but must never be lost. Workers crash now and then, and what they had taken from the queue disappears with them. Lose nothing, and don\'t send anything twice.',
      goals: [
        optGoal, servedGoal, costGoal(BUDGET),
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
      notMet: (m) => `Only ${pct(100 * m.notify.others)} of push and email went out on time: on one shared queue, every worker gets stuck on SMS sends. Give each channel its own queue.`,
      observed: (m) => `Observed: SMS stopped, and ${pct(100 * m.notify.others)} of push and email still went out on time.`,
    },
    {
      id: 'blast', kind: 'event', blast: true,
      label: 'Marketing sends a blast', labelOn: 'Stop the blast',
      needsDesign: 'Build the pipeline first: services, notification server, queue, workers and providers.',
      on: `Marketing sends another promotion to everyone: ${BLAST}× the normal traffic, to users who already got today's.`, onTone: 'bad',
      off: 'The blast is over.',
      expect: (m) => !!m.notify && !m.notify.spam && served99(m),
      notMet: (m) => `Users are flooded, and only ${pct(m.servedPct)} of real notifications go out on time: the blast fills the queue. Limit each user's promotions.`,
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
        ? `${pct(100 * m.notify.lost)} of notifications are lost with the crashed workers. Log every notification and retry what wasn't confirmed.`
        : `${pct(100 * m.notify.dup)} of notifications arrive twice: some resent ones had gone out before the crash. Drop event IDs already sent.`),
      observed: () => 'Observed: workers crashed, nothing was lost, and nothing arrived twice.',
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...level2.text,
    noWeb: 'Connect the services to the notification server.',
    levelComplete: 'Level 16 complete. Take the quiz.',
  },

  quiz: {
    passScore: 8,
    passText: 'Level 16 is done. Level 17, News feed, is next: open it from the level menu at the top.',
    failText: level10.quiz.failText,
    questions: [
      { q: 'Why give each channel its own queue?', o: ['Queues are cheaper that way', 'A provider outage only stalls its own queue', 'Each worker then needs fewer machines behind it', 'Messages arrive in order'], a: 1, e: 'With one shared queue, sends to a dead SMS provider hold up the workers for everyone. A queue per channel keeps push and email moving.', r: 'High-level design' },
      { q: 'What does a push notification to a phone need besides the message?', o: ['The user\'s password', 'The phone number', 'The user\'s email address', 'A device token'], a: 3, e: 'The phone maker\'s push service delivers to a device identified by a device token, which the app registers when it is installed.', r: 'Contact info gathering' },
      { q: 'A notification must never be lost. What makes that possible?', o: ['A notification log and retries', 'A faster provider', 'Bigger queues', 'Sending every notification twice, to be sure'], a: 0, e: 'Write each notification to a log; if a send fails or isn\'t confirmed, put it back on the queue and retry, then alert after a few tries.', r: 'Reliability' },
      { q: 'Can a notification system deliver exactly once?', o: ['Yes, with a big enough queue', 'Yes, as long as the provider confirms each one', 'No, but dedupe by event ID gets close', 'No, so duplicates are ignored'], a: 2, e: 'Across machines a send can succeed just before a crash, then be retried. Checking event IDs already sent catches most of those duplicates.', r: 'Reliability' },
      { q: 'Where is a user\'s opt-out checked?', o: ['By the provider', 'On the user\'s phone', 'By the notification server, before queuing', 'Only for emails, since push has its own settings'], a: 2, e: 'The notification server reads the settings table (user_id, channel, opt_in) and skips users who opted out before anything is queued.', r: 'Notification setting' },
      { q: 'Why limit how many notifications one user gets?', o: ['Providers charge by user', 'Flooded users turn notifications off', 'Queues can only hold a few messages for each user', 'Phones can show only one'], a: 1, e: 'Too many notifications and users disable them, or uninstall. A per-user limit protects the channel.', r: 'Rate limiting' },
      { q: 'Which number shows workers falling behind?', o: ['Notifications waiting in the queues', 'Average email size', 'Number of providers', 'Templates that are currently kept in the cache'], a: 0, e: 'Monitor the queued notifications. If the count keeps growing, workers aren\'t keeping up: add workers.', r: 'Monitor queued notifications' },
      { q: 'What does a notification template save?', o: ['Provider fees', 'Device tokens', 'Space in the queues while the workers are busy', 'Building each message from scratch'], a: 3, e: 'A template holds the fixed text and layout; each notification fills in its parameters. Consistent format, fewer mistakes, less work.', r: 'Notification template' },
      { q: 'Why should only the app\'s own services call the notification API?', o: ['To keep the API fast', 'To stop spam sent through it', 'The providers require it for every single request', 'To save bandwidth'], a: 1, e: 'An open API would let anyone send notifications to your users. Authenticate callers (for example with an app key and secret).', r: 'Security' },
      { q: '12 million push, 2 million SMS and 6 million emails a day. About how many a second at a 2× peak?', o: ['231', '139', '463', '926'], a: 2, e: '20 million ÷ 86,400 ≈ 231 a second on average; twice that at the peak ≈ 463.', r: 'Numbers to carry into the interview' },
    ],
  },

  // Lesson tab content (HTML). The diagram below draws into figNotify.
  lessonHtml: `
    <p class="label">Level 16 · Notification system</p>
    <h1>Notification system</h1>
    <p class="lede">A food delivery app tells users "your order is on its way" by push, SMS and email. The app's services ask a notification system to send them; the system checks, queues and hands them to outside providers. In this level you keep the channels apart, respect users' settings, and make sure no notification is lost.</p>
    <div class="goals-box">
      <div><b>You will learn</b>Providers, the queue-per-channel design, logs and retries, dedupe, settings and limits.</div>
      <div><b>You will decide</b>Queues, workers, the opt-out check, the per-user limit, the log and the duplicate check.</div>
      <div><b>You will estimate</b>Notifications a second.</div>
    </div>

    <section>
      <h2>Scope it</h2>
      <p class="src">Requirements</p>
      <p>Ask: which channels (push, SMS, email), how fast (soft real-time: as soon as possible, a short delay under load is fine), which devices, what triggers them (services, or a schedule), can users opt out (yes), how many (12 million push, 2 million SMS, 6 million emails a day).</p>
      <ul>
        <li>20 million ÷ 86,400 ≈ 231 a second on average, about 463 at a 2× peak.</li>
      </ul>
    </section>

    <section>
      <h2>Providers do the delivering</h2>
      <p class="src">Different types of notifications</p>
      <p>You don't deliver to phones yourself. <b>Push</b> goes through the phone maker's push service, addressed by a <b>device token</b> the app registered at install. <b>SMS</b> goes through an SMS gateway, and <b>email</b> through an email service, both bought from outside companies. Store tokens, phone numbers and emails when users sign up. Providers can fail, or be unavailable in some countries, so plugging one in or out should be easy.</p>
    </section>

    <section>
      <h2>The design</h2>
      <p class="src">High-level design</p>
      <figure class="fig"><svg id="figNotify" viewBox="0 0 660 230" role="img" aria-label="Services call the notification server, which puts each notification on the queue for its channel: push, SMS or email. Workers take from each queue and send to the provider."></svg><figcaption>A queue per channel: one slow provider can't hold up the others</figcaption></figure>
      <ol>
        <li>A service calls <code>POST https://api.example.com/v1/notifications</code>.</li>
        <li>The <b>notification server</b> checks the caller, looks up the user's contact info and settings (cache, then database), fills in a <b>template</b>, and puts the notification on its channel's <b>queue</b>.</li>
        <li><b>Workers</b> take from the queues and call the providers.</li>
      </ol>
      <p>One notification server would be a single point of failure and hard to scale: run several, autoscaled, with the database and cache outside them. Queues absorb bursts and keep one provider's outage to its own channel.</p>
    </section>

    <section>
      <h2>Never lose one</h2>
      <p class="src">Reliability</p>
      <p>Notifications may be late or out of order, but never lost. Write each to a <b>notification log</b>; if a send fails, put it back on the queue and <b>retry</b>, and alert after a few tries. Exactly-once delivery isn't possible across machines: a send can succeed just before a worker crashes and then be retried. <b>Dedupe</b>: check each event's ID and drop ones already sent.</p>
    </section>

    <section>
      <h2>Respect users</h2>
      <p class="src">Settings · Rate limiting · Tracking</p>
      <ul>
        <li><b>Settings:</b> a table of user_id, channel and opt_in; check it before sending.</li>
        <li><b>Per-user limit:</b> too many notifications and users turn them off.</li>
        <li><b>Monitoring:</b> watch the number of queued notifications; if it grows, add workers. Track opens and clicks for analytics.</li>
        <li><b>Security:</b> only verified callers may use the API (for example, an app key and secret).</li>
      </ul>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>Services ask for ${fmt(RATE)} notifications a second at the peak: ${Math.round(100 * SHARES.push)}% push, ${Math.round(100 * SHARES.sms)}% SMS, ${Math.round(100 * SHARES.email)}% email. A worker machine sends one at a time, ${SEND_MS} ms each; a send to a provider that is down waits ${fmt(TIMEOUT_MS)} ms. With a queue per channel, the workers are split by each channel's traffic. ${Math.round(100 * OPT_OUT)}% of requests are for users who opted out. A blast adds ${BLAST}× the traffic. A crash leaves ${Math.round(100 * IN_FLIGHT)}% of notifications unconfirmed, and half of those had already been sent.</p>
      <p class="assume">Game assumptions: the checks and the log cost nothing; workers $90 a machine, notification server $150, queues $50; providers charge you nothing here.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Capacity estimates</p>
      <p><b>Notifications a second</b> = a day's total ÷ 86,400. 20 million → about 231, 463 at the peak.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>Channels, devices, triggers, opt-out, volume, how real-time.</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>Services, notification servers, a queue per channel, workers, providers.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>The log and retries, dedupe, settings, limits, templates, security.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>A provider down, workers crashing, a marketing blast.</div>
      </div>
    </section>
`,

  // Lesson diagram. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs } = f;
    const f1 = $('figNotify'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'users', 100, 115, 'Services', 'Ask to notify');
    figNode(f1, 'notifier', 300, 115, 'Notification server', 'Check, template');
    figNode(f1, 'nqueue', 520, 35, 'Push queue', 'Workers → push');
    figNode(f1, 'nqueue', 520, 115, 'SMS queue', 'Workers → SMS');
    figNode(f1, 'nqueue', 520, 195, 'Email queue', 'Workers → email');
    figArrow(f1, 196, 115, 204, 115, '', null, 0, 0);
    figArrow(f1, 396, 105, 424, 45, '', null, 0, 0);
    figArrow(f1, 396, 115, 424, 115, '', null, 0, 0);
    figArrow(f1, 396, 125, 424, 185, '', null, 0, 0);
  },
};
