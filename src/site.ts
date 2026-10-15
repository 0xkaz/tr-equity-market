// Site-specific settings used by the shared core (src/core/*, synced from 0xkaz/equity-hub).
export const SITE = {
  code: "TR",          // code in equity-hub sites.json
  cookiePrefix: "tr",  // session cookie name: <prefix>_session (changing it signs everyone out)
};

// Per-site columns of the users table (notification settings).
export interface UserFields {
  notify_email: number; notify_daily: number; notify_watchlist: number; notify_signals: string; notify_move_pct: number;
}
