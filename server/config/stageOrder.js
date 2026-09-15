const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'stage_order.md');

const KNOWN_DECISIONS = {
  feedback_timing: ['stage_boundary', 'end_of_interview'],
  time_budget_minutes: [],
  round_budget_minutes: [],
  clarify_cap_per_question: [],
};

const VALID_MODES = new Set(['none', 'checklist', 'dimension']);

function parseTable(md) {
  const rows = [];
  let inTable = false;
  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^\|/.test(line)) {
      if (!inTable && /Order\s*\|\s*Stage/.test(line)) {
        inTable = true;
        continue;
      }
      if (inTable && /^\|(\s*:?-+\s*\|)+$/.test(line)) continue;
      if (!inTable) continue;
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      if (cells.length < 5) continue;
      const order = Number.parseInt(cells[0], 10);
      if (Number.isNaN(order)) continue;
      rows.push({
        order,
        name: cells[1].toLowerCase(),
        mode: cells[2].toLowerCase(),
        minQuestions: Number.parseInt(cells[3], 10),
        notes: cells[4] || '',
      });
    }
  }
  return rows
    .filter((r) => VALID_MODES.has(r.mode))
    .sort((a, b) => a.order - b.order);
}

function parseDecisions(md) {
  const decisions = {};
  const lines = md.split(/\r?\n/);
  let inDecisions = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^#{1,3}\s+Decisions/i.test(line)) {
      inDecisions = true;
      continue;
    }
    if (inDecisions && /^#{1,3}\s/.test(line)) break;
    if (!inDecisions) continue;
    const match = line.match(/^[-*]\s*([a-z_]+)\s*:\s*(\S+)/i);
    if (!match) continue;
    const [, key, value] = match;
    const normalized = key.toLowerCase();
    if (KNOWN_DECISIONS[normalized]) decisions[normalized] = value;
  }
  return decisions;
}

function loadStageOrder(filePath = CONFIG_PATH) {
  let md;
  try {
    md = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Could not read stage order config at ${filePath}: ${err.message}`);
  }

  const stages = parseTable(md);
  const decisions = parseDecisions(md);

  if (stages.length === 0) {
    throw new Error(`No stages could be parsed from ${filePath}`);
  }

  const feedbackTiming = decisions.feedback_timing || 'stage_boundary';
  const timeBudgetMinutes = Math.max(1, Number.parseInt(decisions.time_budget_minutes || '60', 10) || 60);
  const roundBudgetMinutes = Math.max(1, Number.parseInt(decisions.round_budget_minutes || '40', 10) || 40);

  if (!KNOWN_DECISIONS.feedback_timing.includes(feedbackTiming)) {
    throw new Error(`Unknown feedback_timing '${feedbackTiming}' in ${filePath}`);
  }

  const highestQuestionCount = Math.max(...stages.map((s) => s.minQuestions));
  const clarifyCapPerQuestion = Math.max(1, Number.parseInt(decisions.clarify_cap_per_question || '3', 10) || 3);

  return {
    stages,
    feedbackTiming,
    timeBudgetMinutes,
    roundBudgetMinutes,
    clarifyCapPerQuestion,
    defaultMinQuestions: highestQuestionCount,
  };
}

module.exports = { loadStageOrder, parseTable, parseDecisions, CONFIG_PATH };