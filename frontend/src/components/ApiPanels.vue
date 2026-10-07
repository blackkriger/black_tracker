<script setup lang="ts">
import { computed, ref } from 'vue';
import { Check, X } from 'lucide-vue-next';
import { api } from '../lib/api';
import { stamp } from '../lib/issues';
import { usePanelErrors } from '../lib/panelErrors';
import { useSession } from '../lib/session';

const session = useSession();
const me = session.me;

const tokenBusy = ref(false);
const freshToken = ref<string | null>(null);
const copied = ref(false);
const { errors, fail, clear } = usePanelErrors();

const ABILITIES: [string, string | null][] = [
  ['Create issues, change status, priority, assignee, due date, tags, board', 'Ping people'],
  ['Post, edit, delete and pin comments, attach files to them', 'React to comments'],
  ['Manage projects, boards, statuses, tags and marked days', 'Manage roles, people and invite links'],
  ['Delete, if your role can', 'Change your account, sessions or the token itself'],
];

const tokenCreated = computed(() => stamp(me.value?.token?.createdAt ?? null));
const tokenUsed = computed(() => stamp(me.value?.token?.lastUsedAt ?? null));

async function regenerate(): Promise<void> {
  if (tokenBusy.value) return;
  tokenBusy.value = true;
  clear('token');
  copied.value = false;
  try {
    const res = await api<{ token: string }>('/me/regenerate-token', { method: 'POST' });
    freshToken.value = res.token;
    await session.refresh();
  } catch (err) {
    fail('token', err, 'Could not issue a token.');
  } finally {
    tokenBusy.value = false;
  }
}

