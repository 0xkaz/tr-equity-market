-- Per-stock alert conditions on the watchlist (all optional). alert_state = conditions met at the last
-- evaluation (comma separated field names), so an e-mail goes out only when a condition newly becomes true.
ALTER TABLE user_watchlist ADD COLUMN alert_yield_above REAL;
ALTER TABLE user_watchlist ADD COLUMN alert_price_below REAL;
ALTER TABLE user_watchlist ADD COLUMN alert_price_above REAL;
ALTER TABLE user_watchlist ADD COLUMN alert_pe_below REAL;
ALTER TABLE user_watchlist ADD COLUMN alert_state TEXT;
