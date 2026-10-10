import type en from '../en/issues';
import type { Shape } from '../shape';

const issues: Shape<typeof en> = {
  searchTiny: 'Поиск…',
  searchSmall: 'Название или ключ…',
  search: 'Поиск по названию или ключу…',
  searchLabel: 'Поиск задач',
  shown: 'Какие задачи показывать',
  open: 'Открытые',
  all: 'Все',
  key: 'Ключ',
  summary: 'Название',
  nothingFound: 'Ничего не найдено.',
};

export default issues;
