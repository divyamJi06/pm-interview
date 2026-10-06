// Bring-your-own-key storage for the Cohere keys.
//
// One store, on purpose: localStorage. The key never leaves the browser except
// as part of a /api/start or /api/transcribe call to our own server, and the
// server holds it in memory for that session only.
//
// There is deliberately no server-side copy. No table, no sync, no "remember on
// my account" checkbox. A provider key is the candidate's to hold: storing it
// server-side would put a live credential in our database, readable by anyone
// with database access and sitting in backups we do not control, which is a
// worse trade than pasting the key once per browser. Practice on a new device
// means pasting the key again.

const LOCAL_PREFIX = 'pm-key:';

// Cohere keys are opaque tokens with a recognisable shape, but never reject on
// it: a wrong guess would block a valid key and tell the candidate their key is
// broken when it is not. Shape is a hint for the UI, validation is the server's
// job when it calls Cohere.
export function looksLikeCohereKey(key) {
  return /^[A-Za-z0-9_-]{20,}$/.test(String(key || '').trim());
}

export function maskKey(key) {
  const k = String(key || '').trim();
  if (k.length <= 8) return '••••';
  return `${k.slice(0, 4)}••••••••${k.slice(-4)}`;
}

function localKey(purpose) {
  return `${LOCAL_PREFIX}${purpose}`;
}

export function readLocalKey(purpose) {
  try {
    return localStorage.getItem(localKey(purpose)) || '';
  } catch (_) {
    return '';
  }
}

export function writeLocalKey(purpose, key) {
  try {
    const value = String(key || '').trim();
    if (value) localStorage.setItem(localKey(purpose), value);
    else localStorage.removeItem(localKey(purpose));
  } catch (_) {}
}

export function clearLocalKey(purpose) {
  writeLocalKey(purpose, '');
}
