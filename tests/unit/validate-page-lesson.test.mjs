// js/validate-lesson.js validateLesson on a lesson on one page: each problem it reports, triggered on purpose on a
// small made-up lesson. (The checks a section shares with a step, such as body blocks and calculations, are covered
// one by one in validate-lesson.test.mjs; here they are shown to apply with a section's own limits.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLesson, lessonWarnings, newPartProblems, PAGE_LIMITS as L } from '../../js/validate-lesson.js';

/** `n` words of text. */
const words = (n) => Array(n).fill('word').join(' ');
const check = () => ({
  q: 'Which one?',
  options: [{ t: 'This one', why: 'Because it is.', right: true }, { t: 'That one', why: 'It is not.' }],
});
const calc = () => ({
  formula: 'Total = boxes × apples in a box.',
  rows: [{ label: 'Apples', work: '2 boxes × 6 apples', result: '12 apples' }],
  result: 'You have 12 apples.',
});
const section = (n, extra = {}) => ({
  title: `Why section ${n}?`, hook: 'A short problem.', body: [{ p: 'A short body.' }], takeaway: 'One idea.', quiz: [], ...extra,
});
const card = (extra = {}) => ({ type: 'dns', what: 'The address book.', does: 'Turns a name into an address.', game: '$5 a month.', ...extra });
const debrief = () => ({ saw: 'One lookup, then straight to the server.', number: ['about 100 ms', 'response time at 50 req/s'], next: 'Traffic triples.' });

/**
 * A valid level: 2 missions, so 2 parts. Part 1 has a New part card, 2 sections (a figure, then a calculation), one
 * question and a debrief; part 2, the last, has 1 section (a table), one question and no debrief. Each of the 2 quiz
 * questions is prepared by a section. Both wrap-up numbers appear in a section. `change` edits a fresh copy.
 */
function level(change = (d) => d) {
  const d = {
    id: 9,
    components: { users: { name: 'Users' }, dns: { name: 'DNS' } },
    missions: [{}, {}],
    quiz: { questions: [{}, {}] },
    drawFigures({ $ }) { $('figOne'); $('figTwo'); },
    lesson: {
      intro: {
        kicker: 'Level 9 · Test', title: 'A made-up lesson', story: 'You run a small shop.',
        picture: 'figOne', alt: 'Users, then a web server.', outcomes: ['explain one thing', 'explain two things', 'explain three things'],
      },
      parts: [
        {
          title: 'Go live', mission: 0, minutes: 5, newParts: [card()],
          sections: [
            section(1, { quiz: [0], body: [{ figure: 'figTwo', alt: 'One box.', caption: 'One box' }, { p: 'Peak is 2× the average.' }] }),
            section(2, { body: [{ calc: calc() }] }),
          ],
          checks: [check()],
          youWill: ['Connect Users to DNS.', 'Press Play.'],
          debrief: debrief(),
        },
        {
          title: 'Launch day', mission: 1, minutes: 8,
          sections: [section(3, { quiz: [1], body: [{ table: { head: ['A', 'B'], rows: [['1', '2']] } }] })],
          checks: [check()],
          youWill: ['Estimate the peak.', 'Crash the server.'],
        },
      ],
      wrap: {
        picture: 'figOne', alt: 'Users, then a web server.', say: ['Say one.', 'Say two.', 'Say three.'],
        numbers: [['2×', 'peak over average'], ['12 apples', 'apples in two boxes']], broken: 'One server can still fail.',
      },
    },
  };
  change(d);
  return d;
}
const lesson = (d) => d.lesson;
const part = (d, i) => d.lesson.parts[i];
const sec = (d, p, s) => d.lesson.parts[p].sections[s];
const at = (change) => validateLesson(level(change));

/**
 * Fills part 1 towards its word limit (see `PAGE_LIMITS`). Part 1 of the fixture shows 43 words before its mission
 * card: the card 3 + 6 + 3 = 12 ("$5" is a word); section 1's hook 3, prose 5 and Remember 2 = 10; section 2's hook
 * 3, the calculation's formula 6 and result 4, Remember 2 = 15; the question 2 and its options 2 + 2 = 6.
 * Each section stays within 150 words of prose with its hook: section 1 gets 142 more, and two new sections of
 * 147 words each bring a hook (3) and a Remember line (2): 43 + 142 + 2 × 152 = 489. Section 2 then gets `extra`
 * words, and each of `cards` more cards brings 25 + 30 + 20 = 75.
 */
