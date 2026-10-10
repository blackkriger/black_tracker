import type en from '../en/analytics';
import type { Shape } from '../shape';

const analytics: Shape<typeof en> = {
  countFailed: 'Не получилось ничего посчитать.',
  boards: 'Доски',
  noBoards: 'Нечего считать: досок нет.',
  priorities: 'Приоритеты',
  timeToClose: 'Время до закрытия',
  nothingClosed: 'За этот период ничего не закрыли.',
  deadlines: 'Сроки',
  late: 'просрочено: {n}',
  nothingDue: 'В этот период сроков нет.',
  team: 'Команда',
  colOpen: 'откр.',
  colLate: 'проср.',
  colClosed: 'закр.',
  colHeld: 'держит',
  holdingNothing: 'Ничего на руках.',
  still: 'сейчас',
  workedOn: 'Над чем работали',
  colIssues: 'задачи',
  colTime: 'время',
  nothingWorked: 'За этот период ни над чем не работали.',
};

export default analytics;
