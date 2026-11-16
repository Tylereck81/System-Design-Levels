// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 13: Unique ID generator.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt } from '../js/format.js';
import { COMPONENTS } from '../js/engine/catalog.js';
import { costGoal, servedAtLeast, fmtPct } from './shared/goals.js';
import { DB_IDS, CLOCK_BACK_MS } from '../js/engine/ids.js';
import { dns, lb, NO_DB_NOTE, autoscaleSubOf, scalingChoices } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, lbBad } from './shared/connections.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { dayTraffic } from './shared/workload.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 150, servedPct: 99 };
const PCT = { wholeUpTo: 0, wholeFrom: 1 }; // percentages: whole numbers, with one decimal between 0% and 1%
const BUDGET = 1900;
const IDS_PER_REQUEST = 4;
const QPS = 3000; // requests a second
/** IDs a second every mission asks for: 3,000 requests × 4 IDs = 12,000. */
const IDS_NEEDED = QPS * IDS_PER_REQUEST;
/** The size every ID must fit in. */
const ID_BITS = 64;

// ---------------- Lesson ----------------
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
const idgen = COMPONENTS.idgen;
// The 64-bit timestamp-based layout: 1 + 41 + 5 + 5 + 12 = 64 bits. The game's generator makes 2¹² = 4,096 IDs a
// millisecond (SNOW_IDS in js/engine/ids.js).
const layout = { sign: 1, time: 41, dc: 5, machine: 5, seq: 12 };
const years = Math.floor(2 ** layout.time / 1000 / 3600 / 24 / 365); // 2,199,023,255,552 ms ≈ 69.7 years, so 69
const perMs = 2 ** layout.seq; // 4,096
const generators = 2 ** (layout.dc + layout.machine); // 32 × 32 = 1,024
// Step example (ours): 4 servers, the one that starts at 3 hands out 3, 7, 11. The quiz uses 3 servers, Check
// yourself 5.
const step = { servers: 4, start: 3 };
step.ids = [0, 1, 2].map((i) => step.start + i * step.servers);
// Sizing example (ours): 9,000 IDs/s from servers that each make 4,000: 2.25, so 3, plus a spare = 4. Mission 1 asks
// for 12,000 IDs/s at 5,000 each.
const size = { need: 9000, each: 4000 };
size.n = Math.ceil(size.need / size.each);
// The step picture: two servers counting by 2 hand out four numbers each; a third, starting at 3 with a step of 3,
// lands on 3 and 6, already handed out.
const stepFig = { servers: 2, shown: 4 };
// The clock picture: IDs at 250 and 251 ms, then the game's time sync sets the clock back 20 ms, to 231.
const clockFig = { last: 251 };
clockFig.back = clockFig.last - CLOCK_BACK_MS;

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 13 · Part 2: Building blocks',
    title: 'Unique ID generator',
    story: 'Every order, payment and ticket needs an ID that nothing else will ever have. One database could simply count: 1, 2, 3. But records are now created on many servers at once, and no single counter can serve them all.',
    picture: 'figBuilt',
    alt: 'The finished design: web servers ask two ID generators for new IDs. Each generator has its own machine number, and every ID is 64 bits made of the time, the machine number and a sequence number.',
    outcomes: [
      'say why one counter fails at scale',
      'compare four ways to make unique IDs',
      'read the fields of a 64-bit time-based ID',
      'work out what each field\'s width allows',
      'explain what a generator does when its clock goes back',
    ],
  },
  last: 'Level 12 spread data over many nodes. Every record on those nodes needs an ID, and two servers must never hand out the same one.',
  parts: [
    {
      title: 'IDs as 64-bit numbers',
      mission: 0,
      minutes: 9,
      lead: 'An ID has one job: to be different from every other ID, for ever.',
      newParts: [
        { type: 'idgen', before: 1, what: 'A service that hands out IDs for new records.', does: 'Makes sure no two records ever get the same ID. You choose the method and the number of servers.', game: `$${idgen.cost} a month for each server. Four methods to choose from.` },
      ],
      sections: [
        {
          title: 'Why is one counter not enough?',
          hook: 'A single database can number rows by itself: each new row gets the last number plus one (auto_increment).',
          body: [
            { p: 'With one counter, every server that creates a record must ask that one database. So the counter caps how many records you can create a second, and when it fails, nothing can be created at all. It is a bottleneck and a single point of failure.' },
            {
              calc: {
                formula: 'Servers = IDs needed a second ÷ IDs one server makes, rounded up, plus one spare.',
                rows: [
                  { label: 'To keep up', work: `${fmt(size.need)} IDs/s ÷ ${fmt(size.each)} IDs/s`, result: `${size.need / size.each}, so ${size.n} servers` },
                  { label: 'With a spare', work: `${size.n} servers + 1 server`, result: `${size.n + 1} servers` },
                ],
                result: `${size.n + 1} servers. With one down, the other ${size.n} still make ${fmt(size.n * size.each)} IDs a second.`,
              },
            },
          ],
          takeaway: 'One counter limits the rate and stops everything when it fails.',
          quiz: [0, 9],
        },
        {
          title: 'How can several counters avoid each other?',
          hook: 'Give each server its own starting number, and make every server count up by the number of servers.',
          body: [
            {
              figure: 'figStep',
              alt: 'Server 1 counts 1, 3, 5, 7 and server 2 counts 2, 4, 6, 8, so they never give the same number. When a third server is added the step must become 3, and its numbers land on ones already handed out.',
              caption: 'Each server counts in steps of the number of servers',
            },
            { p: `This is called <b>multi-primary</b>: several databases, each counting. With ${step.servers} servers, the server that starts at ${step.start} hands out ${step.ids.join(', ')}. No two servers can ever collide, and the IDs are plain numbers.` },
            { p: 'Two weaknesses. Each server counts at its own pace, so a larger ID is not always a later one. And the step is the number of servers, so adding or removing a server breaks the pattern.' },
          ],
          takeaway: 'Counters with a step never collide, but they ignore time and resist change.',
          quiz: [1, 2],
        },
        {
          title: 'What else could make the IDs?',
          hook: 'Two more methods are simple, and each fails one requirement.',
          body: [
            { table: { head: ['Method', 'How', 'Problem'], rows: [
              ['<b>UUID</b>', 'Each web server makes a random 128-bit value. Two servers picking the same one is almost impossible.', `Twice the ${ID_BITS} bits you have, not a plain number, and not in time order`],
              ['<b>Ticket server</b>', 'One central server counts for everyone', 'Every ID depends on one machine: a single point of failure'],
            ] } },
            { p: 'Size matters because the ID is stored in every row and in every index that points to that row.' },
          ],
          takeaway: 'A UUID is too long and unordered; a ticket server is a single point of failure.',
          quiz: [3, 4],
        },
      ],
      checks: [
        {
          q: 'Five servers hand out IDs with a step of 5. Server 4 starts at 4. What are its first three IDs?',
          options: [
            { t: '4, 5, 6', why: 'That is a step of 1, and it would collide with the other servers at once.' },
            { t: '4, 9, 14', right: true, why: 'Start at 4 and add 5 each time. No other server ever lands on these.' },
            { t: '4, 8, 12', why: 'That is a step of 4. The step is the number of servers: 5.' },
          ],
        },
      ],
      youWill: [
        'estimate the generator servers you need (Play stays locked until you do)',
        `make ${fmt(IDS_NEEDED)} unique IDs a second that are plain numbers and fit in ${ID_BITS} bits`,
        'take a generator server down with the Break it button and still keep up',
        `stay within $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'Counters with a step never collided, and when one server failed the others kept up.',
        number: [`${ID_BITS} bits`, 'the size every ID must fit in'],
        next: 'The app opens in a new city next week, and you need one more ID server, added while the app runs.',
      },
    },
    {
      title: 'A new city opens',
      mission: 1,
      minutes: 8,
      lead: 'A method that only works for a fixed number of servers will not survive growth.',
      sections: [
        {
          title: 'Why does adding a counter server break the IDs?',
          hook: 'The step equals the number of servers. A new server changes the step for everyone.',
          body: [
            { p: 'With two servers counting by 2, every number will be used sooner or later. A third server needs a step of 3, and whatever start it gets, it lands on numbers the first two have already handed out. To add it safely you would have to stop all servers and renumber.' },
            { p: 'What you want is a way for any server to make IDs alone, with no step and no shared counter, and still never collide.' },
          ],
          takeaway: 'Step counters must all change together, so they cannot grow while running.',
          quiz: [],
        },
        {
          title: 'How do you fit time, place and a counter into 64 bits?',
          hook: 'Do not count at all. Build each ID out of facts that cannot be the same on two servers at the same moment. This is a <b>timestamp-based</b> ID.',
          body: [
            {
              figure: 'figBits',
              alt: `A 64-bit ID in five fields: ${layout.sign} bit that is always zero, ${layout.time} bits of time in milliseconds, ${layout.dc} bits for the data center, ${layout.machine} bits for the machine and ${layout.seq} bits for a sequence number. ${layout.time} bits of milliseconds last ${years} years, the two middle fields allow ${fmt(generators)} generators, and ${layout.seq} bits allow ${fmt(perMs)} IDs each millisecond.`,
              caption: 'Time first, then where it was made, then a counter',
            },
            { ul: [
              `<b>Time</b> (${layout.time} bits): milliseconds since a start date you choose, the <b>epoch</b>. It lasts about ${years} years.`,
              `<b>Data center and machine</b> (${layout.dc} + ${layout.machine} bits): a number given to each generator when it starts. Room for ${fmt(generators)} generators.`,
              `<b>Sequence</b> (${layout.seq} bits): a counter that restarts every millisecond. Room for ${fmt(perMs)} IDs each millisecond on each generator.`,
            ] },
            { p: 'Two generators differ in the machine number. One generator differs from itself in the time or the sequence. Time comes first, so sorting by ID sorts by time. The one bit left over stays 0, which keeps the number positive.' },
          ],
          takeaway: 'Time, machine number and a sequence make a 64-bit ID no other server can produce.',
          quiz: [5, 6, 7],
        },
      ],
      checks: [
        {
          q: 'A design changes the sequence field from 12 bits to 10. What does it lose?',
          options: [
            { t: 'Years before the time field runs out', why: 'That depends on the time field, which did not change.' },
            { t: 'IDs each millisecond: 1,024 where it had 4,096', right: true, why: '2 to the power 10 is 1,024. Each bit removed halves what the field can count.' },
            { t: 'The number of generators', why: 'That depends on the data center and machine fields.' },
          ],
        },
      ],
      youWill: [
        'press Add a generator server and see which methods repeat an ID',
        'switch to a method where a new server needs nothing from the others',
        `keep every ID unique, numeric and within ${ID_BITS} bits, for at most $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'The new generator got a machine number of its own, so its IDs could not match another generator\'s.',
        number: [`${fmt(generators)} generators`, 'fit in the data center and machine fields'],
        next: 'Support screens list orders by ID, newest first. That relies on every generator\'s clock.',
      },
    },
    {
      title: 'Newest orders first',
      mission: 2,
      minutes: 6,
      lead: 'A time-based ID is only as good as the clock that made it.',
      sections: [
        {
          title: 'Can you trust a server\'s clock?',
          hook: 'Not completely. Every computer\'s clock runs a little fast or slow.',
          body: [
            { p: 'Servers correct their clocks over the network, many times a day. A correction can move a clock <b>forward</b>, or <b>back</b> if it was running fast. Two servers also never agree exactly: a few milliseconds apart is normal.' },
            { p: 'So across servers, IDs are in time order only roughly. On one server they are in exact order, as long as its clock never goes back.' },
          ],
          takeaway: 'Clocks drift and get corrected, sometimes backwards.',
          quiz: [],
        },
        {
          title: 'What happens when a clock goes backwards?',
          hook: 'The generator would see milliseconds it has already used.',
          body: [
            {
              figure: 'figClock',
              alt: `A generator issues IDs at ${clockFig.last - 1} and ${clockFig.last} milliseconds. A time correction sets its clock back to ${clockFig.back}. The generator waits, issuing nothing, until the clock has passed ${clockFig.last} again, and then issues the next ID at ${clockFig.last + 1}.`,
              caption: 'Wait until the clock passes the last ID',
            },
            { p: 'With the same time, the same machine number and a sequence that starts again from zero, it can produce an ID it has already handed out. And the new IDs would sort before older ones.' },
            { p: 'The rule: a generator remembers the time of its last ID and <b>makes no IDs until the clock has passed it</b>. A wait of a few milliseconds is cheap. A repeated ID can overwrite someone\'s order.' },
          ],
          takeaway: 'If the clock goes back, wait until it has passed the last ID.',
          quiz: [8],
        },
      ],
      checks: [
        {
          q: 'A generator\'s clock is set back by 30 milliseconds. It keeps making IDs straight away. What can go wrong?',
          options: [
            { t: 'Nothing: the machine number keeps IDs unique', why: 'The machine number separates this generator from others, not from its own past.' },
            { t: 'It can repeat an ID it made 30 milliseconds ago', right: true, why: 'Same time, same machine, and the sequence restarts at zero. Waiting 30 milliseconds avoids it.' },
          ],
        },
      ],
      youWill: [
        'make sure an ID made later is always larger',
        'press Set a clock back and keep IDs unique and in order',
        `stay within $${fmt(BUDGET)} a month`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The design you built: web servers ask two ID generators for new IDs. Each generator has its own machine number, and every ID is 64 bits made of the time, the machine number and a sequence number.',
    say: [
      '"One counter caps the rate and is a single point of failure."',
      '"I build 64-bit IDs from a millisecond timestamp, a machine number and a sequence, so generators never coordinate."',
      '"If a generator\'s clock goes back, it waits until the clock passes its last ID."',
    ],
    numbers: [
      [`${years} years`, `what ${layout.time} bits of milliseconds last`],
      [fmt(perMs), 'IDs each millisecond on one generator'],
      [`${fmt(generators)} generators`, `allowed by ${layout.dc + layout.machine} bits of machine number`],
    ],
    loop: `The interview steps again: ${scope} (the servers you need), ${sketch} (generators beside the web servers), ${deep} (the method and its fields), ${stress} (you lost a server, added one, and set a clock back). This ends Building blocks. From here every level is one interview question about a whole product.`,
    broken: 'You now have the parts. Level 14 uses several of them at once to design a complete product: a URL shortener.',
  },
};

// ---------------- Lesson pictures ----------------
/**
 * A bar of ID bits split into fields, each as wide as its bits, starting at (x, y). The field at `accent` is filled.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 * @param {{ x: number, y: number, width: number, accent: number }} at
 * @param {[string, number][]} fields each field's label and its bits
 * @returns {number[]} the centre of each field, for labels under the bar
 */
function drawIdBar(f, svg, { x, y, width, accent }, fields) {
  const { svgEl, figLabel } = f;
  const px = width / fields.reduce((sum, [, bits]) => sum + bits, 0);
  return fields.map(([label, bits], i) => {
    const w = bits * px, mid = x + w / 2;
    svgEl('rect', { x, y, width: w, height: 40, rx: 2, class: i === accent ? 'd-step' : 'ic-stroke' }, svg);
    figLabel(svg, mid, y + 25, label, 'middle', i === accent ? 'd-step-t' : 'd-label');
    x += w;
    return mid;
  });
}

/**
 * Counters with a step: two servers counting by 2 never meet; a third server, added in a dashed panel, needs a step
 * of 3 and lands on numbers already handed out.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawStep(f, svg) {
  const { svgEl, figNode, figLabel, figSvg } = f;
  figSvg(svg, 300);
  const counts = (start, by, n) => Array.from({ length: n }, (_, i) => start + i * by);
  const used = new Set();
  for (let s = 1; s <= stepFig.servers; s++) {
    const ids = counts(s, stepFig.servers, stepFig.shown);
    ids.forEach((id) => used.add(id));
    figNode(svg, 'db', 120, 10 + 70 * s - 30, `Server ${s}`, `Starts at ${s}, step ${stepFig.servers}`);
    figLabel(svg, 240, 70 * s - 16, `${ids.join(', ')}…`, 'start');
  }
  const newStep = stepFig.servers + 1, added = counts(newStep, newStep, 3), repeats = added.filter((id) => used.has(id));
  svgEl('rect', { x: 10, y: 170, width: 620, height: 120, rx: 12, class: 'tier-box' }, svg);
  figLabel(svg, 24, 190, `Add a third server: the step becomes ${newStep}`, 'start', 'tier-label');
  figNode(svg, 'db', 120, 240, `Server ${newStep}`, `Starts at ${newStep}, step ${newStep}`);
  figLabel(svg, 240, 236, `${added.join(', ')}…`, 'start');
  figLabel(svg, 240, 256, `${repeats.join(' and ')} were already handed out`, 'start', 'ch-cap-t');
}

/**
 * The 64-bit timestamp-based ID: five fields as wide as their bits, their names under them, and under those what
 * each width allows.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBits(f, svg) {
  const { figLabel, figSvg } = f;
  figSvg(svg, 176);
  const [, time, dc, machine, seq] = drawIdBar(f, svg, { x: 20, y: 20, width: 600, accent: 1 }, [
    ['', layout.sign], [`${layout.time} bits`, layout.time], [String(layout.dc), layout.dc], [String(layout.machine), layout.machine], [`${layout.seq} bits`, layout.seq],
  ]);
  const ids = (dc + machine) / 2;
  figLabel(svg, 20, 84, 'always 0', 'start');
  figLabel(svg, time, 84, 'time in milliseconds');
  figLabel(svg, ids, 84, 'data center');
  figLabel(svg, ids, 102, '+ machine');
  figLabel(svg, seq, 84, 'sequence');
  figLabel(svg, time, 136, `${years} years`, 'middle', 'ch-pt-t');
  // The two right-hand labels end at their fields' right edges, so they cannot run into each other.
  figLabel(svg, 20 + 600 * (ID_BITS - layout.seq) / ID_BITS, 136, `${fmt(generators)} generators`, 'end', 'ch-pt-t');
  figLabel(svg, 620, 136, `${fmt(perMs)} IDs`, 'end', 'ch-pt-t');
  figLabel(svg, 620, 154, 'each millisecond', 'end', 'ch-pt-t');
}

/**
 * One generator's clock: IDs at the last two milliseconds, a time sync sets the clock back, the generator waits
 * (no IDs) until the clock passes its last ID, then makes the next one.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawClock(f, svg) {
  const { svgEl, figLabel, figDash, figSvg } = f;
  figSvg(svg, 200);
  const { last, back } = clockFig, from = back - 5, to = last + 5;
  const X = (t) => 40 + (t - from) * 560 / (to - from), axis = 130;
  figDash(svg, `M ${X(last)} 90 Q ${X((last + back) / 2)} 30 ${X(back)} 90`);
  figLabel(svg, X((last + back) / 2), 40, `a time sync sets the clock back to ${back}`);
  svgEl('rect', { x: X(back), y: 100, width: X(last) - X(back), height: axis - 100, class: 'ch-cap' }, svg);
  figLabel(svg, X((last + back) / 2), 120, `wait: no IDs until the clock passes ${last}`, 'middle', 'ch-cap-t');
  svgEl('line', { x1: X(from), y1: axis, x2: X(to), y2: axis, class: 'ch-axis' }, svg);
  for (const t of [back, last]) figLabel(svg, X(t), axis + 20, String(t), 'middle', 'ch-t');
  figLabel(svg, X(to), axis + 20, 'clock (ms)', 'end', 'ch-t');
  for (const t of [last - 1, last, last + 1]) svgEl('circle', { cx: X(t), cy: axis, r: 4.5, class: 'ch-pt' }, svg);
  figLabel(svg, X(last) - 8, axis + 44, `IDs at ${last - 1} and ${last}`, 'end', 'ch-pt-t');
  figLabel(svg, X(last + 1) + 8, axis + 44, `next ID at ${last + 1}`, 'start', 'ch-pt-t');
}

/**
 * The finished design, drawn for the intro and again for the wrap-up: web servers ask two ID generators, each with
 * its own machine number, and every ID is 64 bits of time, machine number and sequence.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { figNode, figArrow, figLabel, figSvg } = f;
  figSvg(svg, 520);
  figNode(svg, 'users', 320, 46, 'Users', 'Orders, payments');
  figNode(svg, 'lb', 320, 156, 'Load balancer', 'Shares requests');
  figArrow(svg, 320, 76, 320, 126, '', null, 0, 0);
  figNode(svg, 'web', 320, 266, 'Web servers', 'Autoscaled');
  figArrow(svg, 320, 186, 320, 236, '', null, 0, 0);
  [1, 2].forEach((m, i) => {
    const x = 190 + 260 * i;
    figNode(svg, 'idgen', x, 376, 'ID generator', `Machine ${m}`);
    figArrow(svg, 320 + (i ? 40 : -40), 296, x, 346, '', null, 0, 0);
  });
  drawIdBar(f, svg, { x: 80, y: 440, width: 480, accent: 1 }, [
    ['', layout.sign], ['time', layout.time], ['machine', layout.dc + layout.machine], ['sequence', layout.seq],
  ]);
  figLabel(svg, 320, 504, `every ID: ${ID_BITS} bits`);
}

// The generator's setting as the canvas shows it (saved settings are checked on load, so these are valid options).
const idOf = (n) => ({ method: n.method || 'uuid', servers: Number(n.servers) || 1, wait: n.clock === 'wait' });
const unique = (m) => m.idDupPct != null && m.idDupPct < 1e-9;
const served99 = servedAtLeast(targets.servedPct);
/** @type {Goal} */
const uniqueGoal = { id: 'unique', type: 'metric', text: 'Every ID is unique', test: unique, val: (m) => (m.idDupPct == null ? '—' : fmtPct(m.idDupPct, PCT) + ' repeat') };
/** @type {Goal} */
const numericGoal = { id: 'numeric', type: 'metric', text: 'IDs are numbers only', test: (m) => m.idNumeric === true, val: (m) => (m.idNumeric == null ? '—' : m.idNumeric ? 'digits' : 'hex text') };
/** @type {Goal} */
const bitsGoal = { id: 'bits', type: 'metric', text: `IDs fit in ${ID_BITS} bits`, test: (m) => m.idBits != null && m.idBits <= ID_BITS, val: (m) => (m.idBits == null ? '—' : m.idBits + ' bits') };
/** @type {Goal} */
const orderGoal = { id: 'ordered', type: 'metric', text: 'An ID made later is always larger', test: (m) => m.idOrdered === true, val: (m) => (m.idOrdered == null ? '—' : m.idOrdered ? 'yes' : 'no') };
/** @type {Goal} */
const rateGoal = { id: 'rate', type: 'metric', text: `Make ${fmt(IDS_NEEDED)} IDs a second (${targets.servedPct}% of requests served)`, test: served99, val: (m) => (m.idMade == null ? m.servedPct.toFixed(1) + '%' : fmt(m.idMade) + '/s') };
/** @type {Goal} */
const survivesFailureGoal = { id: 'nospof', type: 'metric', text: 'The generator keeps working if one server fails', test: (m) => m.idSpof === false, val: (m) => (m.idSpof == null ? '—' : m.idSpof ? '1 server' : 'yes') };
/** @type {Goal[]} */
const requirements = [uniqueGoal, numericGoal, bitsGoal, rateGoal, survivesFailureGoal];
const methodName = { step: 'Multi-primary', uuid: 'UUID', ticket: 'Ticket server', snow: 'Timestamp-based' };

/** @type {Level} */
export default {
  id: 13,
  saveKey: 'sdl-level13-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
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
        prompt: `<b>Estimate before you build.</b> One auto_increment database hands out ${fmt(DB_IDS)} IDs a second. The app needs ${fmt(IDS_NEEDED)} a second, and must keep up with one server down. How many servers?`,
        label: 'Servers',
        placeholder: 'e.g. 2',
        acceptedHtml: `<p><b>Estimate accepted.</b></p><div class="calc">${fmt(IDS_NEEDED)} ÷ ${fmt(DB_IDS)} = 2.4, so 3 servers<br>One down leaves 2 × ${fmt(DB_IDS)} = 10,000: too few<br>4 servers: one down leaves 15,000</div>`,
        acceptedLog: 'Estimate accepted: 4 servers. Play is unlocked.',
        notNumber: 'Type the number of servers, for example 2.',
        hints: [
          { test: (v) => v === 3, text: `3 make 15,000 IDs a second, but with one down only 10,000: fewer than ${fmt(IDS_NEEDED)}.` },
          { test: (v) => v <= 2, text: `${fmt(IDS_NEEDED)} ÷ ${fmt(DB_IDS)} = 2.4, so even with all running you need 3. Then add one for the server that fails.` },
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
      notMet: (m) => `Only ${m.servedPct.toFixed(1)}% served: with one server down the generator makes ${fmt(m.idMade || 0)} of the ${fmt(IDS_NEEDED)} IDs a second needed. Run enough servers to keep up with one down.`,
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
      { q: 'Why isn\'t one database\'s auto_increment enough for IDs at scale?', o: ['It needs 128 bits per ID', 'Its IDs are not numbers', 'Its numbers can repeat after every restart', 'One server caps the rate and can fail'], a: 3, e: 'One database hands out every ID, so its speed caps the whole system and when it fails nothing can be saved. Spread the counter over several databases, and their numbers must be kept apart.', r: 'Why is one counter not enough?' },
      { q: 'Multi-primary with 3 servers. Server 2 starts at 2. What are its next IDs?', o: ['3, 4, 5', '2, 5, 8', '2, 4, 6', '6, 9, 12'], a: 1, e: 'Each server adds k = 3, the number of servers, to its last ID: 2, 5, 8. Server 1 gives 1, 4, 7 and server 3 gives 3, 6, 9, so they never meet.', r: 'How can several counters avoid each other?' },
      { q: 'Why don\'t multi-primary IDs follow time?', o: ['Each server counts at its own pace', 'The step changes every second', 'Servers copy each other\'s counters every hour', 'IDs are random'], a: 0, e: 'A busy server\'s counter runs ahead of a quiet one, so an ID made later on the quiet server can be smaller.', r: 'How can several counters avoid each other?' },
      { q: 'Why can\'t a UUID be the ID here?', o: ['It isn\'t unique enough in practice', 'It needs a central server to hand it out', 'It\'s 128 bits long', 'It is too slow to make'], a: 2, e: 'A UUID is 128 bits: twice the 64 allowed. It is also written as hex digits with dashes, and random, so in no time order. Repeats are no worry: it takes about 2.7 × 10¹⁸ UUIDs for a 50% chance of one.', r: 'What else could make the IDs?' },
      { q: 'What makes a ticket server a weak choice at scale?', o: ['Its IDs are not in time order', 'Every ID depends on one server', 'Its IDs are 128 bits', 'It needs synchronized clocks across machines'], a: 1, e: 'One database hands out every number, so it caps the rate and, when it fails, nothing gets an ID. A second one brings back the problem of keeping their numbers apart.', r: 'What else could make the IDs?' },
      { q: '41 bits of milliseconds last about how long?', o: ['35 years', '24 days', '139 years', '69 years'], a: 3, e: '2⁴¹ ms ≈ 2.2 × 10¹² ms ≈ 69.7 years. From a custom epoch of 2026-01-01 the IDs last until 2095; from 1970 they would run out in 2039.', r: 'How do you fit time, place and a counter into 64 bits?' },
      { q: 'How many IDs can one timestamp-based generator make in a millisecond?', o: ['4,096', '1,024', '32', '4,096,000'], a: 0, e: '12 sequence bits: 2¹² = 4,096 a millisecond, about 4 million a second. The sequence starts again at 0 each millisecond.', r: 'How do you fit time, place and a counter into 64 bits?' },
      { q: '5 bits of data center and 5 of machine. How many generators can run?', o: ['32', '64', '1,024', '10,000'], a: 2, e: '32 data centers × 32 machines = 1,024 generators, each with its own pair, so their IDs can\'t collide.', r: 'How do you fit time, place and a counter into 64 bits?' },
      { q: 'A time sync sets a generator\'s clock back 5 ms. What should it do?', o: ['Keep making IDs as before', 'Reset its sequence to 0 and carry on making IDs', 'Switch to UUIDs', 'Wait until the clock passes its last ID'], a: 3, e: 'Its clock would repeat milliseconds it has already used, with the same machine bits and sequence numbers: repeated IDs. Waiting a few ms is cheap. NTP keeps clocks close, but it can still set one back.', r: 'What happens when a clock goes backwards?' },
      { q: 'An app saves 30 million records a day, with a peak 3× the average. About how many IDs a second at peak?', o: ['1,000', '350', '10,000', '30,000'], a: 0, e: '30 million ÷ 86,400 s ≈ 350 a second on average; 3× that at peak ≈ 1,000.', r: 'Why is one counter not enough?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $ } = f;
    drawStep(f, $('figStep'));
    drawBits(f, $('figBits'));
    drawClock(f, $('figClock'));
    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
