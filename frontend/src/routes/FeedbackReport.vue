<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChevronDown, ChevronRight, Download } from 'lucide-vue-next';
import DateRangePicker from '../components/DateRangePicker.vue';
import RidgeRows, { type RidgeRow } from '../components/RidgeRows.vue';
import Select from '../components/Select.vue';
import { api } from '../lib/api';
import { FEEDBACK_FORMS, type FeedbackItem } from '../lib/feedback';
import { stampAt } from '../lib/issues';
import { settled, useLive } from '../lib/live';
import { usePanelErrors } from '../lib/panelErrors';
import { ridgeShape } from '../lib/ridge';

type Dim = 'device' | 'os' | 'browser' | 'browserLang' | 'theme' | 'lang' | 'country';

interface Answer {
  id: string;
  at: string;
  lang: string;
  answers: Record<string, unknown>;
  name: string | null;
  email: string | null;
}

interface Report {
  forms: { id: string; name: string }[];
  form: string;
  sessions: number;
  views: number;
  sent: number;
  reached: Record<string, number>;
  sectionMs: Record<string, number>;
  totalMs: number | null;
  audience: Record<Dim, { value: string | null; n: number }[]>;
  responses: Answer[];
}

const DIMS: { key: Dim; title: string }[] = [
  { key: 'country', title: 'Country' },
  { key: 'device', title: 'Device' },
  { key: 'os', title: 'System' },
  { key: 'browser', title: 'Browser' },
  { key: 'browserLang', title: 'Browser language' },
  { key: 'lang', title: 'Page language' },
  { key: 'theme', title: 'Theme' },
];
const SHOWN_PER_DIM = 6;
const SCORES = ['1', '2', '3', '4', '5'];

const route = useRoute();
const router = useRouter();
const { errors, fail, clear } = usePanelErrors();

const asked = computed(() => ({
  form: typeof route.query.form === 'string' ? route.query.form : '',
  from: typeof route.query.from === 'string' ? route.query.from : '',
  to: typeof route.query.to === 'string' ? route.query.to : '',
}));

function pick(part: Partial<{ form: string; from: string; to: string }>): void {
  const next = { ...asked.value, ...part };
  void router.replace({
    name: 'feedback',
    query: Object.fromEntries(Object.entries(next).filter(([, v]) => v)),
  });
}

const loading = ref(true);
const report = ref<Report | null>(null);
let reads = 0;

async function load(): Promise<void> {
  clear('report');
  const mine = ++reads;
  try {
    const query = new URLSearchParams(Object.entries(asked.value).filter(([, v]) => v)).toString();
    const got = await api<Report | null>(`/feedback/report${query ? `?${query}` : ''}`);
    if (mine === reads) report.value = got;
  } catch (err) {
    if (mine === reads) fail('report', err, 'Could not read the feedback.');
  } finally {
    if (mine === reads) loading.value = false;
  }
}

onMounted(() => void load());
watch(asked, () => {
  if (route.name === 'feedback') void load();
});
const reload = settled(() => void load());
useLive(
  (ev) => {
    if (ev.type === 'feedback.changed') reload();
  },
  () => reload()
);

const formChoices = computed(() => (report.value?.forms ?? []).map((f) => ({ value: f.id, label: f.name })));
const sections = computed(() => FEEDBACK_FORMS[report.value?.form ?? ''] ?? []);
const items = computed<FeedbackItem[]>(() => sections.value.flatMap((s) => s.items));
const responses = computed(() => report.value?.responses ?? []);

const share = (n: number, of: number): string => (of ? `${Math.round((n / of) * 100)}%` : '—');

