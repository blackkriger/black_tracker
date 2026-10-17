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
  checklist: 'Чеклист',
  quote: 'Цитата',
  link: 'Ссылка',
  image: 'Картинка',
  linkTo: 'Адрес ссылки',
};

export default editor;
