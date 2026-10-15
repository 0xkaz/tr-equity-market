-- Google-authenticated users, sessions, per-user watchlist and notification settings
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                 -- Google subject id
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  picture TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL,
  notify_email INTEGER NOT NULL DEFAULT 0,      -- master switch for email notifications
  notify_daily INTEGER NOT NULL DEFAULT 1,      -- daily market brief
  notify_watchlist INTEGER NOT NULL DEFAULT 1,  -- signals / big moves on watchlist
  notify_signals TEXT NOT NULL DEFAULT '["52W_HIGH","BREAKOUT_20D","GOLDEN_CROSS","VOLUME_SPIKE","RECLAIM_SMA200","RSI_OVERSOLD"]', -- market-wide signal digest
  notify_move_pct REAL NOT NULL DEFAULT 5       -- alert when a watched stock moves more than this % in a day
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Per-user watchlist
CREATE TABLE IF NOT EXISTS user_watchlist (
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  note TEXT,
  added_at TEXT NOT NULL,
  PRIMARY KEY (user_id, symbol)
);

-- Sent notifications (idempotency + history)
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- daily
  ref_date TEXT NOT NULL,      -- market date the notification covers
  sent_at TEXT NOT NULL,
  status TEXT NOT NULL,        -- sent | error | skipped
  detail TEXT,
  UNIQUE (user_id, kind, ref_date)
);
