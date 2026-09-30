import { usePeople } from './people';
import { useRoles } from './roles';
import { ink } from './theme';

// Longest first, so `@Game designer` matches before `@Game`.
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

// Input must already be sanitised; only text nodes are rewritten, so hrefs and markup stay untouched.
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
