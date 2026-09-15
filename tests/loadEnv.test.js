const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseEnvFile, loadEnvFile, loadEnvIntoProcess, DEFAULT_ENV_FILE } = require('../server/lib/loadEnv');

function writeTempEnv(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envtest-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, content);
  return file;
}

test('parseEnvFile handles comments, quotes, export prefix, and spaces', () => {
  const parsed = parseEnvFile(`
# a comment
COHERE_API_KEY=sk-plain
OPENAI_API_KEY="sk double quoted"
GROQ_API_KEY='sk single quoted'
export ANTHROPIC_API_KEY = sk-after-spaces
  `);
  assert.equal(parsed.COHERE_API_KEY, 'sk-plain');
  assert.equal(parsed.OPENAI_API_KEY, 'sk double quoted');
  assert.equal(parsed.GROQ_API_KEY, 'sk single quoted');
  assert.equal(parsed.ANTHROPIC_API_KEY, 'sk-after-spaces');
  assert.equal(parsed.comment, undefined);
});

test('ignores malformed lines', () => {
  const parsed = parseEnvFile('nonsense\n=no-key\n# comment\nVALUE_ONLY\n');
  assert.deepEqual(parsed, {});
});

test('loadEnvFile returns {} when the file is missing', () => {
  assert.deepEqual(loadEnvFile(path.join(os.tmpdir(), 'definitely-missing-', '.env')), {});
});

test('loadEnvIntoProcess loads a file but does not override existing env vars', () => {
  const file = writeTempEnv('MY_TEST_KEY=from-file\nMY_EXISTING=from-file\n');
  const before = { test: process.env.MY_TEST_KEY, existing: process.env.MY_EXISTING };
  process.env.MY_EXISTING = 'already-here';

  try {
    const loaded = loadEnvIntoProcess(file);
    assert.equal(loaded.MY_TEST_KEY, 'from-file');
    assert.equal(process.env.MY_TEST_KEY, 'from-file');
    assert.equal(process.env.MY_EXISTING, 'already-here');
  } finally {
    for (const [name, prior] of Object.entries(before)) {
      if (prior === undefined) delete process.env[name === 'test' ? 'MY_TEST_KEY' : 'MY_EXISTING'];
      else process.env[name === 'test' ? 'MY_TEST_KEY' : 'MY_EXISTING'] = prior;
    }
  }
});

test('DEFAULT_ENV_FILE points at the project .env', () => {
  assert.ok(DEFAULT_ENV_FILE.endsWith(path.join('pm-interview-prep', '.env')));
});