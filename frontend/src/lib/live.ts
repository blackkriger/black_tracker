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

/** Listen for as long as the component lives. The stream itself stays open: navigating from one screen to the next unmounts before it mounts, and closing on the way would tear the connection down and build it again on every click. */
/**
 * A burst of events read as one: whatever runs is called once, a moment after the last of
 * them. A screen that reads everything again on each change would otherwise send a request
 * per card moved, and the answers could land out of order.
 */
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
