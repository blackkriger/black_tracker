import type en from '../en/common';
import type { Shape } from '../shape';

const common: Shape<typeof en> = {
  loading: 'Загрузка…',
  noSuchPage: 'Такой страницы нет.',
  noProjects: 'Проектов пока нет.',
  projectsFailed: 'Не получилось загрузить проекты.',
  wentWrong: 'Что-то пошло не так.',
  requestFailed: 'Запрос не прошёл ({status}).',
  close: 'Закрыть',
  all: 'все',
  add: 'Добавить',
  deleteNamed: 'Удалить {name}',
  cancel: 'Отмена',
  save: 'Сохранить',
  saved: 'Сохранено.',
  delete: 'Удалить',
  remove: 'Убрать',
  rename: 'Переименовать',
};

export default common;
