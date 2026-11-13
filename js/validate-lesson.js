// Checks a lesson written as steps or on one page (`StepLesson`, `PageLesson` in types.js). Pure: it reads a level
// and returns its problems. The word limits are the rule: when a lesson cannot meet one, raise it with the owner;
// never loosen the check.

/** Blocks whose text counts towards a step's word limit. */
const PROSE = ['p', 'ul', 'ol', 'calc', 'assume'];
/** Blocks a step may have one of; their text is not counted. */
const VISUAL = ['table', 'code', 'figure'];

export const LIMITS = {
  minSteps: 5, maxSteps: 8,
  promiseWords: 60, hookWords: 50, bodyWords: 120,
  minChecks: 3, minOptions: 2, maxOptions: 3,
  maxCalcRows: 4,
};

/**
 * The limits for a lesson on one page. A calculation's rows and the option counts are as in `LIMITS`. A part's words
 * are what the player reads before its mission card: its New part cards, its sections' hooks, prose and Remember
 * lines, and its questions with their options (an option's explanation shows only when it is pressed).
 * `firstPartWordsLevel1`: Level 1's first part may be longer, because it also explains the Build screen.
 */
export const PAGE_LIMITS = {
  storyWords: 50, minOutcomes: 3, maxOutcomes: 5, outcomeWords: 12, lastWords: 40,
  minSections: 1, maxSections: 4, partWords: 600, firstPartWordsLevel1: 700,
  sectionWords: 150, takeawayWords: 16,
  maxChecks: 2, minYouWill: 2, maxYouWill: 4,
  cardWhatWords: 25, cardDoesWords: 30, cardGameWords: 20,
  debriefWords: 60, sayLines: 3, sayWords: 20, maxWrapNumbers: 4,
};

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTextList = (v) => Array.isArray(v) && v.length > 0 && v.every(isText);
const isOptionalText = (v) => v === undefined || isText(v);
/** A table: a head, and at least one row with a cell for each heading. A cell may be empty, as the corner often is. */
const isTable = (t) => isObject(t) && Array.isArray(t.head) && t.head.length > 0 && t.head.every((c) => typeof c === 'string')
  && Array.isArray(t.rows) && t.rows.length > 0 && t.rows.every((r) => Array.isArray(r) && r.length === t.head.length && r.every((c) => typeof c === 'string'));

/**
 * What each body block type holds (`LessonBlock` in types.js). A block names its type by having exactly one of these
 * keys; `needs` is said to the author when a block of that type is not filled in.
 */
const SHAPES = {
  p: { test: (b) => isText(b.p), needs: 'text' },
  ul: { test: (b) => isTextList(b.ul), needs: 'a list of text items' },
  ol: { test: (b) => isTextList(b.ol), needs: 'a list of text items' },
  table: { test: (b) => isTable(b.table) && isOptionalText(b.caption), needs: 'a head and rows with a cell for each heading' },
  code: { test: (b) => isText(b.code) && isOptionalText(b.caption), needs: 'the code as text' },
  calc: { test: (b) => isObject(b.calc) && isText(b.calc.formula) && Array.isArray(b.calc.rows) && isText(b.calc.result), needs: 'a formula, a list of rows and a result sentence' },
  figure: { test: (b) => isText(b.figure) && isText(b.alt) && isText(b.caption), needs: 'an svg id, alt text and a caption' },
  assume: { test: (b) => isText(b.assume), needs: 'text' },
};
/** The body block types. */
export const BLOCK_TYPES = Object.keys(SHAPES);
/** Text without its inline markup: tags are removed, entities (`&nbsp;`) become spaces. */
const plain = (text) => String(text).replace(/<[^>]*>/g, '').replace(/&#?\w+;/g, ' ');
/** Words in a text, inline markup stripped. A symbol on its own ("→", "=", "÷") is not a word. */
export const wordCount = (text) => plain(text).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
/** One sentence: ends with . ! or ? and has no sentence end (a stop followed by a space) before that. */
const isOneSentence = (text) => {
  const s = plain(text).trim();
  return /[.!?]$/.test(s) && !/[.!?]\s/.test(s.slice(0, -1));
};

/** The text of a prose block that counts towards the word limit, one string per line or item. */
function proseOf(block, type) {
  if (type === 'ul' || type === 'ol') return block[type];
  if (type === 'calc') return [block.calc.formula, block.calc.result]; // its rows are a grid, like a table's cells
  return [block[type]];
}

/**
 * The svg ids the level's drawFigures draws into. It is run with stand-in helpers: `$` records the id it is asked
 * for, and every other helper, element and value is a stand-in that accepts any use and draws nothing. A loop over a
 * stand-in ends at once, so an id that only a loop or a branch not taken asks for is not found: give each figure a
 * fixed `$('id')` call.
 */
function drawnFigures(level) {
  const ids = new Set();
  /** @type {any} */
  const stub = new Proxy(function () {}, {
    get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : stub),
    apply: () => stub,
    set: () => true,
  });
  const helpers = new Proxy({}, { get: (_, name) => (name === '$' ? (id) => { ids.add(id); return stub; } : stub) });
  try { level.drawFigures?.(helpers); } catch (error) { return { ids, error }; }
  return { ids, error: null };
}

