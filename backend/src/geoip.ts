import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { FastifyBaseLogger } from 'fastify';
import { Reader, type CountryResponse } from 'maxmind';
import { env } from './env.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NAME = /^dbip-country-lite-\d{4}-\d{2}\.mmdb$/;

let reader: Reader<CountryResponse> | null = null;

export function countryOf(ip: string): string | null {
  try {
    return reader?.get(ip)?.country?.iso_code ?? null;
  } catch {
    return null;
  }
}

const monthOf = (at: Date): string => at.toISOString().slice(0, 7);
const nameOf = (month: string): string => `dbip-country-lite-${month}.mmdb`;

async function download(month: string): Promise<Buffer | null> {
  const res = await fetch(`https://download.db-ip.com/free/${nameOf(month)}.gz`, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) return null;
  return gunzipSync(Buffer.from(await res.arrayBuffer()));
}

async function refresh(): Promise<void> {
  const dir = env.geoipDir;
  const kept = (await readdir(dir).catch(() => [] as string[])).filter((n) => NAME.test(n)).sort();
  const latest = kept[kept.length - 1];
  const now = new Date();
  const month = monthOf(now);
  if (latest !== nameOf(month)) {
    const before = monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
    for (const tried of latest ? [month] : [month, before]) {
      const data = await download(tried);
      if (!data) continue;
      const fresh = new Reader<CountryResponse>(data);
      const file = path.join(dir, nameOf(tried));
      await mkdir(dir, { recursive: true });
      await writeFile(`${file}.part`, data);
      await rename(`${file}.part`, file);
      reader = fresh;
      await Promise.all(kept.filter((n) => n !== nameOf(tried)).map((n) => rm(path.join(dir, n), { force: true })));
      return;
    }
  }
  if (!reader && latest) reader = new Reader<CountryResponse>(await readFile(path.join(dir, latest)));
}

export function startGeoip(log: FastifyBaseLogger): void {
  const run = (): void => void refresh().catch((err) => log.warn({ err }, 'geoip refresh failed'));
  run();
  setInterval(run, DAY_MS).unref();
}
