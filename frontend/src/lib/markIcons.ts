import { CalendarHeart, Crown, Flag, Gem, Milestone, Rocket, Sparkles, Swords } from 'lucide-vue-next';

export const MARK_ICONS = [
  { name: 'flag', label: 'Flag', icon: Flag },
  { name: 'milestone', label: 'Milestone', icon: Milestone },
  { name: 'gem', label: 'Gem', icon: Gem },
  { name: 'sparkles', label: 'Sparkles', icon: Sparkles },
  { name: 'swords', label: 'Swords', icon: Swords },
  { name: 'rocket', label: 'Rocket', icon: Rocket },
  { name: 'calendar-heart', label: 'Calendar heart', icon: CalendarHeart },
  { name: 'crown', label: 'Crown', icon: Crown },
] as const;

export type MarkIconName = (typeof MARK_ICONS)[number]['name'];

export const markIconOf = (name: string | null | undefined) =>
  (MARK_ICONS.find((m) => m.name === name) ?? MARK_ICONS[0]).icon;
