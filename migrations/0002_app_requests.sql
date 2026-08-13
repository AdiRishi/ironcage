-- verify: SELECT to_regclass('public.app_requests') IS NOT NULL

CREATE TABLE app_requests (
  request_id   uuid PRIMARY KEY,
  operation    text NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  response     jsonb NOT NULL,
  completed_at timestamptz NOT NULL
);
