const fs = require('fs');
const path = require('path');

const PROMPTS_DIR = path.resolve(__dirname, '..', '..', 'prompts');

function extractPromptBody(md) {
  const lines = md.split(/\r?\n/);
  let inBody = false;
  const bodyLines = [];
  for (const line of lines) {
    if (/^#{1,3}\s+Prompt body/i.test(line)) {
      inBody = true;
      continue;
    }
    if (inBody && /^#{1,3}\s+/.test(line)) break;
    if (inBody) bodyLines.push(line);
  }
  const text = bodyLines.join('\n');
  const fenced = text.match(/```[a-z]*\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

function loadPrompt(name) {
  const filePath = path.join(PROMPTS_DIR, name.endsWith('.md') ? name : `${name}.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt template not found: ${filePath}`);
  }
  return extractPromptBody(fs.readFileSync(filePath, 'utf8'));
}

module.exports = { loadPrompt, extractPromptBody, PROMPTS_DIR };