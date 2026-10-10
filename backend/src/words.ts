export type Lang = 'en' | 'ru';
export type Gender = 'm' | 'f' | null;

export const langOf = (lang: string | null | undefined, seen: string | null | undefined): Lang =>
  lang === 'ru' || lang === 'en' ? lang : seen === 'ru' ? 'ru' : 'en';

export type Deed = 'mentioned' | 'assigned' | 'review' | 'pinged' | 'reacted' | 'commentedStarred' | 'changedStarred';

const EN_DEEDS: Record<Deed, (extra: string) => string> = {
  mentioned: () => 'mentioned you',
  assigned: () => 'assigned you',
  review: () => 'asked you to review',
  pinged: () => 'pinged you',
  reacted: (emoji) => `reacted ${emoji} to your comment`,
  commentedStarred: () => 'commented on a starred issue',
  changedStarred: () => 'changed a starred issue',
};

const RU_DEEDS: Record<Deed, [string, (extra: string) => string]> = {
  mentioned: ['упомянул', () => 'тебя'],
  assigned: ['назначил', () => 'тебя'],
  review: ['попросил', () => 'проверить'],
  pinged: ['пингнул', () => 'тебя'],
  reacted: ['отреагировал', (emoji) => `${emoji} на твой комментарий`],
  commentedStarred: ['прокомментировал', () => 'избранную задачу'],
  changedStarred: ['изменил', () => 'избранную задачу'],
};

export function deed(lang: Lang, what: Deed, gender: Gender, extra = ''): string {
  if (lang === 'en') return EN_DEEDS[what](extra);
  const [verb, rest] = RU_DEEDS[what];
  const ending = gender === 'm' ? '' : gender === 'f' ? 'а' : '(а)';
  return `${verb}${ending} ${rest(extra)}`.replace(/\s+/g, ' ').trim();
}

const RU_MONTHS = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЯ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];

export function shortDay(lang: Lang, date: string): string {
  const at = new Date(`${date}T00:00:00Z`);
  if (lang === 'ru') return `${String(at.getUTCDate()).padStart(2, '0')} ${RU_MONTHS[at.getUTCMonth()]}`;
  return at.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).toUpperCase();
}

export const WORDS = {
  en: {
    someone: 'Someone',
    due: (day: string) => `Due ${day}`,
    linked: (key: string | null) => `linked ${key}`,
    unlinked: (key: string | null) => `unlinked ${key}`,
    fields: { status: 'status', assignee: 'assignee', watcher: 'watcher', priority: 'priority', 'due date': 'due' } as Record<
      string,
      string
    >,
    priority: { Critical: 'Critical', Major: 'Major', Normal: 'Normal', Minor: 'Minor' } as Record<string, string>,
    expired: 'This link has expired',
    getNew: ['Get a new one on your ', 'profile', '.'] as const,
    linkedElsewhere: (login: string, title: string) => `${login} is now linked to another ${title} account`,
    isLinked: (login: string) => `${login} is linked`,
    willNotify: "I'll notify you here.",
    unlinkedFrom: (login: string) => `Unlinked from ${login}`,
    wontNotify: "I won't notify you here anymore.",
    created: 'Created ',
    cancel: 'Cancel',
  },
  ru: {
    someone: 'Кто-то',
    due: (day: string) => `Срок ${day}`,
    linked: (key: string | null) => `связь с ${key}`,
    unlinked: (key: string | null) => `связь с ${key} убрана`,
    fields: { status: 'статус', assignee: 'исполнитель', watcher: 'наблюдатель', priority: 'приоритет', 'due date': 'срок' } as Record<
      string,
      string
    >,
    priority: { Critical: 'Критический', Major: 'Высокий', Normal: 'Обычный', Minor: 'Незначительный' } as Record<string, string>,
    expired: 'Ссылка устарела',
    getNew: ['Возьми новую в своём ', 'профиле', '.'] as const,
    linkedElsewhere: (login: string, title: string) => `${login} теперь привязан к другому аккаунту ${title}`,
    isLinked: (login: string) => `${login} привязан`,
    willNotify: 'Буду присылать уведомления сюда.',
    unlinkedFrom: (login: string) => `${login} отвязан`,
    wontNotify: 'Больше не буду присылать сюда уведомления.',
    created: 'Создана ',
    cancel: 'Отмена',
  },
};
