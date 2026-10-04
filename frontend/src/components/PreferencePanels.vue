<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../lib/api';
import { commentOrder, type CommentOrder } from '../lib/issues';
import { setWrapLines, wrapLines } from '../lib/files';
import { layout, setLayout, type Layout } from '../lib/layout';
import { setTheme, theme, type Theme } from '../lib/theme';
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
  <section class="panel sheet__wide">
    <header class="panel__h">Layout</header>
    <div class="panel__b layouts">
      <label
        v-for="l in LAYOUTS"
        :key="l.value"
        class="layout"
        :class="{ 'is-on': layout === l.value }"
      >
        <span class="lay" :class="`lay--${l.value}`" aria-hidden="true">
          <span v-if="l.value === 'top'" class="lay__bar"><i></i><i></i><i></i><i></i></span>
          <span v-else class="lay__rail"><i></i><i></i><i></i><span class="lay__cal"></span></span>
          <span class="lay__cols"><i></i><i></i><i></i><i></i></span>
        </span>
        <span class="flag">
          <input
            type="radio"
            name="layout"
            :checked="layout === l.value"
            @change="setLayout(l.value)"
          />
          {{ l.label }}
        </span>
      </label>
    </div>
  </section>


  <section class="panel sheet__wide">
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
              @change="toggleKind(k.kind)"
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
  <div v-if="errors.prefs" class="err panel__err sheet__wide">{{ errors.prefs }}</div>
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
.layouts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-5);
}
.layout {
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--text-faint);
  cursor: pointer;
}
.layout .flag {
  color: var(--text-dim);
}
.layout.is-on {
  color: var(--accent);
}
.layout.is-on .flag {
  color: var(--text);
}
.lay {
  display: flex;
  width: 220px;
  height: 136px;
  border: 1px solid currentColor;
  background: var(--bg);
}
.lay--top {
  flex-direction: column;
}
.lay__bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 18px;
  padding: 0 8px;
  border-bottom: 1px solid currentColor;
}
.lay__bar i {
  width: 16px;
  height: 3px;
  background: currentColor;
}
.lay__bar i:nth-child(3) {
  margin-left: auto;
}
.lay__rail {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 6px;
  width: 58px;
  padding: 8px;
  border-right: 1px solid currentColor;
}
.lay__rail i {
  width: 70%;
  height: 3px;
  background: currentColor;
}
.lay__cal {
  height: 30px;
  margin-top: 4px;
  border: 1px solid currentColor;
}
.lay__cols {
  display: flex;
  flex: 1 1 auto;
  gap: 6px;
  padding: 8px;
}
.lay__cols i {
  flex: 1 1 0;
  border: 1px solid color-mix(in srgb, currentColor 55%, transparent);
}
</style>
