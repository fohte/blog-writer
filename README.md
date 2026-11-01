# blog-writer

@fohte's personal blog writing tool

## Backend configuration

- `BACKEND_BIND_ADDR` sets the listening address. It defaults to `127.0.0.1:3000`.
- `BACKEND_ALLOWED_HOSTS` sets comma-separated Host values, including ports when needed.
- `BACKEND_ALLOWED_ORIGINS` sets comma-separated origins in `scheme://host[:port]` form.

When the allowlists are unset, the backend allows `localhost`, `127.0.0.1`, and `[::1]` on the listening port. Requests without an `Origin` header are accepted after the Host check.