/** Problems with the lesson's own fields: kicker, title, promise, rules, minutes and the number of steps. */
function lessonProblems(lesson, steps) {
  const problems = [];
  for (const key of ['kicker', 'title', 'promise', 'rules']) if (!isText(lesson[key])) problems.push(`the lesson needs a ${key}`);
  if (!(Number.isFinite(lesson.minutes) && lesson.minutes > 0)) problems.push('the lesson needs its reading time in minutes');
  const promiseWords = wordCount(lesson.promise ?? '');
  if (promiseWords > LIMITS.promiseWords) problems.push(`the promise has ${promiseWords} words, more than ${LIMITS.promiseWords}`);
  if (steps.length < LIMITS.minSteps || steps.length > LIMITS.maxSteps) problems.push(`the lesson has ${steps.length} steps, not ${LIMITS.minSteps} to ${LIMITS.maxSteps}`);
  const numbers = lesson.recap?.numbers;
  if (!(Array.isArray(numbers) && numbers.length > 0 && numbers.every(isPair))) {
    problems.push('recap.numbers needs at least one [value, meaning] pair');
  }
  return problems;
}

/** A pair of texts: [value, what it is]. */
const isPair = (n) => Array.isArray(n) && n.length === 2 && n.every(isText);

/**
 * Problems with a step's or a section's title, hook and takeaway. `limits` gives the hook's word limit (a section's
 * hook is counted with its body instead) and, for a section, the takeaway's; `howTo` lets a title be "How to …".
 * @param {any} step @param {{ hookWords?: number, takeawayWords?: number, howTo?: boolean }} limits
 */
function textProblems(step, limits) {
  const problems = [];
  const title = isText(step.title) ? step.title.trim() : '';
  if (limits.howTo) {
    if (!title.endsWith('?') && !title.startsWith('How to ')) problems.push('the title must be a question ending in "?" or start with "How to "');
  } else if (!title.endsWith('?')) problems.push('the title must be a question ending in "?"');
  if (step.hook === undefined && limits.optionalHook) { /* a section may open with its body */ }
  else if (!isText(step.hook)) problems.push('needs a hook');
  else if (limits.hookWords && wordCount(step.hook) > limits.hookWords) problems.push(`the hook has ${wordCount(step.hook)} words, more than ${limits.hookWords}`);
  if (!isText(step.takeaway)) problems.push('needs a takeaway');
  else if (!isOneSentence(step.takeaway)) problems.push('the takeaway must be one sentence');
  else if (limits.takeawayWords && wordCount(step.takeaway) > limits.takeawayWords) problems.push(`the takeaway has ${wordCount(step.takeaway)} words, more than ${limits.takeawayWords}`);
  return problems;
}

