const fs = require('fs');
const path = require('path');

// BYOK keys are held per session, but the in-memory Map dies with the process.
// This sidecar keeps them in `SESSION_DIR/.keys.json` so a restart does not
// orphan a candidate's key mid-round. A separate file on purpose: the session
// records themselves must never carry a secret (tests assert that).
function createSessionKeyStore({ rootDir }) {
  const file = path.join(rootDir, '.keys.json');
  function load() {
    if (!fs.existsSync(file)) return {};
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const out = {};
      for (const [id, entry] of Object.entries(raw || {})) {
        if (!id || typeof id !== 'string' || !entry || typeof entry !== 'object') continue;
        out[id] = {
          llm: typeof entry.llm === 'string' ? entry.llm : '',
          stt: typeof entry.stt === 'string' ? entry.stt : '',
        };
      }
      return out;
    } catch (err) {
      throw new Error(`Could not read ${file}: ${err.message}`);
    }
  }
  function save(entries) {
    fs.mkdirSync(rootDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(entries, null, 2));
  }
  return { load, save, file };
}

module.exports = { createSessionKeyStore };