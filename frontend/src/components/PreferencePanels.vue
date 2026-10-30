<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import LayoutSketch from './LayoutSketch.vue';
import { api } from '../lib/api';
import { commentOrder, type CommentOrder } from '../lib/issues';
import { setWrapLines, wrapLines } from '../lib/files';
import { layout, setLayout, type Layout } from '../lib/layout';
import { setTheme, theme, type Theme } from '../lib/theme';
import { features } from '../lib/features';
import { useNotices, type NoticeKind } from '../lib/notices';
import { usePanelErrors } from '../lib/panelErrors';
import { useSession, type Me } from '../lib/session';
import { setLanguage } from '../lib/locale';
import { browserLocale, type LangChoice } from '../i18n';
import { NOTICE_KINDS } from '../../../shared/rules';

const { t } = useI18n();
const session = useSession();
const { errors, fail, clear, attempt } = usePanelErrors();
const me = session.me;
const { off, toggleKind } = useNotices();

const LAYOUTS = computed<{ value: Layout; label: string }[]>(() => [
  { value: 'top', label: t('prefs.topBar') },
  { value: 'side', label: t('prefs.sidebar') },
]);

const THEMES = computed<{ value: Theme; label: string }[]>(() => [
  { value: 'dark', label: t('prefs.dark') },
  { value: 'light', label: t('prefs.light') },
  { value: 'system', label: t('prefs.system') },
]);

const SPECIMENS = { en: 'Aa', ru: 'Яя' } as const;

const LANGS = computed<{ value: LangChoice; label: string; specimen: string }[]>(() => [
  { value: 'en', label: 'English', specimen: SPECIMENS.en },
  { value: 'ru', label: 'Русский', specimen: SPECIMENS.ru },
  { value: 'system', label: t('prefs.system'), specimen: SPECIMENS[browserLocale()] },
]);

function pickLanguage(next: LangChoice): void {
  clear('lang');
  setLanguage(next).catch((err) => fail('lang', err));
}

const order = ref<CommentOrder>(commentOrder.get());
function setOrder(next: CommentOrder): void {
  order.value = next;
  commentOrder.set(next);
}

const KINDS = computed<{ kind: NoticeKind; label: string }[]>(() =>
  NOTICE_KINDS.filter((kind) => kind !== 'ping' || features.pings).map(
    (kind) => ({ kind, label: t(`notices.kinds.${kind}`) })
  )
);

const STARS = computed<{ key: keyof Me['autoStar']; body: string; label: string }[]>(() => [
  { key: 'created', body: 'starCreated', label: t('prefs.starCreated') },
  { key: 'assigned', body: 'starAssigned', label: t('prefs.starAssigned') },
  { key: 'commented', body: 'starCommented', label: t('prefs.starCommented') },
]);

async function setAutoStar(body: string, on: boolean): Promise<void> {
  await attempt('prefs', async () => {
    const updated = await api<Me>('/me', { method: 'PATCH', body: { [body]: on } });
    me.value = { ...(me.value as Me), ...updated };
  });
}
</script>