/** A working or a result names what its numbers count: it has a word ("req/s", "servers"), a % or a $. */
const hasUnit = (text) => /[\p{L}%$]/u.test(plain(text));

/** Problems with a calculation's rows: how many there are, and each row's label, working and result. */
function calcProblems(calc) {
  const problems = [];
  if (calc.rows.length < 1 || calc.rows.length > LIMITS.maxCalcRows) problems.push(`the calculation has ${calc.rows.length} rows, not 1 to ${LIMITS.maxCalcRows}`);
  calc.rows.forEach((row, i) => {
    const missing = ['label', 'work', 'result'].filter((part) => !isText(row?.[part]));
    if (missing.length) { problems.push(`calculation row ${i + 1} needs its ${missing.join(' and ')}`); return; }
    for (const part of ['work', 'result']) if (!hasUnit(row[part])) problems.push(`calculation row ${i + 1}: the ${part} "${row[part]}" has no unit`);
  });
  return problems;
}

/** The block's type, or null when it has none or more than one. */
function blockType(block) {
  const types = isObject(block) ? BLOCK_TYPES.filter((t) => t in block) : [];
  return types.length === 1 ? types[0] : null;
}
const keysOf = (block) => (isObject(block) && Object.keys(block).join(', ')) || 'none';

/** The words of a body's prose blocks (the blocks that are not a table, code or a figure). */
function proseWords(body) {
  const blocks = Array.isArray(body) ? body : [];
  return blocks.reduce((n, block) => {
    const type = blockType(block);
    return type && PROSE.includes(type) && SHAPES[type].test(block) ? n + proseOf(block, type).reduce((m, line) => m + wordCount(line), 0) : n;
  }, 0);
}

/**
 * Problems with a step's or a section's body. `words` limits its prose: at most `max` words, together with `counted`
 * more words, and `what` names the text counted in messages (a section's hook is counted with its body). `drawn` holds
 * the figure ids the level draws, or is null when they are unknown.
 * @param {any} body @param {Set<string> | null} drawn @param {{ max: number, counted: number, what: string }} words
 */
function bodyProblems(body, drawn, { max, counted, what }) {
  const blocks = Array.isArray(body) ? body : [], problems = [];
  if (!blocks.length) problems.push('needs a body');
  let visuals = 0, calcs = 0;
  for (const block of blocks) {
    const type = blockType(block);
    if (!type) {
      problems.push(`a body block needs exactly one type from ${BLOCK_TYPES.join(', ')}; it has keys ${keysOf(block)}`);
      continue;
    }
    if (!SHAPES[type].test(block)) { problems.push(`${type} block needs ${SHAPES[type].needs}`); continue; }
    if (VISUAL.includes(type)) visuals++;
    if (type === 'calc') { calcs++; problems.push(...calcProblems(block.calc)); }
    if (type === 'figure' && drawn && !drawn.has(block.figure)) problems.push(`figure "${block.figure}" is not drawn by the level's drawFigures`);
  }
  const words = proseWords(blocks) + counted;
  if (words > max) problems.push(`${what} has ${words} words, more than ${max}`);
  if (visuals > 1) problems.push(`has ${visuals} tables, code samples or figures; at most one`);
  if (calcs > 1) problems.push(`has ${calcs} calculations; at most one`);
  return problems;
}

/** Problems with a question's text and options: 2 or 3 options, exactly one right, each with its text and a why. */
function questionProblems(check) {
  const options = Array.isArray(check.options) ? check.options.filter(isObject) : [], problems = [];
  if (!isText(check.q)) problems.push('the check needs a question');
  if (options.length < LIMITS.minOptions || options.length > LIMITS.maxOptions) problems.push(`the check needs ${LIMITS.minOptions} or ${LIMITS.maxOptions} options; it has ${options.length}`);
  const right = options.filter((o) => o.right === true).length;
  if (right !== 1) problems.push(`the check has ${right} right options, not exactly one`);
  if (!options.every((o) => isText(o.t))) problems.push('every check option needs its text');
  if (!options.every((o) => isText(o.why))) problems.push('every check option needs a why');
  return problems;
}

