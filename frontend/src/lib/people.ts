import { computed, ref } from 'vue';
import { api } from './api';

export interface Person {
  id: string;
  login: string;
  fullName: string;
  roleColor: string | null;
}

const people = ref<Person[]>([]);
const loaded = ref(false);
let inflight: Promise<void> | null = null;

const byLogin = computed(() => new Map(people.value.map((p) => [p.login, p])));
const byId = computed(() => new Map(people.value.map((p) => [p.id, p])));

export function usePeople() {
  return {
    people,
    loaded,
    colorOf(login: string | null | undefined): string | undefined {
      return (login && byLogin.value.get(login)?.roleColor) || undefined;
    },
    colorOfId(id: string | null | undefined): string | undefined {
      return (id && byId.value.get(id)?.roleColor) || undefined;
    },
    nameOf(login: string | null | undefined): string {
      if (!login) return '';
      const p = byLogin.value.get(login);
      return p?.fullName || login;
    },
    async load(force = false): Promise<void> {
      if (loaded.value && !force) return;
      inflight ??= api<Person[]>('/people')
        .then((rows) => {
          people.value = rows;
          loaded.value = true;
        })
        .catch(() => {})
        .finally(() => {
          inflight = null;
        });
      await inflight;
    },
  };
}
