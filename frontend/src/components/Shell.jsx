import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { isNavActive } from '../lib/nav';
import { navigate, usePath } from '../lib/route';
import { cn } from '../lib/utils';

export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-mute transition-colors hover:bg-paper hover:text-ink"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

// One header for every signed-in page. Brand, nav items and trailing actions are
// data, so a page can change any of them without a second copy of the layout.
export default function Shell({ brand, nav, actions, children, width = 'max-w-[1180px]' }) {
  const path = usePath();
  const items = Array.isArray(nav) ? nav : [];
  // The film's geometry: a 1180px window with 40px gutters, so the content column
  // is 1100px. Everything downstream is measured against that.
  const box = cn(width, 'mx-auto w-full');
  return (
    <div className="flex min-h-screen flex-col bg-ground text-ink">
      {/* The chrome. One bar, mono type, the current page in ink and the rest in mute. */}
      <header className="sticky top-0 z-20 border-b border-line bg-deep">
        <div className={cn(box, 'flex h-13 items-center justify-between gap-6 px-10')}>
          <button
            onClick={() => items[0] && navigate(items[0].path)}
            className="mono shrink-0 text-[17px] text-ink"
          >
            {brand}
          </button>
          {items.length > 1 ? (
            <nav className="hidden items-center gap-6 md:flex">
              {items.map((item) => {
                const active = isNavActive(item.path, path);
                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.path)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'mono text-[15px] transition-colors',
                      active ? 'text-ink' : 'text-mute hover:text-ink'
                    )}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
          ) : null}
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <ThemeToggle />
          </div>
        </div>
        {items.length > 1 ? (
          <nav className={cn(box, 'mono flex items-center gap-5 overflow-x-auto border-t border-line py-3 text-[15px] md:hidden')}>
            {items.map((item) => {
              const active = isNavActive(item.path, path);
              return (
                <button
                  key={item.id}
                  onClick={() => navigate(item.path)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'shrink-0 transition-colors',
                    active ? 'text-ink' : 'text-mute hover:text-ink'
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        ) : null}
      </header>
      <main className={cn(box, 'flex-1 px-10 py-14')}>{children}</main>
    </div>
  );
}
