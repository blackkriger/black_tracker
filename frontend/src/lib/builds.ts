import { ref } from 'vue';
import { i18n } from '../i18n';
import { ApiError, TAB_ID, latestRead } from './api';

export interface Build {
  id: string;
  project: string;
  name: string;
  size: number | null;
  url: string | null;
  by: string | null;
  at: string;
}

export const MAX_BUILD_BYTES = 1024 * 1024 * 1024;

const builds = ref<Build[]>([]);
const loaded = ref(false);
const read = latestRead<Build[]>('/builds', (rows) => {
  builds.value = rows;
  loaded.value = true;
});

export function useBuilds() {
  return {
    builds,
    loaded,
    async load(force = false): Promise<void> {
      if (loaded.value && !force) return;
      await read(force).catch(() => {
        loaded.value = true;
      });
    },
  };
}

export const buildLink = (b: Build): Record<string, string> =>
  b.url
    ? { href: b.url, target: '_blank', rel: 'noopener noreferrer' }
    : { href: `/api/builds/${b.id}/file`, download: b.name };

export function uploadBuild(project: string, file: File, progress: (share: number) => void): Promise<Build> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/builds/${encodeURIComponent(project)}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Tab-Id', TAB_ID);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) progress(ev.loaded / ev.total);
    };
    xhr.onload = () => {
      let payload: { data?: Build; error?: string } | null = null;
      try {
        payload = JSON.parse(xhr.responseText) as { data?: Build; error?: string };
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && payload?.data) resolve(payload.data);
      else {
        const fallback = i18n.global.t('common.requestFailed', { status: xhr.status });
        reject(new ApiError(payload?.error ?? fallback, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError(i18n.global.t('common.requestFailed', { status: 0 }), 0));
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}
