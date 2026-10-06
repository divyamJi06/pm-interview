// Single source of truth for the information architecture. Both shells build
// their navigation from these lists, and the router resolves the same paths, so
// a nav item and its destination can never drift apart.

export const CANDIDATE_NAV = [
  { id: 'dashboard', label: 'Dashboard', path: '/app' },
  { id: 'practice', label: 'Start interview', path: '/app/practice' },
  { id: 'interviews', label: 'Interviews', path: '/app/interviews' },
  { id: 'profile', label: 'Profile', path: '/app/profile' },
];

// A nav item is active for its own path and anything nested underneath, except
// that the dashboard only lights up on its exact path rather than on every page
// beneath it.
export function isNavActive(itemPath, path) {
  const clean = path.split('?')[0];
  if (itemPath === clean) return true;
  if (itemPath === '/app') return false;
  return clean.startsWith(itemPath + '/');
}
