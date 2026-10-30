import type { Component } from 'vue';
import { CalendarHeart, Crown, Flag, Gem, Milestone, Rocket, Sparkles, Swords } from 'lucide-vue-next';
import { MARK_ICONS as MARK_ICON_NAMES, type MarkIconName } from '../../../shared/rules';

const ICONS: Record<MarkIconName, { label: string; icon: Component }> = {
  flag: { label: 'Flag', icon: Flag },
  milestone: { label: 'Milestone', icon: Milestone },
  gem: { label: 'Gem', icon: Gem },
  sparkles: { label: 'Sparkles', icon: Sparkles },
  swords: { label: 'Swords', icon: Swords },
  rocket: { label: 'Rocket', icon: Rocket },
  'calendar-heart': { label: 'Calendar heart', icon: CalendarHeart },
  crown: { label: 'Crown', icon: Crown },
};

export const MARK_ICONS = MARK_ICON_NAMES.map((name) => ({ name, ...ICONS[name] }));

export type { MarkIconName };

export const markIconOf = (name: string | null | undefined) =>
  (MARK_ICONS.find((m) => m.name === name) ?? MARK_ICONS[0]).icon;
