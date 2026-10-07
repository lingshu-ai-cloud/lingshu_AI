/* eslint-disable */
/** Renderer-safe caption emphasis plan. Keep this module dependency-free so
 * desktop preview/export and regression tests can share the same decisions. */

const PROFILES = new Set(['d2c_dialogue', 'talking_head', 'factory_process', 'product_showcase']);
const TYPES = new Set(['hook', 'key_fact', 'reveal', 'section_label', 'cta']);
const SOURCES = new Set(['transcript', 'vision', 'metadata', 'editor']);

const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max, fallback) => Math.max(min, Math.min(max, finite(value, fallback)));
const safeText = value => String(value || '').replace(/[{}\\\r\n\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const safeId = (value, fallback) => String(value || '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 96) || fallback;

const PROFILE_STYLE = Object.freeze({
  d2c_dialogue: { accent: '&H003DDAFF&', panel: '&HCC24133D&', strongSize: .069, weakSize: .044, y: .20 },
  talking_head: { accent: '&H004EDCFF&', panel: '&HCC171717&', strongSize: .057, weakSize: .040, y: .18 },
  factory_process: { accent: '&H00F0B34C&', panel: '&HCC20170D&', strongSize: .060, weakSize: .041, y: .16 },
  product_showcase: { accent: '&H006CFFCF&', panel: '&HCC15231F&', strongSize: .064, weakSize: .042, y: .18 },
});

function suggestedBudget(durationMs) {
  const seconds = Math.max(0, finite(durationMs, 0) / 1000);
  if (seconds <= 15) return 4;
  if (seconds <= 30) return 8;
  if (seconds <= 60) return 12;
  return Math.max(12, Math.ceil(seconds / 20) * 4);
}

/** Normalize untrusted events and enforce whole-film density and collision rules. */
function normalizeEmphasisPlan(input, durationSeconds = 0) {
  const raw = record(input);
  const profile = PROFILES.has(String(raw.profile)) ? String(raw.profile) : 'talking_head';
  const durationMs = Math.max(0, finite(durationSeconds, 0) * 1000);
  const budget = Math.min(40, Math.max(0, Math.round(clamp(raw.maxEvents, 0, 40, suggestedBudget(durationMs)))));
  const candidates = (Array.isArray(raw.events) ? raw.events : []).slice(0, 160).flatMap((value, index) => {
    const event = record(value);
    const type = TYPES.has(String(event.type)) ? String(event.type) : '';
    const text = safeText(event.text);
    const startMs = clamp(event.startMs, 0, durationMs, 0);
    const endMs = clamp(event.endMs, startMs, durationMs, Math.min(durationMs, startMs + 1800));
    const confidence = clamp(event.confidence, 0, 1, 0);
    if (!type || !text || endMs - startMs < 180 || confidence < .45 || event.enabled === false) return [];
    const importance = Math.round(clamp(event.importance, 1, 3, 1));
    const requestedStrength = event.strength === 'weak' || event.strength === 'strong'
      ? event.strength : importance >= 3 ? 'strong' : 'weak';
    const anchor = record(event.anchor);
    const x = clamp(anchor.x, .12, .88, .5);
    const y = clamp(anchor.y, .08, .68, PROFILE_STYLE[profile].y);
    // No spatial evidence means the conservative top safe area. Explicitly
    // unsafe placements are downgraded instead of covering a face/product.
    const unsafe = event.safeArea === false || Number(anchor.y) > .68;
    return [{
      id: safeId(event.id, `event-${index}`), type, text,
      startMs: Math.round(startMs), endMs: Math.round(endMs), importance,
      confidence: Number(confidence.toFixed(3)),
      source: SOURCES.has(String(event.source)) ? String(event.source) : 'editor',
      strength: unsafe || confidence < .7 ? 'weak' : requestedStrength,
      anchor: { x: Number(x.toFixed(4)), y: Number((unsafe ? PROFILE_STYLE[profile].y : y).toFixed(4)) },
      degraded: unsafe || confidence < .7,
    }];
  });

  // Exact semantic duplicates are emphasized once at the best-supported time.
  const unique = new Map();
  for (const event of candidates) {
    const key = `${event.type}:${event.text.toLocaleLowerCase()}`;
    const old = unique.get(key);
    if (!old || event.importance > old.importance || (event.importance === old.importance && event.confidence > old.confidence)) unique.set(key, event);
  }
  const selected = [...unique.values()]
    .sort((a, b) => b.importance - a.importance || b.confidence - a.confidence || a.startMs - b.startMs)
    .slice(0, budget)
    .sort((a, b) => a.startMs - b.startMs);

  // One strong component at a time. A colliding lower-priority event remains
  // visible as a compact weak label rather than disappearing.
  let strongUntil = -1;
  for (const event of selected) {
    if (event.strength === 'strong' && event.startMs < strongUntil) {
      event.strength = 'weak'; event.degraded = true;
    } else if (event.strength === 'strong') strongUntil = event.endMs;
  }
  return { schemaVersion: 1, profile, events: selected };
}

function assTime(ms) {
  const cs = Math.max(0, Math.floor(ms / 10));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

function emphasisToAssEvents(plan, width, height) {
  const style = PROFILE_STYLE[plan.profile] || PROFILE_STYLE.talking_head;
  return plan.events.map(event => {
    const strong = event.strength === 'strong';
    const size = Math.round(width * (strong ? style.strongSize : style.weakSize));
    const defaultY = ({ hook: style.y, key_fact: style.y, reveal: .38, section_label: .13, cta: .66 })[event.type] || style.y;
    const x = Math.round(width * event.anchor.x);
    const y = Math.round(height * (event.anchor.y === style.y ? defaultY : event.anchor.y));
    const entrance = strong ? ({
      hook: '\\fscx76\\fscy76\\t(0,150,\\fscx108\\fscy108)\\t(150,260,\\fscx100\\fscy100)',
      key_fact: '\\fscx90\\fscy90\\t(0,180,\\fscx100\\fscy100)\\fad(70,140)',
      reveal: '\\fscx68\\fscy68\\t(0,210,\\fscx104\\fscy104)\\t(210,320,\\fscx100\\fscy100)\\fad(60,160)',
      section_label: '\\fsp8\\t(0,220,\\fsp1)\\fad(100,180)',
      cta: '\\fscx86\\fscy86\\t(0,180,\\fscx100\\fscy100)\\fad(80,180)',
    }[event.type] || '\\fad(100,140)') : '\\fad(100,120)';
    const box = strong ? `\\bord2\\shad2\\3c&H00101010&\\4c${style.panel}` : '\\bord3\\shad0\\3c&H00101010&';
    const label = event.type === 'section_label' ? `「${event.text}」`
      : event.type === 'cta' ? `▶ ${event.text}` : event.text;
    return `Dialogue: ${strong ? 3 : 2},${assTime(event.startMs)},${assTime(event.endMs)},Emphasis,,0,0,0,,{\\an8\\pos(${x},${y})\\fs${size}\\c${style.accent}${box}${entrance}}${label}`;
  });
}

module.exports = { PROFILES, TYPES, PROFILE_STYLE, suggestedBudget, normalizeEmphasisPlan, emphasisToAssEvents };
