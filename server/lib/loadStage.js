const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data', 'stages');

const CHECKLIST_STAGES = new Set(['estimation']);
const DIMENSION_STAGES = new Set(['behavioral', 'product_design', 'case_study', 'strategy', 'execution_metrics', 'technical']);

function parseQuestions(md) {
  const questions = [];
  for (const rawLine of md.split(/\r?\n/)) {
    const match = rawLine.trim().match(/^\s*\d+[.)]\s*(.+)$/);
    if (match) questions.push(match[1].trim());
  }
  return questions;
}

function parseRubricSections(md) {
  const headings = md.split(/\r?\n/).reduce((acc, rawLine, i) => {
    const line = rawLine.trim();
    const m = line.match(/^#{1,3}\s+(.+)$/);
    if (m) acc.push({ title: m[1].trim().toLowerCase(), lineIndex: i });
    return acc;
  }, []);

  const section = (title) => {
    const idx = headings.findIndex((h) => h.title === title);
    if (idx === -1) return '';
    const start = headings[idx].lineIndex + 1;
    const end = idx + 1 < headings.length ? headings[idx + 1].lineIndex : md.split(/\r?\n/).length;
    const body = md
      .split(/\r?\n/)
      .slice(start, end)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^[-*]\s+/, ''))
      .join('\n');
    return body.trim();
  };

  return {
    intent: section('intent'),
    idealStructure: section('ideal structure'),
    scoringDimensions: section('scoring dimensions'),
    greenFlags: section('green flags'),
    redFlags: section('red flags'),
  };
}

function modeForStage(stageName) {
  const name = stageName.toLowerCase();
  if (CHECKLIST_STAGES.has(name)) return 'checklist';
  if (DIMENSION_STAGES.has(name)) return 'dimension';
  return 'none';
}

function loadStage(stageName, { dataDir = DATA_DIR, mode } = {}) {
  const dir = path.join(dataDir, stageName.toLowerCase());
  const questionsPath = path.join(dir, 'questions.md');
  const rubricPath = path.join(dir, 'rubric.md');

  if (!fs.existsSync(questionsPath)) {
    throw new Error(`No questions.md found for stage '${stageName}' at ${questionsPath}`);
  }

  const questions = parseQuestions(fs.readFileSync(questionsPath, 'utf8'));
  if (questions.length === 0) {
    throw new Error(`Stage '${stageName}' has no parseable questions in ${questionsPath}`);
  }

  const rubric = fs.existsSync(rubricPath)
    ? parseRubricSections(fs.readFileSync(rubricPath, 'utf8'))
    : null;

  return {
    name: stageName.toLowerCase(),
    questions,
    rubric,
    mode: mode || modeForStage(stageName),
  };
}

module.exports = { loadStage, parseQuestions, parseRubricSections, modeForStage, CHECKLIST_STAGES, DIMENSION_STAGES };