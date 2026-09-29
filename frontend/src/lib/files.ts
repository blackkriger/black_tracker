import { ref } from 'vue';

// What a click on a file's name does. The server keeps the same list and is the gate; this
// side only decides whether to open the reader or let the download happen, and what to call
// the language while highlighting it.
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

// Whether the reader folds long lines. A habit, like the order comments read in, so it is
// kept per browser and shared by the reader and the preferences that name it.
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
  } catch {
    /* private mode — the reader simply starts unfolded next time */
  }
}
