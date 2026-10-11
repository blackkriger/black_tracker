interface Marks {
  bold: boolean;
  italic: boolean;
  strike: boolean;
}

const NONE: Marks = { bold: false, italic: false, strike: false };

function marksOf(css: string): Partial<Marks> {
  const weight = /font-weight:\s*(\d+|bold)/i.exec(css)?.[1];
  const style = /font-style:\s*(\w+)/i.exec(css)?.[1];
  const line = /text-decoration:\s*([\w\s-]+)/i.exec(css)?.[1];
  return {
    ...(weight ? { bold: weight === 'bold' || Number(weight) >= 600 } : {}),
    ...(style ? { italic: style === 'italic' } : {}),
    ...(line ? { strike: line.includes('line-through') } : {}),
  };
}

function readClasses(doc: Document): Map<string, Partial<Marks>> {
  const classes = new Map<string, Partial<Marks>>();
  for (const style of doc.querySelectorAll('style')) {
    for (const [, name, body] of (style.textContent ?? '').matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
      classes.set(name, { ...classes.get(name), ...marksOf(body) });
    }
  }
  return classes;
}

const escape = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

function realHref(href: string): string | null {
  try {
    const url = new URL(href);
    const target = url.hostname === 'www.google.com' && url.pathname === '/url' ? url.searchParams.get('q') : href;
    return target && /^(https?:|mailto:)/i.test(target) ? target : null;
  } catch {
    return null;
  }
}

const isMarker = (el: Element): boolean =>
  !!el.querySelector('a[href^="#cmnt"], a[href^="#ftnt"], a[id^="cmnt"], a[id^="ftnt"]');

export function fromGoogleDoc(html: string): { summary: string; description: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const classes = readClasses(doc);

  const marksFor = (el: Element, from: Marks): Marks => {
    const next = { ...from };
    for (const name of el.classList) {
      const set = classes.get(name);
      if (set?.bold) next.bold = true;
      if (set?.italic) next.italic = true;
      if (set?.strike) next.strike = true;
    }
    return { ...next, ...marksOf(el.getAttribute('style') ?? '') };
  };

  const wrap = (text: string, m: Marks): string => {
    if (!text) return '';
    let out = text;
    if (m.strike) out = `<s>${out}</s>`;
    if (m.italic) out = `<em>${out}</em>`;
    if (m.bold) out = `<strong>${out}</strong>`;
    return out;
  };

  const inline = (node: Node, m: Marks): string => {
    if (node.nodeType === Node.TEXT_NODE) return wrap(escape((node.textContent ?? '').replace(/ /g, ' ')), m);
    if (!(node instanceof Element)) return '';
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') return '<br>';
    if (tag === 'sup' && isMarker(node)) return '';
    if (tag === 'img') {
      const src = node.getAttribute('src') ?? '';
      return /^(?:https:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(src) ? `<img src="${escape(src)}">` : '';
    }
    const own = marksFor(node, m);
    const inner = [...node.childNodes].map((child) => inline(child, own)).join('');
    if (tag === 'a') {
      const href = realHref(node.getAttribute('href') ?? '');
      return href && inner ? `<a href="${escape(href)}">${inner}</a>` : inner;
    }
    return inner;
  };

  const blocks: { html: string; text: string }[] = [];
  const push = (tag: string, el: Element, attrs = ''): void => {
    const body = inline(el, marksFor(el, NONE)).trim();
    const text = (el.textContent ?? '').replace(/ /g, ' ').trim();
    if (!text && !body.includes('<img')) return;
    blocks.push({ html: `<${tag}${attrs}>${body}</${tag}>`, text });
  };

  const walk = (parent: Element): void => {
    for (const el of parent.children) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'style' || tag === 'script' || tag === 'hr') continue;
      if (tag === 'div' && isMarker(el)) continue;
      if (tag === 'h1' || tag === 'h2' || el.classList.contains('title')) push('h3', el);
      else if (/^h[3-6]$/.test(tag) || el.classList.contains('subtitle')) push('h4', el);
      else if (tag === 'ul' || tag === 'ol') {
        const kind = tag === 'ul' ? 'bullet' : 'ordered';
        const items = [...el.children].filter((li) => li.tagName === 'LI');
        const html = items
          .map((li) => inline(li, marksFor(li, NONE)).trim())
          .filter(Boolean)
          .map((body) => `<li data-list="${kind}">${body}</li>`)
          .join('');
        if (html) blocks.push({ html: `<ol>${html}</ol>`, text: el.textContent ?? '' });
      } else if (tag === 'p') push('p', el);
      else if (tag === 'table' || tag === 'tbody' || tag === 'tr' || tag === 'td' || tag === 'th' || tag === 'div') walk(el);
      else push('p', el);
    }
  };
  walk(doc.body);

  const first = blocks.findIndex((b) => b.text);
  const summary = first >= 0 ? blocks[first].text.replace(/\s+/g, ' ').slice(0, 300) : '';
  const rest = first >= 0 ? [...blocks.slice(0, first), ...blocks.slice(first + 1)] : blocks;
  return { summary, description: rest.map((b) => b.html).join('') };
}
