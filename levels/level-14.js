// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 14: URL shortener.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt, count, ms } from '../js/format.js';
import { servedGoal, latGoal, costGoal, servedAtLeast, fmtPct } from './shared/goals.js';
import { dns, lb, NO_DB_NOTE, autoscaleSubOf, scalingChoices, db, cache } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToDb, lbBad, replicaBad, cacheBad } from './shared/connections.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { dayTraffic } from './shared/workload.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 150, servedPct: 99 };
const BUDGET = 1300;
const CLICKS_PER_LINK = 10;
const WRITES = 1 / (CLICKS_PER_LINK + 1); // 10 clicks for every new link: 1 request in 11 is a new link
const REPEAT = 0.5; // clicks from a browser that has followed the link before
const VIRAL = 1500; // extra clicks a second on one link
const BULK = 3000; // new links a second from one account
/** The characters a code is written in: 0-9 for 0 to 9, a-z for 10 to 35, A-Z for 36 to 61. */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE = DIGITS.length; // 62
/** How many characters of a hash a code keeps. */
const HASH_CHARS = 7;

// ---------------- Lesson ----------------
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
/** A large count to three significant figures, with the word: 916,132,832 → "916 million". */
const about = (n) => count(Number(n.toPrecision(3)));
/** The smallest number of base 62 characters that gives at least `links` codes. */
const charsFor = (links) => Math.ceil(Math.log(links) / Math.log(BASE) - 1e-9);
/**
 * Writing `n` in base 62 by dividing by 62 again and again: one step per division, first division first. The
 * remainders, read from last to first, are the code.
 * @param {number} n
 * @returns {{ n: number, q: number, r: number }[]}
 */
function base62Steps(n) {
  const steps = [];
  do { steps.push({ n, q: Math.floor(n / BASE), r: n % BASE }); n = Math.floor(n / BASE); } while (n > 0);
  return steps;
}
const toBase62 = (n) => base62Steps(n).map((s) => DIGITS[s.r]).reverse().join('');

