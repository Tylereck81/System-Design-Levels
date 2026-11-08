// The level contract: what a level file holds, and what the engine hands its goals and experiments.
// Types only (JSDoc, checked by `npm run typecheck`); nothing here runs. A file opts in with `// @ts-check` and uses
// them as `/** @type {import('../js/types.js').Level} */`.

/**
 * A component on the canvas. Besides its place, it holds the player's setting for each of its type's choices,
 * by the choice's key (`ttl: '600'`, `role: 'replica'`, `count: '4'`).
 * @typedef {{ id: string, type: string, x: number, y: number } & { [setting: string]: string | number }} CanvasNode
 */

/** @typedef {{ id: string, from: string, to: string }} Edge */

/** @typedef {{ x: number, y: number }} Point */

/**
 * What the graph looks like, built by graph() (js/engine/model.js). Struct goals and crash targets read it.
 * "On the path" means reachable from Users.
 * @typedef {object} GraphView
 * @property {CanvasNode | undefined} users  the client component
 * @property {CanvasNode | null} dns   the DNS Users connect to, if any
 * @property {boolean} hasDNS
 * @property {CanvasNode[]} entry      the servers Users send pages to
 * @property {CanvasNode[]} cdn        the CDNs Users fetch files from
 * @property {boolean} needsDns        the level's palette has a DNS
 * @property {boolean} ready           there is an entry, and DNS when the level needs it
 * @property {number} cost             the design's monthly cost in dollars
 * @property {(type: string) => CanvasNode[]} onPath              the servers of a type on the path
 * @property {(type: string) => number} count                     how many of them
 * @property {(from: string, to: string) => boolean} everyReaches  every `from` on the path reaches a `to`
 * @property {(n: CanvasNode, to: string) => number} reached      how many `to` on the path `n` connects to directly
 * @property {(n: CanvasNode) => CanvasNode[]} next               what `n` connects to
 * @property {Map<string, number>} peak                           peak load of autoscaled groups, by node id
 * @property {Set<string>} monitored                              ids of the servers a monitor watches
 */

/**
 * One component's numbers in a model result (`m.node[id]`). Fields after `drop` are set only by the component types
 * that report them.
 * @typedef {object} NodeStat
 * @property {number} load          requests per second reaching it
 * @property {number} cap           what it can serve per second
 * @property {number} util          load / cap
 * @property {number} ms            its time per request
 * @property {number} mult          how much queueing slows it (1 when idle)
 * @property {number} [base]        its time per request when idle
 * @property {string} [unit]        what it counts ("requests", "lookups"…)
 * @property {number} [drop]        share of its load it fails (0–1)
 * @property {boolean} [down]       crashed by an experiment
 * @property {boolean} [standby]    a standby waiting to take over
 * @property {number} [hit]         cache hit share (0–1)
 * @property {number} [misses]      misses per second
 * @property {number} [fileMs]      time to send a file itself
 * @property {number} [jobMs]       time to process an upload itself
 * @property {number} [waitMs]      queue wait
 * @property {number} [backlog]     queued jobs
 * @property {boolean} [consumer]   a queue worker
 * @property {number} [files] @property {number} [pages] @property {number} [uploads]
 * @property {number} [copies] @property {number} [copied]
 * @property {boolean} [combined]   one database for pages and sessions
 * @property {boolean} [nosql]
 * @property {number} [sessionMiss]
 * @property {number} [shards]
 * @property {number} [bots] @property {number} [botPass] @property {number} [realPass] @property {number} [falseBlock]
 * @property {any} [limiter] @property {any} [kv] @property {any} [ids] @property {any} [crawl] @property {any} [notify]
 * @property {any} [feed] @property {any} [chat] @property {any} [typeahead] @property {any} [video] @property {any} [sync]
 *   a component type's own outcome; its shape is the matching outcome module's (js/engine/<topic>.js)
 */

