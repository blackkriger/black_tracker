// The tracker's live channel, opened once per tab. The server sends one event per change; a screen says which kinds it cares about and gets them until it goes away. The browser's own EventSource reconnects after a drop, and we give up only when the session is gone.
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
    // The tab that made the change has already drawn it; everyone else hears about it.
    if (parsed.origin && parsed.origin === TAB_ID) return;
    for (const handler of handlers) handler(parsed);
  };
  // A stream that fails is reopened by the browser on its own; nothing to do but let it.
  source.onerror = () => {};
}

function close(): void {
  if (!handlers.size && source) {
    source.close();
    source = null;
  }
}

/** Listen for as long as the component lives. */
export function useLive(handler: Handler): void {
  handlers.add(handler);
  open();
  onUnmounted(() => {
    handlers.delete(handler);
    close();
  });
}
