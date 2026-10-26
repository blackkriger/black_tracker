import type { Locale } from '../i18n';

export type Words = Record<Locale, string>;

type Raw =
  | { kind: 'choice'; key: string; title: Words; options: Record<string, Words> }
  | { kind: 'scale'; key: string; title: Words; short: Words }
  | { kind: 'ratings'; key: string; title: Words; aspects: Record<string, Words>; shorts: Record<string, Words> }
  | { kind: 'text'; key: string; title: Words };

export interface RawSection {
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

export function feedbackForm(raw: RawSection[], lang: Locale): FeedbackSection[] {
  return raw.map((s) => ({ id: s.id, title: s.title[lang], items: s.items.map((it) => localize(it, lang)) }));
}
