'use client';

import { useTheme } from '@/lib/theme/ThemeContext';
import { Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

type ThemeValue = 'light' | 'dark' | 'system';
type Option = { value: ThemeValue; label: string; icon: typeof Sun; title?: string };

const OPTIONS: Option[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Auto', icon: Monitor, title: 'Use system (computer) setting' },
];

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="grid grid-cols-3 gap-1.5">
      {OPTIONS.map((op) => {
        const Icon = op.icon;
        const isSelected = theme === op.value;
        return (
          <button
            key={op.value}
            type="button"
            onClick={() => setTheme(op.value)}
            title={op.title}
            className={cn(
              'flex min-h-[44px] touch-manipulation flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium transition',
              isSelected
                ? 'border-slate-900 bg-slate-100 text-slate-900 dark:border-slate-100 dark:bg-slate-800 dark:text-slate-100'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800'
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{op.label}</span>
          </button>
        );
      })}
    </div>
  );
}
