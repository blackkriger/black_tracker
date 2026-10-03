import Quill from 'quill';
import { colorOfName } from './mentions';
import { ink } from './theme';

const Inline = Quill.import('blots/inline') as {
  new (...args: unknown[]): object;
  create(value: unknown): HTMLElement;
};

class Mention extends Inline {
  static blotName = 'mention';
  static tagName = 'span';
  static className = 'mention';

  static create(value: string): HTMLElement {
    const node = super.create(value);
    node.setAttribute('data-name', value);
    const color = colorOfName(value);
    if (color) node.style.color = ink(color) ?? '';
    return node;
  }

  static formats(node: HTMLElement): string | boolean {
    return node.getAttribute('data-name') ?? true;
  }
}

Quill.register(Mention as never);
