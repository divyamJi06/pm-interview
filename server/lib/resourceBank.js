const fs = require('fs');
const path = require('path');

const COACHING_DIR = path.resolve(__dirname, '..', '..', 'data', 'coaching');

function resourceKey(resource) {
  const m = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/.exec(resource);
  return m ? m[2].replace(/\/+$/, '') : resource.toLowerCase();
}

function parseResourceBank(md) {
  const sections = [];
  const seen = new Set();
  let current = null;
  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = /^#{1,3}\s+(.+)$/.exec(line);
    if (heading) {
      current = { dimension: heading[1].trim(), resources: [] };
      sections.push(current);
      continue;
    }
    let resource = null;
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      resource = bullet[1].trim();
    } else {
      const keyword = /^\*\*Resource:\*\*\s+(.+)$/.exec(line);
      if (keyword) resource = keyword[1].trim();
    }
    if (!resource) continue;
    if (!current) {
      current = { dimension: 'General', resources: [] };
      sections.push(current);
    }
    const key = resourceKey(resource);
    if (!seen.has(key)) {
      seen.add(key);
      current.resources.push(resource);
    }
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