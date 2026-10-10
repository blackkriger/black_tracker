import type en from '../en/files';
import type { Shape } from '../shape';

const files: Shape<typeof en> = {
  remove: 'Убрать {name}',
  previous: 'Назад',
  next: 'Вперёд',
  reading: 'Читаем…',
  readFailed: 'Не получилось прочитать файл.',
  diagram: 'Схема',
  truncated: 'Показаны только первые 512 КБ. Скачай файл, чтобы прочитать остальное.',
  foldTitle: 'Переносить длинные строки (Alt+Z)',
  wrap: 'Перенос',
  zoomOut: 'Уменьшить',
  zoomIn: 'Увеличить',
  fit: 'Вписать',
  download: 'Скачать',
};

export default files;
