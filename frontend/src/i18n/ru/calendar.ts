import type en from '../en/calendar';
import type { Shape } from '../shape';

const calendar: Shape<typeof en> = {
  today: 'сегодня',
  inDays: 'через {n} день | через {n} дня | через {n} дней',
  prevMonth: 'Предыдущий месяц',
  nextMonth: 'Следующий месяц',
  full: 'Весь календарь',
  forYou: '{said} для тебя',
  unreadOf: '{unread} непрочитанное из {said} для тебя | {unread} непрочитанных из {said} для тебя | {unread} непрочитанных из {said} для тебя',
  work: 'в работе: {worked}, открыто: {created}, закрыто: {resolved}',
  nothingYet: 'Пока ничего.',
  everything: 'Все проекты',
  dayFailed: 'Не получилось прочитать день.',
  addEvent: 'Добавить событие…',
  icon: 'Иконка',
  title: 'Название',
  link: 'Ссылка',
  banner: 'Баннер',
  deleteMarkText: 'Оно пропадёт из календаря у всех. Это нельзя отменить.',
  deleteMark: 'Удалить отмеченный день',
  icons: { flag: 'Флажок', milestone: 'Веха', gem: 'Кристалл', sparkles: 'Искры', swords: 'Мечи', rocket: 'Ракета', calendarHeart: 'Календарь с сердцем', crown: 'Корона' },
};

export default calendar;
