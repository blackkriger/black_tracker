export const RIDGE_W = 100;
export const RIDGE_H = 44;
const BASE = RIDGE_H - 3;
const PEAK = 38;

export const RIDGE_SMOOTH_KERNEL = [0.22, 0.55, 1, 0.55, 0.22];
const WEIGHT = RIDGE_SMOOTH_KERNEL.reduce((all, k) => all + k, 0);

export function smoothRidge(raw: number[]): number[] {
  return raw.map((_, i) => {
    let s = 0;
    RIDGE_SMOOTH_KERNEL.forEach((k, j) => {
      const idx = i + j - 2;
      if (raw[idx] != null) s += raw[idx] * k;
    });
    return s;
  });
}

export function ridgePath(profile: number[], full = 4): { line: string; area: string } {
  if (!profile.length) {
    const line = `M0 ${BASE} L${RIDGE_W} ${BASE}`;
    return { line, area: `${line} L${RIDGE_W} ${BASE} L0 ${BASE} Z` };
  }
  const centred = profile.map((v, i) => ({
    x: ((i + 0.5) / profile.length) * RIDGE_W,
    y: BASE - Math.min(PEAK, (v * PEAK) / full),
  }));
  const pts = [
    { x: 0, y: centred[0].y },
    ...centred,
    { x: RIDGE_W, y: centred[centred.length - 1].y },
  ];
  const n = pts.length;
  const at = (i: number) => pts[Math.max(0, Math.min(n - 1, i))];
  const f = (v: number) => v.toFixed(1);
  const hold = (y: number) => Math.max(BASE - PEAK, Math.min(BASE, y));
  let line = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: hold(p1.y + (p2.y - p0.y) / 6) };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: hold(p2.y - (p3.y - p1.y) / 6) };
    line += ` C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return { line, area: `${line} L${RIDGE_W} ${BASE} L0 ${BASE} Z` };
}

export function ridgeShape(counts: number[]): number[] {
  return smoothRidge(counts.flatMap((n) => [n, n, n, n, n])).map((v) => v / WEIGHT);
}