/** Problems with a step's check, if it has one. */
function checkProblems(check) {
  if (!check) return [];
  if (Array.isArray(check)) return ['has more than one check; at most one'];
  const problems = [];
  if (check.kind !== 'guess' && check.kind !== 'turn') problems.push('the check kind must be guess or turn');
  return [...problems, ...questionProblems(check)];
}

/** Problems with a step's mission or quiz indexes (`what` says which); each index that exists is added to `used`. */
function indexProblems(list, count, what, used) {
  if (!Array.isArray(list)) return [`needs a ${what} list (it may be empty)`];
  const problems = [];
  for (const n of list) {
    if (Number.isInteger(n) && n >= 0 && n < count) used.add(n);
    else problems.push(`${what} index ${n} does not exist`);
  }
  return problems;
}

/** Indexes from 0 to count − 1 that are not in `used`. */
const unused = (count, used) => Array.from({ length: count }, (_, n) => n).filter((n) => !used.has(n));

/** Problems with what the steps cover together: the number of checks, every mission and question, the recap bridge. */
function coverageProblems(lesson, steps, missions, questions) {
  const problems = [];
  const checks = steps.filter((s) => isObject(s?.check)).length;
  if (checks < LIMITS.minChecks) problems.push(`the lesson has ${checks} checks, fewer than ${LIMITS.minChecks}`);
  for (const n of unused(missions.count, missions.used)) problems.push(`mission index ${n} is in no step's missions`);
  for (const n of unused(questions.count, questions.used)) problems.push(`quiz question index ${n} is in no step's quiz`);
  const bridge = lesson.recap?.bridge;
  if (!Array.isArray(bridge) || bridge.length !== missions.count) problems.push(`recap.bridge needs one line per mission (${missions.count}); it has ${Array.isArray(bridge) ? bridge.length : 'none'}`);
  return problems;
}

/**
 * The figure ids the level draws, found only when `needed`; null when they are unknown (not needed, or drawFigures
 * failed, which `problems` then says).
 */
function figureIds(level, needed, problems) {
  if (!needed) return null;
  const figures = drawnFigures(level);
  if (figures.error) problems.push(`drawFigures failed while listing its figures: ${figures.error.message}`);
  return figures.error ? null : figures.ids;
}
const hasFigure = (body) => Array.isArray(body) && body.some((b) => isObject(b) && 'figure' in b);
const prefixed = (where, problems) => problems.map((p) => `${where}: ${p}`);

/** Problems with a lesson written as steps. */
function stepLessonProblems(level) {
  const lesson = level.lesson;
  const steps = Array.isArray(lesson.steps) ? lesson.steps : [];
  const missions = { count: level.missions?.length ?? 0, used: new Set() };
  const questions = { count: level.quiz?.questions?.length ?? 0, used: new Set() };
  const problems = lessonProblems(lesson, steps);

  // The level's drawFigures is run only when a step has a figure; if it fails, figure names cannot be checked.
  const drawn = figureIds(level, steps.some((s) => hasFigure(s?.body)), problems);
  steps.forEach((step, i) => {
    if (!isObject(step)) { problems.push(`step ${i + 1}: is not a step object`); return; }
    problems.push(...prefixed(`step ${i + 1}`, [...textProblems(step, LIMITS), ...bodyProblems(step.body, drawn, { max: LIMITS.bodyWords, counted: 0, what: 'the body' }),
      ...checkProblems(step.check),
      ...indexProblems(step.missions, missions.count, 'mission', missions.used),
      ...indexProblems(step.quiz, questions.count, 'quiz question', questions.used)]));
  });
  return [...problems, ...coverageProblems(lesson, steps, missions, questions)];
}

