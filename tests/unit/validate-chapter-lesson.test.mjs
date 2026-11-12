// js/validate-lesson.js validateLesson on a lesson in chapters: each problem it reports, triggered on purpose on a
// small made-up lesson. (The checks a screen shares with a step, such as body blocks and calculations, are covered
// one by one in validate-lesson.test.mjs; here they are shown to apply with a screen's own limits.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLesson, lessonWarnings, CHAPTER_LIMITS as L } from '../../js/validate-lesson.js';

/** `n` words of text. */
const words = (n) => Array(n).fill('word').join(' ');
const check = (kind = 'guess') => ({
  kind, q: 'Which one?',
  options: [{ t: 'This one', why: 'Because it is.', right: true }, { t: 'That one', why: 'It is not.' }],
});
const calc = () => ({
  formula: 'Total = boxes × apples in a box.',
  rows: [{ label: 'Apples', work: '2 boxes × 6 apples', result: '12 apples' }],
  result: 'You have 12 apples.',
});
const screen = (n, extra = {}) => ({
  title: `Why screen ${n}?`, hook: 'A short problem.', body: [{ p: 'A short body.' }], takeaway: 'One idea.',
  uses: 'In the mission you see it happen.', quiz: [], ...extra,
});
const debrief = () => ({ saw: 'One lookup, then straight to the server.', number: ['about 100 ms', 'response time at 50 req/s'], next: 'Traffic triples.' });

/**
 * A valid level: 2 missions, so 2 chapters. Chapter 1 has 2 screens (a figure, then a calculation) and a debrief;
 * chapter 2, the last, has 1 screen (a table) and no debrief. Each chapter has one question; each of the 2 quiz
 * questions is prepared by a screen. Both wrap-up numbers appear on a screen. `change` edits a fresh copy.
 */
function level(change = (d) => d) {
  const d = {
    missions: [{}, {}],
    quiz: { questions: [{}, {}] },
    drawFigures({ $ }) { $('figOne'); $('figTwo'); },
    lesson: {
      intro: {
        kicker: 'Level 9 · Test', title: 'A made-up lesson', story: 'You run a small shop.',
        picture: 'figOne', alt: 'Users, then a web server.', outcomes: ['explain one thing', 'explain two things', 'explain three things'],
      },
      chapters: [
        {
          title: 'Go live', mission: 0, minutes: 5, debrief: debrief(),
          screens: [
            screen(1, { check: check(), quiz: [0], body: [{ figure: 'figTwo', alt: 'One box.', caption: 'One box' }, { p: 'Peak is 2× the average.' }] }),
            screen(2, { body: [{ calc: calc() }] }),
          ],
        },
        {
          title: 'Launch day', mission: 1, minutes: 8,
          screens: [screen(3, { check: check('turn'), quiz: [1], body: [{ table: { head: ['A', 'B'], rows: [['1', '2']] } }] })],
        },
      ],
      wrap: {
        picture: 'figOne', alt: 'Users, then a web server.', say: ['Say one.', 'Say two.', 'Say three.'],
        numbers: [['2×', 'peak over average'], ['12 apples', 'apples in two boxes']], broken: 'One server can still fail.',
      },
      rules: 'Requests take 10 ms.',
    },
  };
  change(d);
  return d;
}
const lesson = (d) => d.lesson;
const chapter = (d, i) => d.lesson.chapters[i];
const scr = (d, c, s) => d.lesson.chapters[c].screens[s];
const at = (change) => validateLesson(level(change));

test('a valid lesson in chapters has no problems', () => {
  assert.deepEqual(validateLesson(level()), []);
});

test('a lesson with both steps and chapters, or that is not an object', () => {
  assert.deepEqual(at((d) => { lesson(d).steps = []; }), ['the lesson has both steps and chapters; it needs one or the other']);
  assert.deepEqual(at((d) => { d.lesson = null; }), ['the lesson must be an object']);
});