function took(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const funnel = computed(() => {
  const r = report.value;
  if (!r) return [];
  const reachedFrom = (step: number): number =>
    Object.entries(r.reached).reduce((all, [at, n]) => (Number(at) >= step ? all + n : all), 0);
  return [
    ...sections.value.map((s, i) => {
      const n = reachedFrom(i);
      return { key: s.id, label: `${i + 1}. ${s.title}`, n, share: share(n, r.sessions), time: took(r.sectionMs[s.id]) };
    }),
    { key: 'sent', label: 'Sent', n: r.sent, share: share(r.sent, r.sessions), time: took(r.totalMs) },
  ];
});

function scoreCounts(read: (a: Record<string, unknown>) => unknown): number[] {
  const counts = [0, 0, 0, 0, 0];
  for (const r of responses.value) {
    const v = read(r.answers);
    if (typeof v === 'number' && v >= 1 && v <= 5) counts[v - 1] += 1;
  }
  return counts;
}

function mean(counts: number[]): string | null {
  const n = counts.reduce((all, c) => all + c, 0);
  return n ? (counts.reduce((all, c, i) => all + c * (i + 1), 0) / n).toFixed(1) : null;
}

interface Scored {
  key: string;
  label: string;
  hint: string;
  counts: number[];
}

const ratingScores = computed<Scored[]>(() =>
  items.value.flatMap((it) =>
    it.kind !== 'ratings'
      ? []
      : Object.entries(it.aspects).map(([key, label]) => ({
          key,
          label: it.shorts[key] ?? label,
          hint: label,
          counts: scoreCounts((a) => (a[it.key] as Record<string, unknown> | undefined)?.[key]),
        }))
  )
);
const scaleScores = computed<Scored[]>(() =>
  items.value.flatMap((it) =>
    it.kind !== 'scale' ? [] : [{ key: it.key, label: it.short, hint: it.title, counts: scoreCounts((a) => a[it.key]) }]
  )
);
const scoreTallest = computed(() =>
  Math.max(1, ...[...ratingScores.value, ...scaleScores.value].flatMap((s) => s.counts))
);
const ridgeOf = (s: Scored): RidgeRow => ({
  key: s.key,
  label: s.label,
  hint: s.hint,
  profile: ridgeShape(s.counts),
  value: mean(s.counts),
});
const ratingRows = computed(() => ratingScores.value.map(ridgeOf));
const scaleRows = computed(() => scaleScores.value.map(ridgeOf));

const choicePanels = computed(() =>
  items.value.flatMap((it) => {
    if (it.kind !== 'choice') return [];
    const counts = new Map<string, number>();
    for (const r of responses.value) {
      const v = r.answers[it.key];
      if (typeof v === 'string') counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((all, n) => all + n, 0);
    return [
      {
        key: it.key,
        title: it.title,
        rows: Object.entries(it.options).map(([value, label]) => ({
          value,
          label,
          n: counts.get(value) ?? 0,
          share: share(counts.get(value) ?? 0, total),
        })),
      },
    ];
  })
);
const choiceColumns = computed(() => [
  choicePanels.value.filter((_, i) => i % 2 === 0),
  choicePanels.value.filter((_, i) => i % 2 === 1),
]);

const texts = computed(() =>
  items.value.flatMap((it) =>
    it.kind !== 'text'
      ? []
      : [
          {
            key: it.key,
            title: it.title,
            short: it.short,
            said: responses.value.flatMap((r) => {
              const v = r.answers[it.key];
              return typeof v === 'string' && v ? [{ id: r.id, at: r.at, lang: r.lang, text: v }] : [];
            }),
          },
        ]
  )
);
const textKey = ref('');
const shownText = computed(
  () => texts.value.find((t) => t.key === textKey.value) ?? texts.value.find((t) => t.said.length) ?? texts.value[0]
);

const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const languages = new Intl.DisplayNames(['en'], { type: 'language' });

function named(names: Intl.DisplayNames, code: string): string {
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

function valueLabel(dim: Dim, value: string | null): string {
  if (value == null) return 'Unknown';
  if (dim === 'country') return named(regions, value);
  if (dim === 'browserLang' || dim === 'lang') return named(languages, value);
  if (dim === 'device' || dim === 'theme') return value.charAt(0).toUpperCase() + value.slice(1);
  return value;
}

const audience = computed(() =>
  DIMS.map((d) => {
    const all = report.value?.audience[d.key] ?? [];
    const total = all.reduce((sum, r) => sum + r.n, 0);
    const rest = all.slice(SHOWN_PER_DIM).reduce((sum, r) => sum + r.n, 0);
    return {
      ...d,
      rows: [
        ...all.slice(0, SHOWN_PER_DIM).map((r) => ({ label: valueLabel(d.key, r.value), n: r.n, share: share(r.n, total) })),
        ...(rest ? [{ label: 'Other', n: rest, share: share(rest, total) }] : []),
      ],
    };
  })
);

function answerText(it: FeedbackItem, value: unknown): string {
  if (value == null || value === '') return '';
  if (it.kind === 'choice') return it.options[String(value)] ?? String(value);
  if (it.kind === 'ratings') {
    const given = value as Record<string, unknown>;
    return Object.entries(it.aspects)
      .filter(([key]) => given[key] != null)
      .map(([key, label]) => `${label} ${given[key]}`)
      .join(', ');
  }
  return String(value);
}

const opened = ref<string[]>([]);
const toggle = (id: string): void => {
  opened.value = opened.value.includes(id) ? opened.value.filter((x) => x !== id) : [...opened.value, id];
};
const answersOf = (r: Answer) =>
  items.value
    .map((it) => ({ key: it.key, title: it.title, text: answerText(it, r.answers[it.key]) }))
    .filter((a) => a.text);

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function exportCsv(): void {
  const r = report.value;
  if (!r) return;
  const columns: { title: string; read: (a: Answer) => string }[] = [
    { title: 'Date', read: (a) => a.at },
    { title: 'Language', read: (a) => a.lang },
    { title: 'Name', read: (a) => a.name ?? '' },
    { title: 'Email', read: (a) => a.email ?? '' },
    ...items.value.flatMap((it) =>
      it.kind === 'ratings'
        ? Object.entries(it.aspects).map(([key, label]) => ({
            title: label,
            read: (a: Answer) => String((a.answers[it.key] as Record<string, unknown> | undefined)?.[key] ?? ''),
          }))
        : [{ title: it.title, read: (a: Answer) => answerText(it, a.answers[it.key]) }]
    ),
  ];
  const lines = [columns.map((c) => c.title), ...r.responses.map((a) => columns.map((c) => c.read(a)))];
  const blob = new Blob([`﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `feedback-${r.form}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>

<template>
  <div class="page">
    <div class="page__body">
      <div class="sheet">
        <div class="sheet__wide lead">
          <Select
            v-if="formChoices.length"
            :model-value="report?.form ?? ''"
            :options="formChoices"
            small
            label="Form"
            class="lead__form"
            @update:model-value="pick({ form: $event })"
          />
          <span class="lead__period" :class="{ 'is-on': asked.from || asked.to }">
            <DateRangePicker :from="asked.from" :to="asked.to" @change="pick({ from: $event.from, to: $event.to })" />
          </span>
        </div>

        <section class="panel sheet__wide">
          <header class="panel__h">
            Funnel
            <span v-if="report" class="panel__end">{{ report.views }} views</span>
          </header>
          <div class="panel__table">
            <table class="tbl funnel">
              <thead>
                <tr>
                  <th>Section</th>
                  <th class="n">Reached</th>
                  <th class="n">Share</th>
                  <th class="n">Median time</th>
                </tr>
              </thead>
              <tbody>
                <template v-if="loading">
                  <tr v-for="w in [160, 120, 180]" :key="w">
                    <td><span class="sk sk--line" :style="{ width: `${w}px` }"></span></td>
                    <td class="n"><span class="sk sk--line funnel__sk"></span></td>
                    <td class="n"><span class="sk sk--line funnel__sk"></span></td>
                    <td class="n"><span class="sk sk--line funnel__sk"></span></td>
                  </tr>
                </template>
                <tr v-for="row in funnel" :key="row.key" :class="{ 'funnel__sent': row.key === 'sent' }">
                  <td>{{ row.label }}</td>
                  <td class="n">{{ row.n }}</td>
                  <td class="n">{{ row.share }}</td>
                  <td class="n">{{ row.time }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <div v-if="errors.report" class="err panel__err sheet__wide">{{ errors.report }}</div>

        <section class="panel sheet__wide">
          <header class="panel__h">
            Responses
            <span class="panel__end">
              <button
                v-if="responses.length"
                class="btn btn--sm btn--ghost"
                type="button"
                @click="exportCsv"
              ><Download class="ic" />CSV</button>
            </span>
          </header>
          <div class="panel__table">
            <table class="tbl answers">
              <thead>
                <tr>
                  <th>Sent</th>
                  <th>Language</th>
                  <th>Name</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                <template v-if="loading">
                  <tr v-for="w in [90, 70]" :key="w">
                    <td><span class="sk sk--line" style="width: 130px"></span></td>
                    <td><span class="sk sk--line" style="width: 24px"></span></td>
                    <td><span class="sk sk--line" :style="{ width: `${w}px` }"></span></td>
                    <td><span class="sk sk--line" style="width: 140px"></span></td>
                  </tr>
                </template>
                <template v-for="r in responses" :key="r.id">
                  <tr class="answers__row" @click="toggle(r.id)">
                    <td class="stamp">
                      <span class="answers__at">
                        <ChevronDown v-if="opened.includes(r.id)" class="ic ic--sm" />
                        <ChevronRight v-else class="ic ic--sm" />
                        {{ stampAt(r.at) }}
                      </span>
                    </td>
                    <td class="stamp">{{ r.lang.toUpperCase() }}</td>
                    <td>{{ r.name ?? '' }}</td>
                    <td>{{ r.email ?? '' }}</td>
                  </tr>
                  <tr v-if="opened.includes(r.id)" class="answers__more">
                    <td colspan="4">
                      <dl class="answers__list">
                        <template v-for="a in answersOf(r)" :key="a.key">
                          <dt>{{ a.title }}</dt>
                          <dd>{{ a.text }}</dd>
                        </template>
                      </dl>
                    </td>
                  </tr>
                </template>
                <tr v-if="!loading && !responses.length">
                  <td colspan="4" class="hint faint">No responses yet.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel sheet__wide">
          <header class="panel__h">Audience</header>
          <div class="panel__b crowd">
            <div v-for="d in audience" :key="d.key" class="crowd__dim">
              <h3 class="crowd__h">{{ d.title }}</h3>
              <template v-if="loading">
                <span v-for="w in [70, 52]" :key="w" class="sk sk--line" :style="{ width: `${w}%` }"></span>
              </template>
              <div v-else-if="!d.rows.length" class="hint faint">No visits yet.</div>
              <div v-for="row in d.rows" :key="row.label" class="crowd__row">
                <span class="crowd__what">{{ row.label }}</span>
                <span class="n">{{ row.n }}</span>
                <span class="n crowd__share">{{ row.share }}</span>
              </div>
              <a
                v-if="d.key === 'country'"
                class="crowd__credit"
                href="https://db-ip.com"
                target="_blank"
                rel="noopener"
              >IP geolocation by DB-IP</a>
            </div>
          </div>
        </section>

        <section v-if="texts.length" class="panel sheet__wide">
          <header class="panel__h">Comments</header>
          <div class="said">
            <nav class="said__nav" aria-label="Questions">
              <button
                v-for="t in texts"
                :key="t.key"
                class="said__q"
                :class="{ 'is-on': t.key === shownText?.key, 'is-empty': !t.said.length }"
                type="button"
                :aria-pressed="t.key === shownText?.key"
                @click="textKey = t.key"
              >
                <span class="said__name">{{ t.short }}</span>
                <span class="said__n">{{ t.said.length }}</span>
              </button>
            </nav>
            <div class="said__body">
              <div class="said__title">{{ shownText?.title }}</div>
              <div v-if="!shownText?.said.length" class="hint faint">No answers yet.</div>
              <div v-for="s in shownText?.said ?? []" :key="s.id" class="said__row">
                <span class="stamp">{{ stampAt(s.at) }}, {{ s.lang.toUpperCase() }}</span>
                <p class="said__text">{{ s.text }}</p>
              </div>
            </div>
          </div>
        </section>

        <section class="panel">
          <header class="panel__h">
            Ratings
            <span v-if="report" class="panel__end">{{ responses.length }}</span>
          </header>
          <div class="panel__b">
            <div v-if="loading" class="skel">
              <div v-for="n in 5" :key="n" class="skel__ridge">
                <span class="sk sk--line" style="width: 64px"></span>
                <span class="sk sk--line skel__hill"></span>
                <span class="sk sk--line" style="width: 20px"></span>
              </div>
            </div>
            <div v-else-if="!responses.length" class="hint faint">No responses yet.</div>
            <RidgeRows v-else :rows="ratingRows" :full="scoreTallest">
              <template #axis>
                <span v-for="s in SCORES" :key="s">{{ s }}</span>
              </template>
            </RidgeRows>
          </div>
        </section>

        <section class="panel">
          <header class="panel__h">Scales</header>
          <div class="panel__b">
            <div v-if="loading" class="skel">
              <div v-for="n in 6" :key="n" class="skel__ridge">
                <span class="sk sk--line" style="width: 64px"></span>
                <span class="sk sk--line skel__hill"></span>
                <span class="sk sk--line" style="width: 20px"></span>
              </div>
            </div>
            <div v-else-if="!responses.length" class="hint faint">No responses yet.</div>
            <RidgeRows v-else :rows="scaleRows" :full="scoreTallest">
              <template #axis>
                <span v-for="s in SCORES" :key="s">{{ s }}</span>
              </template>
            </RidgeRows>
          </div>
        </section>

        <div v-for="(column, i) in choiceColumns" :key="i" class="stack">
          <section v-for="c in column" :key="c.key" class="panel">
            <header class="panel__h">{{ c.title }}</header>
            <div class="panel__table">
              <table class="tbl tbl--plain">
                <tbody>
                  <tr v-for="row in c.rows" :key="row.value">
                    <td class="wrap">{{ row.label }}</td>
                    <td class="n">{{ row.n }}</td>
                    <td class="n">{{ row.share }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page__body {
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--space-6) var(--space-5);
  overflow-y: auto;
}
.lead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.lead__form {
  width: auto;
}
.lead__period:not(.is-on) :deep(.drp__trigger) {
  color: var(--text-muted);
}
.tbl .n,
.tbl th.n {
  text-align: right;
  font-family: var(--font-num);
  font-size: 12px;
}
.tbl th.n {
  font-family: inherit;
}
.funnel td:first-child {
  width: 100%;
}
.funnel__sent td {
  font-weight: 600;
}
.funnel__sk {
  display: inline-block;
  width: 32px;
}
.skel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 6px 2px 0;
}
.skel__ridge {
  display: grid;
  grid-template-columns: 96px 1fr 44px;
  gap: 12px;
  align-items: center;
}
.skel__ridge .sk:last-child {
  justify-self: end;
}
.skel__hill {
  flex: 1 1 auto;
  height: 6px;
}
.tbl--plain tbody tr:last-child td {
  border-bottom: 0;
}
.tbl td.wrap {
  width: 100%;
  white-space: normal;
}
.said {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
}
.said__nav {
  display: flex;
  flex-direction: column;
  padding: 12px 0;
  border-right: 1px solid var(--line);
}
.said__q {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 16px 0 20px;
  border: 0;
  background: none;
  color: var(--text-dim);
  font: 13px var(--font-ui);
  text-align: left;
  cursor: pointer;
}
.said__q.is-empty {
  color: var(--text-faint);
}
.said__q:hover,
.said__q.is-on {
  color: var(--text);
}
.said__q:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.said__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.said__n {
  font: 11px var(--font-num);
  color: var(--text-muted);
}
.said__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 20px;
}
.said__title {
  font-size: 12.5px;
  color: var(--text-muted);
}
.said__row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.said__text {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.crowd {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 24px 28px;
}
.crowd__dim {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.crowd__h {
  margin: 0 0 2px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
}
.crowd__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 36px;
  gap: 8px;
  font-size: 13px;
}
.crowd__what {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.crowd__row .n {
  text-align: right;
  font: 12px var(--font-num);
}
.crowd__share {
  color: var(--text-muted);
}
.crowd__credit {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-faint);
  text-decoration: none;
}
.crowd__credit:hover {
  color: var(--text);
}
.answers__row {
  cursor: pointer;
}
.answers__at {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.answers td:nth-child(3),
.answers td:nth-child(4) {
  width: 50%;
  max-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.answers__more td {
  height: auto;
  padding: 4px 12px 18px 32px;
  white-space: normal;
}
.answers__list {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  gap: 8px 20px;
  margin: 0;
}
.answers__list dt {
  color: var(--text-muted);
  font-size: 12.5px;
}
.answers__list dd {
  margin: 0;
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (max-width: 760px) {
  .said {
    grid-template-columns: minmax(0, 1fr);
  }
  .said__nav {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .panel__h {
    flex-wrap: wrap;
    height: auto;
    min-height: 48px;
    padding-top: 8px;
    padding-bottom: 8px;
  }
  .skel__ridge {
    grid-template-columns: 72px 1fr 36px;
  }
  .funnel th,
  .funnel td {
    padding: 0 6px;
  }
  .funnel td:first-child {
    white-space: normal;
  }
  .crowd {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .answers__list {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
  .answers__list dd {
    margin-bottom: 8px;
  }
}
</style>
