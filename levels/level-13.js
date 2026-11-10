// @ts-check
/** @import { Level, Goal } from '../js/types.js' */
// Level 13: Unique ID generator.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt } from '../js/format.js';
import { costGoal, servedAtLeast, fmtPct } from './shared/goals.js';
import { DB_IDS, CLOCK_BACK_MS } from '../js/engine/ids.js';
import { dns, lb, NO_DB_NOTE, autoscaleSubOf, scalingChoices } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, lbBad } from './shared/connections.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { dayTraffic } from './shared/workload.js';
import { lessonSteps } from './shared/lesson.js';

const targets = { latencyMs: 150, servedPct: 99 };
const PCT = { wholeUpTo: 0, wholeFrom: 1 }; // percentages: whole numbers, with one decimal between 0% and 1%
const BUDGET = 1900;
const IDS_PER_REQUEST = 4;
const QPS = 3000; // requests a second, so 12,000 IDs a second

// The generator's setting as the canvas shows it (saved settings are checked on load, so these are valid options).
const idOf = (n) => ({ method: n.method || 'uuid', servers: Number(n.servers) || 1, wait: n.clock === 'wait' });
const unique = (m) => m.idDupPct != null && m.idDupPct < 1e-9;
const served99 = servedAtLeast(targets.servedPct);
/** @type {Goal} */
const uniqueGoal = { id: 'unique', type: 'metric', text: 'Every ID is unique', test: unique, val: (m) => (m.idDupPct == null ? '—' : fmtPct(m.idDupPct, PCT) + ' repeat') };
/** @type {Goal} */
const numericGoal = { id: 'numeric', type: 'metric', text: 'IDs are numbers only', test: (m) => m.idNumeric === true, val: (m) => (m.idNumeric == null ? '—' : m.idNumeric ? 'digits' : 'hex text') };
/** @type {Goal} */
const bitsGoal = { id: 'bits', type: 'metric', text: 'IDs fit in 64 bits', test: (m) => m.idBits != null && m.idBits <= 64, val: (m) => (m.idBits == null ? '—' : m.idBits + ' bits') };
/** @type {Goal} */
const orderGoal = { id: 'ordered', type: 'metric', text: 'An ID made later is always larger', test: (m) => m.idOrdered === true, val: (m) => (m.idOrdered == null ? '—' : m.idOrdered ? 'yes' : 'no') };
/** @type {Goal} */
const rateGoal = { id: 'rate', type: 'metric', text: `Make ${fmt(QPS * IDS_PER_REQUEST)} IDs a second (${targets.servedPct}% of requests served)`, test: served99, val: (m) => (m.idMade == null ? m.servedPct.toFixed(1) + '%' : fmt(m.idMade) + '/s') };
/** @type {Goal} */
const survivesFailureGoal = { id: 'nospof', type: 'metric', text: 'The generator keeps working if one server fails', test: (m) => m.idSpof === false, val: (m) => (m.idSpof == null ? '—' : m.idSpof ? '1 server' : 'yes') };
/** @type {Goal[]} */
const requirements = [uniqueGoal, numericGoal, bitsGoal, rateGoal, survivesFailureGoal];
const methodName = { step: 'Multi-primary', uuid: 'UUID', ticket: 'Ticket server', snow: 'Timestamp-based' };

