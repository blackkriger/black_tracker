import { watch } from 'vue';
import { api } from './api';
import { useSession, type Me } from './session';
import { applyLocale, browserLocale, type LangChoice } from '../i18n';

const session = useSession();

watch(
  () => session.me.value,
  (me) => {
    if (!me) return;
    const system = browserLocale();
    const chosen = me.lang === 'en' || me.lang === 'ru' ? me.lang : null;
    applyLocale(chosen ?? system);
    if (!chosen && me.langSeen !== system && me.authKind === 'session') {
      session.me.value = { ...me, langSeen: system };
      void api('/me', { method: 'PATCH', body: { langSeen: system } }).catch(() => {});
    }
  },
  { immediate: true }
);

export async function setLanguage(choice: LangChoice): Promise<void> {
  const before = session.me.value;
  if (!before) return;
  session.me.value = { ...before, lang: choice };
  try {
    const updated = await api<Me>('/me', {
      method: 'PATCH',
      body: { lang: choice, ...(choice === 'system' ? { langSeen: browserLocale() } : {}) },
    });
    if (session.me.value) session.me.value = { ...session.me.value, ...updated };
  } catch (err) {
    if (session.me.value) session.me.value = { ...session.me.value, lang: before.lang };
    throw err;
  }
}
