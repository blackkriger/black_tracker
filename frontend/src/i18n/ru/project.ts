import type en from '../en/project';
import type { Shape } from '../shape';

const project: Shape<typeof en> = {
  repo: 'Репозиторий GitHub',
  loadFailed: 'Не получилось загрузить проект.',
  defaultStatus: 'Статус по умолчанию',
  defaultAssignee: 'Исполнитель по умолчанию',
  order: 'Порядок',
  open: 'Открытый',
  resolved: 'Закрытый',
  actions: 'Действия',
  newBoard: 'Новая доска',
  archived: 'В архиве',
  restore: 'Вернуть из архива',
  archive: 'В архив',
  deleteBoard: 'Удалить доску',
  colorOf: 'Цвет статуса {name}',
  deleteStatus: 'Удалить статус',
  addStatus: 'Добавить статус…',
  addBoard: 'Добавить доску…',
  deleteBoardText: 'Вместе с доской удалятся её статусы и задачи. Это нельзя отменить.',
  deleteProjectText: 'Вместе с проектом удалятся его доски, статусы, задачи и собственные теги. Это нельзя отменить.',
  typeName: 'Введи название проекта, чтобы подтвердить',
  deleteProject: 'Удалить проект',
};

export default project;