<template>
  <div class="sheet__wide prefs">
    <section class="panel prefs__layout">
      <header class="panel__h">{{ t('prefs.layout') }}</header>
      <div class="panel__b layouts">
        <label
          v-for="l in LAYOUTS"
          :key="l.value"
          class="layout"
          :class="{ 'is-on': layout === l.value }"
        >
          <input
            class="sr"
            type="radio"
            name="layout"
            :checked="layout === l.value"
            @change="setLayout(l.value)"
          />
          <LayoutSketch :kind="l.value" />
          <span class="layout__name">{{ l.label }}</span>
        </label>
      </div>
    </section>
    <div class="stack prefs__main">
      <section class="panel">
        <header class="panel__h">{{ t('prefs.language') }}</header>
        <div class="panel__b langs">
          <label
            v-for="l in LANGS"
            :key="l.value"
            class="layout"
            :class="{ 'is-on': me?.lang === l.value }"
          >
            <input
              class="sr"
              type="radio"
              name="lang"
              :checked="me?.lang === l.value"
              @change="pickLanguage(l.value)"
            />
            <span class="lang__specimen" aria-hidden="true">{{ l.specimen }}</span>
            <span class="layout__name">{{ l.label }}</span>
          </label>
        </div>
      </section>
      <div v-if="errors.lang" class="err panel__err">{{ errors.lang }}</div>
      <section class="panel">
        <header class="panel__h">{{ t('settings.preferences') }}</header>
        <div class="panel__b form">
          <div class="pairs">
            <div class="field">
              <span class="label">{{ t('prefs.theme') }}</span>
              <label v-for="t in THEMES" :key="t.value" class="flag">
                <input type="radio" name="theme" :checked="theme === t.value" @change="setTheme(t.value)" />
                {{ t.label }}
              </label>
            </div>
            <div class="field">
              <span class="label">{{ t('prefs.commentsRead') }}</span>
              <label class="flag">
                <input
                  type="radio"
                  name="comment-order"
                  :checked="order === 'oldest'"
                  @change="setOrder('oldest')"
                />
                {{ t('prefs.oldestFirst') }}
              </label>
              <label class="flag">
                <input
                  type="radio"
                  name="comment-order"
                  :checked="order === 'newest'"
                  @change="setOrder('newest')"
                />
                {{ t('prefs.newestFirst') }}
              </label>
            </div>
          </div>
          <div class="pairs">
            <div class="field">
              <span class="label">{{ t('prefs.noticesShown') }}</span>
              <label v-for="k in KINDS" :key="k.kind" class="flag">
                <input
                  type="checkbox"
                  :checked="!off.includes(k.kind)"
                  @change="toggleKind(k.kind).catch((err) => fail('prefs', err))"
                />
                {{ k.label }}
              </label>
            </div>
            <div class="field">
              <span class="label">{{ t('prefs.files') }}</span>
              <label class="flag">
                <input
                  type="checkbox"
                  :checked="wrapLines"
                  @change="setWrapLines(($event.target as HTMLInputElement).checked)"
                />
                {{ t('prefs.wrapLines') }}
              </label>
            </div>
          </div>
          <div class="pairs">
            <div class="field">
              <span class="label">{{ t('prefs.starAuto') }}</span>
              <label v-for="s in STARS" :key="s.key" class="flag">
                <input
                  type="checkbox"
                  :checked="me?.autoStar[s.key] ?? false"
                  @change="setAutoStar(s.body, ($event.target as HTMLInputElement).checked)"
                />
                {{ s.label }}
              </label>
            </div>
          </div>
        </div>
      </section>
      <div v-if="errors.prefs" class="err panel__err">{{ errors.prefs }}</div>
    </div>
  </div>
</template>

<style scoped>
.pairs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  align-items: start;
}
.flag {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.prefs {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--space-5);
}
.prefs__layout {
  flex: none;
}
.prefs__main {
  flex: 1 1 360px;
}
.layouts {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.layouts .layout {
  width: 282px;
}
.langs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4);
}
.layout {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 10px 12px;
  border: 1px solid var(--line-2);
  color: var(--text-faint);
  cursor: pointer;
  border-radius: var(--radius);
}
.layout:hover {
  border-color: var(--line-3);
}
.layout.is-on {
  border-color: var(--accent);
  color: var(--accent);
}
.layout:has(input:focus-visible) {
  box-shadow: var(--focus-ring);
}
.layout__name {
  color: var(--text-dim);
  font-size: 13px;
}
.layout.is-on .layout__name {
  color: var(--text);
}
.lang__specimen {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64px;
  background: var(--bg);
  font: 500 34px/1 var(--font-ui);
  border-radius: var(--radius);
}
</style>
