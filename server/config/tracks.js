const fs = require('fs');
const path = require('path');
const { loadStageOrder } = require('./stageOrder');

const TRACKS_DIR = path.resolve(__dirname, '..', '..', 'tracks');
const LEGACY_STAGES_DIR = path.resolve(__dirname, '..', '..', 'data', 'stages');
const LEGACY_COACHING_DIR = path.resolve(__dirname, '..', '..', 'data', 'coaching');

const DEFAULT_TOKENS = {
  role: 'PM',
  role_lower: 'product manager',
  senior_title: 'Senior Product Manager',
  company_examples: 'Uber and Google',
  track_label: 'Product Management',
};

function readTokens(filePath) {
  if (!fs.existsSync(filePath)) return {};
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid tokens file ${filePath}: ${err.message}`);
  }
}

function resolveTokens(extra) {
  return { ...DEFAULT_TOKENS, ...(extra || {}) };
}

function listTrackFolders() {
  if (!fs.existsSync(TRACKS_DIR)) return [];
  return fs
    .readdirSync(TRACKS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function buildRegistry() {
  const registry = new Map();

  registry.set('pm', {
    id: 'pm',
    label: 'Product Management',
    description: 'Classic PM mock: behavioral, estimation, product design, strategy, metrics, technical-lite.',
    config: loadStageOrder(),
    stagesDir: LEGACY_STAGES_DIR,
    resourcesDir: LEGACY_COACHING_DIR,
    tokens: DEFAULT_TOKENS,
  });

  for (const folder of listTrackFolders()) {
    const dir = path.join(TRACKS_DIR, folder);
    const stageOrderPath = path.join(dir, 'stage_order.md');
    if (!fs.existsSync(stageOrderPath)) continue;
    const tokens = resolveTokens(readTokens(path.join(dir, 'tokens.json')));
    const label = tokens.track_label || folder;
    registry.set(folder, {
      id: folder,
      label,
      description: tokens.track_description || '',
      config: loadStageOrder(stageOrderPath),
      stagesDir: path.join(dir, 'stages'),
      resourcesDir: path.join(dir, 'resources'),
      tokens,
    });
  }

  return registry;
}

let cachedRegistry = null;
function tracks() {
  if (!cachedRegistry) cachedRegistry = buildRegistry();
  return cachedRegistry;
}

function listTracks() {
  return [...tracks().values()].map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
    track_label: t.tokens.track_label,
  }));
}

function getTrack(id) {
  const key = typeof id === 'string' && id ? id : 'pm';
  return tracks().get(key) || tracks().get('pm');
}

function resetRegistry() {
  cachedRegistry = null;
}

module.exports = { tracks, listTracks, getTrack, resetRegistry, TRACKS_DIR, DEFAULT_TOKENS };