import { ref } from 'vue';

// Mirrors READABLE in backend issue-routes.ts, which is the real gate; change both together.
const READS: Record<string, string> = {
  bat: 'plaintext',
  c: 'c',
  cfg: 'ini',
  cmd: 'plaintext',
  conf: 'ini',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  csv: 'plaintext',
  diff: 'diff',
  dio: 'drawio',
  drawio: 'drawio',
  env: 'ini',
  gd: 'python',
  go: 'go',
  godot: 'ini',
  gradle: 'plaintext',
  h: 'c',
  hpp: 'cpp',
  htm: 'xml',
  html: 'xml',
  import: 'ini',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  less: 'less',
  log: 'plaintext',
  lua: 'lua',
  md: 'markdown',
  patch: 'diff',
  php: 'php',
  pl: 'perl',
  properties: 'ini',
  ps1: 'plaintext',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  svg: 'xml',
  swift: 'swift',
  toml: 'ini',
  tres: 'ini',
  ts: 'typescript',
  tscn: 'ini',
  tsx: 'typescript',
  txt: 'plaintext',
  vue: 'xml',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
};

const extOf = (name: string): string => name.split('.').pop()?.toLowerCase() ?? '';

export const canRead = (name: string): boolean => extOf(name) in READS;

export const langOf = (name: string): string => READS[extOf(name)] ?? 'plaintext';

const WRAP = 'tracker:wrap-lines';

function readWrap(): boolean {
  try {
    return localStorage.getItem(WRAP) === '1';
  } catch {
    return false;
  }
}

export const wrapLines = ref(readWrap());

export function setWrapLines(on: boolean): void {
  wrapLines.value = on;
  try {
    localStorage.setItem(WRAP, on ? '1' : '0');
  } catch {}
}
