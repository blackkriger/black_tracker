<script setup lang="ts">
// The account's other half: the token scripts and agents speak with, and what they may say
// with it. Every call made with the token is recorded as the person who minted it.
import { computed, ref } from 'vue';
import { Check, X } from 'lucide-vue-next';
import { api } from '../lib/api';
import { stamp } from '../lib/issues';
import { useSession } from '../lib/session';

const session = useSession();
const me = session.me;

const tokenBusy = ref(false);
// Held only until the page is left: the server keeps a hash, so this is the one moment the value exists anywhere readable.
const freshToken = ref<string | null>(null);
const copied = ref(false);
const tokenError = ref<string | null>(null);

const tokenCreated = computed(() => stamp(me.value?.token?.createdAt ?? null));
const tokenUsed = computed(() => stamp(me.value?.token?.lastUsedAt ?? null));

async function regenerate(): Promise<void> {
  if (tokenBusy.value) return;
  tokenBusy.value = true;
  tokenError.value = null;
  copied.value = false;
  try {
    const res = await api<{ token: string }>('/me/regenerate-token', { method: 'POST' });
    freshToken.value = res.token;
    await session.refresh();
  } catch (err) {
    tokenError.value = err instanceof Error ? err.message : 'Could not issue a token.';
  } finally {
    tokenBusy.value = false;
  }
}

async function revoke(): Promise<void> {
  if (tokenBusy.value) return;
  tokenBusy.value = true;
  tokenError.value = null;
  try {
    await api('/me/token', { method: 'DELETE' });
    freshToken.value = null;
    await session.refresh();
  } catch (err) {
    tokenError.value = err instanceof Error ? err.message : 'Could not revoke the token.';
  } finally {
    tokenBusy.value = false;
  }
}

async function copyToken(): Promise<void> {
  if (!freshToken.value) return;
  try {
    await navigator.clipboard.writeText(freshToken.value);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

const BASE = `${window.location.origin}/api`;
const HEADER = '-H "Authorization: Bearer trk_…"';

// The examples name what the reader fills in, in capitals, rather than borrowing one of
// their own ids: a real key or uuid reads as part of the call when it is only a stand-in.
const examples = computed(() => {
  const auth = '-H "Authorization: Bearer $TRACKER_TOKEN"';
  const json = '-H "Content-Type: application/json"';
  return [
    {
      label: 'Your token, set once per terminal session',
      code: `export TRACKER_TOKEN="${freshToken.value ?? 'trk_…'}"`,
      bare: true,
    },
    { label: 'Your issues', code: `curl -s ${BASE}/my-issues \\\n  ${auth}` },
    { label: 'One issue by its key', code: `curl -s ${BASE}/issues/ISSUE-KEY \\\n  ${auth}` },
    {
      label: 'A board and its statuses',
      code: `curl -s ${BASE}/boards/BOARD-UUID \\\n  ${auth}`,
    },
    {
      label: 'Writing an issue',
      code: `curl -s -X POST ${BASE}/boards/BOARD-UUID/issues \\\n  ${auth} \\\n  ${json} \\\n  -d '{"summary":"Written from the API","priority":"Minor"}'`,
      hint: "Everything but the summary is optional; with no status named, the issue lands in the board's default one.",
    },
    {
      label: 'Moving an issue to another status',
      code: `curl -s -X PATCH ${BASE}/issues/ISSUE-UUID \\\n  ${auth} \\\n  ${json} \\\n  -d '{"stateId":"STATE-UUID"}'`,
    },
  ] as { label: string; code: string; hint?: string; bare?: boolean }[];
});

const copiedAt = ref<number | null>(null);
async function copyExample(i: number, code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code);
    copiedAt.value = i;
    setTimeout(() => {
      if (copiedAt.value === i) copiedAt.value = null;
    }, 1500);
  } catch {
    copiedAt.value = null;
  }
}

const CALLS: { verb: string; path: string; what: string }[] = [
  { verb: 'GET', path: '/projects', what: 'Every project open to you, with its boards' },
  { verb: 'GET', path: '/boards/:boardId', what: 'One board with its statuses and their uuids' },
  { verb: 'GET', path: '/boards/:boardId/issues', what: 'The tasks on one board' },
  { verb: 'GET', path: '/issues/:key', what: 'One issue whole, not its uuid' },
  { verb: 'GET', path: '/issues/search?q=text', what: 'Issues whose summary carries the text' },
  { verb: 'POST', path: '/boards/:boardId/issues', what: 'Write a new issue onto that board' },
  { verb: 'PATCH', path: '/issues/:id', what: 'Change status, priority, assignee, due date, tags' },
  { verb: 'GET', path: '/my-issues', what: 'Everything open on your own hands' },
];
</script>