/** Problems with a picture: it names a figure the level draws (unknown when `drawn` is null), with alt text. */
function pictureProblems(part, drawn) {
  const problems = [];
  if (!isText(part.picture)) problems.push('needs a picture');
  else if (drawn && !drawn.has(part.picture)) problems.push(`figure "${part.picture}" is not drawn by the level's drawFigures`);
  if (!isText(part.alt)) problems.push('needs alt text for its picture');
  return problems;
}

/** Problems with a text that must be there and stay within `max` words. */
function wordsProblems(text, what, max) {
  if (!isText(text)) return [`needs ${what}`];
  const n = wordCount(text);
  return n > max ? [`${what} has ${n} words, more than ${max}`] : [];
}

/** Problems with the intro: kicker, title, a short story, the picture, and 3 to 5 short outcomes. */
function introProblems(intro, drawn) {
  if (!isObject(intro)) return ['the lesson needs an intro'];
  const L = PAGE_LIMITS, problems = [];
  for (const key of ['kicker', 'title']) if (!isText(intro[key])) problems.push(`needs a ${key}`);
  problems.push(...wordsProblems(intro.story, 'the story', L.storyWords), ...pictureProblems(intro, drawn));
  const outcomes = intro.outcomes;
  if (!Array.isArray(outcomes) || outcomes.length < L.minOutcomes || outcomes.length > L.maxOutcomes) {
    problems.push(`needs ${L.minOutcomes} to ${L.maxOutcomes} outcomes; it has ${Array.isArray(outcomes) ? outcomes.length : 'none'}`);
  } else outcomes.forEach((o, i) => problems.push(...wordsProblems(o, `outcome ${i + 1}`, L.outcomeWords)));
  return prefixed('intro', problems);
}

/** Problems with a section's own text: its title, its hook when it has one, its body and its Remember line. */
function sectionTextProblems(section, drawn) {
  const L = PAGE_LIMITS, hook = isText(section.hook) ? wordCount(section.hook) : 0;
  return [...textProblems(section, { takeawayWords: L.takeawayWords, howTo: true, optionalHook: true }),
    ...bodyProblems(section.body, drawn, { max: L.sectionWords, counted: hook, what: 'the hook and body' })];
}

/** Problems with one section. Quiz question indexes it names are added to `questions.used`. */
function sectionProblems(section, drawn, questions) {
  if (!isObject(section)) return ['is not a section object'];
  const problems = sectionTextProblems(section, drawn);
  for (const old of ['check', 'uses', 'missions']) if (old in section) problems.push(`has ${old}, which a section does not take; remove it`);
  return [...problems, ...indexProblems(section.quiz, questions.count, 'quiz question', questions.used)];
}

/**
 * Problems with "Start here", the block before the first part: its time, and one section's text. It prepares no quiz
 * question, so it takes no `quiz`.
 */
function startProblems(start, drawn) {
  if (start === undefined) return [];
  if (!isObject(start)) return ['start: is not an object'];
  const problems = sectionTextProblems(start, drawn);
  if (!(Number.isFinite(start.minutes) && start.minutes > 0)) problems.push('needs its time in minutes');
  if ('quiz' in start) problems.push('has quiz, which Start here does not take; remove it');
  return prefixed('start', problems);
}

/**
 * Problems with "Last time", the line before the first part on every level after the first: what the level before
 * left broken. A lesson opens with Start here or with Last time, never both.
 */
function lastProblems(lesson) {
  if (lesson.last === undefined) return [];
  const problems = wordsProblems(lesson.last, 'Last time', PAGE_LIMITS.lastWords);
  if (lesson.start !== undefined) problems.push('a lesson has Start here or Last time, not both');
  return prefixed('last', problems);
}

/**
 * Problems with a part's New part cards: each names a component of the level, with three short lines, and `before`,
 * when it is there, is the index of one of the part's `sections` (there are `sectionCount`).
 */
