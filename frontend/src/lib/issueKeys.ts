import { reactive, ref } from 'vue';
import { api } from './api';
import type { IssueLink } from './issues';
import { ink } from './theme';

const known = reactive(new Map<string, IssueLink | null>());
export const keysVersion = ref(0);
const asked = new Set<string>();
let queued: string[] = [];
let timer = 0;

export async function findKeys(keys: string[]): Promise<IssueLink[]> {
  if (!keys.length) return [];
  return api<IssueLink[]>(`/issues/keys?keys=${encodeURIComponent(keys.join(','))}`);
}

async function ask(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    try {
      const found = new Map((await findKeys(batch)).map((r) => [r.key.toUpperCase(), r]));
      for (const key of batch) known.set(key, found.get(key) ?? null);
      keysVersion.value += 1;
    } catch {
      for (const key of batch) asked.delete(key);
    }
  }
}

function flush(): void {
  timer = 0;
  const keys = queued;
  queued = [];
  void ask(keys);
}

export function keyInfo(key: string): IssueLink | null | undefined {
  const upper = key.toUpperCase();
  if (!asked.has(upper)) {
    asked.add(upper);
    queued.push(upper);
    if (!timer) timer = window.setTimeout(flush);
  }
  return known.get(upper);
}

export function refreshKey(key: string | undefined): void {
  const upper = key?.toUpperCase();
  if (upper && known.has(upper)) void ask([upper]);
}

export function forgetKeys(): void {
  known.clear();
  asked.clear();
}

export const KEY = /\b[A-Z][A-Z0-9]*-\d+\b/g;
const HAS_KEY = /[A-Z][A-Z0-9]*-\d/;

export function paintKeys(html: string): string {
  if (!HAS_KEY.test(html)) return html;
  const box = document.createElement('div');
  box.innerHTML = html;

  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('a, code, pre')) continue;
    if (HAS_KEY.test(node.nodeValue ?? '')) texts.push(node as Text);
  }

  let touched = false;
  for (const node of texts) {
    const text = node.nodeValue ?? '';
    const parts = document.createDocumentFragment();
    let at = 0;
    for (const m of text.matchAll(KEY)) {
      const info = keyInfo(m[0]);
      if (!info) continue;
      const from = m.index ?? 0;
      parts.append(text.slice(at, from));
      const link = document.createElement('a');
      link.className = info.resolved ? 'ikey is-closed' : 'ikey';
      link.href = `/${info.key}`;
      link.dataset.key = info.key;
      link.title = `${info.summary}, ${info.stateName}`;
      link.style.color = ink(info.stateColor) ?? '';
      link.textContent = m[0];
      parts.append(link);
      at = from + m[0].length;
    }
    if (!at) continue;
    parts.append(text.slice(at));
    node.replaceWith(parts);
    touched = true;
  }

  return touched ? box.innerHTML : html;
}
