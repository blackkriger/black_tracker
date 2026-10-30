<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Ellipsis, Search } from 'lucide-vue-next';
import BuildsPanel from '../components/BuildsPanel.vue';
import Dialog from '../components/Dialog.vue';
import FilterBar from '../components/FilterBar.vue';
import FilterMenu from '../components/FilterMenu.vue';
import { IssueView } from '../lib/issueView';
import { api } from '../lib/api';
import { useBoards, type BoardFull } from '../lib/boards';
import {
  COMMIT_FILTERS,
  commitQuery,
  filtersOf,
  filtersQuery,
  noFilters,
  remember,
  rememberedFilters,
  sameQuery,
  type Filters,
} from '../lib/filters';
import { stampAt, type Issue, type IssueLink, type IssueTag } from '../lib/issues';
import { settled, useLive } from '../lib/live';
import { usePanelErrors } from '../lib/panelErrors';
import { usePeople } from '../lib/people';
import { useProjects } from '../lib/projects';
import { useTags } from '../lib/tags';
import { ink } from '../lib/theme';

interface CommitIssue {
  id: string;
  key: string;
  summary: string;
  stateName: string;
  stateColor: string;
  projectShort: string;
  boardSlug: string;
}

interface Row {
  id: string;
  sha: string;
  kind: 'commit' | 'merge';
  message: string;
  branch: string | null;
  mergedFrom: string | null;
  author: string;
  by: string | null;
  at: string;
  url: string;
  project: string | null;
  issues: CommitIssue[];
}

type Linked = '' | 'yes' | 'no';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { projects, load: loadProjects } = useProjects();
const { nameOf, colorOf, load: loadPeople } = usePeople();
const { errors, fail, clear } = usePanelErrors();
const { tags, load: loadTags } = useTags();
const { boardOf, forget } = useBoards();

const listOf = (v: unknown): string[] => String(v ?? '').split(',').filter(Boolean);

const typed = ref('');
const q = ref('');
const filters = ref<Filters>(noFilters());
const committers = ref<string[]>([]);
const branches = ref<string[]>([]);
const linked = ref<Linked>('');

function sharedOf(query: LocationQuery): Filters {
  const kept = rememberedFilters(noFilters());
  if (!COMMIT_FILTERS.some((key) => query[key] !== undefined)) return kept;
  const got = filtersOf(query);
  return { ...kept, projects: got.projects, tags: got.tags, from: got.from, to: got.to };
}

function fromQuery(): void {
  const query = route.query;
  filters.value = sharedOf(query);
  q.value = String(query.q ?? '');
  typed.value = q.value;
  committers.value = listOf(query.committers);
  branches.value = listOf(query.branches);
  linked.value = query.linked === 'yes' || query.linked === 'no' ? query.linked : '';
}

function toQuery(): Record<string, string> {
  const out = commitQuery(filtersQuery(filters.value));
  if (q.value) out.q = q.value;
  if (committers.value.length) out.committers = committers.value.join(',');
  if (branches.value.length) out.branches = branches.value.join(',');
  if (linked.value) out.linked = linked.value;
  return out;
}

function apiQuery(): URLSearchParams {
  const query = new URLSearchParams(toQuery());
  query.delete('committers');
  if (committers.value.length) query.set('authors', committers.value.join(','));
  return query;
}

fromQuery();

let typing: ReturnType<typeof setTimeout> | null = null;
watch(typed, (text) => {
  if (typing) clearTimeout(typing);
  typing = setTimeout(() => (q.value = text.trim()), 250);
});

const rows = ref<Row[]>([]);
const total = ref(0);
const loading = ref(true);
const more = ref(false);
let reads = 0;

async function load(append = false): Promise<void> {
  const mine = ++reads;
  clear('list');
  const query = apiQuery();
  if (append) query.set('offset', String(rows.value.length));
  if (append) more.value = true;
  try {
    const got = await api<{ total: number; commits: Row[] }>(`/commits?${query}`);
    if (mine !== reads) return;
    total.value = got.total;
    rows.value = append ? [...rows.value, ...got.commits] : got.commits;
  } catch (err) {
    if (mine === reads) fail('list', err, t('commits.loadFailed'));
  } finally {
    if (mine === reads) {
      loading.value = false;
      more.value = false;
    }
  }
}

