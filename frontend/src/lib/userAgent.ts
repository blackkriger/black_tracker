import { i18n } from '../i18n';

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

export const systemOf = (agent: string): string | undefined =>
  SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1];

export function describeAgent(agent: string | null): string {
  const browser = agent ? BROWSERS.find(([pattern]) => pattern.test(agent))?.[1] : undefined;
  if (!browser) return i18n.global.t('profile.unknownBrowser');
  const system = systemOf(agent as string);
  return system ? `${browser}, ${system}` : browser;
}
