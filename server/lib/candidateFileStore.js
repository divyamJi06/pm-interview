const fs = require('fs');
const path = require('path');

function createCandidateFileStore({ rootDir }) {
  fs.mkdirSync(rootDir, { recursive: true });

  const fileFor = (id) =>
    path.join(rootDir, String(id).replace(/[^A-Za-z0-9._-]/g, '_') + '.json');

  return {
    save(data) {
      const file = fileFor(data.id);
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    },
    load() {
      if (!fs.existsSync(rootDir)) return [];
      return fs
        .readdirSync(rootDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(rootDir, f), 'utf8'));
          } catch (_) {
            return null;
          }
        })
        .filter(Boolean);
    },
    remove(id) {
      try {
        fs.unlinkSync(fileFor(id));
      } catch (_) {}
    },
  };
}

module.exports = { createCandidateFileStore };