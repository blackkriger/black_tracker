<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Check, X } from 'lucide-vue-next';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { features } from '../lib/features';
import { stamp } from '../lib/issues';
import { usePanelErrors } from '../lib/panelErrors';
import { useSession } from '../lib/session';

const { t } = useI18n();
const session = useSession();
const me = session.me;

useLive((ev) => {
  if (ev.type === 'session.changed') void session.refresh();
});

const tokenBusy = ref(false);
const freshToken = ref<string | null>(null);
const copied = ref(false);
const { errors, fail, clear } = usePanelErrors();

const ABILITIES = computed<[string, string | null][]>(() => [
  [t('api.canIssues'), features.pings ? t('api.cannotPing') : null],
  [t('api.canComments'), t('api.cannotReact')],
  [t('api.canManage'), t('api.cannotRoles')],
  [t('api.canDelete'), t('api.cannotAccount')],
]);

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
    fail('token', err, t('api.issueFailed'));
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
    fail('token', err, t('api.revokeFailed'));
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

const CALLS = computed<{ group: string; calls: Call[] }[]>(() => [
  {
    group: t('api.groups.reading'),
    calls: [
      { verb: 'GET', path: '/me', what: t('api.calls.me') },
      { verb: 'GET', path: '/projects', what: t('api.calls.projects') },
      { verb: 'GET', path: '/boards/:boardId', what: t('api.calls.board') },
      { verb: 'GET', path: '/boards/:boardId/issues', what: t('api.calls.boardIssues') },
      { verb: 'GET', path: '/issues?q=&tags=&from=&to=', what: t('api.calls.issues') },
      { verb: 'GET', path: '/issues/:key', what: t('api.calls.issue') },
      { verb: 'GET', path: '/issues/search?q=text', what: t('api.calls.search') },
      { verb: 'GET', path: '/my-issues', what: t('api.calls.myIssues') },
      { verb: 'GET', path: '/my-favourites', what: t('api.calls.favourites') },
      { verb: 'GET', path: '/people', what: t('api.calls.people') },
      { verb: 'GET', path: '/tags', what: t('api.calls.tags') },
      { verb: 'GET', path: '/analytics?from=&to=', what: t('api.calls.analytics') },
      { verb: 'GET', path: '/events', what: t('api.calls.events') },
    ],
  },
  {
    group: t('api.groups.issues'),
    calls: [
      { verb: 'POST', path: '/boards/:boardId/issues', what: t('api.calls.createIssue') },
      { verb: 'PATCH', path: '/issues/:issueId', what: t('api.calls.patchIssue') },
      { verb: 'DELETE', path: '/issues/:issueId', what: t('api.calls.deleteIssue') },
      { verb: 'POST', path: '/issues/:issueId/links', what: t('api.calls.link') },
      { verb: 'DELETE', path: '/issues/:issueId/links/:otherId', what: t('api.calls.unlink') },
      { verb: 'PUT', path: '/issues/:issueId/favourite', what: t('api.calls.favourite') },
    ],
  },
  {
    group: t('api.groups.comments'),
    calls: [
      { verb: 'POST', path: '/issues/:issueId/comments', what: t('api.calls.comment') },
      { verb: 'PATCH', path: '/comments/:commentId', what: t('api.calls.editComment') },
      { verb: 'DELETE', path: '/comments/:commentId', what: t('api.calls.deleteComment') },
      { verb: 'PUT', path: '/comments/:commentId/pin', what: t('api.calls.pin') },
      { verb: 'POST', path: '/issues/:issueId/attachments', what: t('api.calls.attach') },
      { verb: 'GET', path: '/attachments/:fileId', what: t('api.calls.download') },
      { verb: 'DELETE', path: '/attachments/:fileId', what: t('api.calls.removeFile') },
    ],
  },
  {
    group: t('api.groups.notices'),
    calls: [
      { verb: 'GET', path: '/notices', what: t('api.calls.notices') },
      { verb: 'GET', path: '/notices/unread', what: t('api.calls.unread') },
      { verb: 'POST', path: '/notices/read', what: t('api.calls.read') },
    ],
  },
  {
    group: t('api.groups.calendar'),
    calls: [
      { verb: 'GET', path: '/calendar?from=&to=', what: t('api.calls.calendar') },
      { verb: 'POST', path: '/key-dates', what: t('api.calls.markDay') },
      { verb: 'PATCH', path: '/key-dates/:dateId', what: t('api.calls.changeDay') },
      { verb: 'DELETE', path: '/key-dates/:dateId', what: t('api.calls.removeDay') },
    ],
  },
  {
    group: t('api.groups.settings'),
    calls: [
      { verb: 'POST', path: '/projects', what: t('api.calls.createProject') },
      { verb: 'PATCH', path: '/projects/:key', what: t('api.calls.patchProject') },
      { verb: 'POST', path: '/projects/:key/boards', what: t('api.calls.createBoard') },
      { verb: 'PATCH', path: '/boards/:boardId', what: t('api.calls.patchBoard') },
      { verb: 'POST', path: '/boards/:boardId/states', what: t('api.calls.createStatus') },
      { verb: 'PATCH', path: '/states/:statusId', what: t('api.calls.patchStatus') },
      { verb: 'POST', path: '/tags', what: t('api.calls.createTag') },
      { verb: 'PATCH', path: '/tags/:tagId', what: t('api.calls.patchTag') },
      { verb: 'PUT', path: '/tags/:tagId/boards/:boardId', what: t('api.calls.showTag') },
      { verb: 'DELETE', path: '/tags/:tagId/boards/:boardId', what: t('api.calls.hideTag') },
    ],
  },
]);
</script>