test('a lesson without its rules', () => {
  assert.deepEqual(at((d) => { delete lesson(d).rules; }), ['the lesson needs its rules']);
});

test('an intro that is missing, or without its kicker or title', () => {
  assert.deepEqual(at((d) => { delete lesson(d).intro; }), ['the lesson needs an intro']);
  for (const key of ['kicker', 'title']) assert.deepEqual(at((d) => { delete lesson(d).intro[key]; }), [`intro: needs a ${key}`]);
});

test('an intro story that is missing or over 50 words', () => {
  assert.deepEqual(at((d) => { delete lesson(d).intro.story; }), ['intro: needs the story']);
  assert.deepEqual(at((d) => { lesson(d).intro.story = words(L.storyWords); }), []);
  assert.deepEqual(at((d) => { lesson(d).intro.story = words(L.storyWords + 1); }), ['intro: the story has 51 words, more than 50']);
});

test('an intro picture that is missing, not drawn, or without alt text', () => {
  assert.deepEqual(at((d) => { delete lesson(d).intro.picture; }), ['intro: needs a picture']);
  assert.deepEqual(at((d) => { lesson(d).intro.picture = 'figNone'; }), ['intro: figure "figNone" is not drawn by the level\'s drawFigures']);
  assert.deepEqual(at((d) => { lesson(d).intro.alt = ''; }), ['intro: needs alt text for its picture']);
});

test('a drawFigures that fails: said once, and no figure is reported as not drawn', () => {
  assert.deepEqual(at((d) => { d.drawFigures = () => { throw new Error('oops'); }; }), ['drawFigures failed while listing its figures: oops']);
});

test('3 to 5 outcomes, each of at most 12 words', () => {
  const outcomes = (list) => at((d) => { lesson(d).intro.outcomes = list; });
  assert.deepEqual(outcomes(['one', 'two']), ['intro: needs 3 to 5 outcomes; it has 2']);
  assert.deepEqual(outcomes(['1', '2', '3', '4', '5']), []);
  assert.deepEqual(outcomes(['1', '2', '3', '4', '5', '6']), ['intro: needs 3 to 5 outcomes; it has 6']);
  assert.deepEqual(outcomes(undefined), ['intro: needs 3 to 5 outcomes; it has none']);
  assert.deepEqual(outcomes(['one', words(L.outcomeWords), 'three']), []);
  assert.deepEqual(outcomes(['one', words(L.outcomeWords + 1), '']), ['intro: outcome 2 has 13 words, more than 12', 'intro: needs outcome 3']);
});

test('one chapter per mission, in mission order', () => {
  assert.deepEqual(at((d) => { d.missions.push({}); }), ['the lesson has 2 chapters; it needs one per mission (3)']);
  // Swapped: each chapter is at the other's place. The last one now has a debrief, which is allowed; the first lacks one.
  assert.deepEqual(at((d) => { lesson(d).chapters.reverse(); }), [
    'chapter 1: its mission must be 0, as chapters follow the missions in order; it is 1', 'chapter 1: needs a debrief',
    'chapter 2: its mission must be 1, as chapters follow the missions in order; it is 0',
  ]);
  assert.deepEqual(at((d) => { lesson(d).chapters[1] = 'Launch day'; }), ['chapter 2: is not a chapter object', 'quiz question index 1 is in no screen\'s quiz']);
});

test('a chapter without its title or minutes', () => {
  assert.deepEqual(at((d) => { chapter(d, 0).title = ''; }), ['chapter 1: needs a title']);
  for (const minutes of [0, '5', undefined]) assert.deepEqual(at((d) => { chapter(d, 1).minutes = minutes; }), ['chapter 2: needs its time in minutes']);
});

