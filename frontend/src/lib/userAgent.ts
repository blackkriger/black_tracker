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

export function describeAgent(agent: string | null): string {
  const browser = agent ? BROWSERS.find(([pattern]) => pattern.test(agent))?.[1] : undefined;
  if (!browser) return 'Unknown browser';
  const system = SYSTEMS.find(([pattern]) => pattern.test(agent as string))?.[1];
  return system ? `${browser}, ${system}` : browser;
}