<template>
    <section class="panel sheet__wide">
      <header class="panel__h">{{ t('api.token') }}</header>
      <div class="panel__b form">
        <i18n-t keypath="api.lede" tag="p" class="token__lede">
          <template #your><strong>{{ t('api.your') }}</strong></template>
          <template #api><span class="api">API</span></template>
        </i18n-t>

        <div v-if="freshToken" class="field">
          <span class="label">{{ t('api.copyNow') }}</span>
          <div class="token__row">
            <code class="input token__value">{{ freshToken }}</code>
            <button class="btn" type="button" @click="copyToken">{{ copied ? t('users.copied') : t('users.copy') }}</button>
          </div>
          <span class="hint">{{ t('users.hashHint') }}</span>
        </div>

        <div v-else-if="me?.token" class="field">
          <span class="label">{{ t('api.tokenLabel') }}</span>
          <code class="input token__value">••••••••••••{{ me.token.hint }}</code>
          <span class="stamp">
            {{ t('api.created', { date: tokenCreated }) }}<template v-if="tokenUsed">, {{ t('api.lastUsed', { date: tokenUsed }) }}</template>
            <template v-else>, {{ t('api.neverUsed') }}</template>
          </span>
        </div>

        <div v-else class="empty empty--sm">
          <span class="empty__g">◇</span>
          {{ t('api.noToken') }}
        </div>

        <div class="token__can">
          <span class="label token__can-h">{{ t('api.canDo') }}</span>
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
            {{ t('users.revoke') }}
          </button>
          <button class="btn" type="button" :disabled="tokenBusy" @click="regenerate">
            {{ me?.token ? t('api.regenerate') : t('api.create') }}
          </button>
        </div>
      </div>
    </section>
    <div v-if="errors.token" class="err panel__err sheet__wide">{{ errors.token }}</div>

    <section class="panel sheet__wide">
      <header class="panel__h">{{ t('api.using') }}</header>
      <div class="panel__b form">
        <div class="field">
          <span class="label">{{ t('api.whereTo') }}</span>
          <pre class="api__code">{{ BASE }}</pre>
        </div>

        <div class="field">
          <span class="label">{{ t('api.authHeader') }}</span>
          <pre class="api__code">{{ HEADER }}</pre>
        </div>

        <div class="field">
          <span class="label">{{ t('api.answers') }}</span>
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
