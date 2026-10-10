import type en from '../en/board';
import type { Shape } from '../shape';

const board: Shape<typeof en> = {
  manualOrder: 'Ручной порядок',
  byPriority: 'По приоритету',
  byDue: 'По сроку',
  issuesFailed: 'Не получилось загрузить задачи.',
  moveFailed: 'Не получилось переместить карточку.',
  orderLabel: 'Порядок карточек',
  searchPlaceholder: 'Поиск по названию…',
  searchLabel: 'Поиск по доске',
  filterPriority: 'Фильтр по приоритету',
  filterAssignee: 'Фильтр по исполнителю',
  filterWatcher: 'Фильтр по наблюдателю',
  filterAuthor: 'Фильтр по автору',
  onlyFavourites: 'Только избранное',
  clearFilters: 'Сбросить фильтры',
  noBoards: 'В этом проекте нет досок.',
  column: '{name}, {n} задача | {name}, {n} задачи | {name}, {n} задач',
  addTo: 'Добавить задачу в {name}',
};

export default board;
