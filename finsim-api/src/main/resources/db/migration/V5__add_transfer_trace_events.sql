CREATE TABLE transfer_trace_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transfer_id VARCHAR(64) NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
    kind VARCHAR(32) NOT NULL,
    stage VARCHAR(64),
    target VARCHAR(64),
    request_payload TEXT,
    response_payload TEXT,
    duration_ms BIGINT,
    fault_id VARCHAR(64),
    from_state VARCHAR(32),
    to_state VARCHAR(32),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transfer_trace_events_transfer_id ON transfer_trace_events(transfer_id);