async function revoke(): Promise<void> {
  if (tokenBusy.value) return;
  tokenBusy.value = true;
  clear('token');
  try {
    await api('/me/token', { method: 'DELETE' });
    freshToken.value = null;
    await session.refresh();
  } catch (err) {
    fail('token', err, 'Could not revoke the token.');
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

type Call = { verb: string; path: string; what: string };

const CALLS: { group: string; calls: Call[] }[] = [
  {
    group: 'Reading',
    calls: [
      { verb: 'GET', path: '/me', what: 'Your own account' },
      { verb: 'GET', path: '/projects', what: 'Every project open to you, with its boards' },
      { verb: 'GET', path: '/boards/:boardId', what: 'One board with its statuses and their uuids' },
      { verb: 'GET', path: '/boards/:boardId/issues', what: 'The issues on one board' },
      { verb: 'GET', path: '/issues?q=&tags=&from=&to=', what: 'Issues across every project open to you' },
      { verb: 'GET', path: '/issues/:key', what: 'One issue whole: comments, history, files, links, commits' },
      { verb: 'GET', path: '/issues/search?q=text', what: 'Issues whose summary carries the text' },
      { verb: 'GET', path: '/my-issues', what: 'Everything open on your own hands' },
      { verb: 'GET', path: '/my-favourites', what: 'Your starred issues' },
      { verb: 'GET', path: '/people', what: 'Everyone on the tracker' },
      { verb: 'GET', path: '/tags', what: 'Every tag' },
      { verb: 'GET', path: '/analytics?from=&to=', what: 'The numbers behind Analytics' },
      { verb: 'GET', path: '/events', what: 'Live stream of every change you may see' },
    ],
  },
  {
    group: 'Issues',
    calls: [
      { verb: 'POST', path: '/boards/:boardId/issues', what: 'Write a new issue onto that board' },
      { verb: 'PATCH', path: '/issues/:issueId', what: 'Change summary, description, status, priority, assignee, due date, tags, board' },
      { verb: 'DELETE', path: '/issues/:issueId', what: 'Delete an issue, if your role can' },
      { verb: 'POST', path: '/issues/:issueId/links', what: 'Link it to another issue' },
      { verb: 'DELETE', path: '/issues/:issueId/links/:otherId', what: 'Unlink the two' },
      { verb: 'PUT', path: '/issues/:issueId/favourite', what: 'Star or unstar it' },
    ],
  },
  {
    group: 'Comments and files',
    calls: [
      { verb: 'POST', path: '/issues/:issueId/comments', what: 'Post a comment' },
      { verb: 'PATCH', path: '/comments/:commentId', what: 'Edit your comment' },
      { verb: 'DELETE', path: '/comments/:commentId', what: 'Delete a comment' },
      { verb: 'PUT', path: '/comments/:commentId/pin', what: 'Pin or unpin it' },
      { verb: 'POST', path: '/issues/:issueId/attachments', what: 'Attach a file; add ?comment=:commentId to put it on your comment' },
      { verb: 'GET', path: '/attachments/:fileId', what: 'Download a file' },
      { verb: 'DELETE', path: '/attachments/:fileId', what: 'Remove a file' },
    ],
  },
  {
    group: 'Notices',
    calls: [
      { verb: 'GET', path: '/notices', what: 'Your notices, newest first' },
      { verb: 'GET', path: '/notices/unread', what: 'How many are unread, by kind' },
      { verb: 'POST', path: '/notices/read', what: 'Mark one read with its id, or all of them without one' },
    ],
  },
  {
    group: 'Calendar',
    calls: [
      { verb: 'GET', path: '/calendar?from=&to=', what: 'Marked days, due dates and activity in the range' },
      { verb: 'POST', path: '/key-dates', what: 'Mark a day' },
      { verb: 'PATCH', path: '/key-dates/:dateId', what: 'Change a marked day' },
      { verb: 'DELETE', path: '/key-dates/:dateId', what: 'Remove it, if your role can' },
    ],
  },
  {
    group: 'Settings',
    calls: [
      { verb: 'POST', path: '/projects', what: 'Make a project' },
      { verb: 'PATCH', path: '/projects/:key', what: 'Change a project' },
      { verb: 'POST', path: '/projects/:key/boards', what: 'Make a board' },
      { verb: 'PATCH', path: '/boards/:boardId', what: 'Change a board' },
      { verb: 'POST', path: '/boards/:boardId/states', what: 'Make a status' },
      { verb: 'PATCH', path: '/states/:statusId', what: 'Change a status' },
      { verb: 'POST', path: '/tags', what: 'Make a tag' },
      { verb: 'PATCH', path: '/tags/:tagId', what: 'Change a tag' },
      { verb: 'PUT', path: '/tags/:tagId/boards/:boardId', what: 'Show the tag on a board' },
      { verb: 'DELETE', path: '/tags/:tagId/boards/:boardId', what: 'Hide it there' },
    ],
  },
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
            <template v-for="[can, cannot] in ABILITIES" :key="can">
              <li><Check class="ic token__yes" />{{ can }}</li>
              <li v-if="cannot"><X class="ic token__no" />{{ cannot }}</li>
              <li v-else class="token__gap" aria-hidden="true"></li>
            </template>
          </ul>
        </div>

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
    <div v-if="errors.token" class="err panel__err sheet__wide">{{ errors.token }}</div>

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
            <template v-for="g in CALLS" :key="g.group">
              <span class="api__group">{{ g.group }}</span>
              <template v-for="c in g.calls" :key="c.verb + c.path">
                <span class="api__verb">{{ c.verb }}</span>
                <code class="api__path">{{ c.path }}</code>
                <span class="api__what">{{ c.what }}</span>
              </template>
            </template>
          </div>
        </div>

        <div class="field">
          <span class="label">Authorization header</span>
          <pre class="api__code">{{ HEADER }}</pre>
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
  background: var(--bg);
}
.token__can-h {
  color: var(--accent);
}
.token__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2) var(--space-5);
  font-size: 13px;
}
@media (max-width: 760px) {
  .token__list {
    grid-template-columns: minmax(0, 1fr);
  }
  .token__gap {
    display: none !important;
  }
}
.token__list li {
  display: flex;
  gap: 10px;
}
.token__yes,
.token__no {
  margin-top: 3px;
}
.token__yes {
  color: var(--ok);
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
.api__table {
  display: grid;
  grid-template-columns: 52px minmax(0, auto) minmax(0, 1fr);
  gap: 6px 12px;
  align-items: baseline;
  font-size: 12.5px;
}
.api__group {
  grid-column: 1 / -1;
  padding-top: 8px;
  color: var(--text-muted);
  font-size: 12px;
}
.api__group:first-child {
  padding-top: 0;
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
@media (max-width: 760px) {
  .api__table {
    grid-template-columns: 52px minmax(0, 1fr);
  }
  .api__what {
    grid-column: 2;
    margin-bottom: 6px;
  }
}
</style>
