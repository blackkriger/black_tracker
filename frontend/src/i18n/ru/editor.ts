import type en from '../en/editor';
import type { Shape } from '../shape';

const editor: Shape<typeof en> = {
  bold: 'Жирный',
  italic: 'Курсив',
  strike: 'Зачёркнутый',
  code: 'Код',
  heading: 'Заголовок',
  bullets: 'Маркированный список',
  numbers: 'Нумерованный список',
  quote: 'Цитата',
  link: 'Ссылка',
  linkTo: 'Адрес ссылки',
};

export default editor;
