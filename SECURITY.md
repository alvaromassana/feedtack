# Security

## What this is, and what it isn't

Feedtack is a review tool for sites that are **not public yet**. Its security model is
built for that, and only for that:

- **Identity is not authentication.** Who wrote what is an anonymous id stored in the
  browser's `localStorage`. It's enough to let a reviewer edit or delete their own comments
  on a private staging site. It's not enough for anything sensitive.
- **The team key** (`?feedtack_admin=`) is what allows resolving, reopening and deleting other
  people's comments. Treat it like a password: it's sent to the Worker and stored in the
  browser that used it.
- **Origins are allowlisted.** The Worker only accepts requests from the domains listed in
  `ORIGENES_PERMITIDOS`. Everything else is rejected by CORS.
- **Attachments are stored in your R2 bucket, and served from an unguessable public URL.**
  Every file a reviewer attaches is written to R2 under
  `<site>/<YYYYMMDD>/<32 random hex>/<filename>` and can be fetched at
  `GET /adjuntos/<that key>`. That URL is **not** behind CORS, the team key or any other
  check: whoever holds the link can read the file. The key is the only secret, and it
  travels in the notification email. The Worker does force `X-Content-Type-Options: nosniff`,
  a `sandbox` CSP, `X-Robots-Tag: noindex`, and serves everything but real images
  (`png`, `jpeg`, `gif`, `webp`) as a download, so an uploaded SVG or HTML cannot run script
  on your Worker's domain.
- **Deleting a comment does not delete its attachments.** `DELETE /api/comentarios/:id`
  removes the database row; the files stay in R2 and their URLs keep working. If you need
  them gone, empty the bucket yourself. Set an R2 lifecycle rule if you want them to expire.
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
