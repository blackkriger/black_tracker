import type en from '../en/notices';
import type { Shape } from '../shape';

const notices: Shape<typeof en> = {
  kinds: {
    mention: 'Упоминания',
    assigned: 'Назначенные тебе',
    reaction: 'Реакции',
    starred: 'Избранные задачи',
    ping: 'Пинги',
  },
  reacted: { m: 'отреагировал', f: 'отреагировала', x: 'отреагировал(а)' },
  assigned: { m: 'назначил тебя', f: 'назначила тебя', x: 'назначил(а) тебя' },
  review: { m: 'попросил проверить', f: 'попросила проверить', x: 'попросил(а) проверить' },
  pinged: { m: 'пингнул тебя', f: 'пингнула тебя', x: 'пингнул(а) тебя' },
  linked: 'связь с {key}',
  unlinked: 'связь с {key} убрана',
  fields: {
    status: 'статус',
    assignee: 'исполнитель',
    watcher: 'наблюдатель',
    priority: 'приоритет',
    due: 'срок',
  },
};

export default notices;