test('1 to 3 screens in a chapter', () => {
  assert.deepEqual(at((d) => { chapter(d, 0).screens.push(screen(4)); }), []);
  assert.deepEqual(at((d) => { chapter(d, 0).screens.push(screen(4), screen(5)); }), ['chapter 1: has 4 screens, not 1 to 3']);
  assert.deepEqual(at((d) => { chapter(d, 1).screens = []; }), ['chapter 2: has 0 screens, not 1 to 3', 'chapter 2: needs at least one question on its screens',
    'quiz question index 1 is in no screen\'s quiz']);
});

test('at most 8 briefing screens in a level', () => {
  // 3 missions, 3 chapters: 3 + 3 + 2 = 8 screens passes; 3 + 3 + 3 = 9 does not.
  const three = (n) => level((d) => {
    d.missions.push({});
    chapter(d, 0).screens.push(screen(4));
    chapter(d, 1).screens.push(screen(5), screen(6));
    chapter(d, 1).debrief = debrief();
    lesson(d).chapters.push({ title: 'More', mission: 2, minutes: 4, screens: Array.from({ length: n }, (_, i) => screen(7 + i, i ? {} : { check: check() })) });
  });
  assert.deepEqual(validateLesson(three(2)), []);
  assert.deepEqual(validateLesson(three(3)), ['the lesson has 9 briefing screens, more than 8']);
});

test('a screen title that is not a question, or a hook that is missing or over 40 words', () => {
  assert.deepEqual(at((d) => { scr(d, 0, 1).title = 'Screen two'; }), ['chapter 1 screen 2: the title must be a question ending in "?"']);
  assert.deepEqual(at((d) => { delete scr(d, 0, 1).hook; }), ['chapter 1 screen 2: needs a hook']);
  assert.deepEqual(at((d) => { scr(d, 0, 1).hook = words(L.hookWords); }), []);
  assert.deepEqual(at((d) => { scr(d, 0, 1).hook = words(L.hookWords + 1); }), ['chapter 1 screen 2: the hook has 41 words, more than 40']);
});

test('a screen body over 90 words; a table is not counted', () => {
  assert.deepEqual(at((d) => { scr(d, 1, 0).body.push({ p: words(L.bodyWords) }); }), []);
  assert.deepEqual(at((d) => { scr(d, 1, 0).body.push({ p: words(L.bodyWords + 1) }); }), ['chapter 2 screen 1: the body has 91 words, more than 90']);
  assert.deepEqual(at((d) => { scr(d, 1, 0).body = []; }), ['chapter 2 screen 1: needs a body']);
});

test('at most one picture or table, and at most one calculation, on a screen', () => {
  assert.deepEqual(at((d) => { scr(d, 1, 0).body.push({ figure: 'figOne', alt: 'Box.', caption: 'Box' }); }), ['chapter 2 screen 1: has 2 tables, code samples or figures; at most one']);
  assert.deepEqual(at((d) => { scr(d, 0, 1).body.push({ calc: calc() }); }), ['chapter 1 screen 2: has 2 calculations; at most one']);
  assert.deepEqual(at((d) => { scr(d, 0, 0).body[0].figure = 'figNone'; }), ['chapter 1 screen 1: figure "figNone" is not drawn by the level\'s drawFigures']);
});

test('a takeaway that is missing, not one sentence, or over 16 words', () => {
  const takeaway = (t) => at((d) => { scr(d, 0, 1).takeaway = t; });
  assert.deepEqual(takeaway(undefined), ['chapter 1 screen 2: needs a takeaway']);
  assert.deepEqual(takeaway('One idea. Then another.'), ['chapter 1 screen 2: the takeaway must be one sentence']);
  assert.deepEqual(takeaway(`${words(L.takeawayWords)}.`), []);
  assert.deepEqual(takeaway(`${words(L.takeawayWords + 1)}.`), ['chapter 1 screen 2: the takeaway has 17 words, more than 16']);
});

