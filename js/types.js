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
 * A worked calculation: the formula in words, one operation per row, then the answer as a sentence.
 * A row is shown as "label | work | = result"; `approx` shows "≈" where the result is rounded.
 * Every `work` and `result` carries a unit.
 * @typedef {{ formula: string, rows: { label: string, work: string, result: string, approx?: boolean }[], result: string }} Calc
 */

/**
 * One block of a lesson step's body. Exactly one of these keys names its type; js/validate-lesson.js lists them.
 * Text may hold inline markup (`<b>`, `<code>`). `figure` names an svg the level's drawFigures draws; `calc` is
 * a worked calculation (`Calc`); `assume` states a rule of the game.
 * @typedef {{ p: string } | { ul: string[] } | { ol: string[] }
 *   | { table: { head: string[], rows: string[][], num?: boolean }, caption?: string }
 *   | { code: string, caption?: string }
 *   | { calc: Calc }
 *   | { figure: string, alt: string, caption: string }
 *   | { assume: string }} LessonBlock
 */

/**
 * One answer to a step's question; `right` marks the one right answer, `why` explains it.
 * @typedef {{ t: string, why: string, right?: boolean }} CheckOption
 */

/**
 * One step of a lesson: one idea, titled as a question.
 * @typedef {object} LessonStep
 * @property {string} title   a question
 * @property {string} hook    the problem the step answers
 * @property {{ kind: 'guess' | 'turn', q: string, options: CheckOption[] }} [check]
 *   `guess`: asked before the explanation; `turn`: practice after it
 * @property {LessonBlock[]} body
 * @property {string} takeaway  one sentence
 * @property {number[]} missions  indexes of the missions that use this step
 * @property {number[]} quiz      indexes of the quiz questions that review this step
 */

/**
 * A lesson as steps, all read before the missions, then a recap that hands over to them.
 * @typedef {object} StepLesson
 * @property {string} kicker @property {string} title
 * @property {string} promise   what the player will know by the end
 * @property {number} minutes   time to read it
 * @property {LessonStep[]} steps
 * @property {{ numbers: [string, string][], bridge: string[] }} recap
 *   numbers worth remembering (value, what it is); `bridge` has one line per mission, in mission order
 * @property {string} rules     the game's rules the lesson relies on, in one paragraph
 */

/**
 * One section of a part: one idea, titled as a question or "How to …".
 * @typedef {object} LessonSection
 * @property {string} title
 * @property {string} [hook]  the problem the section answers; a section may open with its body instead
 * @property {LessonBlock[]} body
 * @property {string} takeaway  one sentence: the section's "Remember" line
 * @property {number[]} quiz      indexes of the quiz questions that review this section
 */

/**
 * A "Check yourself" question, shown with the others of its part after the part's sections. Not saved or scored.
 * @typedef {{ q: string, options: CheckOption[] }} CheckQuestion
 */

/**
 * A "New part" card: a component the level's components describe (`type`), introduced before the mission that uses it.
 * The card shows the component's icon and name.
 * @typedef {{ type: string, what: string, does: string, game: string, aka?: string, before?: number }} NewPartCard
 *   `what`: what it is; `does`: what it does; `game`: what it costs or carries in the game; `aka`: the name written
 *   out ("Domain Name System"); `before`: the index of the section of its part it is shown before (the first, when
 *   left out)
 */

/**
 * One part of a one-page lesson: what one mission needs, then that mission's card.
 * @typedef {object} LessonPart
 * @property {string} title
 * @property {number} mission   index of its mission; part N is mission N
 * @property {number} minutes   time for the reading and the mission
 * @property {string} [lead]     one short paragraph under the part's title: where the story stands
 * @property {NewPartCard[]} [newParts]  each shown before the section its `before` names
 * @property {LessonSection[]} sections
 * @property {CheckQuestion[]} [checks]  0 to 2 "Check yourself" questions
 * @property {string[]} youWill  the mission card's list: what the player does or watches for
 * @property {{ saw: string, number: [string, string], next: string }} [debrief]
 *   the mission card once the mission is done: what the player saw, one number (value, what it is), and what breaks
 *   next; every part but the last has one (the wrap-up follows the last)
 */

/**
 * A lesson on one page: an intro, one part per mission, then a wrap-up. The level's time is the sum of its parts'
 * minutes. A part's state comes from mission progress, so it adds no saved data.
 * @typedef {object} PageLesson
 * @property {{ kicker: string, title: string, story: string, picture: string, alt: string, outcomes: string[] }} intro
 *   `picture` names an svg the level's drawFigures draws: the finished design
 * @property {Omit<LessonSection, 'quiz'> & { minutes: number }} [start]
 *   "Start here", before the first part: one section's text for what the whole course takes as known, and its time
 * @property {LessonPart[]} parts
 * @property {{ picture: string, alt: string, say: string[], numbers: [string, string][], broken: string, loop?: string }} wrap
 *   `say`: three things to say in an interview; `numbers`: values each taught in a section; `broken`: what is
 *   still broken, leading to the next level; `loop`: an optional closing paragraph
 * @property {string} rules     the game's rules the lesson relies on, in one paragraph
 */

/**
 * A lesson as data, in steps or on one page. Levels move from steps to one page one by one.
 * @typedef {StepLesson | PageLesson} Lesson
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
 * @property {Lesson} [lesson]     the lesson as data; a level has this or `lessonHtml`, never both
 * @property {string} [lessonHtml]  the lesson as one block of authored HTML
 * @property {(figures: Record<string, Function>) => void} [drawFigures]  draws the lesson's figures
 * @property {{ title: string, brief: string, checklist: string[] }} [mock]  the level as a mock interview problem
 * @property {{ problem: number, title: string, brief: string, checklist: string[] }} [interview]  set on a mock interview
 */

export {};
