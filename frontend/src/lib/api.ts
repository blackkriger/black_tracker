// Every answer from the backend is `{ data }` or `{ error }`, so one helper unwraps both and throws the message the API wrote.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// One id per tab, minted when the page loads. It rides along with every write so the live channel can tell this tab's own doing from everyone else's — including this same person in another window.
export const TAB_ID =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export async function api<T>(
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {}
): Promise<T> {
  const { body, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    // The session rides in a cookie, so every call carries it.
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      'X-Tab-Id': TAB_ID,
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = (await res.json().catch(() => null)) as
    | { data?: T; error?: string }
    | null;
  if (!res.ok || !payload || payload.error) {
    throw new ApiError(payload?.error ?? `Request failed (${res.status})`, res.status);
  }
  return payload.data as T;
}
