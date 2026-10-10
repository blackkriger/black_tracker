import type en from '../en/fields';
import type { Shape } from '../shape';

const fields: Shape<typeof en> = {
  projects: 'Проекты',
  project: 'Проект',
  board: 'Доска',
  status: 'Статус',
  priority: 'Приоритет',
  assignee: 'Исполнитель',
  watcher: 'Наблюдатель',
  author: 'Автор',
  due: 'Срок',
  tags: 'Теги',
  created: 'Создана',
  nobody: 'Не назначен',
};

export default fields;
