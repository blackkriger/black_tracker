import Quill from 'quill';
import { keyInfo } from './issueKeys';
import { ink } from './theme';

const Inline = Quill.import('blots/inline') as {
  new (...args: unknown[]): object;
  create(value: unknown): HTMLElement;
};

class IssueKey extends Inline {
  static blotName = 'issuekey';
  static tagName = 'span';
  static className = 'ikey';

  static create(value: string): HTMLElement {
    const node = super.create(value);
    node.setAttribute('data-key', value);
    const info = keyInfo(value);
    if (info) {
      node.style.color = ink(info.stateColor) ?? '';
      if (info.resolved) node.classList.add('is-closed');
    }
    return node;
  }

  static formats(node: HTMLElement): string | boolean {
    return node.getAttribute('data-key') ?? true;
  }
}

Quill.register(IssueKey as never);