function cardProblems(cards, components, sectionCount) {
  if (cards === undefined) return [];
  if (!Array.isArray(cards)) return ['newParts must be a list of cards'];
  const L = PAGE_LIMITS, problems = [];
  cards.forEach((card, i) => {
    const where = `New part card ${i + 1}`;
    if (!isObject(card)) { problems.push(`${where}: is not a card object`); return; }
    if (!isText(card.type) || !isObject(components?.[card.type])) problems.push(`${where}: "${card.type}" is not one of the level's components`);
    if (!isOptionalText(card.aka)) problems.push(`${where}: aka must be text when it is there`);
    if (card.before !== undefined && !(Number.isInteger(card.before) && card.before >= 0 && card.before < sectionCount)) problems.push(`${where}: before must be the index of a section of its part; it is ${card.before}`);
    problems.push(...prefixed(where, [...wordsProblems(card.what, 'what it is', L.cardWhatWords),
      ...wordsProblems(card.does, 'what it does', L.cardDoesWords), ...wordsProblems(card.game, 'in the game', L.cardGameWords)]));
  });
  return problems;
}

/** Problems with a part's "Check yourself" questions: 0 to 2, each without a kind (there is only one kind). */
function checksProblems(checks) {
  if (checks === undefined) return [];
  if (!Array.isArray(checks)) return ['checks must be a list of questions'];
  const problems = [];
  if (checks.length > PAGE_LIMITS.maxChecks) problems.push(`has ${checks.length} Check yourself questions, more than ${PAGE_LIMITS.maxChecks}`);
  checks.forEach((check, i) => {
    if (!isObject(check)) { problems.push(`question ${i + 1}: is not a question object`); return; }
    const own = questionProblems(check);
    if ('kind' in check) own.push('a Check yourself question has no kind; remove it');
    problems.push(...prefixed(`question ${i + 1}`, own));
  });
  return problems;
}

/** Problems with the mission card's "You will" list: 2 to 4 lines of text. */
function youWillProblems(list) {
  const L = PAGE_LIMITS;
  if (!Array.isArray(list) || list.length < L.minYouWill || list.length > L.maxYouWill) {
    return [`needs ${L.minYouWill} to ${L.maxYouWill} lines in its "You will" list; it has ${Array.isArray(list) ? list.length : 'none'}`];
  }
  return list.every(isText) ? [] : ['every line of its "You will" list needs text'];
}

/** Problems with a debrief: what the player saw, one number, what breaks next, in at most 60 words together. */
function debriefProblems(debrief) {
  if (!isObject(debrief)) return ['needs a debrief'];
  const problems = [];
  if (!isText(debrief.saw)) problems.push('the debrief needs what the player saw');
  if (!isPair(debrief.number)) problems.push('the debrief needs one number as [value, meaning]');
  if (!isText(debrief.next)) problems.push('the debrief needs what breaks next');
  const words = [debrief.saw, debrief.next, ...(isPair(debrief.number) ? debrief.number : [])].reduce((n, t) => n + (isText(t) ? wordCount(t) : 0), 0);
  if (words > PAGE_LIMITS.debriefWords) problems.push(`the debrief has ${words} words, more than ${PAGE_LIMITS.debriefWords}`);
  return problems;
}

/** The words a part shows before its mission card (see `PAGE_LIMITS`). */
function partWords(part) {
  const list = (v) => (Array.isArray(v) ? v.filter(isObject) : []);
  const words = (t) => (isText(t) ? wordCount(t) : 0);
  const cards = list(part.newParts).reduce((n, c) => n + words(c.what) + words(c.does) + words(c.game), 0);
  const sections = list(part.sections).reduce((n, s) => n + words(s.hook) + proseWords(s.body) + words(s.takeaway), 0);
  const checks = list(part.checks).reduce((n, c) => n + words(c.q) + list(c.options).reduce((m, o) => m + words(o.t), 0), 0);
  return words(part.lead) + cards + sections + checks;
}

/**
 * Problems with part `i` of `count`: its title, mission, minutes, New part cards, 1 to 4 sections, its words, its
 * questions, the "You will" list, and a debrief unless it is the last part (the wrap-up follows that one).
 */
