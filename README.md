# blog-writer

@fohte's personal blog writing tool

## Backend configuration

- `BACKEND_BIND_ADDR` sets the listening address. It defaults to `127.0.0.1:3000`.
- `BACKEND_ALLOWED_HOSTS` sets comma-separated Host values, including ports when needed.
- `BACKEND_ALLOWED_ORIGINS` sets comma-separated origins in `scheme://host[:port]` form.

The Vite development proxy preserves the browser's `Host` and `Origin` headers. Add the dev server's host to `BACKEND_ALLOWED_HOSTS` and its origin to `BACKEND_ALLOWED_ORIGINS` to allow proxied HTTP and WebSocket requests. This example uses fictional backend and dev-server hosts:

```sh
BACKEND_ALLOWED_HOSTS=writer.example,dev.example:4567
BACKEND_ALLOWED_ORIGINS=https://writer.example,http://dev.example:4567
```

When the allowlists are unset, the backend allows `localhost`, `127.0.0.1`, and `[::1]` on the listening port. Requests without an `Origin` header are accepted after the Host check when `Sec-Fetch-Site` is absent, `same-origin`, or `none`. An empty allowlist value allows nothing; rejected requests receive `403 Forbidden`.