<template>
    <section class="panel sheet__wide">
      <header class="panel__h">API token</header>
      <div class="panel__b form">
        <p class="token__lede">
          Personal token for scripts and API use. Whatever it does is recorded as
          <strong>your</strong> action, marked <span class="api">API</span> in history.
        </p>

        <div v-if="freshToken" class="field">
          <span class="label">Your new token — copy it now</span>
          <div class="token__row">
            <code class="input token__value">{{ freshToken }}</code>
            <button class="btn" type="button" @click="copyToken">{{ copied ? 'Copied' : 'Copy' }}</button>
          </div>
          <span class="hint">It is stored as a hash, so this is the only time it can be read.</span>
        </div>

        <div v-else-if="me?.token" class="field">
          <span class="label">Token</span>
          <code class="input token__value">••••••••••••{{ me.token.hint }}</code>
          <span class="stamp">
            CREATED {{ tokenCreated }}<template v-if="tokenUsed">, LAST USED {{ tokenUsed }}</template>
            <template v-else>, NEVER USED</template>
          </span>
        </div>

        <div v-else class="empty empty--sm">
          <span class="empty__g">◇</span>
          No token yet.
        </div>

        <div class="token__can">
          <span class="label token__can-h">What the token can do:</span>
          <ul class="token__list">
            <li><Check class="ic token__yes" />Create issues, change status, priority, assignee, tags</li>
            <li><X class="ic token__no" />Post or edit comments</li>
          </ul>
        </div>

        <div v-if="tokenError" class="err">{{ tokenError }}</div>

        <div class="token__foot">
          <div class="sp"></div>
          <button v-if="me?.token" class="btn btn--danger" type="button" :disabled="tokenBusy" @click="revoke">
            Revoke
          </button>
          <button class="btn" type="button" :disabled="tokenBusy" @click="regenerate">
            {{ me?.token ? 'Regenerate' : 'Create token' }}
          </button>
        </div>
      </div>
    </section>

    <section class="panel sheet__wide">
      <header class="panel__h">Using it</header>
      <div class="panel__b form">
        <div class="field">
          <span class="label">Where to send it</span>
          <pre class="api__code">{{ BASE }}</pre>
        </div>

        <div class="field">
          <span class="label">What answers</span>
          <div class="api__table">
            <template v-for="c in CALLS" :key="c.verb + c.path">
              <span class="api__verb">{{ c.verb }}</span>
              <code class="api__path">{{ c.path }}</code>
              <span class="api__what">{{ c.what }}</span>
            </template>
          </div>
          <span class="hint">
            Every answer is <code>{ data }</code> or <code>{ error }</code>, and a board you
            cannot open answers 403, as it should.
          </span>
        </div>

        <div class="field">
          <span class="label">Authorization header</span>
          <pre class="api__code">{{ HEADER }}</pre>
        </div>

        <div v-for="(ex, i) in examples" :key="ex.label" class="field">
          <div class="api__ex-h">
            <span class="label">{{ ex.label }}</span>
            <button
              v-if="!ex.bare"
              class="btn btn--sm btn--ghost"
              type="button"
              @click="copyExample(i, ex.code)"
            >
              {{ copiedAt === i ? 'Copied' : 'Copy' }}
            </button>
          </div>
          <pre class="api__code">{{ ex.code }}</pre>
          <span v-if="ex.hint" class="hint">{{ ex.hint }}</span>
        </div>
      </div>
    </section>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.token__lede {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-dim);
}
.token__lede strong {
  color: var(--text);
}
.token__row {
  display: flex;
  gap: 6px;
}
.token__value {
  display: flex;
  align-items: center;
  font-family: var(--font-mono);
  font-size: 12.5px;
  letter-spacing: 0.04em;
  color: var(--accent-bright);
  overflow-x: auto;
  white-space: nowrap;
}
.token__can {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--line-2);
  background: rgba(0, 0, 0, 0.3);
}
.token__can-h {
  color: var(--accent);
}
.token__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: 13px;
}
.token__list li {
  display: flex;
  gap: 10px;
}
/* The tick and the cross are icons now; they only need to sit on the first line of their item. */
.token__yes,
.token__no {
  margin-top: 3px;
}
.token__yes {
  color: #8effa9;
}
.token__no {
  color: var(--danger-text);
}
.token__foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--line);
}
/* The calls, three columns wide: what to send, where, and what comes back. */
.api__table {
  display: grid;
  grid-template-columns: 52px minmax(0, auto) minmax(0, 1fr);
  gap: 6px 12px;
  align-items: baseline;
  font-size: 12.5px;
}
.api__verb {
  color: var(--accent);
  font: 11px var(--font-mono);
  letter-spacing: 0.06em;
}
.api__path {
  color: var(--text);
  font: 12.5px var(--font-mono);
  white-space: nowrap;
}
.api__what {
  color: var(--text-dim);
}
.api__code {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--text);
  font: 12.5px/1.6 var(--font-mono);
  overflow-x: auto;
  white-space: pre;
}
/* An example's name on the left, the way to take it on the right. */
.api__ex-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
</style>
