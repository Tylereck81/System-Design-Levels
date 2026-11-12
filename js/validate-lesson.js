// Checks a lesson written as steps or as chapters (`StepLesson`, `ChapterLesson` in types.js). Pure: it reads a level
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

/** The limits for a lesson in chapters. A calculation's rows and the option counts are as in `LIMITS`. */
export const CHAPTER_LIMITS = {
  storyWords: 50, minOutcomes: 3, maxOutcomes: 5, outcomeWords: 12,
  minScreens: 1, maxScreens: 3, maxLevelScreens: 8,
  hookWords: 40, bodyWords: 90, takeawayWords: 16,
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
 * Problems with a step's or a screen's title, hook and takeaway. `limits` gives the hook's word limit and, for a
 * screen, the takeaway's.
 * @param {any} step @param {{ hookWords: number, takeawayWords?: number }} limits
 */
function textProblems(step, limits) {
  const problems = [];
  if (!isText(step.title) || !step.title.trim().endsWith('?')) problems.push('the title must be a question ending in "?"');
  if (!isText(step.hook)) problems.push('needs a hook');
  else if (wordCount(step.hook) > limits.hookWords) problems.push(`the hook has ${wordCount(step.hook)} words, more than ${limits.hookWords}`);
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

/**
 * Problems with a step's or a screen's body, of at most `maxWords` words. `drawn` holds the figure ids the level
 * draws, or is null when they are unknown.
 */
function bodyProblems(body, drawn, maxWords) {
  const blocks = Array.isArray(body) ? body : [], problems = [];
  if (!blocks.length) problems.push('needs a body');
  let words = 0, visuals = 0, calcs = 0;
  for (const block of blocks) {
    const type = blockType(block);
    if (!type) {
      problems.push(`a body block needs exactly one type from ${BLOCK_TYPES.join(', ')}; it has keys ${keysOf(block)}`);
      continue;
    }
    if (!SHAPES[type].test(block)) { problems.push(`${type} block needs ${SHAPES[type].needs}`); continue; }
    if (PROSE.includes(type)) words += proseOf(block, type).reduce((n, line) => n + wordCount(line), 0);
    if (VISUAL.includes(type)) visuals++;
    if (type === 'calc') { calcs++; problems.push(...calcProblems(block.calc)); }
    if (type === 'figure' && drawn && !drawn.has(block.figure)) problems.push(`figure "${block.figure}" is not drawn by the level's drawFigures`);
  }
  if (words > maxWords) problems.push(`the body has ${words} words, more than ${maxWords}`);
  if (visuals > 1) problems.push(`has ${visuals} tables, code samples or figures; at most one`);
  if (calcs > 1) problems.push(`has ${calcs} calculations; at most one`);
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
    problems.push(...prefixed(`step ${i + 1}`, [...textProblems(step, LIMITS), ...bodyProblems(step.body, drawn, LIMITS.bodyWords),
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
  const L = CHAPTER_LIMITS, problems = [];
  for (const key of ['kicker', 'title']) if (!isText(intro[key])) problems.push(`needs a ${key}`);
  problems.push(...wordsProblems(intro.story, 'the story', L.storyWords), ...pictureProblems(intro, drawn));
  const outcomes = intro.outcomes;
  if (!Array.isArray(outcomes) || outcomes.length < L.minOutcomes || outcomes.length > L.maxOutcomes) {
    problems.push(`needs ${L.minOutcomes} to ${L.maxOutcomes} outcomes; it has ${Array.isArray(outcomes) ? outcomes.length : 'none'}`);
  } else outcomes.forEach((o, i) => problems.push(...wordsProblems(o, `outcome ${i + 1}`, L.outcomeWords)));
  return prefixed('intro', problems);
}

/** Problems with one briefing screen. Quiz question indexes it names are added to `questions.used`. */
function screenProblems(screen, drawn, questions) {
  if (!isObject(screen)) return ['is not a screen object'];
  const problems = [...textProblems(screen, CHAPTER_LIMITS), ...bodyProblems(screen.body, drawn, CHAPTER_LIMITS.bodyWords),
    ...checkProblems(screen.check)];
  if (!isText(screen.uses)) problems.push('needs a uses line: what the player does or sees with this idea in the mission');
  if ('missions' in screen) problems.push('takes its mission from its chapter; remove missions');
  return [...problems, ...indexProblems(screen.quiz, questions.count, 'quiz question', questions.used)];
}

/** Problems with a debrief: what the player saw, one number, what breaks next, in at most 60 words together. */
function debriefProblems(debrief) {
  if (!isObject(debrief)) return ['needs a debrief'];
  const problems = [];
  if (!isText(debrief.saw)) problems.push('the debrief needs what the player saw');
  if (!isPair(debrief.number)) problems.push('the debrief needs one number as [value, meaning]');
  if (!isText(debrief.next)) problems.push('the debrief needs what breaks next');
  const words = [debrief.saw, debrief.next, ...(isPair(debrief.number) ? debrief.number : [])].reduce((n, t) => n + (isText(t) ? wordCount(t) : 0), 0);
  if (words > CHAPTER_LIMITS.debriefWords) problems.push(`the debrief has ${words} words, more than ${CHAPTER_LIMITS.debriefWords}`);
  return problems;
}

/**
 * Problems with chapter `i` of `count`: its title, mission, minutes, 1 to 3 screens with at least one question, and a
 * debrief unless it is the last chapter (the wrap-up follows that one).
 */
function chapterProblems(chapter, i, count, drawn, questions) {
  if (!isObject(chapter)) return [`chapter ${i + 1}: is not a chapter object`];
  const L = CHAPTER_LIMITS, problems = [];
  if (!isText(chapter.title)) problems.push('needs a title');
  if (chapter.mission !== i) problems.push(`its mission must be ${i}, as chapters follow the missions in order; it is ${chapter.mission}`);
  if (!(Number.isFinite(chapter.minutes) && chapter.minutes > 0)) problems.push('needs its time in minutes');
  const screens = Array.isArray(chapter.screens) ? chapter.screens : [];
  if (screens.length < L.minScreens || screens.length > L.maxScreens) problems.push(`has ${screens.length} screens, not ${L.minScreens} to ${L.maxScreens}`);
  if (!screens.some((s) => isObject(s?.check))) problems.push('needs at least one question on its screens');
  if (i < count - 1 || chapter.debrief !== undefined) problems.push(...debriefProblems(chapter.debrief));
  return [...prefixed(`chapter ${i + 1}`, problems),
    ...screens.flatMap((s, n) => prefixed(`chapter ${i + 1} screen ${n + 1}`, screenProblems(s, drawn, questions)))];
}

/** Text with markup removed and runs of spaces made one, to look a number up in. */
const flat = (text) => plain(text).replace(/\s+/g, ' ').trim();

/**
 * Problems with the wrap-up: the picture, exactly 3 short things to say, at most 4 numbers each found in the text of
 * a briefing screen (`screenText`), what is still broken, and an optional closing paragraph.
 */
function wrapProblems(wrap, drawn, screenText) {
  if (!isObject(wrap)) return ['the lesson needs a wrap'];
  const L = CHAPTER_LIMITS, problems = pictureProblems(wrap, drawn);
  if (!Array.isArray(wrap.say) || wrap.say.length !== L.sayLines) {
    problems.push(`needs exactly ${L.sayLines} things to say; it has ${Array.isArray(wrap.say) ? wrap.say.length : 'none'}`);
  } else wrap.say.forEach((s, i) => problems.push(...wordsProblems(s, `thing to say ${i + 1}`, L.sayWords)));
  const numbers = wrap.numbers;
  if (!Array.isArray(numbers) || !numbers.every(isPair)) problems.push('numbers needs a list of [value, meaning] pairs');
  else {
    if (numbers.length > L.maxWrapNumbers) problems.push(`has ${numbers.length} numbers, more than ${L.maxWrapNumbers}`);
    for (const [value] of numbers) if (!screenText.includes(flat(value))) problems.push(`the number "${value}" is in no briefing screen of this level`);
  }
  if (!isText(wrap.broken)) problems.push('needs the line on what is still broken');
  if (!isOptionalText(wrap.loop)) problems.push('loop must be text when it is there');
  return prefixed('wrap', problems);
}

/** Problems with a lesson written as chapters. */
function chapterLessonProblems(level) {
  const lesson = level.lesson;
  const chapters = Array.isArray(lesson.chapters) ? lesson.chapters : [];
  const missions = level.missions?.length ?? 0;
  const questions = { count: level.quiz?.questions?.length ?? 0, used: new Set() };
  const screens = chapters.flatMap((c) => (Array.isArray(c?.screens) ? c.screens : []));
  const problems = [];
  if (!isText(lesson.rules)) problems.push('the lesson needs its rules');
  if (chapters.length !== missions) problems.push(`the lesson has ${chapters.length} chapters; it needs one per mission (${missions})`);
  if (screens.length > CHAPTER_LIMITS.maxLevelScreens) problems.push(`the lesson has ${screens.length} briefing screens, more than ${CHAPTER_LIMITS.maxLevelScreens}`);

  // The intro and the wrap-up each name a picture, so the level's drawFigures is always run.
  const drawn = figureIds(level, true, problems);
  problems.push(...introProblems(lesson.intro, drawn));
  chapters.forEach((chapter, i) => problems.push(...chapterProblems(chapter, i, chapters.length, drawn, questions)));
  problems.push(...wrapProblems(lesson.wrap, drawn, flat(screens.flatMap((s) => textsIn(s)).join(' '))));
  for (const n of unused(questions.count, questions.used)) problems.push(`quiz question index ${n} is in no screen's quiz`);
  return problems;
}

/**
 * Problems with a level's lesson, in steps or in chapters. An empty list means the lesson is fine. Until every level
 * is in chapters, a level may use either shape, but not both.
 */
export function validateLesson(level) {
  const lesson = level.lesson;
  if (!isObject(lesson)) return ['the lesson must be an object'];
  if (!('chapters' in lesson)) return stepLessonProblems(level);
  return 'steps' in lesson ? ['the lesson has both steps and chapters; it needs one or the other'] : chapterLessonProblems(level);
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
  if (!('chapters' in lesson)) {
    const { steps, ...rest } = lesson;
    return [['', rest], ...list(steps).map((step, i) => [`step ${i + 1}: `, step])];
  }
  const { chapters, ...rest } = lesson;
  return [['', rest], ...list(chapters).flatMap((chapter, c) => {
    const { screens, ...own } = isObject(chapter) ? chapter : {};
    return [[`chapter ${c + 1}: `, own], ...list(screens).map((s, n) => [`chapter ${c + 1} screen ${n + 1}: `, s])];
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
