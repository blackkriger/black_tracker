import type en from '../en/commits';
import type { Shape } from '../shape';

const commits: Shape<typeof en> = {
  search: 'Поиск по SHA или сообщению…',
  searchLabel: 'Поиск коммитов',
  shown: 'Какие коммиты показывать',
  all: 'Все',
  linked: 'Привязанные',
  unlinked: 'Без задачи',
  author: 'Автор',
  branch: 'Ветка',
  sha: 'SHA',
  message: 'Сообщение',
  issues: 'Задачи',
  when: 'Дата',
  more: 'Показать ещё',
  actions: 'Действия с коммитом',
  linkTo: 'Привязать к задаче',
  loadFailed: 'Не получилось прочитать коммиты.',
  changeFailed: 'Не получилось изменить коммит.',
  none: 'Коммитов не найдено.',
};

export default commits;
