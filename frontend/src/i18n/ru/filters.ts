import type en from '../en/filters';
import type { Shape } from '../shape';

const filters: Shape<typeof en> = {
  from: 'С {date}',
  until: 'По {date}',
  anyTime: 'За всё время',
  pickHint: 'Нажми на день или протяни по дням',
  clear: 'Сбросить',
  clearAll: 'Сбросить всё',
};

export default filters;