test('a screen without its uses line, or that names its own missions', () => {
  const msg = 'chapter 1 screen 2: needs a uses line: what the player does or sees with this idea in the mission';
  assert.deepEqual(at((d) => { delete scr(d, 0, 1).uses; }), [msg]);
  assert.deepEqual(at((d) => { scr(d, 0, 1).uses = ' '; }), [msg]);
  assert.deepEqual(at((d) => { scr(d, 0, 1).missions = [0]; }), ['chapter 1 screen 2: takes its mission from its chapter; remove missions']);
  // The screen held the only "12 apples", so the wrap-up's number loses its source too.
  assert.deepEqual(at((d) => { chapter(d, 0).screens[1] = null; }), ['chapter 1 screen 2: is not a screen object',
    'wrap: the number "12 apples" is in no briefing screen of this level']);
});

test('at least one question in each chapter, at most one on a screen', () => {
  assert.deepEqual(at((d) => { delete scr(d, 1, 0).check; }), ['chapter 2: needs at least one question on its screens']);
  assert.deepEqual(at((d) => { scr(d, 0, 1).check = check('turn'); }), []);
  assert.deepEqual(at((d) => { scr(d, 0, 1).check = [check(), check()]; }), ['chapter 1 screen 2: has more than one check; at most one']);
});

test('a question with other than 2 or 3 options, or an option without its explanation', () => {
  const options = (edit) => at((d) => edit(scr(d, 0, 0).check.options));
  assert.deepEqual(options((o) => o.push({ t: 'C', why: 'No.' })), []);
  assert.deepEqual(options((o) => o.pop()), ['chapter 1 screen 1: the check needs 2 or 3 options; it has 1']);
  assert.deepEqual(options((o) => o.push({ t: 'C', why: 'No.' }, { t: 'D', why: 'No.' })), ['chapter 1 screen 1: the check needs 2 or 3 options; it has 4']);
  assert.deepEqual(options((o) => { delete o[1].why; }), ['chapter 1 screen 1: every check option needs a why']);
});

test('a debrief on every chapter but the last; the last may have one', () => {
  assert.deepEqual(at((d) => { delete chapter(d, 0).debrief; }), ['chapter 1: needs a debrief']);
  assert.deepEqual(at((d) => { chapter(d, 1).debrief = debrief(); }), []);
  assert.deepEqual(at((d) => { chapter(d, 1).debrief = 'Done.'; }), ['chapter 2: needs a debrief']);
});

test('a debrief without what the player saw, one number, or what breaks next', () => {
  const edit = (change) => at((d) => change(chapter(d, 0).debrief));
  assert.deepEqual(edit((b) => { delete b.saw; }), ['chapter 1: the debrief needs what the player saw']);
  assert.deepEqual(edit((b) => { b.number = ['about 100 ms']; }), ['chapter 1: the debrief needs one number as [value, meaning]']);
  assert.deepEqual(edit((b) => { b.next = ''; }), ['chapter 1: the debrief needs what breaks next']);
});

test('a debrief over 60 words, counting what was seen, the number and what breaks next', () => {
  // The number has 3 + 5 words ("about 100 ms", "response time at 50 req/s") and next has 2: 10, so saw may have 50.
  assert.deepEqual(at((d) => { chapter(d, 0).debrief.saw = words(L.debriefWords - 10); }), []);
  assert.deepEqual(at((d) => { chapter(d, 0).debrief.saw = words(L.debriefWords - 9); }), ['chapter 1: the debrief has 61 words, more than 60']);
});

test('a wrap-up that is missing, or whose picture is missing or not drawn', () => {
  assert.deepEqual(at((d) => { delete lesson(d).wrap; }), ['the lesson needs a wrap']);
  assert.deepEqual(at((d) => { lesson(d).wrap.picture = 'figNone'; }), ['wrap: figure "figNone" is not drawn by the level\'s drawFigures']);
  assert.deepEqual(at((d) => { delete lesson(d).wrap.alt; }), ['wrap: needs alt text for its picture']);
});

