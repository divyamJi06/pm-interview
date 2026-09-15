const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_ENV_FILE = path.join(PROJECT_ROOT, '.env');

function parseEnvFile(content) {
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    const double = value.startsWith('"') && value.endsWith('"') && value.length >= 2;
    const single = value.startsWith("'") && value.endsWith("'") && value.length >= 2;
    if (double || single) value = value.slice(1, -1);
    env[match[1]] = value;
  }
  return env;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return parseEnvFile(fs.readFileSync(filePath, 'utf8'));
}

function loadEnvIntoProcess(filePath = process.env.ENV_FILE || DEFAULT_ENV_FILE) {
  const parsed = loadEnvFile(filePath);
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return parsed;
}

module.exports = { loadEnvIntoProcess, loadEnvFile, parseEnvFile, DEFAULT_ENV_FILE };