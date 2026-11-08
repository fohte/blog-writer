CREATE TABLE images (
    name TEXT NOT NULL,
    data BYTEA NOT NULL,
    CONSTRAINT images_pkey PRIMARY KEY (name)
);
