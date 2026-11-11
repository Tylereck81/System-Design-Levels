// Checks a lesson written as steps (`Lesson` in types.js). Pure: it reads a level and returns its problems.
// The word limits are the rule: when a lesson cannot meet one, raise it with the owner; never loosen the check.

/** Blocks whose text counts towards a step's word limit. */
const PROSE = ['p', 'ul', 'ol', 'example', 'assume'];
/** Blocks a step may have one of; their text is not counted. */
const VISUAL = ['table', 'code', 'figure'];

export const LIMITS = {
  minSteps: 5, maxSteps: 8,
  promiseWords: 60, hookWords: 50, bodyWords: 120,
  minChecks: 3, minOptions: 2, maxOptions: 3,
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
  example: { test: (b) => isTextList(b.example) && isOptionalText(b.note), needs: 'a list of lines, and a note only if it is text' },
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

/** The text of a prose block, one string per line or item. */
function proseOf(block, type) {
  if (type === 'ul' || type === 'ol') return block[type];
  if (type === 'example') return [...block.example, block.note ?? ''];
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
  if (!(Array.isArray(numbers) && numbers.length > 0 && numbers.every((n) => Array.isArray(n) && n.length === 2 && n.every(isText)))) {
    problems.push('recap.numbers needs at least one [value, meaning] pair');
  }
  return problems;
}

/** Problems with a step's title, hook and takeaway. */
function textProblems(step) {
  const problems = [];
  if (!isText(step.title) || !step.title.trim().endsWith('?')) problems.push('the title must be a question ending in "?"');
  if (!isText(step.hook)) problems.push('needs a hook');
  else if (wordCount(step.hook) > LIMITS.hookWords) problems.push(`the hook has ${wordCount(step.hook)} words, more than ${LIMITS.hookWords}`);
  if (!isText(step.takeaway)) problems.push('needs a takeaway');
  else if (!isOneSentence(step.takeaway)) problems.push('the takeaway must be one sentence');
  return problems;
}

/** The block's type, or null when it has none or more than one. */
function blockType(block) {
  const types = isObject(block) ? BLOCK_TYPES.filter((t) => t in block) : [];
  return types.length === 1 ? types[0] : null;
}
const keysOf = (block) => (isObject(block) && Object.keys(block).join(', ')) || 'none';

/** Problems with a step's body. `drawn` holds the figure ids the level draws, or is null when they are unknown. */
function bodyProblems(body, drawn) {
  const blocks = Array.isArray(body) ? body : [], problems = [];
  if (!blocks.length) problems.push('needs a body');
  let words = 0, visuals = 0;
  for (const block of blocks) {
    const type = blockType(block);
    if (!type) {
      problems.push(`a body block needs exactly one type from ${BLOCK_TYPES.join(', ')}; it has keys ${keysOf(block)}`);
      continue;
    }
    if (!SHAPES[type].test(block)) { problems.push(`${type} block needs ${SHAPES[type].needs}`); continue; }
    if (PROSE.includes(type)) words += proseOf(block, type).reduce((n, line) => n + wordCount(line), 0);
    if (VISUAL.includes(type)) visuals++;
    if (type === 'figure' && drawn && !drawn.has(block.figure)) problems.push(`figure "${block.figure}" is not drawn by the level's drawFigures`);
  }
  if (words > LIMITS.bodyWords) problems.push(`the body has ${words} words, more than ${LIMITS.bodyWords}`);
  if (visuals > 1) problems.push(`has ${visuals} tables, code samples or figures; at most one`);
  return problems;
}

/** Problems with a step's check, if it has one. */
function checkProblems(check) {
  if (!check) return [];
  if (Array.isArray(check)) return ['has more than one check; at most one'];
  const options = Array.isArray(check.options) ? check.options.filter(isObject) : [], problems = [];
  if (check.kind !== 'guess' && check.kind !== 'turn') problems.push('the check kind must be guess or turn');
  if (!isText(check.q)) problems.push('the check needs a question');
  if (options.length < LIMITS.minOptions || options.length > LIMITS.maxOptions) problems.push(`the check needs ${LIMITS.minOptions} or ${LIMITS.maxOptions} options; it has ${options.length}`);
  const right = options.filter((o) => o.right === true).length;
  if (right !== 1) problems.push(`the check has ${right} right options, not exactly one`);
  if (!options.every((o) => isText(o.t))) problems.push('every check option needs its text');
  if (!options.every((o) => isText(o.why))) problems.push('every check option needs a why');
  return problems;
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

/** Problems with a level's step lesson. An empty list means the lesson is fine. */
export function validateLesson(level) {
  const lesson = level.lesson;
  const steps = Array.isArray(lesson.steps) ? lesson.steps : [];
  const missions = { count: level.missions?.length ?? 0, used: new Set() };
  const questions = { count: level.quiz?.questions?.length ?? 0, used: new Set() };
  const problems = lessonProblems(lesson, steps);

  // The level's drawFigures is run only when a step has a figure; if it fails, figure names cannot be checked.
  const figures = steps.some((s) => Array.isArray(s?.body) && s.body.some((b) => isObject(b) && 'figure' in b)) ? drawnFigures(level) : { ids: null, error: null };
  if (figures.error) problems.push(`drawFigures failed while listing its figures: ${figures.error.message}`);
  const drawn = figures.error ? null : figures.ids;
  steps.forEach((step, i) => {
    if (!isObject(step)) { problems.push(`step ${i + 1}: is not a step object`); return; }
    const stepProblems = [...textProblems(step), ...bodyProblems(step.body, drawn), ...checkProblems(step.check),
      ...indexProblems(step.missions, missions.count, 'mission', missions.used),
      ...indexProblems(step.quiz, questions.count, 'quiz question', questions.used)];
    problems.push(...stepProblems.map((p) => `step ${i + 1}: ${p}`));
  });
  return [...problems, ...coverageProblems(lesson, steps, missions, questions)];
}