/**
 * What model() (js/engine/model.js) returns for the current design and traffic. Metric goals and experiment checks
 * read it.
 * @typedef {object} ModelResult
 * @property {number} mission       index of the mission it was computed for
 * @property {number} qps           requests per second sent
 * @property {number} base          requests per second before experiments
 * @property {number} servedPct     share of requests served, 0–100
 * @property {number | null} latency  average response time in ms (null when nothing is served)
 * @property {number} cost          monthly cost in dollars
 * @property {number} spof          components whose failure stops the service
 * @property {Record<string, NodeStat>} node  by node id
 * @property {string | null} issue  the first problem found, as text for the player
 * @property {GraphView} g
 * @property {Set<string>} down     ids of crashed components
 * @property {{ id: string, type: string } | null} bottleneck  the busiest component that drops requests
 * @property {number | null} hitRate  cache hits / reads (0–1)
 * @property {number} staleSecs     @property {number} fileStaleSecs
 * @property {number | null} farFileMs  @property {number | null} farPageMs  @property {number | null} uploadMs
 * @property {number} lostPct       @property {number} noDataPct  @property {number} lagWrites
 * @property {Record<string, any>} queues  by queue id
 * @property {number} jobsIn  @property {number} jobsOut  @property {number} backlog
 * @property {{ queue: string, grow: number } | null} alert  a monitored queue that grows
 * @property {number} bots
 * @property {number | null} ringMoved  @property {number | null} ringSpread
 * @property {number | null} idDupPct  @property {number | null} idBits  @property {boolean | null} idNumeric
 * @property {boolean | null} idOrdered  @property {boolean | null} idSpof  @property {number | null} idMade
 * @property {number | null} keyQuota  @property {number} botThrough  @property {boolean} [limitShared]
 * @property {number | null} kvStalePct  @property {number | null} kvReadMs  @property {number | null} kvFailPct
 * @property {any} kvQuorum
 * @property {number | null} maxShardUtil  @property {number} shardCount
 * @property {any} [link] @property {any} [crawl] @property {any} [notify] @property {any} [feed] @property {any} [chat]
 * @property {any} [video] @property {any} [sync] @property {any} [typeahead]
 *   a workload's outcome (js/engine/workloads.js); its shape is the matching outcome module's
 */

/** Text for the player, fixed or worked out from a model result. @typedef {string | ((m: ModelResult) => string)} Text */

/**
 * A goal. `struct` reads the design (`test(g)`), `metric` the live result (`test(m)`); `exp` passes when the
 * experiment with the same id has passed, `gate` when the mission's estimate is accepted.
 * @typedef {StructGoal | MetricGoal | ExpGoal | GateGoal} Goal
 */
/** @typedef {{ id: string, type: 'struct', text: string, test: (g: GraphView) => boolean, val?: (m: ModelResult, g: GraphView) => string }} StructGoal */
/** @typedef {{ id: string, type: 'metric', text: string, test: (m: ModelResult) => boolean, val?: (m: ModelResult, g: GraphView) => string }} MetricGoal */
/** @typedef {{ id: string, type: 'exp', text: string }} ExpGoal */
/** @typedef {{ id: string, type: 'gate', text: string }} GateGoal */

/**
 * A number the player must estimate before the mission's traffic runs; accepted when it is within `lo`–`hi`.
 * @typedef {object} Gate
 * @property {number} lo @property {number} hi
 * @property {string} prompt @property {string} label @property {string} placeholder
 * @property {string} acceptedHtml @property {string} acceptedLog @property {string} notNumber
 * @property {{ test: (v: number) => boolean, text: string }[]} hints  the first hint whose test matches a wrong answer
 * @property {string} fallback      shown when no hint matches
 * @property {boolean} [hidesTraffic]  the traffic is not shown until the estimate is accepted
 */

/**
 * A mission. Fields after `gate` are the request mix of levels that have one.
 * @typedef {object} Mission
 * @property {string} title @property {string} ref @property {string} story
 * @property {number} qps           requests per second
 * @property {number | null} [budget]  monthly budget in dollars
 * @property {Goal[]} goals
 * @property {string} hint @property {string} takeaway
 * @property {Gate} [gate]
 * @property {number} [writes]      share of requests that write (0–1)
 * @property {number} [files]       static files per page
 * @property {number} [far]         share of users in the far region (0–1)
 * @property {boolean} [sessions]   pages need the user's session
 * @property {number} [uploads]     share of requests that upload (0–1)
 * @property {number} [hot]         share of requests for the hot key (0–1)
 * @property {number} [nonRel]      share of data that is not relational (0–1)
 * @property {{ keys: number, rate: number }} [bot]  bot keys, each sending `rate` requests per second
 */

