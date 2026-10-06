import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

// A practice configuration (or a session to rejoin) is produced by one page and
// consumed by another, so it needs somewhere to live across a route change.
// It is deliberately not persisted: a stale preset would silently start the
// wrong interview.
const PrepContext = createContext(null);

export function PrepProvider({ children }) {
  const [preset, setPreset] = useState(null);
  const [tracks, setTracks] = useState([]);

  const consume = useCallback(() => setPreset(null), []);

  const value = useMemo(
    () => ({ preset, setPreset, consumePreset: consume, tracks, setTracks }),
    [preset, consume, tracks]
  );

  return <PrepContext.Provider value={value}>{children}</PrepContext.Provider>;
}

export function usePrep() {
  const ctx = useContext(PrepContext);
  if (!ctx) throw new Error('usePrep must be used inside PrepProvider');
  return ctx;
}
