CREATE TABLE sync_updates (
    update_id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT NOT NULL,
    update_data BLOB NOT NULL
);

CREATE INDEX sync_updates_doc_id_update_id_idx ON sync_updates (doc_id, update_id);
