-- Universe of tracked instruments (Borsa Istanbul equities + BIST100 index)
CREATE TABLE IF NOT EXISTS tickers (
  symbol TEXT PRIMARY KEY,            -- Yahoo symbol, e.g. THYAO.IS / XU100.IS
  code TEXT NOT NULL UNIQUE,          -- Borsa Istanbul stock code, e.g. THYAO (BIST100 for the index)
  name TEXT,
  sector TEXT,
  kind TEXT NOT NULL DEFAULT 'equity',-- equity | index
  currency TEXT,                      -- quote currency from Yahoo (TRY, ...)
  active INTEGER NOT NULL DEFAULT 1,
  last_fetched_at TEXT,
  last_price_date TEXT,
  fetch_error TEXT
);

-- Daily OHLCV bars
CREATE TABLE IF NOT EXISTS prices (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,                 -- YYYY-MM-DD (Europe/Istanbul)
  open REAL, high REAL, low REAL, close REAL,
  volume INTEGER,
  PRIMARY KEY (symbol, date)
);
CREATE INDEX IF NOT EXISTS idx_prices_date ON prices(date);

-- Latest computed metrics / signals per symbol (JSON blob)
CREATE TABLE IF NOT EXISTS metrics (
  symbol TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Fundamentals snapshot per symbol (from Yahoo quote): PE, yield, market cap...
CREATE TABLE IF NOT EXISTS fundamentals (
  symbol TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Market-wide daily snapshot: breadth, sector performance, brief text
CREATE TABLE IF NOT EXISTS market_daily (
  date TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Job log for cron / manual refresh runs
CREATE TABLE IF NOT EXISTS job_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  kind TEXT NOT NULL,
  detail TEXT
);

-- Daily market breadth history (backfilled from stored prices, appended daily)
CREATE TABLE IF NOT EXISTS breadth_daily (
  date TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  advancers INTEGER, decliners INTEGER,
  above_sma20 INTEGER, above_sma50 INTEGER, above_sma200 INTEGER,
  new_hi52 INTEGER, new_lo52 INTEGER,
  index_close REAL,
  median_chg1d REAL
);

-- Workers AI generated per-stock commentary
CREATE TABLE IF NOT EXISTS ai_notes (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (symbol, date)
);