/**
 * A Break-it experiment. `crash` takes down `target(g)` or `targets(g)`; `spike` multiplies traffic by `factor`;
 * `event` turns on the flags below (read by expFlag); `day` plays 24 hours in `secs` seconds.
 * @typedef {object} Experiment
 * @property {string} id
 * @property {'crash' | 'spike' | 'event' | 'day'} kind
 * @property {string} label @property {string} labelOn
 * @property {string} needsDesign   shown when the design cannot run it yet
 * @property {string | ((qps: number) => string)} on  logged when it starts (`qps` = the mission's qps × factor)
 * @property {string} [onTone] @property {string} off
 * @property {(m: ModelResult) => unknown} [expect]  holds while the design copes
 * @property {Text} [notMet] @property {Text} [observed] @property {Text} [issue]
 * @property {string | ((hour: number) => string)} [hud]
 * @property {(base: number) => string} [note]
 * @property {(g: GraphView) => CanvasNode | null | undefined} [target]
 * @property {(g: GraphView) => CanvasNode[]} [targets]
 * @property {number} [factor] @property {number} [uploadFactor] @property {number} [secs]
 * @property {boolean} [botEdge] @property {number} [resize] @property {boolean} [partition] @property {boolean} [clockBack]
 * @property {number} [viral] @property {number} [bulk] @property {boolean} [slowDns] @property {boolean} [flood]
 * @property {boolean} [trap] @property {boolean} [smsDown] @property {boolean} [blast] @property {boolean} [crash]
 * @property {boolean} [star] @property {boolean} [postSurge] @property {boolean} [serverDies] @property {boolean} [night]
 * @property {boolean} [tunnel] @property {boolean} [patchy] @property {boolean} [workerDies] @property {boolean} [growth]
 * @property {boolean} [pollDies]
 */

/**
 * One option of a component choice.
 * @typedef {{ id: string, name: string, sub?: string, short?: string, note?: string, log?: string } & Record<string, any>} ChoiceOption
 */
/** @typedef {{ key: string, label: string, options: ChoiceOption[] } & Record<string, any>} Choice */

/**
 * A component type's text and the player's choices for it (the catalog, js/engine/catalog.js, holds its numbers).
 * @typedef {object} ComponentText
 * @property {string} name @property {string} [short] @property {string} [sub] @property {string} [desc]
 * @property {Choice[]} [choices]
 * @property {Record<string, { name: string, lower?: string, desc?: string }>} [roles]
 * @property {(n: CanvasNode, size: any, st?: NodeStat) => string} [subOf]  the line under its name on the canvas
 * @property {(n: CanvasNode) => string} [nameOf]
 * @property {(size: any) => string} [sizeWhat]
 * @property {Record<string, string>} [live]
 * @property {Record<string, string> | null} [regions]
 * @property {any[]} [kinds] @property {any[]} [algos]
 * @property {string} [kindsLabel] @property {string} [algosLabel] @property {string} [sizeLabel]
 * @property {string} [noDbNote] @property {string} [unsetSub] @property {string} [unsetNote] @property {string} [standbySub]
 * @property {string} [standbyNote] @property {string} [promoteNote] @property {string} [downNote] @property {string} [statefulNote]
 */

/**
 * A quiz question: `o` the options, `a` the index of the right one, `e` why, `r` the lesson section it reviews.
 * @typedef {{ q: string, o: string[], a: number, e: string, r: string }} Question
 */

/**
 * A level file's default export.
 * @typedef {object} Level
 * @property {number | 'mock'} id
 * @property {string} saveKey       `sdl-levelN-v1`
 * @property {number} saveVersion   bumped when saved data no longer lines up
 * @property {number} [quizVersion] bumped when saved quiz answers no longer line up (defaults to saveVersion)
 * @property {Record<string, number>} [targets]
 * @property {Record<string, any>} [workload]  turns on a workload (workloads.js) and sets its inputs
 * @property {Record<string, ComponentText>} components  by component type
 * @property {string[]} palette     the types the player can add
 * @property {Record<string, number>} limits  how many of each type
 * @property {Record<string, string>} limitMsg  shown when a type is at its limit
 * @property {CanvasNode[]} startNodes @property {Edge[]} [startEdges]
 * @property {Record<string, Point | Point[]>} slots  where a new component of a type is placed: the first free spot
 * @property {{ ok: Record<string, { from: string, to: string, label: string, desc: string }>, bad: Record<string, string> }} connections
 *   allowed and refused links, keyed by the two types in alphabetical order (`'db|web'`)
 * @property {Mission[]} missions
 * @property {Experiment[]} experiments
 * @property {Record<string, string | ((...args: any[]) => string)>} text  the engine's messages, in the level's words
 * @property {{ passScore: number, passText: string, failText: string | ((pass: number) => string), questions: Question[] }} quiz
 * @property {string} lessonHtml
 * @property {(figures: Record<string, Function>) => void} [drawFigures]  draws the lesson's figures
 * @property {{ title: string, brief: string, checklist: string[] }} [mock]  the level as a mock interview problem
 * @property {{ problem: number, title: string, brief: string, checklist: string[] }} [interview]  set on a mock interview
 */

export {};