const authorChoices = ref<{ value: string; label: string; color?: string | null }[]>([]);
const branchChoices = ref<{ value: string; label: string }[]>([]);

async function loadFacets(): Promise<void> {
  try {
    const got = await api<{ authors: { value: string; login: string | null }[]; branches: string[] }>('/commits/facets');
    authorChoices.value = got.authors.map((a) => ({
      value: a.value,
      label: a.login ? nameOf(a.login) : a.value,
      color: a.login ? colorOf(a.login) : null,
    }));
    branchChoices.value = got.branches.map((b) => ({ value: b, label: b }));
  } catch {}
}

const ownDirty = computed(() => !!q.value || !!committers.value.length || !!branches.value.length || !!linked.value);

function clearOwn(): void {
  typed.value = '';
  q.value = '';
  committers.value = [];
  branches.value = [];
  linked.value = '';
}

watch(
  [filters, q, committers, branches, linked],
  () => {
    remember(filters.value, noFilters());
    const next = toQuery();
    if (!sameQuery(next, route.query as Record<string, unknown>)) {
      void router.replace({ name: 'commits', params: route.params, query: next });
    }
    void load();
  },
  { deep: true }
);

watch(
  () => route.query,
  () => {
    if (route.name !== 'commits') return;
    if (!sameQuery(toQuery(), route.query as Record<string, unknown>)) fromQuery();
  }
);

const openKey = computed(() => (route.name === 'commits' && route.params.key ? String(route.params.key) : null));
const open = ref<{ key: string; project: string; board: BoardFull } | null>(null);

async function showIssue(key: string | null): Promise<void> {
  if (!key) {
    open.value = null;
    return;
  }
  try {
    const got = await api<Issue>(`/issues/${encodeURIComponent(key)}`);
    forget(got.boardId);
    open.value = {
      key,
      project: projects.value.find((p) => p.id === got.projectId)?.shortName ?? '',
      board: await boardOf(got.boardId),
    };
  } catch (err) {
    fail('list', err);
  }
}
watch(openKey, (key) => void showIssue(key));

const boardsOf = (short: string) => projects.value.find((p) => p.shortName === short)?.boards ?? [];
const tagsOf = (board: BoardFull): IssueTag[] => tags.value.filter((t) => board.tagIds.includes(t.id));

function closeIssue(): void {
  void router.push({ name: 'commits', params: {}, query: route.query });
}

onMounted(async () => {
  await loadProjects();
  void loadTags();
  await loadPeople();
  void loadFacets();
  void load();
  void showIssue(openKey.value);
});

const reloadAll = settled(() => {
  void load();
  void loadFacets();
});
useLive(
  (ev) => {
    if (ev.type === 'commit.added' || ev.type === 'history.added') reloadAll();
  },
  () => reloadAll()
);

const authorOf = (r: Row): string => (r.by ? nameOf(r.by) : r.author);

const acting = ref<Row | null>(null);
const findQuery = ref('');
const found = ref<IssueLink[]>([]);
const finding = ref(false);
const actBusy = ref(false);
const actError = ref<string | null>(null);
let findTimer: ReturnType<typeof setTimeout> | null = null;
let finds = 0;

function openActions(r: Row): void {
  acting.value = r;
  findQuery.value = '';
  found.value = [];
  actError.value = null;
}

watch(findQuery, (term) => {
  if (findTimer) clearTimeout(findTimer);
  const text = term.trim();
  if (!text) {
    ++finds;
    finding.value = false;
    found.value = [];
    return;
  }
  findTimer = setTimeout(async () => {
    const mine = ++finds;
    finding.value = true;
    try {
      const got = await api<IssueLink[]>(`/issues/search?q=${encodeURIComponent(text)}`);
      if (mine !== finds) return;
      const already = new Set(acting.value?.issues.map((i) => i.id));
      found.value = got.filter((r) => !already.has(r.id));
    } catch {
      if (mine === finds) found.value = [];
    } finally {
      if (mine === finds) finding.value = false;
    }
  }, 200);
});

