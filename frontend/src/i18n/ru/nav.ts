import type en from '../en/nav';
import type { Shape } from '../shape';

const nav: Shape<typeof en> = {
  issues: 'Задачи',
  analytics: 'Аналитика',
  feedback: 'Отчёты',
  settings: 'Настройки',
  signOut: 'Выйти',
  projects: 'Проекты',
  menu: 'Меню',
  notices: 'Уведомления',
  calendar: 'Календарь',
  account: 'Аккаунт',
  sections: 'Разделы',
  light: 'Светлая',
  dark: 'Тёмная',
  today: '{what} сегодня',
  till: '{n} день до {what} | {n} дня до {what} | {n} дней до {what}',
};

export default nav;
