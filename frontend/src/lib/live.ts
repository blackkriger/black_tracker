import { onUnmounted } from 'vue';
import { TAB_ID } from './api';

export interface LiveEvent {
  type: string;
  boardId?: string | null;
  projectId?: string | null;
  issueId?: string;
  issueKey?: string;
  commentId?: string;
  fields?: string[];
  by?: string;
  origin?: string;
  at: string;
}

type Handler = (event: LiveEvent) => void;

const handlers = new Set<Handler>();
const resyncs = new Set<() => void>();
let source: EventSource | null = null;
let lost = false;
let retry: ReturnType<typeof setTimeout> | null = null;
let delay = 1000;

function open(): void {
  if (source || retry) return;
  const stream = new EventSource('/api/events', { withCredentials: true });
  source = stream;
  stream.onopen = () => {
    delay = 1000;
    if (!lost) return;
    lost = false;
    for (const resync of resyncs) resync();
  };
  stream.onmessage = (ev) => {
    let parsed: LiveEvent;
    try {
      parsed = JSON.parse(ev.data) as LiveEvent;
    } catch {
      return;
    }
    if (parsed.origin && parsed.origin === TAB_ID) return;
    for (const handler of handlers) handler(parsed);
  };
  stream.onerror = () => {
    lost = true;
    if (stream.readyState !== EventSource.CLOSED || source !== stream) return;
    source = null;
    retry = setTimeout(() => {
      retry = null;
      open();
    }, delay);
    delay = Math.min(delay * 2, 30_000);
  };
}

export function tellTab(type: string): void {
  const event: LiveEvent = { type, at: new Date().toISOString() };
  for (const handler of handlers) handler(event);
}

export function settled(run: () => void, ms = 300): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      run();
    }, ms);
  };
}

export function useLive(handler: Handler, resync?: () => void): void {
  handlers.add(handler);
  if (resync) resyncs.add(resync);
  open();
  onUnmounted(() => {
    handlers.delete(handler);
    if (resync) resyncs.delete(resync);
  });
}
