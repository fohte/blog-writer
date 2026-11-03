CREATE TABLE sync_updates (
    update_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doc_id TEXT NOT NULL,
    update_data BYTEA NOT NULL
);

CREATE INDEX sync_updates_doc_id_update_id_idx ON sync_updates (doc_id, update_id);
