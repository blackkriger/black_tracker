import { ref } from 'vue';
import { i18n } from '../i18n';
import { ApiError, TAB_ID, latestRead } from './api';
import { systemOf } from './userAgent';

export type Platform = 'windows' | 'macos';

export const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'windows', label: 'Windows' },
  { value: 'macos', label: 'macOS' },
];

export interface Build {
  id: string;
  project: string;
  name: string;
  platform: Platform;
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

export const platformLabel = (platform: Platform): string =>
  PLATFORMS.find((p) => p.value === platform)?.label ?? platform;

export const viewerPlatform = (): Platform => (systemOf(navigator.userAgent) === 'macOS' ? 'macos' : 'windows');

const MAC_NAME = /\.(dmg|pkg)$|(^|[^a-z])(mac|macos|osx|darwin)([^a-z]|$)/i;
const WINDOWS_NAME = /\.(exe|msi)$|(^|[^a-z])(win|windows)(32|64)?([^a-z]|$)/i;

export function platformOfName(name: string): Platform | null {
  const mac = MAC_NAME.test(name);
  const windows = WINDOWS_NAME.test(name);
  return mac === windows ? null : mac ? 'macos' : 'windows';
}

export async function platformOfFile(file: File): Promise<Platform | null> {
  if (/\.zip$/i.test(file.name)) {
    try {
      const { BlobReader, ZipReader } = await import('@zip.js/zip.js');
      const reader = new ZipReader(new BlobReader(file));
      const names = (await reader.getEntries()).map((entry) => entry.filename);
      await reader.close();
      const mac = names.some((n) => /\.app\/|(^|\/)Contents\/(Info\.plist|MacOS\/)/.test(n));
      const windows = names.some((n) => /\.exe$/i.test(n));
      if (mac !== windows) return mac ? 'macos' : 'windows';
    } catch {}
  }
  return platformOfName(file.name);
}

export function uploadBuild(
  project: string,
  platform: Platform,
  file: File,
  progress: (share: number) => void
): Promise<Build> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/builds/${encodeURIComponent(project)}?platform=${platform}`);
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