function fill(d, extra, cards = 0) {
  const p = part(d, 0);
  p.sections[0].body.push({ p: words(142) });
  p.sections[1].body.push({ p: words(extra) });
  p.sections.push(section(4, { body: [{ p: words(147) }] }), section(5, { body: [{ p: words(147) }] }));
  for (let i = 0; i < cards; i++) p.newParts.push(card({ what: words(25), does: words(30), game: words(20) }));
}

test('a valid lesson on one page has no problems', () => {
  assert.deepEqual(validateLesson(level()), []);
});

test('a lesson with both steps and parts, or that is not an object', () => {
  assert.deepEqual(at((d) => { lesson(d).steps = []; }), ['the lesson has both steps and parts; it needs one or the other']);
  assert.deepEqual(at((d) => { d.lesson = null; }), ['the lesson must be an object']);
});

test('a lesson with rules: a lesson on one page has none', () => {
  assert.deepEqual(at((d) => { lesson(d).rules = 'Requests take 10 ms.'; }), ['a lesson on one page has no rules']);
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

test('one part per mission, in mission order', () => {
  assert.deepEqual(at((d) => { d.missions.push({}); }), ['the lesson has 2 parts; it needs one per mission (3)']);
  // Swapped: each part is at the other's place. The last one now has a debrief, which is allowed; the first lacks one.
  assert.deepEqual(at((d) => { lesson(d).parts.reverse(); }), [
    'part 1: its mission must be 0, as parts follow the missions in order; it is 1', 'part 1: needs a debrief',
    'part 2: its mission must be 1, as parts follow the missions in order; it is 0',
  ]);
  assert.deepEqual(at((d) => { lesson(d).parts[1] = 'Launch day'; }), ['part 2: is not a part object', 'quiz question index 1 is in no section\'s quiz']);
});

test('a part without its title or minutes', () => {
  assert.deepEqual(at((d) => { part(d, 0).title = ''; }), ['part 1: needs a title']);
  for (const minutes of [0, '5', undefined]) assert.deepEqual(at((d) => { part(d, 1).minutes = minutes; }), ['part 2: needs its time in minutes']);
});

test('1 to 4 sections in a part', () => {
  assert.deepEqual(at((d) => { part(d, 0).sections.push(section(4), section(5)); }), []);
  assert.deepEqual(at((d) => { part(d, 0).sections.push(section(4), section(5), section(6)); }), ['part 1: has 5 sections, not 1 to 4']);
  assert.deepEqual(at((d) => { part(d, 1).sections = []; }), ['part 2: has 0 sections, not 1 to 4', 'quiz question index 1 is in no section\'s quiz']);
});

test('at most 600 words before a mission card, counting cards, sections and questions but not option explanations', () => {
  assert.deepEqual(at((d) => fill(d, 111)), []); // 489 + 111 = 600
  assert.deepEqual(at((d) => fill(d, 112)), ['part 1: has 601 words before its mission card, more than 600']);
  assert.deepEqual(at((d) => { part(d, 0).checks[0].options[0].why = words(L.partWords); }), []);
});

test('Level 1\'s first part may have 700 words before its mission card; its other parts 600', () => {
  assert.deepEqual(at((d) => { d.id = 1; fill(d, 112); }), []);
  assert.deepEqual(at((d) => { d.id = 1; fill(d, 61, 2); }), []); // 489 + 61 + 2 × 75 = 700
  assert.deepEqual(at((d) => { d.id = 1; fill(d, 62, 2); }), ['part 1: has 701 words before its mission card, more than 700']);
  // Part 2 of Level 1: 11 words, plus three new sections of 152 and 133 more in section 3 (3 + 133 = 136): 600, then 601.
  const part2 = (extra) => (d) => {
    d.id = 1;
    part(d, 1).sections[0].body.push({ p: words(extra) });
    part(d, 1).sections.push(section(4, { body: [{ p: words(147) }] }), section(5, { body: [{ p: words(147) }] }), section(6, { body: [{ p: words(147) }] }));
  };
  assert.deepEqual(at(part2(133)), []);
  assert.deepEqual(at(part2(134)), ['part 2: has 601 words before its mission card, more than 600']);
});

test('a section title that is a question or starts "How to "', () => {
  assert.deepEqual(at((d) => { sec(d, 0, 1).title = 'How to use the Build screen'; }), []);
  assert.deepEqual(at((d) => { sec(d, 0, 1).title = 'Section two'; }), ['part 1 section 2: the title must be a question ending in "?" or start with "How to "']);
});

test('a section may open with its body; a hook that is there must be text', () => {
  assert.deepEqual(at((d) => { delete sec(d, 0, 1).hook; }), []);
  assert.deepEqual(at((d) => { sec(d, 0, 1).hook = ''; }), ['part 1 section 2: needs a hook']);
});

test('"Start here" is optional: one section\'s text and its time, without quiz questions', () => {
  const start = (extra = {}) => ({ minutes: 3, title: 'What is a shop?', hook: 'A short problem.', body: [{ p: 'A short body.' }], takeaway: 'One idea.', ...extra });
  const withStart = (extra) => at((d) => { lesson(d).start = start(extra); });
  assert.deepEqual(withStart(), []);
  assert.deepEqual(withStart({ hook: undefined }), []);
  assert.deepEqual(at((d) => { lesson(d).start = 'Read this first.'; }), ['start: is not an object']);
  assert.deepEqual(withStart({ minutes: 0 }), ['start: needs its time in minutes']);
  assert.deepEqual(withStart({ title: 'Start' }), ['start: the title must be a question ending in "?" or start with "How to "']);
  assert.deepEqual(withStart({ quiz: [0] }), ['start: has quiz, which Start here does not take; remove it']);
  // The same limits as a section: 150 words of prose with the hook (3 here), and a Remember line of 16 words.
  assert.deepEqual(withStart({ body: [{ p: words(L.sectionWords - 3) }] }), []);
  assert.deepEqual(withStart({ body: [{ p: words(L.sectionWords - 2) }] }), ['start: the hook and body has 151 words, more than 150']);
  assert.deepEqual(withStart({ takeaway: `${words(L.takeawayWords + 1)}.` }), ['start: the takeaway has 17 words, more than 16']);
  assert.deepEqual(withStart({ body: [{ figure: 'figNine', alt: 'One box.', caption: 'One box' }] }), ['start: figure "figNine" is not drawn by the level\'s drawFigures']);
});

test('a part\'s lead is optional text, and counts towards the words before the mission card', () => {
  assert.deepEqual(at((d) => { part(d, 0).lead = 'The shop is ready.'; }), []);
  assert.deepEqual(at((d) => { part(d, 0).lead = 4; }), ['part 1: lead must be text when it is there']);
  // fill(d, 108) brings part 1 to 597 words (see the 600-word test); a lead of 3 words is the limit, 4 is one over.
  assert.deepEqual(at((d) => { fill(d, 108); part(d, 0).lead = words(3); }), []);
  assert.deepEqual(at((d) => { fill(d, 108); part(d, 0).lead = words(4); }), ['part 1: has 601 words before its mission card, more than 600']);
});

test('at most 150 words of prose in a section, its hook included; a table is not counted', () => {
  // Section 3 has a hook of 3 words and a table.
  assert.deepEqual(at((d) => { sec(d, 1, 0).body.push({ p: words(L.sectionWords - 3) }); }), []);
  assert.deepEqual(at((d) => { sec(d, 1, 0).body.push({ p: words(L.sectionWords - 2) }); }), ['part 2 section 1: the hook and body has 151 words, more than 150']);
  assert.deepEqual(at((d) => { sec(d, 1, 0).body = []; }), ['part 2 section 1: needs a body']);
});

test('at most one picture or table, and at most one calculation, in a section', () => {
  assert.deepEqual(at((d) => { sec(d, 1, 0).body.push({ figure: 'figOne', alt: 'Box.', caption: 'Box' }); }), ['part 2 section 1: has 2 tables, code samples or figures; at most one']);
  assert.deepEqual(at((d) => { sec(d, 0, 1).body.push({ calc: calc() }); }), ['part 1 section 2: has 2 calculations; at most one']);
  assert.deepEqual(at((d) => { sec(d, 0, 0).body[0].figure = 'figNone'; }), ['part 1 section 1: figure "figNone" is not drawn by the level\'s drawFigures']);
});

test('a Remember line that is missing, not one sentence, or over 16 words', () => {
  const takeaway = (t) => at((d) => { sec(d, 0, 1).takeaway = t; });
  assert.deepEqual(takeaway(undefined), ['part 1 section 2: needs a takeaway']);
  assert.deepEqual(takeaway('One idea. Then another.'), ['part 1 section 2: the takeaway must be one sentence']);
  assert.deepEqual(takeaway(`${words(L.takeawayWords)}.`), []);
  assert.deepEqual(takeaway(`${words(L.takeawayWords + 1)}.`), ['part 1 section 2: the takeaway has 17 words, more than 16']);
});

test('a section with the old fields: its own question, a uses line or missions', () => {
  for (const [key, value] of [['check', check()], ['uses', 'In the mission.'], ['missions', [0]]]) {
    assert.deepEqual(at((d) => { sec(d, 0, 1)[key] = value; }), [`part 1 section 2: has ${key}, which a section does not take; remove it`]);
  }
  // The section held the only "12 apples", so the wrap-up's number loses its source too.
  assert.deepEqual(at((d) => { part(d, 0).sections[1] = null; }), ['part 1 section 2: is not a section object',
    'wrap: the number "12 apples" is in no section of this level']);
});

test('0 to 2 Check yourself questions in a part, without a kind', () => {
  assert.deepEqual(at((d) => { delete part(d, 0).checks; }), []);
  assert.deepEqual(at((d) => { part(d, 0).checks = []; }), []);
  assert.deepEqual(at((d) => { part(d, 0).checks.push(check()); }), []);
  assert.deepEqual(at((d) => { part(d, 0).checks.push(check(), check()); }), ['part 1: has 3 Check yourself questions, more than 2']);
  assert.deepEqual(at((d) => { part(d, 0).checks = check(); }), ['part 1: checks must be a list of questions']);
  assert.deepEqual(at((d) => { part(d, 0).checks[0].kind = 'guess'; }), ['part 1: question 1: a Check yourself question has no kind; remove it']);
});

test('a question with other than 2 or 3 options, one right, or an option without its text or explanation', () => {
  const options = (edit) => at((d) => edit(part(d, 0).checks[0].options));
  assert.deepEqual(options((o) => o.push({ t: 'C', why: 'No.' })), []);
  assert.deepEqual(options((o) => o.pop()), ['part 1: question 1: the check needs 2 or 3 options; it has 1']);
  assert.deepEqual(options((o) => o.push({ t: 'C', why: 'No.' }, { t: 'D', why: 'No.' })), ['part 1: question 1: the check needs 2 or 3 options; it has 4']);
  assert.deepEqual(options((o) => { o[1].right = true; }), ['part 1: question 1: the check has 2 right options, not exactly one']);
  assert.deepEqual(options((o) => { delete o[1].t; }), ['part 1: question 1: every check option needs its text']);
  assert.deepEqual(options((o) => { delete o[1].why; }), ['part 1: question 1: every check option needs a why']);
  assert.deepEqual(at((d) => { part(d, 0).checks[0].q = ''; }), ['part 1: question 1: the check needs a question']);
});

test('a mission card\'s "You will" list of 2 to 4 lines', () => {
  const youWill = (list) => at((d) => { part(d, 0).youWill = list; });
  assert.deepEqual(youWill(['One.', 'Two.', 'Three.', 'Four.']), []);
  assert.deepEqual(youWill(['One.']), ['part 1: needs 2 to 4 lines in its "You will" list; it has 1']);
  assert.deepEqual(youWill(['1.', '2.', '3.', '4.', '5.']), ['part 1: needs 2 to 4 lines in its "You will" list; it has 5']);
  assert.deepEqual(youWill(undefined), ['part 1: needs 2 to 4 lines in its "You will" list; it has none']);
  assert.deepEqual(youWill(['One.', ' ']), ['part 1: every line of its "You will" list needs text']);
});

test('a New part card names one of the level\'s components', () => {
  assert.deepEqual(at((d) => { delete part(d, 0).newParts; }), []);
  assert.deepEqual(at((d) => { part(d, 1).newParts = [card({ type: 'users' })]; }), []);
  assert.deepEqual(at((d) => { part(d, 0).newParts = [card({ type: 'lb' })]; }), ['part 1: New part card 1: "lb" is not one of the level\'s components']);
  assert.deepEqual(at((d) => { part(d, 0).newParts = card(); }), ['part 1: newParts must be a list of cards']);
  assert.deepEqual(at((d) => { part(d, 0).newParts = ['dns']; }), ['part 1: New part card 1: is not a card object']);
});

test('a New part card may name the section it comes before, and the component\'s name written out', () => {
  // Part 1 has 2 sections, so `before` is 0 or 1.
  assert.deepEqual(at((d) => { part(d, 0).newParts = [card({ before: 1, aka: 'Domain Name System' })]; }), []);
  for (const before of [2, -1, 0.5, '1']) {
    assert.deepEqual(at((d) => { part(d, 0).newParts = [card({ before })]; }), [`part 1: New part card 1: before must be the index of a section of its part; it is ${before}`]);
  }
  assert.deepEqual(at((d) => { part(d, 0).newParts = [card({ aka: '' })]; }), ['part 1: New part card 1: aka must be text when it is there']);
});

test('across levels: a component needs a New part card in the first level that has it; levels not on one page are skipped', () => {
  const paged = (id, types, carded) => ({ id, components: Object.fromEntries(types.map((t) => [t, {}])), lesson: { parts: [{ newParts: [] }, { newParts: carded.map((type) => ({ type })) }] } });
  const old = (id, types) => ({ id, components: Object.fromEntries(types.map((t) => [t, {}])), lessonHtml: '<p>Old lesson</p>' });
  assert.deepEqual(newPartProblems([paged(1, ['users', 'dns'], ['users', 'dns'])]), []);
  assert.deepEqual(newPartProblems([paged(1, ['users', 'dns'], ['users'])]), ['Level 1: "dns" first appears in this level and has no New part card']);
  // Level 2 needs a card only for what Level 1 did not have.
  assert.deepEqual(newPartProblems([paged(1, ['users'], ['users']), paged(2, ['users', 'lb'], ['lb'])]), []);
  assert.deepEqual(newPartProblems([paged(1, ['users'], ['users']), paged(2, ['users', 'lb'], [])]), ['Level 2: "lb" first appears in this level and has no New part card']);
  // A level not on one page yet is skipped, and what it has counts as introduced for the levels after it.
  assert.deepEqual(newPartProblems([old(1, ['users', 'dns']), paged(2, ['users', 'dns', 'lb'], ['lb'])]), []);
  assert.deepEqual(newPartProblems([paged(1, ['users'], ['users']), old(2, ['users', 'lb']), paged(3, ['users', 'lb', 'cache'], [])]), ['Level 3: "cache" first appears in this level and has no New part card']);
  // A one-page lesson without any card list.
  assert.deepEqual(newPartProblems([{ id: 1, components: { users: {} }, lesson: { parts: [{}] } }]), ['Level 1: "users" first appears in this level and has no New part card']);
});

test('a New part card\'s three lines: what it is (25 words), what it does (30), in the game (20)', () => {
  const edit = (key, text) => at((d) => { part(d, 0).newParts[0][key] = text; });
  for (const [key, what, max] of [['what', 'what it is', L.cardWhatWords], ['does', 'what it does', L.cardDoesWords], ['game', 'in the game', L.cardGameWords]]) {
    assert.deepEqual(edit(key, ''), [`part 1: New part card 1: needs ${what}`]);
    assert.deepEqual(edit(key, words(max)), []);
    assert.deepEqual(edit(key, words(max + 1)), [`part 1: New part card 1: ${what} has ${max + 1} words, more than ${max}`]);
  }
});

test('a debrief on every part but the last; the last may have one', () => {
  assert.deepEqual(at((d) => { delete part(d, 0).debrief; }), ['part 1: needs a debrief']);
  assert.deepEqual(at((d) => { part(d, 1).debrief = debrief(); }), []);
  assert.deepEqual(at((d) => { part(d, 1).debrief = 'Done.'; }), ['part 2: needs a debrief']);
});

test('a debrief without what the player saw, one number, or what breaks next', () => {
  const edit = (change) => at((d) => change(part(d, 0).debrief));
  assert.deepEqual(edit((b) => { delete b.saw; }), ['part 1: the debrief needs what the player saw']);
  assert.deepEqual(edit((b) => { b.number = ['about 100 ms']; }), ['part 1: the debrief needs one number as [value, meaning]']);
  assert.deepEqual(edit((b) => { b.next = ''; }), ['part 1: the debrief needs what breaks next']);
});

test('a debrief over 60 words, counting what was seen, the number and what breaks next', () => {
  // The number has 3 + 5 words ("about 100 ms", "response time at 50 req/s") and next has 2: 10, so saw may have 50.
  assert.deepEqual(at((d) => { part(d, 0).debrief.saw = words(L.debriefWords - 10); }), []);
  assert.deepEqual(at((d) => { part(d, 0).debrief.saw = words(L.debriefWords - 9); }), ['part 1: the debrief has 61 words, more than 60']);
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

test('at most 4 wrap-up numbers, each found in a section of the level', () => {
  const numbers = (list) => at((d) => { lesson(d).wrap.numbers = list; });
  const two = ['2×', 'peak'];
  assert.deepEqual(numbers([]), []);
  assert.deepEqual(numbers([two, two, two, two]), []);
  assert.deepEqual(numbers([two, two, two, two, two]), ['wrap: has 5 numbers, more than 4']);
  assert.deepEqual(numbers([two, ['86,400', 'seconds in a day']]), ['wrap: the number "86,400" is in no section of this level']);
  assert.deepEqual(numbers([['2×'], two]), ['wrap: numbers needs a list of [value, meaning] pairs']);
  // Found through inline markup and spacing in the section ("<b>2×</b>&nbsp;the").
  assert.deepEqual(at((d) => { sec(d, 0, 0).body[1].p = 'Peak is <b>2×</b>&nbsp;the average.'; }), []);
  // A number only in the debrief or the wrap-up itself is not taught in a section.
  assert.deepEqual(numbers([['about 100 ms', 'response time']]), ['wrap: the number "about 100 ms" is in no section of this level']);
});

test('a wrap-up without the still-broken line, or with a loop that is not text', () => {
  assert.deepEqual(at((d) => { delete lesson(d).wrap.broken; }), ['wrap: needs the line on what is still broken']);
  assert.deepEqual(at((d) => { lesson(d).wrap.loop = 'Every level repeats this loop.'; }), []);
  assert.deepEqual(at((d) => { lesson(d).wrap.loop = ['A list.']; }), ['wrap: loop must be text when it is there']);
});

test('every quiz question is prepared by a section, and every index exists', () => {
  assert.deepEqual(at((d) => { sec(d, 1, 0).quiz = []; }), ['quiz question index 1 is in no section\'s quiz']);
  assert.deepEqual(at((d) => { sec(d, 0, 1).quiz = [2]; }), ['part 1 section 2: quiz question index 2 does not exist']);
  assert.deepEqual(at((d) => { delete sec(d, 0, 1).quiz; }), ['part 1 section 2: needs a quiz question list (it may be empty)']);
});

test('a warning for each number of a million or more written in digits, in every part of the lesson', () => {
  const advice = 'is written in digits; use the word ("40 million", "1.2 billion")';
  assert.deepEqual(lessonWarnings(level()), []);
  assert.deepEqual(lessonWarnings(level((d) => { lesson(d).intro.story = 'You serve 2,000,000 users.'; })), [`2,000,000 ${advice}`]);
  assert.deepEqual(lessonWarnings(level((d) => { sec(d, 0, 1).hook = 'It has 3,000,000 users.'; })), [`part 1 section 2: 3,000,000 ${advice}`]);
  assert.deepEqual(lessonWarnings(level((d) => { part(d, 0).debrief.next = 'Then 4,000,000 users.'; })), [`part 1: 4,000,000 ${advice}`]);
  assert.deepEqual(lessonWarnings(level((d) => { part(d, 0).youWill[0] = 'Serve 6,000,000 users.'; })), [`part 1: 6,000,000 ${advice}`]);
  assert.deepEqual(lessonWarnings(level((d) => { lesson(d).wrap.say[0] = 'Plan for 5,000,000 users.'; })), [`5,000,000 ${advice}`]);
});
