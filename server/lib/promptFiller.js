function fillTemplate(template, data) {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, key) => {
    const value = data[key];
    if (value === undefined || value === null) return '(empty)';
    if (Array.isArray(value)) return value.join('\n');
    return String(value);
  });
}

module.exports = { fillTemplate };