async function act(path: 'link' | 'unlink', body: Record<string, string>): Promise<void> {
  const row = acting.value;
  if (!row || actBusy.value) return;
  actBusy.value = true;
  actError.value = null;
  try {
    await api(`/commits/${row.id}/${path}`, { method: 'POST', body });
    acting.value = null;
    await load();
  } catch (err) {
    actError.value = err instanceof Error ? err.message : t('commits.changeFailed');
  } finally {
    actBusy.value = false;
  }
}
</script>

<template>
  <div class="page">
    <div class="page__body">
      <div class="sheet">
        <BuildsPanel class="sheet__wide" :projects="filters.projects" />
        <section class="panel sheet__wide">
          <header class="panel__h">
            {{ t('nav.commits') }}
            <span v-if="!loading" class="panel__end">{{ total }}</span>
          </header>

          <div class="panel__b list__tools">
            <div class="list__row">
              <span class="search list__search">
                <Search class="ic ic--sm search__i" />
                <input
                  v-model="typed"
                  class="input input--sm search__f"
                  :placeholder="t('commits.search')"
                  maxlength="200"
                  :aria-label="t('commits.searchLabel')"
                />
              </span>
              <div class="seg" role="radiogroup" :aria-label="t('commits.shown')">
                <label class="seg__i" :class="{ 'is-on': linked === '' }">
                  <input v-model="linked" class="sr" type="radio" name="commits-linked" value="" />
                  {{ t('commits.all') }}
                </label>
                <label class="seg__i" :class="{ 'is-on': linked === 'yes' }">
                  <input v-model="linked" class="sr" type="radio" name="commits-linked" value="yes" />
                  {{ t('commits.linked') }}
                </label>
                <label class="seg__i" :class="{ 'is-on': linked === 'no' }">
                  <input v-model="linked" class="sr" type="radio" name="commits-linked" value="no" />
                  {{ t('commits.unlinked') }}
                </label>
              </div>
            </div>
            <FilterBar v-model="filters" :menus="['projects']" :dirty="ownDirty" @clear="clearOwn">
              <FilterMenu v-model="committers" :label="t('commits.author')" :options="authorChoices" />
              <FilterMenu v-model="branches" :label="t('commits.branch')" :options="branchChoices" />
            </FilterBar>
          </div>

          <div class="panel__table">
            <table class="tbl list">
              <thead>
                <tr>
                  <th class="list__sha">{{ t('commits.sha') }}</th>
                  <th class="list__branch">{{ t('commits.branch') }}</th>
                  <th class="list__summary">{{ t('commits.message') }}</th>
                  <th class="list__issues">{{ t('commits.issues') }}</th>
                  <th class="list__who">{{ t('commits.author') }}</th>
                  <th class="list__when">{{ t('commits.when') }}</th>
                  <th class="list__act"></th>
                </tr>
              </thead>
              <tbody v-if="loading">
                <tr v-for="n in 6" :key="n">
                  <td class="list__sha"><span class="sk sk--line" style="width: 52px"></span></td>
                  <td class="list__branch"><span class="sk sk--line" style="width: 80px"></span></td>
                  <td class="list__what"><span class="sk sk--line" :style="{ width: `${40 + ((n * 17) % 45)}%` }"></span></td>
                  <td class="list__issues"><span class="sk sk--line" style="width: 44px"></span></td>
                  <td class="list__who"><span class="sk sk--line" style="width: 56px"></span></td>
                  <td class="list__when"><span class="sk sk--line" style="width: 90px"></span></td>
                  <td class="list__act"></td>
                </tr>
              </tbody>
              <tbody v-else>
                <tr v-for="r in rows" :key="r.id">
                  <td class="key list__sha">
                    <a :href="r.url" target="_blank" rel="noopener noreferrer">{{ r.sha.slice(0, 7) }}</a>
                  </td>
                  <td class="list__dim list__branch">{{ r.branch }}</td>
                  <td class="list__what" :title="r.message">{{ r.message }}</td>
                  <td class="list__issues">
                    <RouterLink
                      v-for="i in r.issues"
                      :key="i.id"
                      class="key list__key"
                      :to="{ name: 'commits', params: { key: i.key }, query: route.query }"
                      :title="`${i.summary}, ${i.stateName}`"
                      :style="{ color: ink(i.stateColor) }"
                    >{{ i.key }}</RouterLink>
                  </td>
                  <td class="list__who" :style="{ color: r.by ? ink(colorOf(r.by)) : undefined }">{{ authorOf(r) }}</td>
                  <td class="stamp list__when">{{ stampAt(r.at) }}</td>
                  <td class="list__act">
                    <button
                      class="btn btn--sm btn--icon btn--ghost"
                      type="button"
                      :title="t('commits.actions')"
                      :aria-label="t('commits.actions')"
                      @click="openActions(r)"
                    ><Ellipsis class="ic" /></button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="!loading && !rows.length" class="hint faint list__none">{{ t('commits.none') }}</div>
            <div v-if="!loading && rows.length < total" class="list__more">
              <button class="btn btn--sm btn--ghost" type="button" :disabled="more" @click="load(true)">
                {{ t('commits.more') }}
              </button>
            </div>
          </div>
        </section>
        <div v-if="errors.list" class="err sheet__wide">{{ errors.list }}</div>
      </div>
    </div>

    <Dialog v-if="acting" :title="acting.sha.slice(0, 7)" :width="520" @close="acting = null">
      <p class="act__msg">{{ acting.message }}</p>
      <div v-if="acting.issues.length" class="pick">
        <div v-for="i in acting.issues" :key="i.id" class="pick__line">
          <span class="key" :style="{ color: ink(i.stateColor) }">{{ i.key }}</span>
          <span class="pick__sum">{{ i.summary }}</span>
          <button class="btn btn--sm btn--ghost" type="button" :disabled="actBusy" @click="act('unlink', { issueId: i.id })">
            {{ t('issue.unlinkCommits') }}
          </button>
        </div>
      </div>
      <div v-if="acting.issues.length" class="hr"></div>
      <div class="sec-h">{{ t('commits.linkTo') }}</div>
      <input
        v-model="findQuery"
        class="input"
        :placeholder="t('issue.keyOrTitle')"
        @keydown.enter.prevent="found[0] && act('link', { key: found[0].key })"
      />
      <div class="pick">
        <button
          v-for="r in found"
          :key="r.id"
          class="pick__row"
          type="button"
          :disabled="actBusy"
          @click="act('link', { key: r.key })"
        >
          <span class="key">{{ r.key }}</span>
          <span class="pick__sum">{{ r.summary }}</span>
          <span class="pick__state" :style="{ color: ink(r.stateColor) }">{{ r.stateName }}</span>
        </button>
        <p v-if="finding" class="hint">{{ t('issue.searching') }}</p>
        <p v-else-if="findQuery.trim() && !found.length" class="hint">{{ t('issues.nothingFound') }}</p>
      </div>
      <div v-if="actError" class="err">{{ actError }}</div>
    </Dialog>

    <IssueView
      v-if="open"
      :key="open.key"
      :issue-key="open.key"
      :board="open.board"
      :boards="boardsOf(open.project)"
      :tags="tagsOf(open.board)"
      :project="open.project"
      @close="closeIssue"
      @changed="reloadAll"
      @linked="reloadAll"
      @moved="reloadAll(); showIssue(open.key)"
      @deleted="closeIssue(); reloadAll()"
    />
  </div>
</template>

<style scoped>
.list__search .search__f {
  width: 100%;
}
.list__sha a {
  color: var(--text-dim);
  text-decoration: none;
}
.list__sha a:hover {
  color: var(--text);
}
.list__issues {
  white-space: nowrap;
}
.list__key + .list__key {
  margin-left: 6px;
}
.list__key {
  text-decoration: none;
}
.list__branch {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.list__act {
  width: 1%;
}
.list__more {
  display: flex;
  justify-content: center;
  padding: 12px 0 4px;
}
.act__msg {
  margin: 0 0 8px;
  color: var(--text);
  font-size: 13px;
}
@media (max-width: 760px) {
  .list__branch,
  .list__who {
    display: none;
  }
}
</style>
