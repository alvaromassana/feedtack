# Changelog

All notable changes to Tack Comment are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
  (`?tack_admin=`) to resolve, reopen and delete.
- A nudge to point at something when a comment is about to be sent without a target.
- Spanish and English, picked from the page `lang` attribute or forced with `data-lang`.
- WordPress plugin with a production lock: it refuses to load when
  `wp_get_environment_type()` is `production` unless explicitly overridden.
- Per-person links: `?tack_yo=Name` signs every comment from that browser, so with several
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

[Unreleased]: https://github.com/alvaromassana/tack-comment/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/alvaromassana/tack-comment/releases/tag/v0.1.0
