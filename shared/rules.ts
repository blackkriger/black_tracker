export const PRIORITIES = ['Critical', 'Major', 'Normal', 'Minor'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const REACTIONS = [
  '\u{1F44D}',
  '\u{1F44C}',
  '\u{1F64F}',
  '\u{1F440}',
  '\u{2764}\u{FE0F}',
  '\u{1F389}',
  '\u{1F608}',
  '\u{1F921}',
  '\u{1F4A9}',
] as const;

export const LINK_KINDS = ['related', 'parent', 'child', 'duplicateOf', 'duplicatedBy'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_PICKS = ['related', 'parentOf', 'subtaskOf', 'duplicateOf', 'duplicatedBy'] as const;
export type LinkPick = (typeof LINK_PICKS)[number];

export const NOTICE_KINDS = ['mention', 'assigned', 'reaction', 'starred', 'ping'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const MARK_ICONS = ['flag', 'milestone', 'gem', 'sparkles', 'swords', 'rocket', 'calendar-heart', 'crown'] as const;
export type MarkIconName = (typeof MARK_ICONS)[number];

export const PLATFORMS = ['windows', 'macos'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const READABLE = [
  'bat', 'c', 'cfg', 'cmd', 'conf', 'cpp', 'cs', 'css', 'csv', 'dio', 'diff', 'drawio', 'env',
  'gd', 'go',
  'godot', 'gradle', 'h', 'hpp', 'htm', 'html', 'import', 'ini', 'java', 'js', 'json',
  'jsx', 'kt', 'less', 'log', 'lua', 'md', 'patch', 'php', 'pl', 'properties', 'ps1',
  'py', 'rb', 'rs', 'scss', 'sh', 'sql', 'svg', 'swift', 'toml', 'tres', 'ts', 'tscn',
  'tsx', 'txt', 'vue', 'xml', 'yaml', 'yml',
] as const;
export type ReadableExtension = (typeof READABLE)[number];

export const FILE_MAX_BYTES = 100 * 1024 * 1024;
export const INLINE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const BUILD_MAX_BYTES = 1024 * 1024 * 1024;

export const PROJECT_KEY = '[A-Z][A-Z0-9]*';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export const STATUS_COLORS = [
  { name: 'Backlog', color: '#e0917f' },
  { name: 'In progress', color: '#6cdcff' },
  { name: 'Review', color: '#c98eff' },
  { name: 'Done', color: '#8effa9' },
  { name: "Won't Fix", color: '#7d8188' },
  { name: 'Duplicate', color: '#9aa3ad' },
] as const;

export const BASE_TONE = [62, 64] as const;
