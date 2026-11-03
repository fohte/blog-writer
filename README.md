# blog-writer

@fohte's personal blog writing tool

## Backend configuration

- `BACKEND_BIND_ADDR` sets the listening address. It defaults to `127.0.0.1:3000`.
- `BACKEND_ALLOWED_HOSTS` sets comma-separated Host values, including ports when needed.
- `BACKEND_ALLOWED_ORIGINS` sets comma-separated origins in `scheme://host[:port]` form.
- `LLM_PROVIDER` selects the LLM provider. The supported value is `claude_code`, which is also the default.
- `LLM_PROVIDER_LOCKED` locks the configured provider when set. The backend exits at startup if `LLM_BASE_URL`, `LLM_API_KEY`, or `LLM_MODEL` is also set.
- If `ANTHROPIC_API_KEY` is set, the backend logs a warning because Claude Code prefers API key authentication.
- `BLOG_EXPORT_DESTINATIONS` enables article export when set to a non-empty JSON array. Each destination has a unique `id`, `repository` (`owner/repo`), `base_branch`, `path_template` with one `{slug}`, `format` (`markdown` or `mdx`), and `frontmatter_template`. The backend returns the `frontmatter_template` to the client as-is. An empty or invalid value makes the server fail at startup.
- `BLOG_EXPORT_OCTO_STS_URL`, `BLOG_EXPORT_OCTO_STS_IDENTITY`, and `BLOG_EXPORT_OCTO_STS_SA_TOKEN_PATH` configure the per-request GitHub App token exchange. All three are required when destinations are configured.

```sh
export BLOG_EXPORT_DESTINATIONS='[{"id":"site-one","repository":"writer/notes","base_branch":"main","path_template":"posts/{slug}.mdx","format":"mdx","frontmatter_template":"title: {{ title }}"}]'
export BLOG_EXPORT_OCTO_STS_URL=https://sts.example
export BLOG_EXPORT_OCTO_STS_IDENTITY=writer-export
export BLOG_EXPORT_OCTO_STS_SA_TOKEN_PATH=/var/run/secrets/service-token
```

When `BLOG_EXPORT_DESTINATIONS` is unset, export is disabled and its endpoints return `503 Service Unavailable`.

The Vite development proxy preserves the browser's `Host` and `Origin` headers. Add the dev server's host to `BACKEND_ALLOWED_HOSTS` and its origin to `BACKEND_ALLOWED_ORIGINS` to allow proxied HTTP and WebSocket requests. This example uses fictional backend and dev-server hosts:

```sh
BACKEND_ALLOWED_HOSTS=writer.example,dev.example:4567
BACKEND_ALLOWED_ORIGINS=https://writer.example,http://dev.example:4567
```

When the allowlists are unset, the backend allows `localhost`, `127.0.0.1`, and `[::1]` on the listening port. Requests without an `Origin` header are accepted after the Host check when `Sec-Fetch-Site` is absent, `same-origin`, or `none`. An empty allowlist value allows nothing; rejected requests receive `403 Forbidden`.
