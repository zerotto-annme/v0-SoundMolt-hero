-- Migration 017: Shared rate limiting table
-- Replaces in-memory per-instance rate limiting with a DB-backed shared store

CREATE TABLE IF NOT EXISTS rate_limit_requests (
  ip           TEXT   NOT NULL,
  window_start BIGINT NOT NULL,
  count        INT    NOT NULL DEFAULT 1,
  PRIMARY KEY (ip, window_start)
);

-- No public access; only the service role may read/write this table.
ALTER TABLE rate_limit_requests ENABLE ROW LEVEL SECURITY;

-- Atomic upsert that increments the counter and returns whether the caller is rate-limited.
-- window_ms   : size of the fixed window in milliseconds (e.g. 60000 for 1 minute)
-- max_requests: maximum allowed requests per window
CREATE OR REPLACE FUNCTION check_rate_limit(
  client_ip    TEXT,
  window_ms    BIGINT,
  max_requests INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  now_ms    BIGINT;
  win_start BIGINT;
  new_count INT;
BEGIN
  now_ms    := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
  win_start := (now_ms / window_ms) * window_ms;

  INSERT INTO rate_limit_requests (ip, window_start, count)
  VALUES (client_ip, win_start, 1)
  ON CONFLICT (ip, window_start)
  DO UPDATE SET count = rate_limit_requests.count + 1
  RETURNING count INTO new_count;

  RETURN new_count > max_requests;
END;
$$;

-- Restrict execution: revoke from PUBLIC, grant only to service_role.
REVOKE ALL ON FUNCTION check_rate_limit(TEXT, BIGINT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_rate_limit(TEXT, BIGINT, INT) TO service_role;

-- Periodically clean up stale windows to keep the table small.
-- The retention threshold (120000 ms = 2 × 60000 ms window) is intentionally
-- coupled to the WINDOW_MS constant in app/api/username-available/route.ts.
-- If that constant changes, update the value below to match (2 × new window_ms).
-- This function is called externally on a schedule; see task #68 for automation.
CREATE OR REPLACE FUNCTION cleanup_rate_limit_requests()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM rate_limit_requests
  WHERE window_start < (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT - 120000;
$$;

REVOKE ALL ON FUNCTION cleanup_rate_limit_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_rate_limit_requests() TO service_role;
