// Text written by people, shown to people. The editor writes HTML and the reader is handed HTML, so everything on its way out of the database goes through a strict allowlist first — the same guard another project puts on its reviews.
import DOMPurify from 'dompurify';
import { paintNames } from './mentions';

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  's',
  'u',
  'code',
  'pre',
  'blockquote',
  'ol',
  'ul',
  'li',
  'h3',
  'h4',
  'a',
];

export function clean(html: string): string {
  return DOMPurify.sanitize(html ?? '', {
    ALLOWED_TAGS,
    // Quill writes both kinds of list as <ol> and says which in data-list, so dropping that attribute turned every bullet into a number.
    ALLOWED_ATTR: ['href', 'target', 'rel', 'data-list'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/)/i,
  });
}

/** Whether there is anything in it besides empty paragraphs — what Quill leaves behind when a field is cleared. */
export function isBlank(html: string): boolean {
  return clean(html).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === '';
}

// Text written before the editor arrived is plain: it becomes one paragraph per line rather than one long run.
export function fromPlain(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] as string)}</p>`)
    .join('');
}

/** Whether a stored string is already HTML from the editor, or plain text from before it. */
export const looksLikeHtml = (text: string): boolean => /^\s*<(p|h3|h4|ul|ol|pre|blockquote)\b/i.test(text);

export const asHtml = (text: string): string =>
  !text ? '' : paintNames(looksLikeHtml(text) ? clean(text) : clean(fromPlain(text)));
