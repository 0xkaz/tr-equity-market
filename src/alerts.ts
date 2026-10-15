// Watchlist alert conditions: thresholds a user sets per starred stock. They are evaluated once a day after the
// close and reported in the daily e-mail only when a condition newly becomes true (alert_state keeps the
// conditions met at the previous evaluation). Same design as the KL Equity and Asia REIT sites (src/alerts.ts there).

export const ALERT_FIELDS = ["alert_yield_above", "alert_price_below", "alert_price_above", "alert_pe_below"] as const;
export type AlertField = (typeof ALERT_FIELDS)[number];
export type Alerts = Partial<Record<AlertField, number | null>>;
// Values the conditions are checked against: last close (metrics), dividend yield % and trailing PER (fundamentals).
export interface AlertInputs { close: number | null; yield: number | null; pe: number | null }

export const ALERT_LABELS: Record<AlertField, string> = {
  alert_yield_above: "配当利回り",
  alert_price_below: "株価",
  alert_price_above: "株価",
  alert_pe_below: "PER",
};
export function describeCondition(f: AlertField, v: number): string {
  switch (f) {
    case "alert_yield_above": return `配当利回り ${v}% 以上`;
    case "alert_price_below": return `株価 ${v} 以下`;
    case "alert_price_above": return `株価 ${v} 以上`;
    case "alert_pe_below": return `PER ${v} 倍以下`;
  }
}

export function alertInputs(m: { close?: number | null } | null | undefined, f: { dividendYield?: number | null; trailingPE?: number | null } | null | undefined): AlertInputs {
  return { close: m?.close ?? null, yield: f?.dividendYield ?? null, pe: f?.trailingPE != null && f.trailingPE > 0 ? f.trailingPE : null };
}

export function metConditions(a: Alerts, v: AlertInputs): AlertField[] {
  const out: AlertField[] = [];
  if (a.alert_yield_above != null && v.yield != null && v.yield >= a.alert_yield_above) out.push("alert_yield_above");
  if (a.alert_price_below != null && v.close != null && v.close <= a.alert_price_below) out.push("alert_price_below");
  if (a.alert_price_above != null && v.close != null && v.close >= a.alert_price_above) out.push("alert_price_above");
  if (a.alert_pe_below != null && v.pe != null && v.pe <= a.alert_pe_below) out.push("alert_pe_below");
  return out;
}
export const parseState = (s: string | null | undefined): AlertField[] => (s ? s.split(",").filter((x): x is AlertField => (ALERT_FIELDS as readonly string[]).includes(x)) : []);
export const formatState = (f: AlertField[]): string | null => (f.length ? f.join(",") : null);

// Validates the alert fields present in a request body; absent fields keep their previous value.
export function parseAlertBody(body: any, prev: Alerts): { values: Alerts; changed: boolean; error?: string } {
  const values: Alerts = { ...prev };
  let changed = false;
  for (const f of ALERT_FIELDS) {
    if (!body || !Object.prototype.hasOwnProperty.call(body, f)) continue;
    changed = true;
    const raw = body[f];
    if (raw === null || raw === "" || raw === undefined) { values[f] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n > 1e6) return { values, changed, error: `${ALERT_LABELS[f]}の条件は正の数で指定してください` };
    values[f] = n;
  }
  if (values.alert_price_below != null && values.alert_price_above != null && values.alert_price_below >= values.alert_price_above)
    return { values, changed, error: "株価の下限は上限より小さくしてください" };
  return { values, changed };
}
