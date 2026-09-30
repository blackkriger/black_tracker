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
let source: EventSource | null = null;

function open(): void {
  if (source) return;
  source = new EventSource('/api/events', { withCredentials: true });
  source.onmessage = (ev) => {
    let parsed: LiveEvent;
    try {
      parsed = JSON.parse(ev.data) as LiveEvent;
    } catch {
      return;
    }
    if (parsed.origin && parsed.origin === TAB_ID) return;
    for (const handler of handlers) handler(parsed);
  };
  source.onerror = () => {};
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

export function useLive(handler: Handler): void {
  handlers.add(handler);
  open();
  onUnmounted(() => handlers.delete(handler));
}