// Scope example (ours): 25 million new links a day, kept 5 years: 25 million × 365 × 5 = 45,625,000,000 links. 62⁵ is
// 916,132,832, too few; 62⁶ is 56,800,235,584, enough: 6 characters. The mission uses 60 million for 10 years.
const sc = { perDay: 25e6, years: 5 };
sc.total = sc.perDay * 365 * sc.years;
sc.chars = charsFor(sc.total);
sc.writes = Math.round(sc.perDay / 86400); // 289
sc.reads = sc.writes * CLICKS_PER_LINK; // 2,890
// Check yourself: 2 billion links also need 6 characters (the mission asks for 219 billion: 7).
const checkLinks = 2e9;
// Base 62 example: 12345 = 3 × 62² + 13 × 62 + 7 → "3d7"; the next ID, 12346, is "3d8". The quiz uses 20000.
const b62 = { n: 12345 };
b62.steps = base62Steps(b62.n);
b62.code = toBase62(b62.n);
b62.next = toBase62(b62.n + 1);
/** One division of the base 62 example as a worked-example row. */
const b62Row = (label, { n, q, r }, i) => ({ label, work: i ? `what is left, ${n} ÷ ${BASE}` : `ID ${fmt(n)} ÷ ${BASE}`, result: `${q}, remainder ${r} → ${DIGITS[r]}` });

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 14 · Part 3: Design real systems',
    title: 'URL shortener',
    story: 'Marketing teams want short links: paste a long address, get back a few characters, and every click on them lands on the long page. From here on, each level is one interview question, designed from a blank canvas.',
    picture: 'figBuilt',
    alt: 'The finished design: users reach the link service through a load balancer. The link service looks codes up in a cache, reads the database on a miss, and checks new codes against a Bloom filter.',
    outcomes: [
      'scope a link service with one estimate',
      'work out how many characters a code needs',
      'choose between a 301 and a 302 redirect',
      `turn a number into a base ${BASE} code`,
      'make codes that cannot be guessed',
    ],
  },
  last: 'Levels 1 to 13 built the parts: load balancers, caches, queues, shards, rate limiters, rings and ID generators. Now you combine them to answer a real interview question.',
  parts: [
    {
      title: 'Short links',
      mission: 0,
      minutes: 10,
      lead: 'Every design interview starts the same way: before drawing anything, find out what you are building and how big it is.',
      sections: [
        {
          title: 'Scope it: how long must a short code be?',
          hook: `A link service does two things: <b>shorten</b> (long link in, short code out) and <b>redirect</b> (code in, long link out). Links never change. Codes use 0-9, a-z and A-Z: ${BASE} characters.`,
          body: [
            {
              calc: {
                formula: `Links to hold = links a day × 365 × years. The code needs n characters, where ${BASE} to the power n is at least that.`,
                rows: [
                  { label: 'Links in all', work: `${count(sc.perDay)} a day × 365 days × ${sc.years} years`, result: `${about(sc.total)} links`, approx: true },
                  { label: `${sc.chars - 1} characters`, work: `${BASE} to the power ${sc.chars - 1}`, result: `${about(BASE ** (sc.chars - 1))} codes: too few`, approx: true },
                  { label: `${sc.chars} characters`, work: `${BASE} to the power ${sc.chars}`, result: `${about(BASE ** sc.chars)} codes: enough`, approx: true },
                ],
                result: `Six characters hold every link for ${sc.years} years. Each extra character multiplies the room by ${BASE}.`,
              },
            },
            { p: `Write the load down too: ${count(sc.perDay)} new links a day is about ${fmt(sc.writes)} a second. With clicks to new links at ${CLICKS_PER_LINK} to 1, that is about ${fmt(sc.reads)} clicks a second. Clicks are the traffic to design for. Storage is links × bytes for each link.` },
          ],
          takeaway: `Count the links for the whole lifetime, then find the power of ${BASE} that holds them.`,
          quiz: [2, 9],
        },
        {
          title: 'How does a click find its long link?',
          hook: 'Two endpoints are enough. <code>POST /api/v1/shorten</code> takes a long link and returns a code. <code>GET /{code}</code> answers with a redirect.',
          body: [
            { ol: [
              'The click reaches a web server through the load balancer.',
              'The web server looks the code up in the <b>cache</b>. A link never changes, so a cached copy is never stale.',
              'On a miss it reads the database and fills the cache.',
              'If the code is in neither, it does not exist: the answer is <b>404 Not Found</b>.',
            ] },
            { p: 'When a link goes viral, every click asks for the same code. That is one key, so after the first miss the cache answers all of them and the database never notices.' },
          ],
          takeaway: 'Clicks are reads of one small mapping, so a cache in front answers most of them.',
          quiz: [7, 8],
        },
      ],
      checks: [
        {
          q: `A service expects ${count(checkLinks)} links in its lifetime. Codes use ${BASE} characters. How many characters does a code need?`,
          options: [
            { t: '5', why: `${BASE} to the power 5 is about ${about(BASE ** 5)}, fewer than ${count(checkLinks)}.` },
            { t: '6', right: true, why: `${BASE} to the power 6 is about ${about(BASE ** 6)}, comfortably more than ${count(checkLinks)}.` },
            { t: '7', why: 'That works, but 6 is already enough. Shorter is the whole point.' },
          ],
        },
      ],
      youWill: [
        'estimate how many characters a code needs (Play stays locked until you do)',
        'build the redirect path with a cache in front of the database',
        `let a link go viral and keep Served at least ${targets.servedPct}%`,
        `stay within $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'Most clicks ended in the cache, and the viral link was a single key the cache absorbed.',
        number: [`${CLICKS_PER_LINK} to 1`, 'clicks to new links'],
        next: 'Marketing teams want to count every click. Right now half of them never reach you.',
      },
    },
    {
      title: 'Count every click',
      mission: 1,
      minutes: 6,
      lead: 'The redirect you choose decides whether a click comes back to you at all.',
      sections: [
        {
          title: 'Should a redirect be 301 or 302?',
          hook: 'Both send the browser on to the long link. They differ in what the browser remembers.',
          body: [
            {
              figure: 'figRedirect',
              alt: 'With a 302, the browser asks the link service for every click and is sent on to the long page. With a 301, the browser remembers the answer, so its second click goes straight to the long page without reaching the link service.',
              caption: 'A 301 is remembered by the browser. A 302 is asked again',
            },
            { ul: [
              '<b>301 Moved Permanently:</b> the browser remembers it and skips you next time. Less load, but you only see first clicks.',
              '<b>302 Found:</b> the browser asks you on every click. More load, and you can count each click and where it came from.',
            ] },
          ],
          takeaway: 'A 301 lowers load, and a 302 lets you count every click.',
          quiz: [0, 1],
        },
        {
          title: 'How to stop one script filling the database',
          hook: 'Anyone with an account can call the shorten endpoint, as fast as they like.',
          body: [
            { p: 'One script creating links in bulk can write millions of rows and slow everyone down. Put a <b>rate limit</b> on new links for each account, as in Level 10. Over the limit, the script gets a 429 and the database never sees the request.' },
          ],
          takeaway: 'Limit new links per account so one client cannot flood the writes.',
          quiz: [],
        },
      ],
      checks: [
        {
          q: 'A link is shared in an email. The same reader clicks it three times. With a 301, how many clicks reach the service?',
          options: [
            { t: 'One', right: true, why: 'The browser remembers a 301 after the first click and goes straight to the long page.' },
            { t: 'Three', why: 'That is a 302. A 301 is cached by the browser.' },
          ],
        },
      ],
      youWill: [
        'switch redirects so every click is counted',
        'press A script creates links and keep the service up with a per-account limit',
        `stay within $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'Every click came back and was counted, and the bulk script was turned away with 429s.',
        number: ['302', 'the redirect that brings every click back'],
        next: 'Partners now shorten private links, such as invoices. If codes follow a sequence, anyone can try the next one.',
      },
    },
    {
      title: 'Private links',
      mission: 2,
      minutes: 8,
      lead: 'There are two ways to make a code, and they fail in opposite ways.',
      sections: [
        {
          title: 'How to turn an ID into a short code',
          hook: `Take a new unique ID from an ID generator and write it in <b>base ${BASE}</b>: digits 0-9, then a-z for 10 to 35, then A-Z for 36 to ${BASE - 1}.`,
          body: [
            {
              calc: {
                formula: `Divide by ${BASE} again and again. The remainders, read from last to first, are the code.`,
                rows: [b62Row('First', b62.steps[0], 0), b62Row('Second', b62.steps[1], 1), b62Row('Last', b62.steps[2], 2)],
                result: `ID ${fmt(b62.n)} becomes the code "${b62.code}".`,
              },
            },
            { p: 'Unique IDs give unique codes, so there is never a collision and no check is needed.' },
          ],
          takeaway: `Base ${BASE} of a unique ID gives a unique code with no collision check.`,
          quiz: [3],
        },
        {
          title: 'How do you make codes nobody can guess?',
          hook: `IDs count up, so codes count up too: after "${b62.code}" comes "${b62.next}". Anyone can walk through every private link.`,
          body: [
            {
              figure: 'figCodes',
              alt: `With base ${BASE}, consecutive IDs give consecutive codes that can be guessed. With a hash, the long link is hashed, the first ${HASH_CHARS} characters become the code, and a Bloom filter says whether the code might be taken; only then is the database checked, and a collision is fixed by adding a suffix and hashing again.`,
              caption: `Base ${BASE} is guessable. A hash needs a collision check`,
            },
            { p: `A <b>hash</b> of the long link has no order. Keep its first ${HASH_CHARS} characters. Two links can share them, a <b>collision</b>, so check: if the code is taken, add a suffix and hash again.` },
            { p: 'Checking the database for every new link doubles the queries. A <b>Bloom filter</b> is a small structure in memory that answers "certainly not taken" or "maybe". Only a maybe needs the database.' },
          ],
          takeaway: 'Hashed codes are unguessable, and a Bloom filter keeps their collision check cheap.',
          quiz: [4, 5, 6],
        },
      ],
      checks: [
        {
          q: 'A Bloom filter says a new code is "certainly not taken". What do you do?',
          options: [
            { t: 'Check the database anyway', why: 'A Bloom filter is never wrong about "certainly not". The check would be wasted.' },
            { t: 'Use the code straight away', right: true, why: 'Only a "maybe" needs the database, and that is rare.' },
          ],
        },
      ],
      youWill: [
        'switch to codes that cannot be guessed from each other',
        'keep a new link at about one database query',
        `let a link go viral and keep Response under ${ms(targets.latencyMs)}, for at most $${fmt(BUDGET)} a month`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The design you built: users reach the link service through a load balancer. The link service looks codes up in a cache, reads the database on a miss, and checks new codes against a Bloom filter.',
    say: [
      '"Clicks outnumber new links ten to one, so a cache sits in front of the database."',
      '"A 301 lowers load, and a 302 lets me count every click."',
      '"Base 62 of an ID never collides but is guessable, and a hash with a Bloom filter is not."',
    ],
    numbers: [
      [String(BASE), 'characters a code can use'],
      [about(BASE ** sc.chars), `codes of ${sc.chars} characters`],
      [`${CLICKS_PER_LINK} to 1`, 'clicks to new links'],
    ],
    loop: `The interview steps: ${scope} (how many links and how long a code), ${sketch} (shorten and redirect paths), ${deep} (redirect type and code method), ${stress} (a viral link and a bulk script).`,
    broken: 'A link service answers requests. Level 15 is a system that makes requests of its own: a crawler that downloads the web.',
  },
};

// ---------------- Lesson pictures ----------------
/**
 * A dashed frame with its label, for one panel of a two-panel picture.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 * @param {number} y
 * @param {number} height
 * @param {string} label
 */
function panel(f, svg, y, height, label) {
  f.svgEl('rect', { x: 10, y, width: 620, height, rx: 12, class: 'tier-box' }, svg);
  f.figLabel(svg, 24, y + 20, label, 'start', 'tier-label');
}

/**
 * A 302 sends every click through the link service on to the long page; after a 301 the browser's second click goes
 * straight to the long page and the link service is not asked.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawRedirect(f, svg) {
  const { figNode, figArrow, figLabel, figSvg } = f;
  figSvg(svg, 436);
  panel(f, svg, 10, 200, '302 Found: every click asks the link service');
  figNode(svg, 'users', 110, 76, 'Browser', `Clicks /${b62.code}`);
  figNode(svg, 'web', 530, 76, 'Link service', `Looks up ${b62.code}`);
  figNode(svg, 'web', 530, 170, 'example.com', 'The long page');
  figArrow(svg, 204, 66, 436, 66, `GET /${b62.code}`, '1', 236, 58);
  figArrow(svg, 436, 86, 204, 86, '302, Location: long page', '2', 236, 104);
  figArrow(svg, 110, 106, 436, 166, 'GET the long page', '3', 140, 168);
  panel(f, svg, 226, 200, '301 Moved Permanently: the second click');
  figNode(svg, 'users', 110, 292, 'Browser', `Remembers /${b62.code}`);
  figNode(svg, 'web', 530, 292, 'Link service', 'Not asked');
  figNode(svg, 'web', 530, 386, 'example.com', 'The long page');
  figLabel(svg, 320, 296, 'no request');
  figArrow(svg, 110, 322, 436, 382, 'straight to the long page', null, 140, 384);
}

/**
 * Two ways to make a code: base 62 of the next ID gives the next code, which can be guessed; a hash has no order, but
 * its first characters may be taken, so a Bloom filter answers first and only a "maybe" reaches the database.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawCodes(f, svg) {
  const { figNode, figArrow, figLabel, figSvg } = f;
  figSvg(svg, 396);
  panel(f, svg, 10, 130, `Base ${BASE}: the next ID gives the next code`);
  figNode(svg, 'idgen', 110, 82, 'ID generator', 'Counts up');
  figArrow(svg, 204, 82, 330, 82, `base ${BASE}`, null, 267, 74, 'middle');
  figLabel(svg, 350, 70, `${fmt(b62.n)} → ${b62.code}`, 'start', 'ch-pt-t');
  figLabel(svg, 350, 92, `${fmt(b62.n + 1)} → ${b62.next}`, 'start', 'ch-pt-t');
  figLabel(svg, 350, 118, 'the next code is easy to guess', 'start', 'ch-cap-t');
  panel(f, svg, 156, 230, 'Hash: no order, but a code may be taken');
  figNode(svg, 'web', 110, 222, 'Link service', 'Hashes the link');
  figArrow(svg, 110, 252, 110, 300, `keep ${HASH_CHARS} characters`, null, 124, 282);
  figNode(svg, 'cache', 110, 330, 'Bloom filter', 'In memory');
  figLabel(svg, 220, 376, 'certainly not taken: use it', 'start');
  figArrow(svg, 204, 330, 436, 330, 'maybe taken', null, 320, 322, 'middle');
  figNode(svg, 'db', 530, 330, 'Database', 'If taken: rehash');
}

/**
 * The finished design, drawn for the intro and again for the wrap-up: users reach the link service through a load
 * balancer; it limits new links per account, makes hashed codes checked by a Bloom filter, and looks codes up in a
 * cache before the database.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { figNode, figArrow, figLabel, figSvg } = f;
  figSvg(svg, 440);
  figNode(svg, 'users', 320, 46, 'Users', 'Shorten and click');
  figNode(svg, 'lb', 320, 156, 'Load balancer', 'Shares requests');
  figArrow(svg, 320, 76, 320, 126, '', null, 0, 0);
  figNode(svg, 'web', 320, 266, 'Link service', '302 · hash + bloom');
  figArrow(svg, 320, 186, 320, 236, 'new links: rate limit', null, 334, 206);
  figLabel(svg, 334, 222, 'per account', 'start');
  figNode(svg, 'cache', 500, 396, 'Cache', 'Code → long link');
  figArrow(svg, 360, 296, 460, 366, 'lookups', null, 420, 326);
  figNode(svg, 'db', 140, 396, 'Database', 'Every link');
  figArrow(svg, 280, 296, 180, 366, 'on a miss', null, 220, 326, 'end');
}

const counted = (m) => !!m.link && m.link.counted > 0.9999;
/** @type {Goal} */
const countGoal = { id: 'counted', type: 'metric', text: 'Every click is counted', test: counted, val: (m) => (m.link ? fmtPct(100 * m.link.counted) : '—') };
/** @type {Goal} */
const privateGoal = { id: 'private', type: 'metric', text: 'Codes can\'t be guessed from each other', test: (m) => !!m.link && m.link.code !== 'base62', val: (m) => (m.link ? (m.link.code === 'base62' ? 'in sequence' : 'hashed') : '—') };
const served99 = servedAtLeast(targets.servedPct);
// The web server's settings as the canvas shows them (saved settings are checked on load, so these are valid options).
const codeName = { base62: 'base 62', hash: 'hash', bloom: 'hash + bloom' };
const linkCache = cache();

/** @type {Level} */
export default {
  id: 14,
  saveKey: 'sdl-level14-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
  targets,
  // The day's traffic curve (for the autoscaled web servers). repeatClicks: clicks from a browser that has followed
  // the link before. catalogGB: the links clicked in a month, readGapSecs: seconds between clicks on a link (for the cache).
  workload: { day: dayTraffic(), repeatClicks: REPEAT, catalogGB: 20, readGapSecs: 60 },

  // The mock interview's brief and self-check list for this problem (see mock.js).
  mock: {
    title: 'URL shortener',
    brief: 'Design a URL shortener: people turn long links into short ones, and every click on a short link redirects to the long one. 60 million new links a day, 10 clicks for each, links kept for 10 years; codes use 0–9, a–z and A–Z.',
    checklist: [
      'Estimated writes, reads and storage (about 694 and 6,900 a second; 21.9 TB over 10 years)',
      'Worked out the code length: 7 characters for 219 billion links',
      'Chose 301 or 302 and said why: less load, or every click counted',
      'Compared a hash with a collision check against base 62 of a unique ID',
      'Put a cache in front of the database for redirects',
      'Limited link creation per account against bulk scripts',
    ],
  },

  components: {
    users: {
      name: 'Users', sub: 'Shorten links, click them',
      desc: `People who shorten long links and people who click short ones. For every new link there are ${CLICKS_PER_LINK} clicks. A click asks for the long link behind a code, such as lnk.example/aZ3k9Qe, and gets a redirect.`,
    },
    dns: dns(),
    lb: lb(),
    web: {
      name: 'Link service', short: 'Shortens and redirects',
      desc: 'Your web servers: POST /api/v1/shorten makes a code for a long link; GET /{code} looks it up and answers with a redirect. An autoscaled group of L servers, as in Level 6.',
      noDbNote: NO_DB_NOTE,
      subOf: (n, size) => `${autoscaleSubOf(n, size)} · ${n.redirect === '301' ? '301' : '302'} · ${codeName[n.code] || 'base 62'}`,
      choices: [
        ...scalingChoices(),
        {
          key: 'redirect', label: 'Redirect',
          options: [
            { id: '301', name: '301 Moved Permanently', sub: 'the browser remembers it', note: 'The browser keeps the redirect, so a second click on the same link goes straight to the long link. Less load, but you never see those clicks.', log: 'Redirects set to 301: browsers remember them.' },
            { id: '302', name: '302 Found', sub: 'every click comes back', note: 'A temporary redirect: every click asks your servers again, so you can count each one (when, from where). More load.', log: 'Redirects set to 302: every click reaches the servers.' },
          ],
        },
        {
          key: 'code', label: 'Short code',
          options: [
            { id: 'base62', name: 'Base 62 of a unique ID', sub: 'next ID, no lookup', note: 'Each new link gets the next unique ID, written in base 62 (0–9, a–z, A–Z). No collisions, one insert. But codes follow each other, so anyone can guess the next one.', log: 'Short codes are now base 62 of a unique ID.' },
            { id: 'hash', name: 'Hash, check the database', sub: `first ${HASH_CHARS} characters`, note: `Hash the long link and keep ${HASH_CHARS} characters. Another link may already have them, so look the code up first and rehash on a collision: two queries for every new link.`, log: 'Short codes are now hashed, with a database check.' },
            { id: 'bloom', name: 'Hash, check a bloom filter', sub: 'memory answers most checks', note: 'A bloom filter in memory says "surely not used" for almost every new code; only its rare false positives (1% here) go to the database.', log: 'Short codes are now hashed, checked against a bloom filter.' },
          ],
        },
        {
          key: 'limit', label: 'New links per account',
          options: [
            { id: 'none', name: 'No limit', sub: 'any account, any rate', note: 'Anyone can create links as fast as they like.', log: 'New links are no longer limited.' },
            { id: 'account', name: 'Rate limited', sub: '10 a minute per account', note: 'Each account may create 10 links a minute, as in Level 10; more get 429 Too Many Requests.', log: 'New links limited to 10 a minute per account.' },
          ],
        },
      ],
    },
    db: { ...db(), desc: 'The table of links: id, code, long link. Every new link is a write; every click the cache misses is a read.' },
    cache: { ...linkCache, desc: 'Keeps code → long link in memory. A link never changes, so a cached copy never goes stale. In this game it handles 10,000 lookups/s.', choices: [linkCache.choices[0]] }, // TTL only: a link never changes
  },
  palette: ['dns', 'lb', 'web', 'db', 'cache'],
  limits: { dns: 1, lb: 1, web: 1, db: 1, cache: 1 },
  limitMsg: {
    dns: 'You only need one DNS service.',
    lb: 'One load balancer is enough in this level.',
    web: 'One autoscaled group of web servers is enough: it grows on its own.',
    db: 'One database is enough here: let the cache take the clicks.',
    cache: 'One cache is enough: pick its size in the inspector.',
  },
  // One data center: an autoscaled link service with 301 redirects and base 62 codes, and one database.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60 },
    { id: 'd', type: 'dns', x: 120, y: 60 },
    { id: 'l', type: 'lb', x: 380, y: 168, algo: 'rr' },
    { id: 'w', type: 'web', x: 380, y: 276, size: 'L', scaling: 'auto', redirect: '301', code: 'base62', limit: 'none' },
    { id: 'b', type: 'db', x: 380, y: 420, size: 'XL', kind: 'sql' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'u', to: 'l' },
    { id: 's3', from: 'l', to: 'w' }, { id: 's4', from: 'w', to: 'b' },
  ],
  slots: { dns: { x: 120, y: 60 }, lb: { x: 380, y: 168 }, web: { x: 380, y: 276 }, db: { x: 380, y: 420 }, cache: { x: 640, y: 348 } },

  connections: {
    ok: {
      'dns|users': dnsLookup(),
      'lb|users': usersToLb(),
      'lb|web': lbToWeb(),
      'db|web': webToDb(),
      'cache|web': { from: 'web', to: 'cache', label: 'lookups', desc: 'For each click the link service asks the cache for the code first. On a miss it reads the database, then stores the link in the cache.' },
    },
    bad: { ...lbBad(), ...replicaBad(), ...cacheBad() },
  },

  missions: [
    {
      title: 'Short links', ref: 'URL redirecting', qps: 2200, writes: WRITES, budget: BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 7, hi: 7,
        prompt: '<b>Estimate before you build.</b> The plan: 60 million new links a day, kept for 10 years, about 219 billion in all. Codes use 0–9, a–z and A–Z: 62 characters. How many characters does a code need?',
        label: 'Characters',
        placeholder: 'e.g. 5',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">60 million × 365 × 10 ≈ 219 billion links<br>62⁶ ≈ 56.8 billion: too few<br>62⁷ ≈ 3.5 trillion: enough, so 7 characters</div>',
        acceptedLog: 'Estimate accepted: 7 characters. Play is unlocked.',
        notNumber: 'Type the number of characters, for example 5.',
        hints: [
          { test: (v) => v === 6, text: '62⁶ ≈ 56.8 billion codes, fewer than 219 billion links.' },
          { test: (v) => v <= 5, text: 'Far too few: 62⁵ is under a billion codes.' },
          { test: (v) => v >= 8, text: 'That works, but shorter is the point: 62⁷ ≈ 3.5 trillion is already enough.' },
        ],
        fallback: 'Not quite. Find the smallest n with 62ⁿ above 219 billion.',
      },
      story: `A link service with 200 new links and 2,000 clicks a second. Redirects are 301, so a browser that has followed a link goes straight there next time: half the clicks never reach you. Keep it fast when a link goes viral: ${fmt(VIRAL)} more clicks a second, from people who have never clicked it.`,
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the code length' },
        servedGoal(targets), latGoal(targets), costGoal(BUDGET),
        { id: 'viral', type: 'exp', text: 'Break it: a link goes viral; still 99% served' },
      ],
      hint: 'Every click the browser can\'t answer becomes a database read. Add a cache: the viral link is one key, so after the first click every click on it is a hit.',
      takeaway: 'Clicks outnumber new links 10 to 1, and a few links get most clicks: a cache in front of the database answers them. A viral link is a single hot key, so the cache absorbs it entirely.',
    },
    {
      title: 'Count every click', ref: '301 vs 302', qps: 2200, writes: WRITES, budget: BUDGET,
      story: 'Marketing teams want to see how many people click their links, and when. With 301, a browser\'s second click never reaches you. Count every click, and stay up when a script starts creating links in bulk.',
      goals: [
        countGoal, servedGoal(targets), latGoal(targets), costGoal(BUDGET),
        { id: 'bulk', type: 'exp', text: 'Break it: one account creates links in bulk; still 99% served' },
      ],
      hint: 'Switch redirects to 302 so every click comes back. Then limit new links per account: one script shouldn\'t be able to fill the database.',
      takeaway: '302 trades load for data: every click reaches you and can be counted. A per-account limit turns the bulk script away with 429s before it reaches the database.',
    },
    {
      title: 'Private links', ref: 'Hash + collision resolution', qps: 2800, writes: 800 / 2800, budget: BUDGET,
      story: 'Partners now shorten every link in their emails, many of them private (a shared document, an invoice): 800 new links and 2,000 clicks a second. Codes in sequence let anyone try the next one, so codes must not be guessable. Keep it up when one of them goes viral.',
      goals: [
        privateGoal, countGoal, servedGoal(targets), latGoal(targets), costGoal(BUDGET),
        { id: 'viral', type: 'exp', text: 'Break it: a link goes viral; still 99% served' },
      ],
      hint: 'A hash doesn\'t follow a sequence, but checking each new code in the database doubles the queries for new links. Check a bloom filter in memory instead.',
      takeaway: 'Hashed codes can\'t be guessed from each other, and a bloom filter answers almost every collision check from memory, so a new link still costs about one query.',
    },
  ],

  // Break-it experiments. An event only checks its outcome; `viral` adds clicks on one link, `bulk` new links from one account.
  experiments: [
    {
      id: 'viral', kind: 'event', viral: VIRAL,
      label: 'A link goes viral', labelOn: 'Calm down',
      needsDesign: 'Build the design first: the link service needs its database.',
      on: `A link goes viral: ${fmt(VIRAL)} more clicks a second, all on one code, from people who have never clicked it.`, onTone: 'bad',
      off: 'The link calms down.',
      expect: served99,
      notMet: (m) => `Only ${m.servedPct.toFixed(1)}% served. Every click on the viral link that misses a cache is a database read. One link is one key: a cache answers it from memory.`,
      observed: (m) => `Observed: a link went viral, and ${m.servedPct.toFixed(1)}% of requests were still served.`,
    },
    {
      id: 'bulk', kind: 'event', bulk: BULK,
      label: 'A script creates links', labelOn: 'Stop the script',
      needsDesign: 'Build the design first: the link service needs its database.',
      on: `One account starts creating ${fmt(BULK)} links a second.`, onTone: 'bad',
      off: 'The script stops.',
      expect: served99,
      notMet: (m) => `Only ${m.servedPct.toFixed(1)}% served: ${fmt(m.link ? m.link.bots : 0)} new links a second from one account reach the database. Limit new links per account.`,
      observed: () => 'Observed: the script was turned away with 429s, and real users were served.',
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    levelComplete: levelComplete(14),
  },

  quiz: {
    passScore: 8,
    passText: passText(14, 'Web crawler'),
    failText,
    questions: [
      { q: 'Which redirect lets you count every click?', o: ['301 Moved Permanently', '302 Found', '200 OK with the page', '404 Not Found'], a: 1, e: 'With 302 the browser asks your servers on every click, so you can count each one. With 301 it keeps the redirect and skips you next time: less load, fewer counted clicks.', r: 'Should a redirect be 301 or 302?' },
      { q: 'Why does a 301 redirect lower the load?', o: ['It compresses the reply', 'It skips the load balancer', 'It is cached in the database', 'The browser remembers it'], a: 3, e: 'A permanent redirect is kept by the browser, so the next click on the same link goes straight to the long link without asking your servers.', r: 'Should a redirect be 301 or 302?' },
      { q: '62⁶ ≈ 56.8 billion. How many characters for 219 billion links?', o: ['6', '8', '7', '11'], a: 2, e: '62⁶ is too few; 62⁷ ≈ 3.5 trillion is enough. So 7 characters.', r: 'Scope it: how long must a short code be?' },
      { q: 'What is 20000 in base 62 (0–9, a–z, A–Z)?', o: ['20k', 'c5A', 'A5c', '5cA'], a: 3, e: '20000 = 5 × 62² + 12 × 62 + 36. Digit 5 is "5", 12 is "c" (a = 10), 36 is "A" (the first capital). So 5cA.', r: 'How to turn an ID into a short code' },
      { q: 'Even CRC32 gives 8 hex characters. How does hashing get a 7-character code?', o: ['Use the whole hash', 'Keep the first 7, recheck', 'Encrypt the long link', 'Switch to a shorter hash function'], a: 1, e: 'Keep the first 7 characters. Two links can then share a code, so look it up and, on a collision, append a fixed string and hash again until it is free.', r: 'How do you make codes nobody can guess?' },
      { q: 'What does a bloom filter answer?', o: ['Where a key is stored', 'The newest version of a key', 'How many times a key has been read in total', '"Surely not in the set" or "maybe"'], a: 3, e: 'A bloom filter is a small bit array in memory. "Not in the set" is always right; "maybe" can be a false positive, and only then do you check the database.', r: 'How do you make codes nobody can guess?' },
      { q: 'What is the downside of base 62 codes from a unique ID?', o: ['Codes can collide', 'Codes are too long', 'The next code is easy to guess', 'Each new link needs two database lookups first'], a: 2, e: 'IDs go up one by one, so codes do too: anyone can try the next code and find other people\'s links. They never collide and need no lookup, though.', r: 'How do you make codes nobody can guess?' },
      { q: 'A click\'s code is not in the cache or the database. What do you answer?', o: ['A 404: no such link', 'A random long link', 'A 301 to the home page', 'A 500 error'], a: 0, e: 'The code was never created (often a typo), so there is nothing to redirect to: answer 404 Not Found.', r: 'How does a click find its long link?' },
      { q: 'A link goes viral. Which part takes the extra clicks?', o: ['The database, which holds every link', 'The cache, since it\'s one key', 'The unique ID generator', 'The rate limiter'], a: 1, e: 'Every viral click asks for the same code. After the first miss the cache holds it, so all the others are hits and the database never sees them.', r: 'How does a click find its long link?' },
      { q: '219 billion links × 100 bytes each. About how much storage?', o: ['219 GB', '2.19 TB', '21.9 TB', '219 TB'], a: 2, e: '219 × 10⁹ × 100 bytes = 2.19 × 10¹³ bytes ≈ 21.9 TB. The 219 billion already covers the 10 years.', r: 'Scope it: how long must a short code be?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $ } = f;
    drawRedirect(f, $('figRedirect'));
    drawCodes(f, $('figCodes'));
    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
