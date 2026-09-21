const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

function fillTemplate(template, data) {
  const map = Object.create(null);
  for (const [k, v] of Object.entries(data)) map[norm(k)] = v;
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, key) => {
    const value = map[norm(key)];
    if (value === undefined || value === null) return '(empty)';
    if (Array.isArray(value)) return value.join('\n');
    return String(value);
  });
}

module.exports = { fillTemplate };