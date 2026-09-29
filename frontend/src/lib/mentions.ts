// A name written in a comment is shown in the colour of whoever it belongs to: a person's
// role, or the role itself. Nothing about that colour is stored — it is looked up when the
// text is drawn, so renaming a role recolours every comment that ever named it.
import { usePeople } from './people';
import { useRoles } from './roles';
import { ink } from './theme';

/** Every name that may follow an `@`, longest first so `@Game designer` wins over `@Game`. */
export function knownNames(): { name: string; color: string | null }[] {
  const { people } = usePeople();
  const { roles } = useRoles();
  return [
    ...people.value.map((p) => ({ name: p.login, color: p.roleColor })),
    ...roles.value.map((r) => ({ name: r.name, color: r.color })),
  ].sort((a, b) => b.name.length - a.name.length);
}

export function colorOfName(name: string): string | null {
  const low = name.toLowerCase();
  return knownNames().find((n) => n.name.toLowerCase() === low)?.color ?? null;
}

/** The name standing at `from` in `text`, if any, and what colour it is written in. */
export function nameAt(text: string, from: number): { name: string; color: string | null } | null {
  const rest = text.slice(from).toLowerCase();
  return (
    knownNames().find(
      (n) =>
        rest.startsWith(n.name.toLowerCase()) &&
        !/[a-zA-Z0-9_.-]/.test(rest.charAt(n.name.length))
    ) ?? null
  );
}

/**
 * Paints the names inside a piece of already-sanitised markup. It walks the text rather
 * than the markup, so an address inside an href is never touched, and the spans it adds
 * are built here rather than taken from what somebody wrote.
 */
export function paintNames(html: string): string {
  if (!html.includes('@')) return html;
  const box = document.createElement('div');
  box.innerHTML = html;

  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue?.includes('@')) texts.push(node as Text);
  }

  for (const node of texts) {
    const text = node.nodeValue ?? '';
    const parts = document.createDocumentFragment();
    let at = 0;
    let touched = false;
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '@') continue;
      if (i > 0 && !/\s/.test(text[i - 1])) continue;
      const found = nameAt(text, i + 1);
      if (!found) continue;
      parts.append(text.slice(at, i));
      const span = document.createElement('span');
      span.className = 'mention';
      if (found.color) span.style.color = ink(found.color) ?? '';
      span.textContent = `@${text.slice(i + 1, i + 1 + found.name.length)}`;
      parts.append(span);
      at = i + 1 + found.name.length;
      i = at - 1;
      touched = true;
    }
    if (!touched) continue;
    parts.append(text.slice(at));
    node.replaceWith(parts);
  }

  return box.innerHTML;
}
