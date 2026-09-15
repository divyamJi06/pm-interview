const fs = require('fs');
const path = require('path');

const COACHING_DIR = path.resolve(__dirname, '..', '..', 'data', 'coaching');

function parseResourceBank(md) {
  const sections = [];
  let current = null;
  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = /^#{1,3}\s+(.+)$/.exec(line);
    if (heading) {
      current = { dimension: heading[1].trim(), resources: [] };
      sections.push(current);
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (current && bullet) current.resources.push(bullet[1].trim());
  }
  return sections.filter((s) => s.resources.length > 0);
}

function loadResourceBank({ dataDir = COACHING_DIR } = {}) {
  if (!fs.existsSync(dataDir)) return [];
  const sections = [];
  for (const f of fs.readdirSync(dataDir)) {
    if (!f.toLowerCase().endsWith('.md')) continue;
    sections.push(...parseResourceBank(fs.readFileSync(path.join(dataDir, f), 'utf8')));
  }
  return sections;
}

function formatResourceBank(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return '(no curated resource bank configured)';
  return sections
    .map((s) => `- ${s.dimension}:\n${s.resources.map((r) => `  - ${r}`).join('\n')}`)
    .join('\n');
}

module.exports = { parseResourceBank, loadResourceBank, formatResourceBank, COACHING_DIR };