# Changelog

All notable changes to Feedtack are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **The HTTP API answers in English**: `/api/comments`, `/api/comments/:id/replies`,
  `/api/comments/:id/status`, `/health`, `/attachments/<key>`, and every comment comes back
  with `message`, `targets`, `author`, `authorId`, `status`, `path`, `created`, `updated`,
  `title`, `replies` and `attachments`. Documented in the README.
  `data-position` takes `right-edge` (the old `borde-derecho` still works), which was the
  last Spanish word anyone integrating this had to type.
  **Nothing breaks**: the Spanish routes still answer and every response carries both sets
  of field names, because an installed widget that lost its routes would show an empty list
  with no error at all. The aliases go away once no review started before this is still
  open, which is the same condition the project already wrote for `tack_*`. The `status`
  values (`abierto`, `resuelto`…) are data and are not translated.

### Fixed
- **Deleting a comment now deletes its attachments.** `DELETE` removed the row and left the
  files in R2 with their URLs working forever. Attachment keys now carry the comment id, so
  they can be found and deleted, replies included. Older files cannot be linked back to
  their comment; an R2 lifecycle rule is the way to clear those.
- **The README and SECURITY.md were wrong about where attachments go.** Both said they are
  emailed and never stored; they have been written to R2 since 8 September 2026 and are
  served from `GET /adjuntos/<key>`, an unguessable but public URL that does not go through
  CORS or the team key. Deleting a comment still does not delete its attachments. All of
  that is now written down instead of denied.

### Added
- **The notification email speaks English too.** New `EMAIL_LANG` (`es` by default, so no
  existing deployment changes) and `ZONA_HORARIA`. Everything the email says lives in one
  `IDIOMAS` table in `worker/src/index.js`; the dates no longer force `es-ES` and
  `Europe/Madrid`.
- **Continuous integration**, which did not exist despite ten test files: on every push and
  pull request the code parses, the Worker really builds (`wrangler deploy --dry-run`, which
  catches quote mistakes that `node --check` does not), both email languages are in step, the
  WordPress production lock still holds, and the three copies of the widget still match.
- `qa/qa-idiomas.mjs`: checks the two email languages have the same keys, the same types and
  no value that renders as "undefined". No network, no wrangler.
- `CODE_OF_CONDUCT.md`, `.editorconfig` and `.gitattributes`.

### Changed
- **The comments are in English now.** Widget, Worker, WordPress plugin, SQL schema,
  `wrangler.toml` and the guide builder. Verified to be comment-only: the files before and
  after are byte-identical once comments are stripped. The public surface (API routes, JSON
  fields, config variables, SQL columns) is deliberately unchanged: renaming it would break
  every install that already exists.
- **The project is now called Feedtack** (it was Tack Comment). Renamed everywhere: the
  repository, the widget file (`widget/feedtack.js`), the WordPress plugin, the worker
  template, the docs and the demo. Existing installs keep working: the old repository URL
  and the old jsDelivr paths still resolve, the widget still reads the `tack_*` keys saved
  in the browser and still accepts `?tack_yo=` and `?tack_admin=` links already sent out,
  and `window.Tack` is kept as an alias. Those aliases go away once no review started
  before the rename is still open.

### Fixed
- The README no longer promises voice notes: the button has been commented out since
  7 September 2026.

### Added
- Every comment is a thread: anyone can reply, as many times as needed, pointing at an area
  or attaching an image. New `respuestas` table in D1 (run `esquema.sql` again to create it).
- Whoever wrote a comment can close it, without being on the team.
- A guide for reviewers, at `/guia/` (Spanish) and `/guia/en/` (English): one short clip per
  action, same page for every client, public with `noindex`. Recorded by `qa/guia-clips.mjs`
  against the demo with every API call intercepted, so no comment ever reaches the database.
- A "How does this work?" link at the foot of the panel, above the signature, opening the guide
  in the language of the panel (not the browser's) in a new tab.

### Fixed
- The confirmation after sending pointed people to a tab called "Already said". The tab is
  called "History".
- The comment placeholder still offered voice notes, which were taken out of the interface on
  September 7.

## [0.1.0] - 2026-09-08

First tagged release. Everything below was built between July 27 and September 7, 2026,
and the September changes came out of the first day of use on a real client site.

### Added
- Point at one or more elements, with the CSS selector, text and position of each one.
- Screenshot, image attachments and voice notes (up to 2 minutes) in the same comment.
- Comments come back to the page: numbered pins on the elements, a scrollbar ruler, and a
  list grouped by page where the client can edit their own comments.
- Review workflow: `open → resolved → confirmed | reopened`, with the team key
  (`?feedtack_admin=`) to resolve, reopen and delete.
- A nudge to point at something when a comment is about to be sent without a target.
- Spanish and English, picked from the page `lang` attribute or forced with `data-lang`.
- WordPress plugin with a production lock: it refuses to load when
  `wp_get_environment_type()` is `production` unless explicitly overridden.
- Per-person links: `?feedtack_yo=Name` signs every comment from that browser, so with several
  reviewers you know who asked for what.
- The name is asked once (and remembered) instead of being optional. Optional fields don't
  get filled in.
- Keyboard navigation while pointing: arrows up and down walk the element hierarchy,
  left and right move between siblings. The mouse only reaches the deepest element, and in
  a hero with a slider you need to choose between the photo, the slide and the slider.
- Hide the pins and highlights with one click, for when they get in the way of reviewing.
- Authors can delete their own comments. A copy goes out by email either way; it's the only
  trace that's kept.
- "Go to the site" from inside a comment, also when the comment lives on another page.
- Keep the pointed area highlighted while a comment is being read.
- Plugin setting for the panel language, for sites written in one language and reviewed
  in another.
- A small "Made by Websalia" line at the bottom of the panel.

### Fixed
- The widget didn't start when the CSS template literal contained backticks.
- Deleting a comment failed after a previous deletion in the same session.
- Signature and name-warning styles were in the wrong stylesheet.

[Unreleased]: https://github.com/alvaromassana/feedtack/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/alvaromassana/feedtack/releases/tag/v0.1.0
