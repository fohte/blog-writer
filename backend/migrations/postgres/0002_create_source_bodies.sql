CREATE TABLE source_bodies (
    source_id TEXT NOT NULL,
    article_id TEXT NOT NULL,
    body TEXT NOT NULL,
    CONSTRAINT source_bodies_pkey PRIMARY KEY (article_id, source_id)
);