/** @type {Level} */
export default {
  id: 13,
  saveKey: 'sdl-level13-v1',
  saveVersion: 1,
  targets,
  // The day's traffic curve (for the autoscaled web servers). idsPerRequest: new IDs each request asks for.
  workload: { day: dayTraffic(), idsPerRequest: IDS_PER_REQUEST },

  components: {
    users: {
      name: 'Users', sub: 'Order food, track it',
      desc: `People on a food delivery app. Each request saves new records, such as an order, a payment, a delivery update or a chat message: ${IDS_PER_REQUEST} on average, and each needs a new ID.`,
    },
    dns: dns(),
    lb: lb(),
    web: {
      name: 'Web server', short: 'Your back-end code',
      desc: `Runs your back-end code. For each request it gets ${IDS_PER_REQUEST} new IDs from the ID generator, then saves the records. These are autoscaled groups of L servers, as in Level 6.`,
      noDbNote: NO_DB_NOTE,
      subOf: autoscaleSubOf,
      choices: scalingChoices(),
    },
    idgen: {
      name: 'ID generator', short: 'Hands out new IDs',
      desc: 'Hands out the IDs for new records. Choose how: databases that each count up by a step (multi-primary), UUIDs made in the web servers, one central ticket server, or timestamp-based generators. $100 a month per server in this game; UUIDs need none.',
      subOf: (n) => { const x = idOf(n); return x.method === 'uuid' ? 'UUID · in the web servers' : `${methodName[x.method]} · ${x.servers} ${x.servers === 1 ? 'server' : 'servers'}${x.method === 'snow' && x.wait ? ' · waits' : ''}`; },
      choices: [
        {
          key: 'method', label: 'Method',
          options: [
            { id: 'step', name: 'Multi-primary', sub: 'each counts up by k', note: `Each database server counts up by k, the number of servers, from its own start: with 2 servers one hands out 1, 3, 5… and the other 2, 4, 6…. ${fmt(DB_IDS)} IDs a second per server.`, log: 'ID generator set to multi-primary: each server counts up by the number of servers.' },
            { id: 'uuid', name: 'UUID', sub: '128 bits, random', note: 'Each web server makes random 128-bit IDs itself, with no coordination. Free and fast, but twice the 64 bits allowed, written as hex digits with dashes, and in no time order.', log: 'ID generator set to UUIDs, made in each web server.' },
            { id: 'ticket', name: 'Ticket server', sub: 'one central counter', note: `One database hands out the next number from its auto_increment counter: numbers in time order, but ${fmt(DB_IDS)} IDs a second, and nothing gets an ID while it is down. Ticket servers added to it count 1, 2, 3… on their own.`, log: 'ID generator set to a ticket server.' },
            { id: 'snow', name: 'Timestamp-based', sub: 'time, machine, sequence', note: 'Each generator builds a 64-bit ID from 41 bits of milliseconds since a custom epoch, 5 bits of data center, 5 of machine and a 12-bit sequence. No coordination; up to 4,096 IDs a millisecond each.', log: 'ID generator set to timestamp-based IDs.' },
          ],
        },
        {
          key: 'servers', label: 'Servers',
          options: [1, 2, 3, 4, 5].map((k) => ({ id: String(k), name: `${k} ${k === 1 ? 'server' : 'servers'}`, sub: `$${k * 100} a month`, note: `${k} ${k === 1 ? 'database or generator' : 'databases or generators'}. UUIDs ignore this: the web servers make them.`, log: `ID generator set to ${k} ${k === 1 ? 'server' : 'servers'}.` })),
        },
        {
          key: 'clock', label: 'When a clock goes back',
          options: [
            { id: 'keep', name: 'Keep going', sub: 'use the clock as it is', note: 'A timestamp-based generator goes on making IDs from its clock, even if a time sync has just set it back.', log: 'ID generator keeps making IDs when its clock goes back.' },
            { id: 'wait', name: 'Wait', sub: 'until it passes the last ID', note: 'A timestamp-based generator whose clock is behind its last ID waits until the clock catches up. Only timestamp-based IDs read the clock.', log: 'ID generator waits when its clock goes back.' },
          ],
        },
      ],
    },
  },
  palette: ['dns', 'lb', 'web', 'idgen'],
  limits: { dns: 1, lb: 1, web: 2, idgen: 1 },
  limitMsg: {
    dns: 'You only need one DNS service.',
    lb: 'One load balancer is enough in this level.',
    web: 'Two autoscaled groups of web servers are enough: they grow on their own.',
    idgen: 'One ID generator is enough: choose its method and servers in the inspector.',
  },
  // One data center: autoscaled web servers that make UUIDs.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60 },
    { id: 'd', type: 'dns', x: 120, y: 60 },
    { id: 'l', type: 'lb', x: 380, y: 168, algo: 'rr' },
    { id: 'w1', type: 'web', x: 250, y: 276, size: 'L', scaling: 'auto' },
    { id: 'w2', type: 'web', x: 510, y: 276, size: 'L', scaling: 'auto' },
    { id: 'i', type: 'idgen', x: 380, y: 420, method: 'uuid', servers: '1', clock: 'keep' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'u', to: 'l' },
    { id: 's3', from: 'l', to: 'w1' }, { id: 's4', from: 'l', to: 'w2' },
    { id: 's5', from: 'w1', to: 'i' }, { id: 's6', from: 'w2', to: 'i' },
  ],
  slots: { dns: { x: 120, y: 60 }, lb: { x: 380, y: 168 }, web: { x: 510, y: 276 }, idgen: { x: 380, y: 420 } },

  connections: {
    ok: {
      'dns|users': dnsLookup(),
      'lb|users': usersToLb(),
      'lb|web': lbToWeb(),
      'idgen|web': { from: 'web', to: 'idgen', label: 'next IDs', desc: `The web server asks for ${IDS_PER_REQUEST} new IDs per request.` },
    },
    bad: {
      ...lbBad(),
      'idgen|users': 'Users never ask for IDs. Their requests go through the load balancer to a web server, which gets the IDs.',
      'idgen|lb': 'The load balancer spreads requests over web servers. The web servers get the IDs.',
      'dns|idgen': 'The ID generator does not need DNS. Connect the web servers to it.',
    },
  },

  missions: [
    {
      title: 'IDs as 64-bit numbers', ref: 'Multi-primary', qps: QPS, budget: BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 4, hi: 4,
        prompt: `<b>Estimate before you build.</b> One auto_increment database hands out ${fmt(DB_IDS)} IDs a second. The app needs ${fmt(QPS * IDS_PER_REQUEST)} a second, and must keep up with one server down. How many servers?`,
        label: 'Servers',
        placeholder: 'e.g. 2',
        acceptedHtml: `<p><b>Estimate accepted.</b></p><div class="calc">${fmt(QPS * IDS_PER_REQUEST)} ÷ ${fmt(DB_IDS)} = 2.4, so 3 servers<br>One down leaves 2 × ${fmt(DB_IDS)} = 10,000: too few<br>4 servers: one down leaves 15,000</div>`,
        acceptedLog: 'Estimate accepted: 4 servers. Play is unlocked.',
        notNumber: 'Type the number of servers, for example 2.',
        hints: [
          { test: (v) => v === 3, text: `3 make 15,000 IDs a second, but with one down only 10,000: fewer than ${fmt(QPS * IDS_PER_REQUEST)}.` },
          { test: (v) => v <= 2, text: `${fmt(QPS * IDS_PER_REQUEST)} ÷ ${fmt(DB_IDS)} = 2.4, so even with all running you need 3. Then add one for the server that fails.` },
          { test: (v) => v >= 5, text: 'That works, but fewer are enough: with one down, 4 servers still make 15,000 a second.' },
        ],
        fallback: `Not quite. Divide the IDs needed by ${fmt(DB_IDS)}, round up, and add one server for the one that fails.`,
      },
      story: 'The web servers give each new record a UUID. The database team wants IDs as 64-bit numbers: they fit a BIGINT column and keep its index small. Make 12,000 unique IDs a second as 64-bit numbers, and keep going when a generator server fails.',
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the servers' },
        ...requirements, costGoal(BUDGET),
        { id: 'lose', type: 'exp', text: 'Break it: take a generator server down; still 12,000 IDs a second' },
      ],
      hint: 'A UUID is 128 bits. A ticket server makes 5,000 IDs a second and stops everything when it fails. Pick multi-primary on 4 servers: each counts up by 4 from its own start.',
      takeaway: 'Four servers, each counting up by 4 from its own start (1, 5, 9… and 2, 6, 10…), never hand out the same number, and when one fails the other three still make 15,000 a second. But the counters run side by side, so a later ID can be smaller, and a fifth server would change every step.',
    },
    {
      title: 'A new city opens', ref: 'Adding a server', qps: QPS, budget: BUDGET,
      story: 'The app opens in a new city next week, and the plan is one more ID server, added while the app runs. Not one ID may repeat. The requirements stay the same.',
      goals: [
        ...requirements, costGoal(BUDGET),
        { id: 'add', type: 'exp', text: 'Break it: add a generator server; still no repeated IDs' },
      ],
      hint: 'Adding a server to multi-primary changes the step, and the new server counts onto numbers already handed out. Timestamp-based generators need no coordination: a new one just gets its own machine ID. Use 2 or more.',
      takeaway: 'The new generator got a machine ID of its own, so its IDs can\'t match another generator\'s, whatever the time. 5 bits of data center and 5 of machine allow 1,024 generators, with no counter to share.',
    },
    {
      title: 'Newest orders first', ref: 'Clock synchronization', qps: QPS, budget: BUDGET,
      story: 'Support screens list orders by ID, newest first, so an ID made later must be larger. The generators keep their clocks in sync over the network (NTP), and a sync can set a clock back. Keep IDs unique and in order when it does.',
      goals: [
        uniqueGoal, numericGoal, bitsGoal, orderGoal, rateGoal, survivesFailureGoal, costGoal(BUDGET),
        { id: 'clock', type: 'exp', text: 'Break it: set a generator\'s clock back; IDs still unique and in order' },
      ],
      hint: 'Only a timestamp-based ID follows time across servers. When its clock goes back it would reuse milliseconds it has already used: set it to wait until the clock passes its last ID.',
      takeaway: `The generator waited ${CLOCK_BACK_MS} ms for its clock to pass its last ID, so no ID repeated or went backwards. A short wait is cheap; a repeated ID is not. Real generators refuse to make IDs while the clock is behind.`,
    },
  ],

  // Break-it experiments. An event only checks its outcome; `resize` adds or takes away a generator server, `clockBack`
  // sets one generator's clock back.
  experiments: [
    {
      id: 'lose', kind: 'event', resize: -1,
      label: 'A generator server fails', labelOn: 'Bring it back',
      needsDesign: 'Build the design first: the web servers need the ID generator.',
      on: 'One ID generator server is down.', onTone: 'bad',
      off: 'The server is back.',
      expect: served99,
      notMet: (m) => `Only ${m.servedPct.toFixed(1)}% served: with one server down the generator makes ${fmt(m.idMade || 0)} of the ${fmt(QPS * IDS_PER_REQUEST)} IDs a second needed. Run enough servers to keep up with one down.`,
      observed: (m) => `Observed: with one generator server down, ${m.servedPct.toFixed(1)}% of requests were still served.`,
    },
    {
      id: 'add', kind: 'event', resize: 1,
      label: 'Add a generator server', labelOn: 'Remove it again',
      needsDesign: 'Build the design first: the web servers need the ID generator.',
      on: 'A new ID generator server joins while the app runs.', onTone: '',
      off: 'The new server is removed again.',
      expect: (m) => unique(m) && served99(m),
      notMet: (m) => (unique(m)
        ? `Only ${m.servedPct.toFixed(1)}% served. The generator can't keep up.`
        : `${fmtPct(m.idDupPct, PCT)} of IDs repeat one already handed out. Each server must make IDs no other server can: give each its own machine ID.`),
      observed: () => 'Observed: a server joined, and no ID repeated.',
    },
    {
      id: 'clock', kind: 'event', clockBack: true,
      label: 'Set a clock back', labelOn: 'Stop the test',
      needsDesign: 'Build the design first: the web servers need the ID generator.',
      on: `A time sync sets one generator's clock back ${CLOCK_BACK_MS} ms.`, onTone: 'bad',
      off: 'The clock has caught up again.',
      expect: (m) => unique(m) && m.idOrdered === true && served99(m),
      notMet: (m) => (m.idOrdered !== true && unique(m)
        ? 'IDs are not in time order: only timestamp-based IDs follow time across servers.'
        : !unique(m) ? `${fmtPct(m.idDupPct, PCT)} of IDs repeat. A generator whose clock went back must wait until it passes its last ID.` : `Only ${m.servedPct.toFixed(1)}% served.`),
      observed: () => 'Observed: the clock went back, and IDs stayed unique and in order.',
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    idNote: (x) => {
      if (!(x.dup > 0)) return null;
      const p = fmtPct(100 * x.dup, PCT);
      if (x.method === 'ticket') return `Each ticket server counts 1, 2, 3… on its own, so ${p} of IDs repeat one already handed out. Use one ticket server, or multi-primary, where each counts up by a step from its own start.`;
      if (x.method === 'step') return `The new server counts up by the new step from its own start, onto numbers already handed out: ${p} of IDs repeat. Multi-primary can't grow without renumbering every server.`;
      return `A clock set back makes its generator reuse milliseconds it has already used: ${p} of IDs repeat, and go backwards in time. Set the generator to wait until its clock passes its last ID.`;
    },
    levelComplete: levelComplete(13),
  },

  quiz: {
    passScore: 8,
    passText: passText(13, 'URL shortener'),
    failText,
    questions: [
      { q: 'Why isn\'t one database\'s auto_increment enough for IDs at scale?', o: ['It needs 128 bits per ID', 'Its IDs are not numbers', 'Its numbers can repeat after every restart', 'One server caps the rate and can fail'], a: 3, e: 'One database hands out every ID, so its speed caps the whole system and when it fails nothing can be saved. Spread the counter over several databases, and their numbers must be kept apart.', r: 'Why one counter is not enough' },
      { q: 'Multi-primary with 3 servers. Server 2 starts at 2. What are its next IDs?', o: ['3, 4, 5', '2, 5, 8', '2, 4, 6', '6, 9, 12'], a: 1, e: 'Each server adds k = 3, the number of servers, to its last ID: 2, 5, 8. Server 1 gives 1, 4, 7 and server 3 gives 3, 6, 9, so they never meet.', r: 'Multi-primary' },
      { q: 'Why don\'t multi-primary IDs follow time?', o: ['Each server counts at its own pace', 'The step changes every second', 'Servers copy each other\'s counters every hour', 'IDs are random'], a: 0, e: 'A busy server\'s counter runs ahead of a quiet one, so an ID made later on the quiet server can be smaller.', r: 'Multi-primary' },
      { q: 'Why can\'t a UUID be the ID here?', o: ['It isn\'t unique enough in practice', 'It needs a central server to hand it out', 'It\'s 128 bits long', 'It is too slow to make'], a: 2, e: 'A UUID is 128 bits: twice the 64 allowed. It is also written as hex digits with dashes, and random, so in no time order. Repeats are no worry: it takes about 2.7 × 10¹⁸ UUIDs for a 50% chance of one.', r: 'UUID' },
      { q: 'What makes a ticket server a weak choice at scale?', o: ['Its IDs are not in time order', 'Every ID depends on one server', 'Its IDs are 128 bits', 'It needs synchronized clocks across machines'], a: 1, e: 'One database hands out every number, so it caps the rate and, when it fails, nothing gets an ID. A second one brings back the problem of keeping their numbers apart.', r: 'Ticket server' },
      { q: '41 bits of milliseconds last about how long?', o: ['35 years', '24 days', '139 years', '69 years'], a: 3, e: '2⁴¹ ms ≈ 2.2 × 10¹² ms ≈ 69.7 years. From a custom epoch of 2026-01-01 the IDs last until 2095; from 1970 they would run out in 2039.', r: 'Timestamp-based IDs' },
      { q: 'How many IDs can one timestamp-based generator make in a millisecond?', o: ['4,096', '1,024', '32', '4,096,000'], a: 0, e: '12 sequence bits: 2¹² = 4,096 a millisecond, about 4 million a second. The sequence starts again at 0 each millisecond.', r: 'Timestamp-based IDs' },
      { q: '5 bits of data center and 5 of machine. How many generators can run?', o: ['32', '64', '1,024', '10,000'], a: 2, e: '32 data centers × 32 machines = 1,024 generators, each with its own pair, so their IDs can\'t collide.', r: 'Timestamp-based IDs' },
      { q: 'A time sync sets a generator\'s clock back 5 ms. What should it do?', o: ['Keep making IDs as before', 'Reset its sequence to 0 and carry on making IDs', 'Switch to UUIDs', 'Wait until the clock passes its last ID'], a: 3, e: 'Its clock would repeat milliseconds it has already used, with the same machine bits and sequence numbers: repeated IDs. Waiting a few ms is cheap. NTP keeps clocks close, but it can still set one back.', r: 'Clock synchronization' },
      { q: 'An app saves 30 million records a day, with a peak 3× the average. About how many IDs a second at peak?', o: ['1,000', '350', '10,000', '30,000'], a: 0, e: '30 million ÷ 86,400 s ≈ 350 a second on average; 3× that at peak ≈ 1,000.', r: 'Numbers to carry into the interview' },
    ],
  },

  // Lesson tab content (HTML). The diagrams below draw into figStep and figBits.
  lessonHtml: `
    <p class="label">Level 13 · Unique ID generator</p>
    <h1>Unique ID generator</h1>
    <p class="lede">A food delivery app saves orders, payments, delivery updates and chat messages, and each needs an ID. On one database, auto_increment does it. Across many servers, one counter is too slow and stops everything when it fails. In this level you compare four ways to hand out IDs.</p>
    <div class="goals-box">
      <div><b>You will learn</b>Multi-primary, UUID, ticket server and timestamp-based IDs, and clock sync.</div>
      <div><b>You will decide</b>The method, how many servers, and what a generator does when its clock goes back.</div>
      <div><b>You will estimate</b>The servers for 12,000 IDs a second with one down.</div>
    </div>

    <section>
      <h2>Scope it first</h2>
      <p class="src">Requirements</p>
      <p>Ask what the IDs must be. Here: <b>unique</b>; <b>numbers only</b>; <b>64 bits</b>; <b>in time order</b> (an ID made in the evening is larger than one made that morning, though not always by exactly 1); and <b>12,000 a second</b>. Each option below breaks a different one.</p>
    </section>

    <section>
      <h2>Multi-primary: each server counts by a step</h2>
      <p class="src">Multi-primary</p>
      <p>Use each database's auto_increment, but count up by <b>k</b>, the number of servers, from a different start. Capacity grows with the servers.</p>
      <figure class="fig"><svg id="figStep" viewBox="0 0 660 200" role="img" aria-label="Two database servers with step 2: server 1 hands out 1, 3, 5, 7 and server 2 hands out 2, 4, 6, 8."></svg><figcaption>k = 2: odd numbers from one server, even from the other</figcaption></figure>
      <ul>
        <li>The counters run side by side, so a later ID can be smaller: no time order across servers.</li>
        <li>Adding or removing a server changes k, and every server must be renumbered.</li>
        <li>Hard to stretch across data centers.</li>
      </ul>
    </section>

    <section>
      <h2>UUID: random, 128 bits</h2>
      <p class="src">UUID</p>
      <p>A UUID is a 128-bit value, such as <code>3f2b8c41-7d9e-4a6b-9c15-e0a7d4b2f861</code>. Each web server makes its own, with no coordination, so it scales with the web servers. Random UUIDs have 122 random bits: you'd need about 2.7 × 10¹⁸ for a 50% chance of one repeat, which at a billion a second takes about 86 years.</p>
      <p>But it is 128 bits, not 64; it is written as hex digits with dashes, not a number; and it is random, so in no time order.</p>
    </section>

    <section>
      <h2>Ticket server: one central counter</h2>
      <p class="src">Ticket server</p>
      <p>One database's auto_increment hands out every ID. Numbers, in order, and simple: fine for small and medium systems. But it is a <b>single point of failure</b>, and its speed caps the system. A second ticket server needs its numbers kept apart from the first's, which brings back the multi-primary step.</p>
    </section>

    <section>
      <h2>Timestamp-based: build the ID from parts</h2>
      <p class="src">Timestamp-based IDs</p>
      <p>Divide the 64 bits into sections (this layout is known as Snowflake):</p>
      <figure class="fig"><svg id="figBits" viewBox="0 0 660 150" role="img" aria-label="A 64-bit ID: 1 sign bit, 41 bits of timestamp, 5 bits of data center ID, 5 bits of machine ID and 12 bits of sequence number."></svg><figcaption>Sign, timestamp, data center (DC), machine (M), sequence: 64 bits</figcaption></figure>
      <ul>
        <li><b>Sign</b>, 1 bit: always 0, so the ID stays positive.</li>
        <li><b>Timestamp</b>, 41 bits: milliseconds since a custom epoch. The highest bits, so IDs sort by time. 2⁴¹ ms is about 69.7 years: from 2026-01-01, until 2095. From 1970 they'd run out in 2039, which is why the epoch is set close to today.</li>
        <li><b>Data center and machine</b>, 5 bits each: 32 × 32 = 1,024 generators. Set when a generator starts; changing them by mistake can make IDs collide.</li>
        <li><b>Sequence</b>, 12 bits: counts the IDs a machine makes within one millisecond, then starts again at 0: up to 4,096 a millisecond.</li>
      </ul>
      <p>No generator has to talk to another. Section sizes can be tuned: fewer sequence bits and more timestamp bits suit a system with few IDs at a time that must last longer.</p>
    </section>

    <section>
      <h2>Clocks and availability</h2>
      <p class="src">Clock synchronization</p>
      <p>Timestamp-based IDs assume every generator's clock is right. Servers keep their clocks close with <b>NTP</b> (Network Time Protocol), but a sync can set a clock back. A generator then reuses milliseconds it has already used, with the same machine bits and sequence: repeated IDs. So it must wait until its clock passes the time of its last ID. And since every write needs an ID, the generator must be highly available.</p>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>Each request asks for ${IDS_PER_REQUEST} new IDs, so 3,000 requests a second need 12,000 IDs. A request whose IDs can't be made in time fails. A server added to a multi-primary setup counts with the new step from its own start, onto numbers already handed out, so its share of the IDs repeats. In the clock test, one generator's clock goes back ${CLOCK_BACK_MS} ms; while it replays them, its share of the IDs repeats unless it waits.</p>
      <p class="assume">Game assumptions: an auto_increment database hands out ${fmt(DB_IDS)} IDs a second, in 2 ms; a timestamp-based generator takes 1 ms; a UUID takes no time; $100 a month per database or generator.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Capacity estimates</p>
      <p><b>64 bits</b> = 1 + 41 + 5 + 5 + 12. 2⁴¹ ms ≈ 69.7 years; 2¹² = 4,096 IDs a millisecond per machine; 2⁵ × 2⁵ = 1,024 machines.</p>
      <p><b>IDs a second</b> = new records a day ÷ 86,400, times the peak. 30 million a day ≈ 350 a second, about 1,000 at a 3× peak.</p>
    </section>

    <section>
      ${lessonSteps([
        'Unique? Numbers only? How many bits? Sorted by time? How many a second?',
        'Compare multi-primary, UUID, ticket server and timestamp-based IDs against each requirement.',
        'The bit layout, the epoch, the sequence, and how machine IDs are given out.',
        'A server fails, one is added, a clock goes back.',
      ])}
    </section>
`,

  // Lesson diagrams. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs, svgEl, figLabel } = f;

    const f1 = $('figStep'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'web', 110, 100, 'Web servers', 'Ask for IDs');
    figNode(f1, 'db', 400, 50, 'Server 1', 'Starts at 1, step 2');
    figNode(f1, 'db', 400, 150, 'Server 2', 'Starts at 2, step 2');
    figArrow(f1, 206, 90, 304, 56, '', null, 0, 0);
    figArrow(f1, 206, 110, 304, 144, '', null, 0, 0);
    figLabel(f1, 510, 54, '1, 3, 5, 7…', 'start');
    figLabel(f1, 510, 154, '2, 4, 6, 8…', 'start');

    const f2 = $('figBits'); f2.textContent = ''; figDefs(f2);
    // Widths in proportion to the bits, 9.5 px a bit.
    /** @type {[string, number, string][]} */
    const parts = [['0', 1, '1'], ['timestamp', 41, '41 bits'], ['DC', 5, '5'], ['M', 5, '5'], ['sequence', 12, '12 bits']];
    let x = 26;
    parts.forEach(([name, bits, sub], i) => {
      const w = bits * 9.5;
      svgEl('rect', { x, y: 40, width: w, height: 40, rx: 2, class: i === 1 ? 'd-step' : 'ic-stroke' }, f2);
      figLabel(f2, x + w / 2, 65, name, 'middle', i === 1 ? 'd-step-t' : 'd-label');
      figLabel(f2, x + w / 2, 104, sub);
      x += w;
    });
    figLabel(f2, 26, 26, 'bit 63', 'start');
    figLabel(f2, x, 26, 'bit 0', 'end');
  },
};