test('exactly 3 things to say, each of at most 20 words', () => {
  const say = (list) => at((d) => { lesson(d).wrap.say = list; });
  assert.deepEqual(say(['One.', 'Two.']), ['wrap: needs exactly 3 things to say; it has 2']);
  assert.deepEqual(say(['One.', 'Two.', 'Three.', 'Four.']), ['wrap: needs exactly 3 things to say; it has 4']);
  assert.deepEqual(say(['One.', `${words(L.sayWords)}.`, 'Three.']), []);
  assert.deepEqual(say(['One.', `${words(L.sayWords + 1)}.`, 'Three.']), ['wrap: thing to say 2 has 21 words, more than 20']);
});

test('at most 4 wrap-up numbers, each found on a briefing screen of the level', () => {
  const numbers = (list) => at((d) => { lesson(d).wrap.numbers = list; });
  const two = ['2×', 'peak'];
  assert.deepEqual(numbers([]), []);
  assert.deepEqual(numbers([two, two, two, two]), []);
  assert.deepEqual(numbers([two, two, two, two, two]), ['wrap: has 5 numbers, more than 4']);
  assert.deepEqual(numbers([two, ['86,400', 'seconds in a day']]), ['wrap: the number "86,400" is in no briefing screen of this level']);
  assert.deepEqual(numbers([['2×'], two]), ['wrap: numbers needs a list of [value, meaning] pairs']);
  // Found through inline markup and spacing on the screen ("<b>2×</b>&nbsp;the").
  assert.deepEqual(at((d) => { scr(d, 0, 0).body[1].p = 'Peak is <b>2×</b>&nbsp;the average.'; }), []);
  // A number only in the debrief or the wrap-up itself is not on a briefing screen.
  assert.deepEqual(numbers([['about 100 ms', 'response time']]), ['wrap: the number "about 100 ms" is in no briefing screen of this level']);
});

test('a wrap-up without the still-broken line, or with a loop that is not text', () => {
  assert.deepEqual(at((d) => { delete lesson(d).wrap.broken; }), ['wrap: needs the line on what is still broken']);
  assert.deepEqual(at((d) => { lesson(d).wrap.loop = 'Every level repeats this loop.'; }), []);
  assert.deepEqual(at((d) => { lesson(d).wrap.loop = ['A list.']; }), ['wrap: loop must be text when it is there']);
});

test('every quiz question is prepared by a screen, and every index exists', () => {
  assert.deepEqual(at((d) => { scr(d, 1, 0).quiz = []; }), ['quiz question index 1 is in no screen\'s quiz']);
  assert.deepEqual(at((d) => { scr(d, 0, 1).quiz = [2]; }), ['chapter 1 screen 2: quiz question index 2 does not exist']);
  assert.deepEqual(at((d) => { delete scr(d, 0, 1).quiz; }), ['chapter 1 screen 2: needs a quiz question list (it may be empty)']);
});

test('a warning for each number of a million or more written in digits, in every part of the lesson', () => {
  const advice = 'is written in digits; use the word ("40 million", "1.2 billion")';
  assert.deepEqual(lessonWarnings(level()), []);
  assert.deepEqual(lessonWarnings(level((d) => { lesson(d).intro.story = 'You serve 2,000,000 users.'; })), [`2,000,000 ${advice}`]);
  assert.deepEqual(lessonWarnings(level((d) => { scr(d, 0, 1).hook = 'It has 3,000,000 users.'; })), [`chapter 1 screen 2: 3,000,000 ${advice}`]);
  assert.deepEqual(lessonWarnings(level((d) => { chapter(d, 0).debrief.next = 'Then 4,000,000 users.'; })), [`chapter 1: 4,000,000 ${advice}`]);
  assert.deepEqual(lessonWarnings(level((d) => { lesson(d).wrap.say[0] = 'Plan for 5,000,000 users.'; })), [`5,000,000 ${advice}`]);
});
