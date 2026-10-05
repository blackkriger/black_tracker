import DOMPurify from 'dompurify';
import { paintKeys } from './issueKeys';
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
    // Quill marks both list kinds as <ol> and tells them apart by data-list; keep it allowed.
    ALLOWED_ATTR: ['href', 'target', 'rel', 'data-list'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/)/i,
  });
}

const EMPTY_EDGES = /^(?:\s*<p(?:\s[^>]*)?>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>)+|(?:<p(?:\s[^>]*)?>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>\s*)+$/gi;

export const trimBlank = (html: string): string => html.replace(EMPTY_EDGES, '');

export function isBlank(html: string): boolean {
  return clean(html).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === '';
}

export function fromPlain(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] as string).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Descriptions may be plain text (older rows, API writes), not editor HTML.
export const looksLikeHtml = (text: string): boolean => /^\s*<(p|h3|h4|ul|ol|pre|blockquote)\b/i.test(text);

export const asHtml = (text: string): string =>
  !text ? '' : paintKeys(paintNames(trimBlank(looksLikeHtml(text) ? clean(text) : clean(fromPlain(text)))));
