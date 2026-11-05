# blog-writer

@fohte's personal blog writing tool

## Backend configuration

- `BACKEND_BIND_ADDR` sets the listening address. It defaults to `127.0.0.1:3000`; the container image defaults to `0.0.0.0:3000`.
- `DATABASE_URL` is required to start the backend unless `LLM_API_ONLY` is set. `postgres://` and `postgresql://` URLs connect to PostgreSQL; `sqlite://` URLs use a SQLite file, which is created when it does not exist. Migrations run automatically at startup.
- `LLM_API_ONLY=true` starts the backend without a database, embedded frontend, or non-LLM API routes. `true` and `1` enable the mode; `false` and `0` disable it. It must listen on `127.0.0.1`; `BACKEND_BIND_ADDR` can set its port.
- `BACKEND_ALLOWED_HOSTS` sets comma-separated Host values, including ports when needed.
- `BACKEND_ALLOWED_ORIGINS` sets comma-separated origins in `scheme://host[:port]` form.
- `LLM_PROVIDER` selects the LLM provider. Supported values are `claude_code` (the default) and `openai_compatible`.
- `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` configure the base URL, optional API key, and model for the OpenAI-compatible provider. Set `LLM_BASE_URL` without a `/v1` suffix; the provider appends `/v1/chat/completions` to it. `LLM_BASE_URL` and `LLM_MODEL` are required at startup when `LLM_PROVIDER` is `openai_compatible`, and empty values are treated as unset.
- `LLM_PROVIDER_LOCKED` locks the configured provider when set. The backend exits at startup if settings for another provider are also set.
- If `ANTHROPIC_API_KEY` is set while `claude_code` is selected, the backend logs a warning because Claude Code prefers API key authentication.
- `BLOG_EXPORT_DESTINATIONS` enables article export when set to a non-empty JSON array. Each destination has a unique `id`, `repository` (`owner/repo`), `base_branch`, `path_template` with one `{slug}`, `format` (`markdown` or `mdx`), and `frontmatter_template`. The backend returns the `frontmatter_template` to the client as-is. An optional `ogp_json_path` sets a repository-relative JSON file where publishing adds metadata for missing `CardLink` hrefs. An empty or invalid value makes the server fail at startup.
- `BLOG_EXPORT_OCTO_STS_URL`, `BLOG_EXPORT_OCTO_STS_IDENTITY`, and `BLOG_EXPORT_OCTO_STS_SA_TOKEN_PATH` configure the per-request GitHub App token exchange. All three are required when destinations are configured.
- `BLOG_SYNC_DIRECTORY` enables local Markdown file synchronization for article bodies when `DATABASE_URL` is also configured. Article paths must be relative `.md` paths beneath this directory. If either setting is missing, article file synchronization endpoints return `503 Service Unavailable` and the configuration endpoint reports `enabled: false`.

```sh
export BLOG_EXPORT_DESTINATIONS='[{"id":"site-one","repository":"writer/notes","base_branch":"main","path_template":"posts/{slug}.mdx","format":"mdx","frontmatter_template":"title: {{ title }}","ogp_json_path":"data/link-cards.json"}]'
export BLOG_EXPORT_OCTO_STS_URL=https://sts.example
export BLOG_EXPORT_OCTO_STS_IDENTITY=writer-export
export BLOG_EXPORT_OCTO_STS_SA_TOKEN_PATH=/var/run/secrets/service-token
export BLOG_SYNC_DIRECTORY=/path/to/notes
```

When `BLOG_EXPORT_DESTINATIONS` is unset, export is disabled and its endpoints return `503 Service Unavailable`.

Run the LLM API-only backend with `mise run llm:api-only`. Set `BACKEND_ALLOWED_ORIGINS` to the frontend origin before starting; the task listens on `127.0.0.1:4312` by default and accepts a different port through `LLM_API_ONLY_PORT`. The allowed origins are also used for CORS preflight requests.

```sh
BACKEND_ALLOWED_ORIGINS=https://writer.example mise run llm:api-only
```

The Vite development proxy preserves the browser's `Host` and `Origin` headers. Add the dev server's host to `BACKEND_ALLOWED_HOSTS` and its origin to `BACKEND_ALLOWED_ORIGINS` to allow proxied HTTP and WebSocket requests. This example uses fictional backend and dev-server hosts:

```sh
BACKEND_ALLOWED_HOSTS=writer.example,dev.example:4567
BACKEND_ALLOWED_ORIGINS=https://writer.example,http://dev.example:4567
```

When the allowlists are unset, the backend allows `localhost`, `127.0.0.1`, and `[::1]` on the listening port. Requests without an `Origin` header are accepted after the Host check when `Sec-Fetch-Site` is absent, `same-origin`, or `none`. An empty allowlist value allows nothing; rejected requests receive `403 Forbidden`.

## Run the container image

The image `ghcr.io/fohte/blog-writer:latest` is published from pushes to `main`. It listens on port `3000` and requires `DATABASE_URL`. For SQLite, use a named volume mounted at `/data`:

```sh
docker volume create blog-writer-data
docker run --rm -p 127.0.0.1:3000:3000 \
  -e DATABASE_URL=sqlite:///data/blog-writer.sqlite \
  -v blog-writer-data:/data \
  ghcr.io/fohte/blog-writer:latest
```

The image runs as UID `65534`; `/data` is writable by that user.

## Build and run locally

Install the tools in `.mise.toml` and the Rust toolchain in `backend/rust-toolchain.toml`. Then run these commands from the repository root:

```sh
mise install
corepack enable pnpm
pnpm install --frozen-lockfile
cd backend
rustup show
../scripts/build-release
DATABASE_URL=sqlite://blog-writer.sqlite BACKEND_BIND_ADDR=127.0.0.1:3000 cargo run --release
```

The SQLite file is created in `backend/` if it does not exist. The frontend is included in the backend executable during the release build.
