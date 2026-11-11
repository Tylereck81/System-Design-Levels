// The mock interview's steps and saved problem, shared by the mock level (mock.js) and its panel (js/ui/mock.js).

/** localStorage key of the chosen problem (a level id); a missing or unknown one picks at random. */
export const PROBLEM_KEY = 'sdl-mock-problem';

/** The four steps of an interview, with the minutes each should take. */
export const STEPS = [
  { name: 'Scope it', min: 5, max: 8, tip: 'Ask what it must do, for whom, and at what scale. Estimate the traffic and storage.' },
  { name: 'Sketch it', min: 10, max: 12, tip: 'Put the main parts on the canvas and connect them. Press Play to see it carry the load.' },
  { name: 'Go deep', min: 15, max: 20, tip: 'Pick the two or three hardest parts and get them right. Tune the settings in the inspector.' },
  { name: 'Stress it', min: 5, max: 5, tip: 'Break it: run the experiments, and say how the design handles each failure.' },
];

/** The interview's length in minutes: every step at its longest (45). */
export const INTERVIEW_MINUTES = STEPS.reduce((total, step) => total + step.max, 0);
