import { z } from 'zod';
import { pool } from './db.js';

const SAT = 62;
const LIGHT = 64;
const ROOMY_GAP = 90;

export const hexColor = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .transform((c) => c.toLowerCase());

export function hexToHue(hex: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (((h * 60) % 360) + 360) % 360;
}

export function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

const KNOWN_COLORS: Record<string, string> = {
  backlog: '#e0917f',
  'in progress': '#6cdcff',
  review: '#c98eff',
  done: '#8effa9',
  'wont fix': '#7d8188',
  'will not fix': '#7d8188',
  duplicate: '#9aa3ad',
};

export function knownColor(name: string): string | null {
  const key = name
    .toLowerCase()
    .replace(/['’ʼ`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return KNOWN_COLORS[key] ?? null;
}

export function pickColor(taken: string[]): string {
  const hues = taken
    .map(hexToHue)
    .filter((h): h is number => h != null)
    .sort((a, b) => a - b);
  if (!hues.length) return hslToHex(Math.floor(Math.random() * 360), SAT, LIGHT);
  let start = hues[hues.length - 1];
  let size = 360 - hues[hues.length - 1] + hues[0];
  for (let i = 1; i < hues.length; i++) {
    const gap = hues[i] - hues[i - 1];
    if (gap > size) {
      start = hues[i - 1];
      size = gap;
    }
  }
  const pos = size > ROOMY_GAP ? 0.25 + Math.random() * 0.5 : 0.5;
  return hslToHex(Math.round((start + size * pos) % 360), SAT, LIGHT);
}

export async function freshColor(takenSql: string, params: unknown[] = []): Promise<string> {
  const taken = await pool.query<{ color: string }>(takenSql, params);
  return pickColor(taken.rows.map((r) => r.color));
}
