// Ridgeline geometry shared by the Activity ridge and the shelf charts: a 100×44 viewBox, baseline at H−3, peaks clamped 38 px above it.
export const RIDGE_W = 100;
export const RIDGE_H = 44;
const BASE = RIDGE_H - 3;
const PEAK = 38;

export const RIDGE_SMOOTH_KERNEL = [0.22, 0.55, 1, 0.55, 0.22];

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

// `full` is the value drawn at the full peak height; the Activity ridge keeps its absolute scale of 4.
export function ridgePath(profile: number[], full = 4): { line: string; area: string } {
  if (!profile.length) {
    const line = `M0 ${BASE} L${RIDGE_W} ${BASE}`;
    return { line, area: `${line} L${RIDGE_W} ${BASE} L0 ${BASE} Z` };
  }
  const n = profile.length;
  const pts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = ((i / Math.max(1, n - 1)) * RIDGE_W).toFixed(1);
    const y = (BASE - Math.min(PEAK, (profile[i] * PEAK) / full)).toFixed(1);
    pts.push(`${x} ${y}`);
  }
  const line = `M${pts.join(' L')}`;
  return { line, area: `${line} L${RIDGE_W} ${BASE} L0 ${BASE} Z` };
}
