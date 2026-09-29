// A name inside the editor, so it is written in its colour as it is typed. The format is
// the editor's own business: it never leaves, because the sanitiser drops the span and the
// reader's side paints the names again from the text itself.
import Quill from 'quill';
import { colorOfName } from './mentions';
import { ink } from './theme';

// Quill hands its blots back untyped; this is the shape the one below needs from it.
const Inline = Quill.import('blots/inline') as {
  new (...args: unknown[]): object;
  create(value: unknown): HTMLElement;
};

class Mention extends Inline {
  static blotName = 'mention';
  static tagName = 'span';
  static className = 'mention';

  static create(value: string): HTMLElement {
    const node = Inline.create(value);
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
