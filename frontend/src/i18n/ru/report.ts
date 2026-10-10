import type en from '../en/report';
import type { Shape } from '../shape';

const report: Shape<typeof en> = {
  readFailed: 'Не получилось прочитать фидбек.',
  sentRow: 'Отправили',
  sentAt: 'Отправлен',
  unknown: 'Неизвестно',
  other: 'Другие',
  date: 'Дата',
  language: 'Язык',
  name: 'Имя',
  email: 'Почта',
  form: 'Форма',
  funnel: 'Воронка',
  views: '{n} просмотр | {n} просмотра | {n} просмотров',
  section: 'Раздел',
  reached: 'Дошли',
  share: 'Доля',
  medianTime: 'Медианное время',
  responses: 'Ответы',
  noResponses: 'Ответов пока нет.',
  audience: 'Аудитория',
  noVisits: 'Заходов пока нет.',
  comments: 'Комментарии',
  sections: 'Разделы',
  noAnswers: 'Ответов пока нет.',
  ratings: 'Оценки',
  scales: 'Шкалы',
  dims: { country: 'Страна', device: 'Устройство', os: 'Система', browser: 'Браузер', browserLang: 'Язык браузера', lang: 'Язык страницы', theme: 'Тема' },
  devices: { desktop: 'Компьютер', phone: 'Телефон', tablet: 'Планшет' },
  formNames: { demo: 'Фидбек по демо' },
};

export default report;
