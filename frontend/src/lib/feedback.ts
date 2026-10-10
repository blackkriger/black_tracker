import type { Locale } from '../i18n';

type Words = Record<Locale, string>;

type Raw =
  | { kind: 'choice'; key: string; title: Words; options: Record<string, Words> }
  | { kind: 'scale'; key: string; title: Words; short: Words }
  | { kind: 'ratings'; key: string; title: Words; aspects: Record<string, Words>; shorts: Record<string, Words> }
  | { kind: 'text'; key: string; title: Words };

interface RawSection {
  id: string;
  title: Words;
  items: Raw[];
}

export type FeedbackItem =
  | { kind: 'choice'; key: string; title: string; options: Record<string, string> }
  | { kind: 'scale'; key: string; title: string; short: string }
  | { kind: 'ratings'; key: string; title: string; aspects: Record<string, string>; shorts: Record<string, string> }
  | { kind: 'text'; key: string; title: string };

export interface FeedbackSection {
  id: string;
  title: string;
  items: FeedbackItem[];
}

const DEMO: RawSection[] = [
  {
    id: 'about',
    title: { en: 'A bit about you', ru: 'Пара слов о тебе' },
    items: [
      {
        kind: 'choice',
        key: 'played',
        title: { en: 'Roughly how long did you play?', ru: 'Сколько примерно ты играл?' },
        options: {
          lt15: { en: 'under 15 minutes', ru: 'меньше 15 минут' },
          '15-30': { en: '15–30 minutes', ru: '15–30 минут' },
          '30-60': { en: '30–60 minutes', ru: '30–60 минут' },
          '1-2h': { en: '1–2 hours', ru: '1–2 часа' },
          gt2h: { en: 'over 2 hours', ru: 'больше 2 часов' },
        },
      },
      {
        kind: 'choice',
        key: 'device',
        title: { en: 'What did you play on?', ru: 'На чём играл?' },
        options: {
          kbm: { en: 'keyboard + mouse', ru: 'клавиатура + мышь' },
          gamepad: { en: 'gamepad', ru: 'геймпад' },
          both: { en: 'both', ru: 'и то и другое' },
        },
      },
      {
        kind: 'choice',
        key: 'genre',
        title: { en: 'Have you played games like this before?', ru: 'Играл раньше в похожие игры?' },
        options: {
          mine: { en: "yes, it's my genre", ru: 'да, это мой жанр' },
          some: { en: 'a couple of times', ru: 'пару раз' },
          first: { en: 'no, first time', ru: 'нет, впервые' },
        },
      },
      {
        kind: 'text',
        key: 'genreText',
        title: {
          en: 'Tell us about those games: your favourites and what you love about them',
          ru: 'Расскажи о таких играх: какие любимые и что в них нравится',
        },
      },
    ],
  },
  {
    id: 'ending',
    title: { en: 'How it ended', ru: 'Чем закончилось' },
    items: [
      {
        kind: 'choice',
        key: 'stopped',
        title: { en: 'At what point did you stop playing?', ru: 'На каком моменте ты перестал играть?' },
        options: {
          finished: { en: 'finished everything there was', ru: 'прошёл всё, что было' },
          bored: { en: 'got bored', ru: 'надоело' },
          stuck: { en: "got stuck, didn't know where to go", ru: 'застрял, не понял куда идти' },
          hard: { en: 'it was too hard', ru: 'было слишком сложно' },
          crash: { en: 'the game broke or crashed', ru: 'игра сломалась или вылетела' },
          other: { en: 'something else', ru: 'другое' },
        },
      },
      {
        kind: 'text',
        key: 'stoppedText',
        title: { en: 'Tell us what happened at that moment:', ru: 'Расскажи, что произошло в этот момент:' },
      },
    ],
  },
  {
    id: 'ratings',
    title: { en: 'Ratings', ru: 'Оценки' },
    items: [
      {
        kind: 'ratings',
        key: 'ratings',
        title: { en: 'Rate from 1 to 5', ru: 'Оцени по шкале от 1 до 5' },
        aspects: {
          exploration: { en: 'Exploration', ru: 'Исследование' },
          combat: { en: 'Combat', ru: 'Боёвка' },
          visuals: { en: 'Visuals', ru: 'Визуал' },
          narrative: { en: 'Narrative', ru: 'Нарратив' },
          progression: { en: 'Heroine upgrades', ru: 'Прокачка героини' },
        },
        shorts: { progression: { en: 'Upgrades', ru: 'Прокачка' } },
      },
      {
        kind: 'text',
        key: 'ratingsText',
        title: {
          en: 'Tell us more: what did you like, what got in the way?',
          ru: 'Расскажи подробнее: что понравилось, что помешало?',
        },
      },
    ],
  },
  {
    id: 'start',
    title: { en: 'The opening', ru: 'Начало игры' },
    items: [
      {
        kind: 'scale',
        key: 'startClear',
        title: { en: 'Was it clear what to do in the first minutes?', ru: 'Было ли понятно, что делать в первые минуты?' },
        short: { en: 'Opening', ru: 'Начало' },
      },
      {
        kind: 'text',
        key: 'startText',
        title: { en: 'What was still unclear at the start?', ru: 'Что осталось непонятным в начале?' },
      },
    ],
  },
  {
    id: 'combat',
    title: { en: 'Combat in detail', ru: 'Бой подробнее' },
    items: [
      {
        kind: 'scale',
        key: 'readAttacks',
        title: { en: 'Could you read enemy attacks and react in time?', ru: 'Успевал ли читать атаки врагов и реагировать?' },
        short: { en: 'Attacks', ru: 'Атаки' },
      },
      { kind: 'text', key: 'combatText', title: { en: 'Tell us more about the fights:', ru: 'Расскажи о боях подробнее:' } },
      {
        kind: 'scale',
        key: 'deathsFair',
        title: { en: 'Did deaths feel fair?', ru: 'Смерти ощущались справедливыми?' },
        short: { en: 'Deaths', ru: 'Смерти' },
      },
      {
        kind: 'choice',
        key: 'potions',
        title: { en: 'Did you have enough healing potions?', ru: 'Хватало ли зелий лечения?' },
        options: {
          enough: { en: 'enough', ru: 'хватало' },
          barely: { en: 'just barely', ru: 'впритык' },
          short: { en: 'not enough', ru: 'не хватало' },
        },
      },
    ],
  },
  {
    id: 'progress',
    title: { en: 'Progression and navigation', ru: 'Прогрессия и навигация' },
    items: [
      {
        kind: 'scale',
        key: 'upgrades',
        title: { en: 'Is it clear how to upgrade the heroine?', ru: 'Понятно ли, как улучшать героиню?' },
        short: { en: 'Upgrades', ru: 'Прокачка' },
      },
      {
        kind: 'choice',
        key: 'coins',
        title: { en: 'Did you have enough coins and runes?', ru: 'Хватало ли монет и рун?' },
        options: {
          enough: { en: 'enough', ru: 'хватало' },
          barely: { en: 'just barely', ru: 'впритык' },
          short: { en: 'not enough', ru: 'не хватало' },
          unclear: { en: "didn't get what they're for", ru: 'не понял, зачем они' },
        },
      },
      {
        kind: 'scale',
        key: 'lost',
        title: { en: 'Did you get lost on the map?', ru: 'Терялся ли на карте?' },
        short: { en: 'Map', ru: 'Карта' },
      },
      { kind: 'text', key: 'lostText', title: { en: 'Where exactly did you get lost?', ru: 'Где именно терялся?' } },
      {
        kind: 'scale',
        key: 'interact',
        title: {
          en: 'Is it clear what you can pick up and interact with?',
          ru: 'Понятно ли, что можно подобрать и с чем взаимодействовать?',
        },
        short: { en: 'Interaction', ru: 'Объекты' },
      },
    ],
  },
  {
    id: 'tech',
    title: { en: 'Technical', ru: 'Техника' },
    items: [
      {
        kind: 'text',
        key: 'bugsText',
        title: { en: 'Any frame drops, crashes or bugs? Describe the moment:', ru: 'Были просадки, вылеты, баги? Опиши момент:' },
      },
    ],
  },
  {
    id: 'last',
    title: { en: 'Last bits', ru: 'Напоследок' },
    items: [
      { kind: 'text', key: 'addText', title: { en: 'One thing worth adding:', ru: 'Одна вещь, которую стоит добавить:' } },
      { kind: 'text', key: 'removeText', title: { en: 'One thing worth removing:', ru: 'Одна вещь, которую стоит убрать:' } },
    ],
  },
];

const FORMS: Record<string, RawSection[]> = { demo: DEMO };

const each = (words: Record<string, Words>, lang: Locale): Record<string, string> =>
  Object.fromEntries(Object.entries(words).map(([key, w]) => [key, w[lang]]));

function localize(item: Raw, lang: Locale): FeedbackItem {
  switch (item.kind) {
    case 'choice':
      return { ...item, title: item.title[lang], options: each(item.options, lang) };
    case 'scale':
      return { ...item, title: item.title[lang], short: item.short[lang] };
    case 'ratings':
      return { ...item, title: item.title[lang], aspects: each(item.aspects, lang), shorts: each(item.shorts, lang) };
    default:
      return { ...item, title: item.title[lang] };
  }
}

export function feedbackForm(id: string, lang: Locale): FeedbackSection[] {
  return (FORMS[id] ?? []).map((s) => ({ id: s.id, title: s.title[lang], items: s.items.map((it) => localize(it, lang)) }));
}
