import type en from '../en/me';
import type { Shape } from '../shape';

const me: Shape<typeof en> = {
  starredFailed: 'Не получилось прочитать избранные задачи.',
  mineFailed: 'Не получилось прочитать твои задачи.',
  monthFailed: 'Не получилось прочитать месяц.',
  openFailed: 'Не получилось открыть задачу.',
  yourIssues: 'Твои задачи',
  nothingOnYou: 'На тебе ничего нет.',
  prevYear: 'Предыдущий год',
  nextYear: 'Следующий год',
  threeMonths: 'Показать три месяца',
  wholeYear: 'Показать весь год',
  markedDays: 'Отмеченные дни',
  nothingMarked: 'В этом году ничего не отмечено.',
  starred: 'В избранном',
  nothingStarred: 'В избранном пусто.',
  nothingForYou: 'Для тебя пока ничего нет.',
};

export default me;
