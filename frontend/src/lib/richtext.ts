import DOMPurify from './purify';
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
  'img',
];

const OWN_IMAGE =
  /^(?:\/api\/attachments\/[0-9a-f-]{36}$|https:\/\/[a-z0-9-]+\.googleusercontent\.com\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i;

function keepOwnImages(html: string): string {
  if (!html.includes('<img')) return html;
  const box = document.createElement('template');
  box.innerHTML = html;
  for (const img of box.content.querySelectorAll('img')) {
    if (!OWN_IMAGE.test(img.getAttribute('src') ?? '')) img.remove();
  }
  return box.innerHTML;
}

export function clean(html: string): string {
  return keepOwnImages(DOMPurify.sanitize(html ?? '', {
    ALLOWED_TAGS,
    // Quill marks both list kinds as <ol> and tells them apart by data-list; keep it allowed.
    ALLOWED_ATTR: ['href', 'target', 'rel', 'data-list', 'src'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/)/i,
  }));
}

const EMPTY_EDGES = /^(?:\s*<p(?:\s[^>]*)?>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>)+|(?:<p(?:\s[^>]*)?>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>\s*)+$/gi;

export const trimBlank = (html: string): string => html.replace(EMPTY_EDGES, '');

export function isBlank(html: string): boolean {
  const cleaned = clean(html);
  return !/<img\b/i.test(cleaned) && cleaned.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === '';
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