function partProblems(part, i, count, { levelId, drawn, questions, components }) {
  if (!isObject(part)) return [`part ${i + 1}: is not a part object`];
  const L = PAGE_LIMITS, problems = [];
  if (!isText(part.title)) problems.push('needs a title');
  if (!isOptionalText(part.lead)) problems.push('lead must be text when it is there');
  if (part.mission !== i) problems.push(`its mission must be ${i}, as parts follow the missions in order; it is ${part.mission}`);
  if (!(Number.isFinite(part.minutes) && part.minutes > 0)) problems.push('needs its time in minutes');
  const sections = Array.isArray(part.sections) ? part.sections : [];
  if (sections.length < L.minSections || sections.length > L.maxSections) problems.push(`has ${sections.length} sections, not ${L.minSections} to ${L.maxSections}`);
  const maxWords = levelId === 1 && i === 0 ? L.firstPartWordsLevel1 : L.partWords, words = partWords(part);
  if (words > maxWords) problems.push(`has ${words} words before its mission card, more than ${maxWords}`);
  problems.push(...cardProblems(part.newParts, components, sections.length), ...checksProblems(part.checks), ...youWillProblems(part.youWill));
  if (i < count - 1 || part.debrief !== undefined) problems.push(...debriefProblems(part.debrief));
  return [...prefixed(`part ${i + 1}`, problems),
    ...sections.flatMap((s, n) => prefixed(`part ${i + 1} section ${n + 1}`, sectionProblems(s, drawn, questions)))];
}

/** Text with markup removed and runs of spaces made one, to look a number up in. */
const flat = (text) => plain(text).replace(/\s+/g, ' ').trim();

/**
 * Problems with the wrap-up: the picture, exactly 3 short things to say, at most 4 numbers each found in the text of
 * a section (`sectionText`), what is still broken, and an optional closing paragraph.
 */
function wrapProblems(wrap, drawn, sectionText) {
  if (!isObject(wrap)) return ['the lesson needs a wrap'];
  const L = PAGE_LIMITS, problems = pictureProblems(wrap, drawn);
  if (!Array.isArray(wrap.say) || wrap.say.length !== L.sayLines) {
    problems.push(`needs exactly ${L.sayLines} things to say; it has ${Array.isArray(wrap.say) ? wrap.say.length : 'none'}`);
  } else wrap.say.forEach((s, i) => problems.push(...wordsProblems(s, `thing to say ${i + 1}`, L.sayWords)));
  const numbers = wrap.numbers;
  if (!Array.isArray(numbers) || !numbers.every(isPair)) problems.push('numbers needs a list of [value, meaning] pairs');
  else {
    if (numbers.length > L.maxWrapNumbers) problems.push(`has ${numbers.length} numbers, more than ${L.maxWrapNumbers}`);
    for (const [value] of numbers) if (!sectionText.includes(flat(value))) problems.push(`the number "${value}" is in no section of this level`);
  }
  if (!isText(wrap.broken)) problems.push('needs the line on what is still broken');
  if (!isOptionalText(wrap.loop)) problems.push('loop must be text when it is there');
  return prefixed('wrap', problems);
}

/** Problems with a lesson written on one page. */
function pageLessonProblems(level) {
  const lesson = level.lesson;
  const parts = Array.isArray(lesson.parts) ? lesson.parts : [];
  const missions = level.missions?.length ?? 0;
  const questions = { count: level.quiz?.questions?.length ?? 0, used: new Set() };
  const sections = parts.flatMap((p) => (Array.isArray(p?.sections) ? p.sections : []));
  const problems = [];
  if (lesson.rules !== undefined) problems.push('a lesson on one page has no rules');
  if (parts.length !== missions) problems.push(`the lesson has ${parts.length} parts; it needs one per mission (${missions})`);

  // The intro and the wrap-up each name a picture, so the level's drawFigures is always run.
  const drawn = figureIds(level, true, problems);
  problems.push(...introProblems(lesson.intro, drawn), ...startProblems(lesson.start, drawn), ...lastProblems(lesson));
  const context = { levelId: level.id, drawn, questions, components: level.components };
  parts.forEach((part, i) => problems.push(...partProblems(part, i, parts.length, context)));
  problems.push(...wrapProblems(lesson.wrap, drawn, flat(sections.flatMap((s) => textsIn(s)).join(' '))));
  for (const n of unused(questions.count, questions.used)) problems.push(`quiz question index ${n} is in no section's quiz`);
  return problems;
}

