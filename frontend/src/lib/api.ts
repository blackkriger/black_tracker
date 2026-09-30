export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

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

export function latestRead<T>(path: string, apply: (data: T) => void): (fresh?: boolean) => Promise<void> {
  let inflight: Promise<void> | null = null;
  let reads = 0;
  return (fresh = false) => {
    if (inflight && !fresh) return inflight;
    const mine = ++reads;
    const request: Promise<void> = api<T>(path)
      .then((data) => {
        if (mine === reads) apply(data);
      })
      .finally(() => {
        if (inflight === request) inflight = null;
      });
    inflight = request;
    return request;
  };
}
