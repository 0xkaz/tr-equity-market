// GENERATED from 0xkaz/equity-hub core/ai-guard.ts (core 2026.10.15-2). Do not edit here: edit equity-hub/core and run scripts/sync-core.mjs.
// Guards for AI-written market commentary (sites' src/ai.ts, same idea as the hub digest's unsupportedNumbers):
// the model may only copy percentages / bp from the data it was given. Figures it invents are detected so the caller can retry,
// and sentences that still carry one are dropped instead of being shown.
const norm = (s: string) => String(s).replace(/,/g, "").replace(/^[+-]/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

// Percentages / bp in `text` that do not occur as a percentage / bp among the figures of `prompt`.
// Only figures the prompt itself states as % / bp count, so a date, a price or a count cannot make an invented 10% look valid.
export function unsupportedNumbers(text: string, prompt: string): string[] {
  const known = new Set([...String(prompt).matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:%|bp|％)/g)].map((m) => norm(m[1])));
  const bad: string[] = [];
  for (const m of String(text).matchAll(/([+-]?\d[\d,]*(?:\.\d+)?)\s*(?:%|bp|％)/g)) if (!known.has(norm(m[1]))) bad.push(m[0]);
  return bad;
}

// Removes the sentences (split after 。！？ or at a newline) that contain a figure not in the prompt. May return "".
export function dropUnsupported(text: string, prompt: string): string {
  const parts = String(text).split(/(?<=[。！？\n])/);
  return parts.filter((p) => unsupportedNumbers(p, prompt).length === 0).join("").replace(/\n{3,}/g, "\n\n").trim();
}
