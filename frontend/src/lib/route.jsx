import React, { useEffect, useState, useCallback } from 'react';

// Path based routing, kept deliberately small. The app has a handful of public
// entry points that must survive a refresh and must be linkable, and the rest
// of the product lives in tabs inside the app shell.

export function currentPath() {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname || '/';
}

export function navigate(to, { replace = false } = {}) {
  if (typeof window === 'undefined') return;
  if (currentPath() === to) return;
  if (replace) window.history.replaceState({}, '', to);
  else window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  return path;
}

// Matches "/board" and "/board/:token", returning the params.
export function matchPath(pattern, path) {
  const want = pattern.split('/').filter(Boolean);
  const got = path.split('/').filter(Boolean);
  const params = {};
  let i = 0;
  for (; i < want.length; i += 1) {
    const w = want[i];
    if (w.startsWith(':')) {
      const value = got[i];
      if (value === undefined) return null;
      params[w.slice(1)] = decodeURIComponent(value);
    } else if (w !== got[i]) {
      return null;
    }
  }
  if (got.length !== want.length) return null;
  return params;
}

export function useNavigate() {
  return useCallback((to, opts) => navigate(to, opts), []);
}
