import type en from '../en/priority';
import type { Shape } from '../shape';

const priority: Shape<typeof en> = {
  Critical: 'Критический',
  Major: 'Высокий',
  Normal: 'Обычный',
  Minor: 'Незначительный',
};

export default priority;
