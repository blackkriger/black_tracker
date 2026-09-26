// Colours are never picked by hand here — a tag or a status gets one that nothing beside it is already wearing. The hues in use are laid around the circle, the widest gap between them is found, and the new hue lands somewhere inside it: the first few come out plainly random, and the fiftieth is simply as far from its neighbours as the circle still allows. Saturation and lightness are fixed so everything reads at the same weight on the dark background.

const SAT = 62;
const LIGHT = 64;
// Two hues this far apart are told apart at a glance; below it the placement stops being random and starts being careful.
const ROOMY_GAP = 90;

export function hexToHue(hex: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null; // grey carries no hue to keep away from
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

// A handful of status names mean the same thing on every board, so they always wear the same colour: the starting four in the theme's own hues, and the two ways an issue ends without being done in grey and steel.
const KNOWN_COLORS: Record<string, string> = {
  backlog: '#d9b95c',
  'in progress': '#6cdcff',
  review: '#c98eff',
  done: '#8effa9',
  "won't fix": '#7d8188',
  'wont fix': '#7d8188',
  'will not fix': '#7d8188',
  duplicate: '#9aa3ad',
};

export function knownColor(name: string): string | null {
  return KNOWN_COLORS[name.trim().toLowerCase()] ?? null;
}

export function pickColor(taken: string[]): string {
  const hues = taken
    .map(hexToHue)
    .filter((h): h is number => h != null)
    .sort((a, b) => a - b);
  if (!hues.length) return hslToHex(Math.floor(Math.random() * 360), SAT, LIGHT);
  // The gap that wraps past 360 counts too, or every new colour would crowd the low end of the circle.
  let start = hues[hues.length - 1];
  let size = 360 - hues[hues.length - 1] + hues[0];
  for (let i = 1; i < hues.length; i++) {
    const gap = hues[i] - hues[i - 1];
    if (gap > size) {
      start = hues[i - 1];
      size = gap;
    }
  }
  // While the gap is wide the hue lands anywhere in its middle half, which keeps the choice visibly random. Once the circle fills up, randomness would start putting near-identical colours side by side, so the hue goes dead centre — the furthest it can be from both neighbours.
  const pos = size > ROOMY_GAP ? 0.25 + Math.random() * 0.5 : 0.5;
  return hslToHex(Math.round((start + size * pos) % 360), SAT, LIGHT);
}
