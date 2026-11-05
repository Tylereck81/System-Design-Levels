// Level 9: Scale the data tier with sharding.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { servedGoal, latGoal, costGoal } from './shared/goals.js';
import level2 from './level-02.js';
import level3 from './level-03.js';
import level6 from './level-06.js';

const targets = { latencyMs: 150, servedPct: 99 };
const BUDGET = 2500;
const HOT_BUDGET = 3500;
const GROW_BUDGET = 3900;
const SHARD_MAX = 0.7;

const shardGoal = {
  id: 'shards', type: 'metric', text: `No database shard above ${Math.round(SHARD_MAX * 100)}% busy`,
  test: (m) => m.maxShardUtil != null && m.maxShardUtil < SHARD_MAX,
  val: (m) => (m.maxShardUtil == null ? '—' : Math.round(m.maxShardUtil * 100) + '%'),
};
const noSqlGoal = { id: 'nosql', type: 'struct', text: 'Plays and likes go to a NoSQL store', test: (g) => g.onPath('nosql').length > 0, val: () => '' };
const keyName = { account: 'account', country: 'country', date: 'sign-up date' };

export default {
  id: 9,
  saveKey: 'sdl-level9-v1',
  saveVersion: 1,
  targets,
  // The day's traffic curve, for the cost of the autoscaled web servers.
  workload: { day: level6.workload.day },

  components: {
    users: {
      name: 'Users', sub: 'Listen and upload',
      desc: 'Listeners and creators. Every page reads or writes account data: profiles, follows, plays and likes. 60% of the queries are writes.',
    },
    dns: level2.components.dns,
    lb: level2.components.lb,
    web: {
      name: 'Web server', short: 'Your back-end code',
      desc: 'Runs your back-end code: each page makes one database query. These are autoscaled groups of M servers, as in Level 6.',
      noDbNote: level2.components.web.noDbNote,
      subOf: level6.components.web.subOf,
      choices: level6.components.web.choices,
    },
    db: level3.components.db,
    shards: {
      name: 'Sharded database', short: 'Data split by a key',
      desc: 'Several database servers, each holding part of the data: the shards. Every shard has the same tables; a shard key decides which shard holds each row. The web servers work out the shard from the key on every query.',
      sizeLabel: 'Shard size (each shard)',
      subOf: (n) => `${n.count}${n.hot === 'own' ? '+3' : ''} × ${n.size} · ${keyName[n.key] || 'account'}`,
      choices: [
        {
          key: 'count', label: 'Shards (N in key % N)',
          options: [
            { id: '2', name: '2 shards', sub: 'key % 2', note: 'Two shards: each holds about half the data.', log: 'Sharded database set to 2 shards.' },
            { id: '3', name: '3 shards', sub: 'key % 3', note: 'Three shards: each holds about a third of the data.', log: 'Sharded database set to 3 shards.' },
            { id: '4', name: '4 shards', sub: 'key % 4', note: 'Four shards: each holds about a quarter of the data.', log: 'Sharded database set to 4 shards.' },
            { id: '8', name: '8 shards', sub: 'key % 8', note: 'Eight shards: each holds about an eighth of the data.', log: 'Sharded database set to 8 shards.' },
          ],
        },
        {
          key: 'key', label: 'Shard key',
          options: [
            { id: 'account', name: 'account_id % N', sub: 'spreads evenly', note: 'Millions of accounts, so the remainder spreads them, and their queries, evenly over the shards. Account 1006 goes to shard 1006 % 4 = 2.', log: 'Shard key set to account_id.' },
            { id: 'country', name: 'Listener country', sub: 'one country, one shard', note: 'Each country\'s accounts live on one shard. 42% of queries come from one country, and a country can\'t be split, so its shard is far busier than the others.', log: 'Shard key set to country.' },
            { id: 'date', name: 'Sign-up date ranges', sub: 'newest range is busiest', note: 'Each shard holds a range of sign-up dates. New accounts are the most active, so the newest range gets half of all queries.', log: 'Shard key set to sign-up date ranges.' },
          ],
        },
        {
          key: 'hot', label: 'Very popular accounts',
          options: [
            { id: 'stay', name: 'Where the key puts them', sub: 'no extra shards', note: 'Hot accounts stay on the shard their key gives them, with everyone else\'s data.', log: 'Popular accounts stay on their usual shard.' },
            { id: 'own', name: 'A shard for each', sub: '+3 shards', note: 'Each of the three hot accounts gets a shard of its own, the same size as the others. The web servers look these accounts up in a short list before using the key.', log: 'Each popular account now has its own shard.' },
          ],
        },
      ],
    },
    nosql: {
      name: 'NoSQL store', short: 'Plays and likes', sub: 'Managed · $200',
      desc: 'A key-value store for data that needs no joins: play counts and likes, read and written by key. It is easy to scale by adding machines. A managed service in this game: 20,000 lookups/s, 3 ms each, $200/month.',
    },
  },
  palette: ['dns', 'lb', 'web', 'db', 'shards', 'nosql'],
  limits: { dns: 1, lb: 1, web: 2, db: 2, shards: 1, nosql: 1 },
  limitMsg: {
    dns: 'You only need one DNS service.',
    lb: 'One load balancer is enough in this level.',
    web: 'Two autoscaled web server groups are enough: they grow on their own.',
    db: 'Two databases is the limit: a primary and a replica.',
    shards: 'One sharded database is enough: choose how many shards it has in the inspector.',
    nosql: 'One NoSQL store is enough.',
  },
  // Inside one data center: autoscaled web servers and Level 3's primary and replica.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60 },
    { id: 'd', type: 'dns', x: 120, y: 60 },
    { id: 'l', type: 'lb', x: 380, y: 168, algo: 'rr' },
    { id: 'w1', type: 'web', x: 250, y: 276, size: 'M', scaling: 'auto' },
    { id: 'w2', type: 'web', x: 510, y: 276, size: 'M', scaling: 'auto' },
    { id: 'b', type: 'db', x: 120, y: 440, size: 'XL', kind: 'sql', role: 'primary' },
    { id: 'r', type: 'db', x: 380, y: 440, size: 'XL', kind: 'sql', role: 'replica' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'u', to: 'l' },
    { id: 's3', from: 'l', to: 'w1' }, { id: 's4', from: 'l', to: 'w2' },
    { id: 's5', from: 'w1', to: 'b' }, { id: 's6', from: 'w2', to: 'b' }, { id: 's7', from: 'w1', to: 'r' }, { id: 's8', from: 'w2', to: 'r' },
  ],
  slots: {
    dns: { x: 120, y: 60 }, lb: { x: 380, y: 168 }, web: { x: 510, y: 276 },
    db: [{ x: 120, y: 440 }, { x: 380, y: 440 }],
    shards: [{ x: 640, y: 440 }, { x: 380, y: 440 }, { x: 120, y: 440 }],
    nosql: { x: 640, y: 168 },
  },

  connections: {
    ok: {
      'dns|users': level2.connections.ok['dns|users'],
      'lb|users': level2.connections.ok['lb|users'],
      'lb|web': level2.connections.ok['lb|web'],
      'db|web': level3.connections.ok['db|web'],
      'shards|web': { from: 'web', to: 'shards', label: 'queries', desc: 'For each query the web server works out the shard from the shard key, then queries only that shard (about 0.5 ms round trip).' },
      'nosql|web': { from: 'web', to: 'nosql', label: 'plays, likes', desc: 'Play counts and likes (40% of the queries) go to the NoSQL store, by key. The other queries still go to the database.' },
    },
    bad: {
      ...level2.connections.bad,
      'shards|users': 'Users reach the web servers through the load balancer. Connect the web servers to the sharded database.',
      'lb|shards': 'The load balancer sends requests to web servers. Connect the web servers to the sharded database.',
      'db|shards': 'The sharded database replaces the single primary; it doesn\'t sit behind it. Connect the web servers to it, and remove the old databases.',
      'nosql|users': 'Users reach the web servers through the load balancer. Connect the web servers to the NoSQL store.',
      'lb|nosql': 'The load balancer sends requests to web servers. Connect the web servers to the NoSQL store.',
      'db|nosql': 'The NoSQL store is a separate store the web servers query directly. Connect the web servers to it.',
      'nosql|shards': 'The NoSQL store is a separate store the web servers query directly. Connect the web servers to it.',
      'dns|shards': 'DNS answers name lookups for users. Connect the web servers to the sharded database.',
      'dns|nosql': 'DNS answers name lookups for users. Connect the web servers to the NoSQL store.',
    },
  },

  missions: [
    {
      title: 'Too many writes', ref: 'Sharding', qps: 3000, writes: 0.6, budget: BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 2.6, hi: 3,
        prompt: '<b>Estimate before you build.</b> At peak the database gets 3,000 queries a second. An XL database server takes 1,600 a second, and each shard should stay under 70% busy. How many XL shards do you need at least?',
        label: 'Shards',
        placeholder: 'e.g. 2',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">70% of 1,600 = 1,120 queries/s per shard<br>3,000 ÷ 1,120 ≈ 2.7, so 3 shards<br>That holds only if the key spreads queries evenly</div>',
        acceptedLog: 'Estimate accepted: 3 XL shards, if the key spreads queries evenly. Play is unlocked.',
        notNumber: 'Type the estimate as a number of shards, for example 2.',
        hints: [
          { test: (v) => v >= 1.8 && v <= 2, text: 'That runs every shard at 100% busy. Divide by 70% of 1,600: 1,120.' },
          { test: (v) => v === 4, text: 'Four works, but fewer do too. Divide 3,000 by 1,120 and round up.' },
        ],
        fallback: 'Not quite. Divide 3,000 queries a second by 1,120, the most one shard should take, and round up.',
      },
      story: '60% of the database\'s 3,000 queries a second are writes: plays, follows and likes. Every write goes to the one primary, which can take 1,600 a second, and a read replica can\'t take writes. Split the data over several database servers, and choose a shard key that keeps every shard under 70% busy.',
      goals: [{ id: 'est', type: 'gate', text: 'Estimate the shards you need' }, shardGoal, servedGoal(targets), latGoal(targets), costGoal(BUDGET)],
      hint: 'Add a sharded database, connect both web servers to it, and remove the primary and the replica. Pick account_id as the shard key: the other keys pile queries onto one shard. Three XL shards are enough.',
      takeaway: 'Each shard now takes a third of the writes. The shard key mattered as much as the number of shards: by country or by sign-up date, one shard got far more than its share.',
    },
    {
      title: 'Three famous creators', ref: 'Hotspots', qps: 3000, writes: 0.6, hot: 0.2, budget: HOT_BUDGET,
      story: 'Three creators with more than 50 million followers each joined, and their accounts all landed on the same shard. Their profiles and episode lists now take 20% of all queries, all on that one shard. Keep every shard under 70% busy.',
      goals: [shardGoal, servedGoal(targets), latGoal(targets), costGoal(HOT_BUDGET)],
      hint: 'More shards don\'t help: the three accounts still share one. Select the sharded database and give each very popular account a shard of its own.',
      takeaway: 'The hot accounts now have a shard each, and no shard is near its limit. Real systems sometimes split a single huge account further still.',
    },
    {
      title: 'Running out of room', ref: 'Resharding', qps: 4500, writes: 0.6, hot: 0.2, nonRel: 0.4, budget: GROW_BUDGET,
      story: 'Traffic grew to 4,500 queries a second. Plays and likes are 40% of them, and they need no joins: they are just counters read and written by key. Move them to a NoSQL store so the shards have room again, then see what adding a shard would have cost.',
      goals: [
        noSqlGoal, shardGoal, servedGoal(targets), latGoal(targets), costGoal(GROW_BUDGET),
        { id: 'reshard', type: 'exp', text: 'Break it: add one more shard and see how much data moves' },
      ],
      hint: 'Add a NoSQL store and connect both web servers to it. Then press "Add a shard" to see what resharding with % N would move.',
      takeaway: 'Moving the counters out took 40% of the load off the shards without moving a single row between them. Adding a shard with % N would have moved most of the data. A later level shows a way to add servers and move far less.',
    },
  ],

  // Break-it experiments. An event only checks its outcome.
  experiments: [
    {
      id: 'reshard', kind: 'event',
      label: 'Add a shard', labelOn: 'Done',
      needsDesign: 'Build the design first: shard the database, then add a shard.',
      on: 'Adding a shard: every account_id is placed again with the new N.', onTone: '',
      off: 'Back to the current shards.',
      expect: (m) => m.shardCount > 0,
      notMet: 'There is no sharded database yet. Add one, and connect the web servers to it.',
      observed: (m) => {
        const n = m.shardCount;
        return `Observed: going from ${n} to ${n + 1} shards, account_id % ${n + 1} puts ${Math.round(100 * n / (n + 1))}% of accounts on a different shard than % ${n}. All of that data must be copied while the site keeps running.`;
      },
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...level3.text,
    levelComplete: 'Level 9 complete. Take the quiz.',
  },

  quiz: {
    passScore: 8,
    passText: 'Level 9 is done, and with it the first part: scaling from one server to millions of users. Level 10, Rate limiter, is next: open it from the level menu at the top.',
    failText: (pass) => `You need ${pass} to pass. Reread the lesson sections behind the questions you missed, then try again.`,
    questions: [
      { q: 'Why not just keep buying a bigger database server?', o: ['Bigger servers cannot run SQL', 'They hit a size limit and cost far more', 'A bigger server adds network lag to every query', 'Replicas stop working on big servers'], a: 1, e: 'Vertical scaling hits a hardware limit, the biggest server you can buy, and powerful servers cost much more for each unit of capacity. One server is also a single point of failure.', r: 'Vertical scaling' },
      { q: 'What does a shard hold?', o: ['A full copy of all the data, kept for reads only', 'The indexes of every table', 'Part of the rows, in the same tables', 'Only the writes of the last hour'], a: 2, e: 'Each shard has the same schema but holds different rows: the ones its shard key maps to it. A full copy for reads is a replica.', r: 'Sharding' },
      { q: 'With account_id % 4, which shard holds account 1006?', o: ['Shard 0', 'Shard 1', 'Shard 2', 'Shard 6'], a: 2, e: '1006 ÷ 4 = 251, remainder 2, so shard 2.', r: 'Sharding' },
      { q: 'What makes a good shard key?', o: ['It spreads data and queries evenly', 'It is short to store', 'It changes often', 'It sorts rows by date, for fast range queries'], a: 0, e: 'The most important criterion is an even spread, so no shard gets more than its share. A key with few values, or one where new rows all land in one range, makes hotspots.', r: 'Choosing a shard key' },
      { q: 'You shard by country, and 42% of queries come from one country. What happens?', o: ['Queries spread evenly anyway', 'The database refuses the key', 'Each country is split evenly across all the shards', 'One shard is far busier than the rest'], a: 3, e: 'A country can\'t be split, so its shard takes 42% of the queries however many shards you add.', r: 'Choosing a shard key' },
      { q: 'Three huge accounts land on one shard and overload it. What is a common fix?', o: ['Give each of them a shard of its own', 'Add more shards and hope they move apart', 'Move every account to a NoSQL store', 'Put that shard behind the load balancer'], a: 0, e: 'Hot accounts can get dedicated shards, and a single very hot one may be split further. More shards with the same key don\'t guarantee the hot accounts move apart.', r: 'Sharding problems' },
      { q: 'You go from key % 4 to key % 5. About what share of the data moves?', o: ['20%', '50%', '80%', '100%'], a: 2, e: 'A key stays only where key % 4 equals key % 5: 4 of every 20 keys. The other 80% move. Consistent hashing reduces this.', r: 'Sharding problems' },
      { q: 'Why are joins hard after sharding?', o: ['SQL databases switch joins off once tables are sharded', 'The rows to join may be on different servers', 'Shards are read-only', 'Joins need a load balancer'], a: 1, e: 'Rows that belong together may live on different shards, and a join across servers is slow and complex. A common workaround is to denormalize, so a query reads one table.', r: 'Sharding problems' },
      { q: 'Which data is the best fit to move from the relational database to a NoSQL store?', o: ['Orders that must join to payments', 'Monthly reports that join every table in the database', 'Account settings joined to plans', 'Like counts read and written by key'], a: 3, e: 'Data that needs no joins and is accessed by key, such as counters, moves easily to a key-value store and takes load off the database.', r: 'Moving data to NoSQL' },
      { q: 'A database gets 6,000 queries/s. Each shard takes 2,000/s and should stay under 75% busy. How many shards, evenly loaded?', o: ['3', '5', '6', '4'], a: 3, e: '75% of 2,000 = 1,500 per shard. 6,000 ÷ 1,500 = 4 shards. Three would run every shard at 100%.', r: 'Numbers to carry into the interview' },
    ],
  },

  // Lesson tab content (HTML). The diagrams below draw into figShards and figData.
  lessonHtml: `
    <p class="label">Level 9 · Scale the data tier with sharding</p>
    <h1>Scale the data tier with sharding</h1>
    <p class="lede">Every write goes to one database server, and it is running out of room. In this level you split the data across several servers, choose the key that decides where each row goes, deal with a few accounts that are far more popular than the rest, and see what adding a server later costs.</p>
    <div class="goals-box">
      <div><b>You will learn</b>Sharding, shard keys, hotspots, resharding, and when to use NoSQL.</div>
      <div><b>You will decide</b>How many shards, which key, and where the busiest data lives.</div>
      <div><b>You will estimate</b>How many shards keep each one under its limit.</div>
    </div>

    <section>
      <h2>Vertical or horizontal</h2>
      <p class="src">Database scaling</p>
      <p>You can scale a database up by giving it more CPU, memory and disk. The biggest cloud database servers have terabytes of memory, and many large sites run for years on one primary. But scaling up has limits:</p>
      <ul>
        <li>There is a largest server. A big enough user base outgrows it.</li>
        <li>One server is a single point of failure.</li>
        <li>Powerful servers cost much more for each unit of capacity.</li>
      </ul>
      <p>Read replicas help with reads, but every write still goes to the one primary.</p>
    </section>

    <section>
      <h2>Sharding</h2>
      <p class="src">Horizontal partitioning</p>
      <p>Sharding scales a database out: it splits the data across several servers called <b>shards</b>. Every shard has the same tables, but holds different rows. The <b>shard key</b> (or partition key) decides which shard a row lives on, so each query goes straight to the right one.</p>
      <figure class="fig"><svg id="figShards" viewBox="0 0 660 230" role="img" aria-label="The web servers compute account_id % 4 for each query. Account 1006 goes to shard 2, account 1004 to shard 0."></svg><figcaption>account_id % 4 sends each account to one of four shards</figcaption></figure>
      <p>With <code>account_id % 4</code> as the hash function, the remainder picks the shard: account 1006 has remainder 2, so it lives on shard 2.</p>
    </section>

    <section>
      <h2>Choosing a shard key</h2>
      <p class="src">Shard keys</p>
      <p>The most important rule: choose a key that spreads data, and the queries for it, evenly. A key with few values, such as country, puts a whole country on one shard. A key where new rows land together, such as sign-up date in ranges, puts all the newest, busiest accounts on one shard.</p>
    </section>

    <section>
      <h2>Sharding problems</h2>
      <p class="src">Challenges</p>
      <ul>
        <li><b>Resharding.</b> When a shard is full, or some shards fill faster than others, you change the sharding function and move data. With <code>% N</code>, changing N moves most rows. Consistent hashing, in a later level, moves far fewer.</li>
        <li><b>Hotspots</b> (the celebrity problem). A few very popular accounts on one shard can overload it, here three creators with more than 50 million followers each. Give each one a shard of its own, and split one further if needed.</li>
        <li><b>Joins.</b> Rows that belong together may live on different shards, so joins across them are hard. A common workaround is to denormalize: store the data a query needs in one table.</li>
      </ul>
    </section>

    <section>
      <h2>Moving data to NoSQL</h2>
      <p class="src">Choosing stores</p>
      <figure class="fig"><svg id="figData" viewBox="0 0 660 200" role="img" aria-label="The web servers send account queries to the sharded database and play counts and likes to a NoSQL store."></svg><figcaption>Relational data in shards; counters by key in a NoSQL store</figcaption></figure>
      <p>Some data needs no joins at all: play counts and likes are read and written by key. Moving it to a NoSQL store takes that load off the relational database, and a NoSQL store is easy to scale out.</p>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>A sharded database is one box: choose its shard size, number of shards, key and what happens to very popular accounts. Each shard is a database server with its own share of the queries, and the box shows the busiest. With account_id the queries spread evenly; by country, 42% go to one shard; by sign-up date ranges, 50% go to the newest range. The three popular accounts take 20% of all queries and land on one shard, unless each gets its own. With a NoSQL store, 40% of the queries (plays and likes) go there instead.</p>
      <p class="assume">Game assumptions: each page makes one query. Shards cost the same as database servers of their size. The NoSQL store is a managed service: 20,000 lookups/s, 3 ms each, $200 a month, not a single point of failure. Shards have no replicas here, to keep the canvas readable; real shards usually have them.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Shard estimates</p>
      <p><b>Shards needed</b> = queries per second ÷ (what one shard takes × the highest share busy you allow), rounded up, for an even key. For example, 3,000 ÷ (1,600 × 70%) ≈ 2.7, so 3 shards.</p>
      <p><b>Data moved by resharding with % N</b>: going from N to N + 1 shards moves about N ÷ (N + 1) of the rows: 80% from 4 to 5.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>How many queries, how many writes? How big is the data?</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>Shards by a key, a NoSQL store for counters.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>The shard key, hotspots, joins and denormalization.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>Add a shard: how much data moves?</div>
      </div>
      <p>When you shard in an interview, name the key and say why it spreads evenly, how you handle hot keys, and how you will add shards later.</p>
    </section>
`,

  // Lesson diagrams. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs } = f;
    const f1 = $('figShards'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'web', 330, 40, 'Web servers', 'account_id % 4');
    figNode(f1, 'shards', 100, 190, 'Shard 0', '1004, 1008, …');
    figNode(f1, 'shards', 560, 190, 'Shard 2', '1006, 1010, …');
    figArrow(f1, 290, 70, 140, 158, 'account 1004', null, 200, 112, 'end');
    figArrow(f1, 370, 70, 520, 158, 'account 1006', null, 460, 112, 'start');
    const t = f.svgEl('text', { x: 330, y: 194, class: 'd-label', 'text-anchor': 'middle' }, f1); t.textContent = 'shards 1 and 3 …';

    const f2 = $('figData'); f2.textContent = ''; figDefs(f2);
    figNode(f2, 'web', 330, 40, 'Web servers', 'Each page');
    figNode(f2, 'shards', 120, 160, 'Sharded database', 'Accounts, follows');
    figNode(f2, 'nosql', 540, 160, 'NoSQL store', 'Plays and likes');
    figArrow(f2, 280, 70, 170, 128, '60% of queries', null, 212, 96, 'end');
    figArrow(f2, 380, 70, 490, 128, '40% of queries', null, 448, 96, 'start');
  },
};
