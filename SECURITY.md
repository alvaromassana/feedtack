# Security

## What this is, and what it isn't

Tack Comment is a review tool for sites that are **not public yet**. Its security model is
built for that, and only for that:

- **Identity is not authentication.** Who wrote what is an anonymous id stored in the
  browser's `localStorage`. It's enough to let a reviewer edit or delete their own comments
  on a private staging site. It's not enough for anything sensitive.
- **The team key** (`?tack_admin=`) is what allows resolving, reopening and deleting other
  people's comments. Treat it like a password: it's sent to the Worker and stored in the
  browser that used it.
- **Origins are allowlisted.** The Worker only accepts requests from the domains listed in
  `ORIGENES_PERMITIDOS`. Everything else is rejected by CORS.
- **Attachments are never stored.** Screenshots, images and voice notes go out by email and
  are not kept in the database.
- **There is no rate limiting.** An allowed origin can send as many comments as it likes.

The WordPress plugin refuses to load when `wp_get_environment_type()` returns
`production`, unless you explicitly override it. On a live site every visitor would see the
button, could write comments and could read everyone else's. Don't do that.

## Reporting a vulnerability

If you find something, email **alvaro.massana@websalia.com** with the details and, if you
can, steps to reproduce. Please don't open a public issue for it. You'll get a reply within
a few days, and a fix or a note in the changelog once it's handled.

## Supported versions

Only the latest release on `main` gets fixes.
