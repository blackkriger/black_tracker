export type FeedbackItem =
  | { kind: 'choice'; key: string; title: string; options: Record<string, string> }
  | { kind: 'scale'; key: string; title: string; short: string }
  | { kind: 'ratings'; key: string; title: string; aspects: Record<string, string>; shorts: Record<string, string> }
  | { kind: 'text'; key: string; title: string; short: string };

export interface FeedbackSection {
  id: string;
  title: string;
  items: FeedbackItem[];
}

const DEMO: FeedbackSection[] = [
  {
    id: 'about',
    title: 'A bit about you',
    items: [
      {
        kind: 'choice',
        key: 'played',
        title: 'Roughly how long did you play?',
        options: { lt15: 'under 15 minutes', '15-30': '15–30 minutes', '30-60': '30–60 minutes', '1-2h': '1–2 hours', gt2h: 'over 2 hours' },
      },
      {
        kind: 'choice',
        key: 'device',
        title: 'What did you play on?',
        options: { kbm: 'keyboard + mouse', gamepad: 'gamepad', both: 'both' },
      },
      {
        kind: 'choice',
        key: 'genre',
        title: 'Have you played games like this before?',
        options: { mine: "yes, it's my genre", some: 'a couple of times', first: 'no, first time' },
      },
      {
        kind: 'text',
        key: 'genreText',
        title: 'Tell us about those games: your favourites and what you love about them',
        short: 'Similar games',
      },
    ],
  },
  {
    id: 'ending',
    title: 'How it ended',
    items: [
      {
        kind: 'choice',
        key: 'stopped',
        title: 'At what point did you stop playing?',
        options: {
          finished: 'finished everything there was',
          bored: 'got bored',
          stuck: "got stuck, didn't know where to go",
          hard: 'it was too hard',
          crash: 'the game broke or crashed',
          other: 'something else',
        },
      },
      { kind: 'text', key: 'stoppedText', title: 'Tell us what happened at that moment:', short: 'Why they stopped' },
    ],
  },
  {
    id: 'ratings',
    title: 'Ratings',
    items: [
      {
        kind: 'ratings',
        key: 'ratings',
        title: 'Rate from 1 to 5',
        aspects: {
          exploration: 'Exploration',
          combat: 'Combat',
          visuals: 'Visuals',
          narrative: 'Narrative',
          progression: 'Heroine upgrades',
        },
        shorts: { progression: 'Upgrades' },
      },
      {
        kind: 'text',
        key: 'ratingsText',
        title: 'Tell us more: what did you like, what got in the way?',
        short: 'About the ratings',
      },
    ],
  },
  {
    id: 'start',
    title: 'The opening',
    items: [
      { kind: 'scale', key: 'startClear', title: 'Was it clear what to do in the first minutes?', short: 'Opening' },
      { kind: 'text', key: 'startText', title: 'What was still unclear at the start?', short: 'Unclear at the start' },
    ],
  },
  {
    id: 'combat',
    title: 'Combat in detail',
    items: [
      { kind: 'scale', key: 'readAttacks', title: 'Could you read enemy attacks and react in time?', short: 'Attacks' },
      { kind: 'text', key: 'combatText', title: 'Tell us more about the fights:', short: 'About the fights' },
      { kind: 'scale', key: 'deathsFair', title: 'Did deaths feel fair?', short: 'Deaths' },
      {
        kind: 'choice',
        key: 'potions',
        title: 'Did you have enough healing potions?',
        options: { enough: 'enough', barely: 'just barely', short: 'not enough' },
      },
    ],
  },
  {
    id: 'progress',
    title: 'Progression and navigation',
    items: [
      { kind: 'scale', key: 'upgrades', title: 'Is it clear how to upgrade the heroine?', short: 'Upgrades' },
      {
        kind: 'choice',
        key: 'coins',
        title: 'Did you have enough coins and runes?',
        options: { enough: 'enough', barely: 'just barely', short: 'not enough', unclear: "didn't get what they're for" },
      },
      { kind: 'scale', key: 'lost', title: 'Did you get lost on the map?', short: 'Map' },
      { kind: 'text', key: 'lostText', title: 'Where exactly did you get lost?', short: 'Where they got lost' },
      { kind: 'scale', key: 'interact', title: 'Is it clear what you can pick up and interact with?', short: 'Interaction' },
    ],
  },
  {
    id: 'tech',
    title: 'Technical',
    items: [
      { kind: 'text', key: 'bugsText', title: 'Any frame drops, crashes or bugs? Describe the moment:', short: 'Bugs' },
    ],
  },
  {
    id: 'last',
    title: 'Last bits',
    items: [
      { kind: 'text', key: 'addText', title: 'One thing worth adding:', short: 'Worth adding' },
      { kind: 'text', key: 'removeText', title: 'One thing worth removing:', short: 'Worth removing' },
    ],
  },
];

export const FEEDBACK_FORMS: Record<string, FeedbackSection[]> = { demo: DEMO };
