<script setup lang="ts">
import { ref } from 'vue';
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

const session = useSession();
const { errors, fail, clear } = usePanelErrors();
const me = session.me;
const { off, toggleKind } = useNotices();

const LAYOUTS: { value: Layout; label: string }[] = [
  { value: 'top', label: 'Top bar' },
  { value: 'side', label: 'Sidebar' },
];

const THEMES: { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

const order = ref<CommentOrder>(commentOrder.get());
function setOrder(next: CommentOrder): void {
  order.value = next;
  commentOrder.set(next);
}

const KINDS: { kind: NoticeKind; label: string }[] = [
  { kind: 'mention', label: 'Mentions' },
  { kind: 'assigned', label: 'Assigned to you' },
  { kind: 'reaction', label: 'Reactions' },
  { kind: 'starred', label: 'Starred issues' },
  ...(features.pings ? [{ kind: 'ping' as const, label: 'Pings' }] : []),
];

const STARS: { key: keyof Me['autoStar']; body: string; label: string }[] = [
  { key: 'created', body: 'starCreated', label: 'Created by me' },
  { key: 'assigned', body: 'starAssigned', label: 'Assigned to me' },
  { key: 'commented', body: 'starCommented', label: 'Commented on (by me)' },
];

async function setAutoStar(body: string, on: boolean): Promise<void> {
  clear('prefs');
  try {
    const updated = await api<Me>('/me', { method: 'PATCH', body: { [body]: on } });
    me.value = { ...(me.value as Me), ...updated };
  } catch (err) {
    fail('prefs', err);
  }
}
</script>

<template>
  <div class="sheet__wide prefs">
    <section class="panel prefs__layout">
      <header class="panel__h">Layout</header>
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
        <header class="panel__h">Preferences</header>
        <div class="panel__b form">
          <div class="pairs">
            <div class="field">
              <span class="label">Theme</span>
              <label v-for="t in THEMES" :key="t.value" class="flag">
                <input type="radio" name="theme" :checked="theme === t.value" @change="setTheme(t.value)" />
                {{ t.label }}
              </label>
            </div>
            <div class="field">
              <span class="label">Comments read</span>
              <label class="flag">
                <input
                  type="radio"
                  name="comment-order"
                  :checked="order === 'oldest'"
                  @change="setOrder('oldest')"
                />
                Oldest first
              </label>
              <label class="flag">
                <input
                  type="radio"
                  name="comment-order"
                  :checked="order === 'newest'"
                  @change="setOrder('newest')"
                />
                Newest first
              </label>
            </div>
          </div>
          <div class="pairs">
            <div class="field">
              <span class="label">Notices shown</span>
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
              <span class="label">Files</span>
              <label class="flag">
                <input
                  type="checkbox"
                  :checked="wrapLines"
                  @change="setWrapLines(($event.target as HTMLInputElement).checked)"
                />
                Wrap long lines
              </label>
            </div>
          </div>
          <div class="pairs">
            <div class="field">
              <span class="label">Star automatically</span>
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
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
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
.layout {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 282px;
  padding: 10px 10px 12px;
  border: 1px solid var(--line-2);
  color: var(--text-faint);
  cursor: pointer;
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
</style>
