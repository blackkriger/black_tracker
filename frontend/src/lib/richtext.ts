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

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);

export function fromPlain(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Descriptions may be plain text (older rows, API writes), not editor HTML.
export const looksLikeHtml = (text: string): boolean => /^\s*<(p|h3|h4|ul|ol|pre|blockquote)\b/i.test(text);

const BARE_URL = /https?:\/\/[^\s<>"']+/gi;

function trimUrl(raw: string): string {
  let url = raw.replace(/[.,;:!?'"]+$/, '');
  while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
    url = url.slice(0, -1).replace(/[.,;:!?'"]+$/, '');
  }
  return url;
}

function linkTo(url: string): HTMLAnchorElement | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const link = document.createElement('a');
  link.href = url;
  if (parsed.origin !== window.location.origin) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  link.textContent = url;
  return link;
}

export function paintLinks(html: string): string {
  if (!/https?:\/\//i.test(html)) return html;
  const box = document.createElement('div');
  box.innerHTML = html;

  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('a, code, pre')) continue;
    if (/https?:\/\//i.test(node.nodeValue ?? '')) texts.push(node as Text);
  }

  let touched = false;
  for (const node of texts) {
    const text = node.nodeValue ?? '';
    const parts = document.createDocumentFragment();
    let at = 0;
    for (const m of text.matchAll(BARE_URL)) {
      const url = trimUrl(m[0]);
      const link = linkTo(url);
      if (!link) continue;
      const from = m.index ?? 0;
      parts.append(text.slice(at, from), link);
      at = from + url.length;
    }
    if (!at) continue;
    parts.append(text.slice(at));
    node.replaceWith(parts);
    touched = true;
  }

  return touched ? box.innerHTML : html;
}

const CHECK_ITEM = 'li[data-list="checked"], li[data-list="unchecked"]';

export function paintChecks(html: string, editable: boolean): string {
  if (!html.includes('checked"')) return html;
  const box = document.createElement('div');
  box.innerHTML = html;
  const items = box.querySelectorAll(CHECK_ITEM);
  if (!items.length) return html;
  items.forEach((li, i) => {
    const mark = document.createElement('button');
    mark.type = 'button';
    mark.className = 'tick';
    mark.setAttribute('role', 'checkbox');
    mark.setAttribute('aria-checked', String(li.getAttribute('data-list') === 'checked'));
    if (editable) mark.dataset.check = String(i);
    else mark.disabled = true;
    li.prepend(mark);
  });
  return box.innerHTML;
}

export function flipCheck(html: string, index: number): string {
  const box = document.createElement('div');
  box.innerHTML = html;
  const li = box.querySelectorAll(CHECK_ITEM)[index];
  if (!li) return html;
  li.setAttribute('data-list', li.getAttribute('data-list') === 'checked' ? 'unchecked' : 'checked');
  return box.innerHTML;
}

const LIST_ITEM = 'li[data-list="bullet"], li[data-list="ordered"]';

export function paintStrikes(html: string): string {
  if (!html.includes('data-list="bullet"') && !html.includes('data-list="ordered"')) return html;
  const box = document.createElement('div');
  box.innerHTML = html;
  box.querySelectorAll<HTMLElement>(LIST_ITEM).forEach((li, i) => {
    li.classList.add('strikable');
    li.dataset.strike = String(i);
  });
  return box.innerHTML;
}

export function flipStrike(html: string, index: number): string {
  const box = document.createElement('div');
  box.innerHTML = html;
  const li = box.querySelectorAll(LIST_ITEM)[index];
  if (!li) return html;
  const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
  let words = false;
  let struck = true;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue?.trim()) continue;
    words = true;
    if (!node.parentElement?.closest('s')) struck = false;
  }
  li.querySelectorAll('s').forEach((s) => s.replaceWith(...s.childNodes));
  if (words && !struck) {
    const s = document.createElement('s');
    s.append(...li.childNodes);
    li.append(s);
  }
  return box.innerHTML;
}

export const asHtml = (text: string, editable = false, strikable = false): string => {
  if (!text) return '';
  const html = paintChecks(
    paintKeys(paintNames(paintLinks(trimBlank(looksLikeHtml(text) ? clean(text) : clean(fromPlain(text)))))),
    editable
  );
  return strikable ? paintStrikes(html) : html;
};
