// The buddy avatar from another project, carried over whole so a person looks the same in both places: an FNV-1a hash of the login picks a hue, and the rest is a self-contained SVG. No upload path here — the tracker has no avatar files.

// FNV-1a hash of a name to a uint32, a stable per-name seed shared by both fallback styles below. Three independent byte-slices of it feed hue, saturation and lightness, so even hue collisions stay distinguishable by brightness; the earlier `(h * 31 + ch) >>> 0` with a raw `% 360` clustered short names into the green band, which FNV fixed.
function fnv1a(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// MSN/Messenger-style glossy buddy, the default avatar for users with no uploaded picture: a self-contained SVG of coloured backdrop plus glass head and torso, tinted by the username's hue so every user gets a stable colour, with a square viewBox so it fills the gold-bordered tiles cover.
function buddyAvatarSvg(hue: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">` +
    `<defs>` +
    `<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},65%,95%)"/><stop offset="1" stop-color="hsl(${hue},68%,80%)"/></linearGradient>` +
    `<radialGradient id="g" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="d" cx=".42" cy=".24" r=".9"><stop offset="0" stop-color="hsl(${hue},92%,80%)"/><stop offset=".5" stop-color="hsl(${hue},94%,53%)"/><stop offset=".86" stop-color="hsl(${hue},96%,39%)"/><stop offset="1" stop-color="hsl(${hue},96%,30%)"/></radialGradient>` +
    `<radialGradient id="e" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="hsl(${hue},96%,84%)"/><stop offset=".42" stop-color="hsl(${hue},93%,56%)"/><stop offset=".85" stop-color="hsl(${hue},96%,41%)"/><stop offset="1" stop-color="hsl(${hue},96%,31%)"/></radialGradient>` +
    `<radialGradient id="s" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="hsl(${hue},96%,22%)" stop-opacity=".55"/><stop offset="1" stop-color="hsl(${hue},96%,22%)" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="p" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".6" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `</defs>` +
    `<rect width="100" height="100" fill="url(#b)"/>` +
    `<ellipse cx="50" cy="40" rx="54" ry="46" fill="url(#g)"/>` +
    `<path d="M14,101 C13,73 28,50 50,50 C72,50 87,73 86,101 Z" fill="url(#d)"/>` +
    `<ellipse cx="39" cy="66" rx="15" ry="8" fill="url(#p)" opacity=".45"/>` +
    `<ellipse cx="50" cy="57" rx="18" ry="6.5" fill="url(#s)"/>` +
    `<circle cx="50" cy="37" r="20.5" fill="url(#e)"/>` +
    `<ellipse cx="42" cy="29" rx="11" ry="8.5" fill="url(#p)"/>` +
    `</svg>`
  );
}

// Data URI for the buddy avatar, usable as a `background-image`, memoized by name because it is bound directly in `v-for` `:style` on hot feeds — Lobby, comments, friend lists — so it re-runs on every row re-render; the SVG build plus encodeURIComponent is pure in `name` and the distinct-name set is small.
const buddyUriCache = new Map<string, string>();
function buddyAvatarDataUri(name: string): string {
  const cached = buddyUriCache.get(name);
  if (cached !== undefined) return cached;
  const svg = buddyAvatarSvg(fnv1a(name) % 360);
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  buddyUriCache.set(name, uri);
  return uri;
}

// Drop-in for `placeholderAvatarStyle` on user-avatar tiles, painting the buddy as a cover background since the SVG carries its own backdrop.
export function buddyAvatarStyle(name: string): {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
} {
  return {
    backgroundImage: `url("${buddyAvatarDataUri(name)}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };
}
