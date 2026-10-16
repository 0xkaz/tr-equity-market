// GENERATED from 0xkaz/equity-hub core/ai-guard.ts (core 2026.10.16-1). Do not edit here: edit equity-hub/core and run scripts/sync-core.mjs.
// Guards for AI-written market commentary (sites' src/ai.ts, same idea as the hub digest's unsupportedNumbers):
// the model may only copy figures from the data it was given. Figures it invents are detected so the caller can retry,
// and sentences that still carry one are dropped instead of being shown. takeGuardStats() returns (and resets) how often that
// happened in this isolate; refresh jobs log it (aiGuard) so the hub can show how often the guard had to step in.
const norm = (s: string) => String(s).replace(/,/g, "").replace(/^[+-]/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

export interface GuardStats { retries: number; dropped: number }
let stats: GuardStats = { retries: 0, dropped: 0 };
export function takeGuardStats(): GuardStats { const s = stats; stats = { retries: 0, dropped: 0 }; return s; }
export function noteRetry(): void { stats.retries++; }

// Percentages / bp in `text` that do not occur as a percentage / bp among the figures of `prompt`.
// Only figures the prompt itself states as % / bp count, so a date, a price or a count cannot make an invented 10% look valid.
export function unsupportedNumbers(text: string, prompt: string): string[] {
  const known = new Set([...String(prompt).matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:%|bp|％)/g)].map((m) => norm(m[1])));
  const bad: string[] = [];
  for (const m of String(text).matchAll(/([+-]?\d[\d,]*(?:\.\d+)?)\s*(?:%|bp|％)/g)) if (!known.has(norm(m[1]))) bad.push(m[0]);
  return bad;
}

// The figures without a unit that the commentary states about a name or a market: an RSI value, "N銘柄", "N日前". They must occur
// somewhere in the prompt as a number (loose on purpose: a legitimate sentence must never be dropped for a formatting difference).
export function unsupportedPlain(text: string, prompt: string): string[] {
  const known = new Set([...String(prompt).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => norm(m[0])));
  const bad: string[] = [];
  for (const m of String(text).matchAll(/RSI(?:\(?14\)?)?\s*(?:は|が|:|：)?\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*)\s*(?:銘柄|日前)/g)) {
    const v = m[1] ?? m[2];
    if (v != null && !known.has(norm(v))) bad.push(m[0]);
  }
  return bad;
}

export const unsupportedFigures = (text: string, prompt: string): string[] => [...unsupportedNumbers(text, prompt), ...unsupportedPlain(text, prompt)];

// Removes the sentences (split after 。！？ or at a newline) that contain a figure not in the prompt. May return "".
export function dropUnsupported(text: string, prompt: string): string {
  const parts = String(text).split(/(?<=[。！？\n])/);
  const kept = parts.filter((p) => unsupportedFigures(p, prompt).length === 0);
  stats.dropped += parts.filter((p) => p.trim()).length - kept.filter((p) => p.trim()).length;
  return kept.join("").replace(/\n{3,}/g, "\n\n").trim();
}