/**
 * Problems across the course: every component needs a New part card in the first level that has it. A level whose
 * lesson is not on one page yet is skipped, but its components still count as seen by the levels after it. (A mission
 * does not say which components it uses, so the card's part is not checked against the mission.)
 * @param {{ id: number | string, components: Record<string, any>, lesson?: any }[]} levels  in course order
 */
export function newPartProblems(levels) {
  const seen = new Set(), problems = [];
  for (const level of levels) {
    const parts = Array.isArray(level.lesson?.parts) ? level.lesson.parts : null;
    const carded = new Set((parts ?? []).flatMap((p) => (Array.isArray(p?.newParts) ? p.newParts : [])).map((c) => c?.type));
    for (const type of Object.keys(level.components ?? {})) {
      if (parts && !seen.has(type) && !carded.has(type)) problems.push(`Level ${level.id}: "${type}" first appears in this level and has no New part card`);
      seen.add(type);
    }
  }
  return problems;
}

/**
 * Problems with a level's lesson, in steps or on one page. An empty list means the lesson is fine. Until every level
 * is on one page, a level may use either shape, but not both.
 */
export function validateLesson(level) {
  const lesson = level.lesson;
  if (!isObject(lesson)) return ['the lesson must be an object'];
  if (!('parts' in lesson)) return stepLessonProblems(level);
  return 'steps' in lesson ? ['the lesson has both steps and parts; it needs one or the other'] : pageLessonProblems(level);
}

/** Every piece of text under `value`, except code samples (shown as written) and figure ids. */
function textsIn(value, key) {
  if (typeof value === 'string') return key === 'code' || key === 'figure' ? [] : [value];
  if (Array.isArray(value)) return value.flatMap((v) => textsIn(v, key));
  return isObject(value) ? Object.entries(value).flatMap(([k, v]) => textsIn(v, k)) : [];
}

/** Whole numbers of a million or more written in digits ("1,200,000"); digits after a decimal point do not count. */
const bigNumbers = (text) => (plain(text).match(/\d(?:[\d,]*\d)?(?:\.\d+)?/g) ?? []).filter((n) => n.split('.')[0].replaceAll(',', '').length >= 7);

/** The parts of a lesson with the words that name where each is: [where, part]. */
function placesIn(lesson) {
  const list = (v) => (Array.isArray(v) ? v : []);
  if (!('parts' in lesson)) {
    const { steps, ...rest } = lesson;
    return [['', rest], ...list(steps).map((step, i) => [`step ${i + 1}: `, step])];
  }
  const { parts, ...rest } = lesson;
  return [['', rest], ...list(parts).flatMap((part, p) => {
    const { sections, ...own } = isObject(part) ? part : {};
    return [[`part ${p + 1}: `, own], ...list(sections).map((s, n) => [`part ${p + 1} section ${n + 1}: `, s])];
  })];
}

/**
 * Advice on a level's lesson that is not a problem: a number of a million or more is easier to read with the
 * word ("40 million", "1.2 billion"). An id or a similar long number may stay as it is, so this never fails a level.
 */
export function lessonWarnings(level) {
  return placesIn(level.lesson).flatMap(([where, value]) => textsIn(value).flatMap(bigNumbers)
    .map((n) => `${where}${n} is written in digits; use the word ("40 million", "1.2 billion")`));
}
