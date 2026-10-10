import type en from '../en/tags';
import type { Shape } from '../shape';

const tags: Shape<typeof en> = {
  colorOf: 'Цвет тега {name}',
  addPlaceholder: 'Добавить тег…',
  loadFailed: 'Не получилось загрузить теги.',
  boards: 'Доски',
  none: 'Пока нет.',
};

export default tags;
