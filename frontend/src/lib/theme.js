import { useState, useEffect } from 'react';
import { readLocal, writeLocal } from './utils';

// The theme preference was duplicated across the prep shell, the hiring shell
// and the public board header. One hook keeps the toggle in sync everywhere and
// guarantees the `dark` class is applied exactly once per mount.
export function useTheme() {
  const [dark, setDark] = useState(() => {
    const pref = readLocal('ui-theme', 'auto');
    if (pref === 'dark') return true;
    if (pref === 'light') return false;
    // "auto" follows the OS, which is what the paper look assumes: most people
    // who run an interview tool are not asking for a dark room.
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const toggle = () =>
    setDark((d) => {
      writeLocal('ui-theme', d ? 'light' : 'dark');
      return !d;
    });

  return { dark, toggle };
}
