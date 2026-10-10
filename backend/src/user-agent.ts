const BROWSERS: [RegExp, string][] = [
  [/YaBrowser\//, 'Yandex Browser'],
  [/Edg(A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Waterfox\//, 'Waterfox'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

export type Device = 'desktop' | 'phone' | 'tablet';

export function readAgent(
  agent: string,
  touch: boolean
): { device: Device; os: string | null; browser: string | null } {
  const padAsMac = touch && /Macintosh/.test(agent);
  const device: Device =
    padAsMac || /iPad|Tablet/.test(agent) || (/Android/.test(agent) && !/Mobile/.test(agent))
      ? 'tablet'
      : /Mobi|iPhone|iPod|Android/.test(agent)
        ? 'phone'
        : 'desktop';
  return {
    device,
    os: padAsMac ? 'iOS' : (SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1] ?? null),
    browser: BROWSERS.find(([pattern]) => pattern.test(agent))?.[1] ?? null,
  };
}
