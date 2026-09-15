const fs = require('fs');
const path = require('path');

function sanitizeName(name) {
  return String(name).replace(/[^A-Za-z0-9._-]/g, '_');
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function createTraceStore({ rootDir }) {
  if (!rootDir) {
    throw new Error('createTraceStore requires a rootDir');
  }
  fs.mkdirSync(rootDir, { recursive: true });
  const seq = new Map();

  function dirFor(sessionId) {
    return path.join(rootDir, sanitizeName(sessionId));
  }

  function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  function maxSeqIn(callsDir) {
    if (!fs.existsSync(callsDir)) return 0;
    let max = 0;
    for (const f of fs.readdirSync(callsDir)) {
      const m = /^(\d+)-/.exec(f);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max;
  }

  function initSession({ sessionId, mode, practiceStage = null, targetRoleAndLevel = '', config = null }) {
    const dir = dirFor(sessionId);
    fs.mkdirSync(path.join(dir, 'calls'), { recursive: true });
    seq.set(sessionId, maxSeqIn(path.join(dir, 'calls')) + 1 || 1);
    const info = {
      sessionId,
      mode,
      practiceStage,
      targetRoleAndLevel,
      startedAt: new Date().toISOString(),
      stages: config ? config.stages.map((s) => s.name) : [],
      feedbackTiming: config ? config.feedbackTiming : null,
    };
    writeJson(path.join(dir, 'info.json'), info);
    return info;
  }

  function recordCall({ sessionId, record }) {
    if (!seq.has(sessionId)) {
      seq.set(sessionId, maxSeqIn(path.join(dirFor(sessionId), 'calls')) + 1);
    }
    const n = seq.get(sessionId);
    seq.set(sessionId, n + 1);
    const dir = path.join(dirFor(sessionId), 'calls');
    try {
      fs.mkdirSync(dir, { recursive: true });
      const label = sanitizeName(record.label || 'model_call');
      writeJson(path.join(dir, `${String(n).padStart(3, '0')}-${label}.json`), { seq: n, ...record });
    } catch (err) {
      console.error(`traceStore: failed to record call for session ${sessionId}: ${err.message}`);
    }
  }

  function finalizeSession({ sessionId, outcome = 'finished' }) {
    const dir = dirFor(sessionId);
    const callsDir = path.join(dir, 'calls');
    const calls = fs.existsSync(callsDir)
      ? fs
          .readdirSync(callsDir)
          .filter((f) => f.endsWith('.json'))
          .sort()
          .map((f) => JSON.parse(fs.readFileSync(path.join(callsDir, f), 'utf8')))
      : [];

    const totals = {
      calls: calls.length,
      success: 0,
      failed: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      pricedCalls: 0,
    };
    const byLabel = {};
    for (const c of calls) {
      totals[c.success ? 'success' : 'failed'] += 1;
      if (c.usage) {
        totals.inputTokens += c.usage.inputTokens || 0;
        totals.outputTokens += c.usage.outputTokens || 0;
      }
      if (c.costUsd != null && c.costUsd !== 0) {
        totals.costUsd += c.costUsd;
        totals.pricedCalls += 1;
      }
      const key = c.label || 'model_call';
      byLabel[key] = (byLabel[key] || 0) + 1;
    }

    const summary = {
      sessionId,
      outcome,
      endedAt: new Date().toISOString(),
      totals: { ...totals, costUsd: round4(totals.costUsd) },
      callsByLabel: byLabel,
    };
    writeJson(path.join(dir, 'cost-summary.json'), summary);
    return summary;
  }

  return { initSession, recordCall, finalizeSession, rootDir };
}

module.exports = { createTraceStore, sanitizeName };