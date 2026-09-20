# Feedtack

**Your client points at the thing they don't like, instead of describing it in an email.**

> Feedtack was called **Tack Comment** until September 2026. The old repository URL and the
> old jsDelivr paths still resolve, so existing installs keep working.

**Website and docs: [feedtack.dev](https://feedtack.dev)** · [Docs](https://feedtack.dev/docs/) · [Live demo](https://feedtack.dev/demo/) · [Guide for your client](https://feedtack.dev/guia/)

[![MIT licence](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![No dependencies](https://img.shields.io/badge/dependencies-none-brightgreen.svg)](widget/feedtack.js)
[![Runs on Cloudflare Workers](https://img.shields.io/badge/backend-Cloudflare%20Workers%20%2B%20D1-f38020.svg)](worker/)
[![Live demo](https://img.shields.io/badge/demo-feedtack.dev-4f46e5.svg)](https://feedtack.dev)

A floating button you drop into a site you're building, so the client can comment on what
they see. They point at the exact element, attach a screenshot, and you get it in your
inbox with the CSS selector and the browser they were using. The
comments stay on the page as numbered pins, so everyone sees what's open and what's done.

No account, no SaaS, no per-seat pricing. One `<script>` tag and a Cloudflare Worker you own.

![Pointing at an element, walking the hierarchy with the arrow keys and writing the comment](docs/img/demo.gif)

**Try it:** [feedtack.dev/demo/](https://feedtack.dev/demo/) is a fake client site with
the widget installed. Press *Comentar*, point at something, write a line. Comments written
there are real and land in our inbox, so be nice.

---

## Why

Every agency knows this email:

> *"the button at the top doesn't convince me, and the photo in the section about us
> looks weird on my phone"*

Which button. Which page. Which phone. You end up in a five-email thread to find out what
they meant, and then you do it again next week.

Feedtack turns that into: the client clicks the element, types one line, and you get
`#services > div.grid:nth-of-type(2) > article` with a screenshot attached.

There are good tools that do this (markup.io, BugHerd, Atarim, Pastel). They're
subscription services, the free tiers stop at one user or one project, and your clients'
comments live on someone else's server. This one is free, has no tiers, and the data sits
in your own Cloudflare account.

## What it does

- **Point at one or more elements.** Inspector-style highlight; stores the CSS selector, the
  text and the position of each one. While pointing, the **arrow keys walk the hierarchy**
  (up and down for parent and child, left and right for siblings): the mouse only reaches
  the deepest element, and in a hero with a slider you need to choose between the photo,
  the slide and the slider.
- **Screenshot and image attachments**, all in one comment.
- **The comments come back.** They're stored, so the client sees what they already said,
  grouped by page, and **can edit or delete their own**. Each edit emails you the previous
  text struck through, so you don't work off a stale version.
- **Numbered pins on the page** plus a **scrollbar ruler**: where the open work is, at a
  glance. One click hides them when they get in the way.
- **Who asked for what.** Each reviewer gets a personal link (`?feedtack_yo=Name`) and every
  comment from that browser is signed. If nobody used a link, the name is asked once and
  remembered.
- **Every comment is a thread.** Anyone can reply, as many times as needed, and a reply can
  point at an area or attach an image too. The conversation stays next to the thing it's about.
- **A workflow, not an inbox**: `open → resolved → confirmed | reopened`. Whoever wrote a
  comment can close it themselves, and your team can close their own notes in one step, for
  reminders and internal to-dos.
- **Nudges the client to point**, once, if they try to send without pointing at anything.
  What isn't pointed at can't get a pin, so it floats loose on the page.
- **Spanish and English**, picked up from the page's `lang` attribute or forced per site.

| Pointing at an element | Writing the comment | The list, with pins on the page |
|---|---|---|
| ![Inspector-style highlight over the element, with the keyboard hint](docs/img/senalar.png) | ![The comment panel with a pointed element and the reviewer's name](docs/img/panel.png) | ![The comment list grouped by page, numbered pins on the page itself](docs/img/lista.png) |

## It doesn't care what your site is built with

Plain JavaScript, zero dependencies, no build step, isolated in a Shadow DOM so the host
site's CSS can't break it. Anywhere you can put a `<script>` tag:

| Stack | Where |
|---|---|
| **WordPress** | The plugin in `wordpress/` (recommended: it has the production lock) |
| **Astro / Eleventy / Hugo** | Your base layout, before `</body>` |
| **React / Next / Vue** | `index.html` or your root layout (verified on React) |
| **Plain HTML** | Before `</body>` |
| **Shopify / Squarespace / Wix** | Their "custom code" section (paid plans only) |

> ⚠️ **Review sites only.** This is a review tool. On a live site every visitor would see the
> button, could write comments and could read everyone else's. The WordPress plugin refuses
> to load in production unless you explicitly override it.

## Quick start

### 1. Deploy your own backend (about twenty minutes the first time)

The backend is a Cloudflare Worker that **you own and deploy**. Nothing runs on our servers and
nothing is billed to us: your comments, your database, your attachments, your email account.

#### What you need first

| | What | Cost |
|---|---|---|
| 1 | A **[Cloudflare](https://dash.cloudflare.com/sign-up) account**. Sign up with an email, no card needed to start. | Free tier |
| 2 | **An R2 subscription** on that account. In Cloudflare's words: *Storage & databases > R2 > Overview*, then complete the checkout flow. It is a checkout, not a bill: the free allowance below still applies. | Free tier |
| 3 | A **[Resend](https://resend.com) account** with a verified sending domain, and an API key. Resend is what actually delivers the notification emails. | Free tier |
| 4 | **Node.js 18 or newer** on your machine, to run `wrangler` (Cloudflare's CLI). You do not install it globally: `npx` fetches it. | Free |

You can use any other transactional email provider, but you would have to change
`enviarCorreo()` in `worker/src/index.js`. Out of the box it is Resend.

#### Get the code and log in

```bash
git clone https://github.com/alvaromassana/feedtack.git
cd feedtack/worker
npx wrangler login          # opens the browser and links the CLI to your account
```

#### Create the three pieces of storage

The Worker needs three Cloudflare resources. **Create all three before deploying**: `wrangler
deploy` reads `wrangler.toml`, and a binding pointing at something that does not exist will
stop the deploy.

```bash
# 1. The database, where the comments live
npx wrangler d1 create feedtack          # copy the database_id it prints

# 2. The bucket, where the screenshots live
npx wrangler r2 bucket create feedtack-adjuntos
```

The third one, the **Durable Object** that batches the notifications, needs no command: the
migration already declared in `wrangler.toml` creates it on the first deploy.

#### Fill in wrangler.toml

Open `worker/wrangler.toml` and set:

| Field | What to put |
|---|---|
| `database_id` | The id that `d1 create` printed |
| `DESTINO` | The address the comments are emailed to, normally yours |
| `REMITENTE` | The sender, on a domain you verified in Resend, e.g. `Feedtack <feedtack@youragency.com>` |
| `ORIGENES_PERMITIDOS` | Comma-separated list of the sites allowed to send comments, e.g. `https://staging.client.com,https://client.pages.dev`. Wildcards like `*.pages.dev` work. Anything else is blocked by CORS, on purpose. |
| `BASE_PUBLICA` | Your Worker's own URL, so screenshots too big for the email get a download link. Leave it empty and the attachments simply travel without a link. You will only know the URL after the first deploy, so fill this one in and deploy again. |

`VENTANA_MINUTOS` and `CORTE_COMENTARIOS` control how comments are grouped into one email.
The defaults are sensible; leave them alone until the volume tells you otherwise.

Two optional ones:

| Field | What to put |
|---|---|
| `EMAIL_LANG` | Language of the notification email you receive: `es` (the default) or `en`. Nothing else reads it: the widget picks its own language from the page or from `data-lang`. |
| `ZONA_HORARIA` | The timezone the email shows times in, e.g. `Europe/London`. Defaults to `Europe/Madrid`. |

#### Create the tables, deploy, and set the secrets

```bash
npx wrangler d1 execute feedtack --remote --file=esquema.sql
npx wrangler deploy                                          # prints your Worker's URL

npx wrangler secret put RESEND_API_KEY                       # your Resend key
openssl rand -hex 24 | npx wrangler secret put CLAVE_ADMIN   # your team key, save it
```

Now put that Worker URL into `BASE_PUBLICA` in `wrangler.toml` and run `npx wrangler deploy`
once more.

#### Check it is up

```bash
curl https://your-worker.workers.dev/salud      # {"ok":true}
```

If you get anything else, the usual suspects are a `database_id` that was not pasted in, the
R2 bucket not created, or the schema not run against `--remote`.

#### What this costs you, in practice

A review tool moves a handful of comments a day, so the free tiers are not a constraint.
Checked against the providers' own pricing pages on 19 September 2026:

| Free allowance | Limit |
|---|---|
| Cloudflare Workers | 100,000 requests / day |
| Cloudflare D1 | 5 GB stored, 5 million rows read / day, 100,000 rows written / day |
| Cloudflare R2 | 10 GB stored / month, egress free |
| Resend | 3,000 emails / month, 100 / day |

An agency with thirty client sites under review will not get near any of those. If you ever do
outgrow them, you are the one who decides whether to pay, and to whom. We never see any of it.

### 2. Add the widget

**Two ways in, pick one:**

| Your site | What to do | Why |
|---|---|---|
| **WordPress** | Install the plugin, [step 2a](#2a-on-wordpress-install-the-plugin) | A settings screen instead of editing templates, and it refuses to load on a production site |
| **Anything else** | Paste the tag, [step 2b](#2b-anywhere-else-paste-the-tag) | Astro, Eleventy, Hugo, React, Next, Vue, plain HTML, Shopify, Squarespace, Wix |

The plugin and the tag load exactly the same widget and talk to the same Worker. Nothing else
in this guide changes depending on which one you choose.

#### 2a. On WordPress: install the plugin

Download
[`wordpress/feedtack.zip`](https://github.com/alvaromassana/feedtack/releases/latest) and
install it like any other plugin. The widget file travels inside the zip, so the plugin has no
external dependency. Settings live under **Settings -> Feedtack**: site slug, Worker endpoint,
colour, button text, position and panel language.

🔒 **The plugin will not load on a production site** unless you tick the override box on
purpose, and it never loads in the dashboard, in ajax requests, in cron or in feeds. That
guardrail is the reason to prefer it on WordPress. Full detail in
[The WordPress plugin](#the-wordpress-plugin) below; you can skip step 2b.

#### 2b. Anywhere else: paste the tag

🔴 **There is no production guardrail here.** The widget file has no idea which site it is on,
so the tag loads whenever it is present. On a live site every visitor would see the button,
write comments and read everyone else's. Removing the tag before you go live is on you.

**Host the file yourself.** Copy `widget/feedtack.js` (103 KB, 28 KB gzipped, zero dependencies)
next to your site's other assets and point the tag at your own copy:

```html
<script src="/feedtack.js"
        data-site="client-slug"
        data-endpoint="https://your-worker.workers.dev"
        data-color="#4f46e5"
        defer></script>
```

This is the recommended way and it is what makes the install genuinely yours: your site stops
depending on anyone else's repository or CDN staying up, and an update only happens when you
decide to copy a new file.

If you would rather not host it, jsDelivr serves it straight from this repository:

```html
<script src="https://cdn.jsdelivr.net/gh/alvaromassana/feedtack@main/widget/feedtack.js" ...
```

> ⚠️ `@main` tracks this repository's main branch, so your clients' sites pick up our changes
> the moment we push them, including the broken ones. If you use the CDN, pin it to a release
> tag rather than `@main`, for example
> `@v1.0.0` ([releases](https://github.com/alvaromassana/feedtack/releases)).

| Attribute | What for | Default |
|---|---|---|
| `data-site` | Identifies the client, shows up in the email subject | `sin-identificar` |
| `data-endpoint` | Your Worker's base URL | none (required) |
| `data-color` | Accent colour, usually the client's brand | `#4f46e5` |
| `data-label` | Button text | `Comentar` / `Comment` |
| `data-position` | `borde-derecho` (a tab on the right edge), `bottom-right`, `bottom-left`, `top-right` | `borde-derecho` |
| `data-lang` | `es` or `en`, overrides the page's `lang` | auto |

The `data-*` table above applies to the self-hosted copy and to the CDN alike.

### 3. Hand out the links

- **Your team**: open the site once with `?feedtack_admin=YOUR_KEY`. It's remembered in that
  browser. With the key you can resolve, mark your own notes as done, reopen and delete.
- **Each reviewer**: send them `https://staging.example.com/?feedtack_yo=Their%20Name`. From then
  on everything they write is signed, and they can edit or delete their own comments.
  Without a link, the widget asks for a name the first time and remembers it.

Without the key you can write, edit and delete your own, and confirm or reopen what's been
resolved. Nothing else.

- **Give reviewers the guide too**: [feedtack.dev/guia/](https://feedtack.dev/guia/)
  (Spanish) and [/guia/en/](https://feedtack.dev/guia/en/) (English). Every action in
  clips of a few seconds, same page for everyone, no sign-up. Regenerate it with
  `node qa/guia-clips.mjs` when the widget changes.

## The WordPress plugin

Install `wordpress/feedtack.zip` like any other plugin. Settings under
**Settings → Feedtack**: site slug, Worker endpoint, colour, button text, position and
panel language (leave it empty to follow the page's `lang`; set it when the site is written
in one language and reviewed in another).

![The plugin settings page, refusing to load on a production site](docs/img/wordpress.png)

The reason it exists isn't compatibility, it's the lock: it will **not** load if
`wp_get_environment_type()` returns `production`, unless you tick a box, which then shows a
permanent red warning. It also stays out of the admin, ajax calls, cron and feeds. The
environment comes from `WP_ENVIRONMENT_TYPE` in `wp-config.php`.

## What lands in your inbox

Every new comment, edit, reopening and deletion sends an email with the text (previous
version struck through on edits), the pointed elements with their selectors and sizes, the
attachments, and the context: page, URL, viewport, browser, OS, scroll position, time.

![The email you receive, with the comment, the CSS selector and the browser](docs/img/email.png)

## The review workflow

```
open  ──(your team, with the key)──>  resolved  ──(the client)──>  confirmed
  ^                                       │
  └───────────(the client)──────────  reopened
```

The client writes and can edit their own while it's not closed. Your team resolves. The
client confirms or reopens, and you get an email either way. Deleting (by the team or by the
author) emails a copy, which is the only trace that's kept.

## What is stored, and where

One table in your D1 database, `comentarios`: the text, the pointed elements (selector, text,
position), the page, the anonymous author id and name, the state, a history of state changes
and previous texts, and the browser context. See [`worker/esquema.sql`](worker/esquema.sql).

**Attachments go to your R2 bucket.** Each file is written to
`<site>/<YYYYMMDD>/<32 random hex>/<filename>` and is readable at `GET /adjuntos/<key>`, an
unguessable but otherwise **public** URL: no CORS check, no team key. The notification email
carries the files inline while they fit in 15 MB and links the rest. The panel shows the
count, not the files.

Two things to know before you point this at a client's material: deleting a comment removes
the database row but **leaves its attachments in R2**, and nothing expires on its own. If
that matters to you, add an R2 lifecycle rule to the bucket. See
[SECURITY.md](SECURITY.md).

## Honest limitations

- **Identity is not authentication.** Who wrote what is an anonymous id in `localStorage`.
  Enough for a private staging site, not enough for anything sensitive. Switch browsers and
  you lose the ability to edit what you wrote (a personal link restores the name, not the id).
- **No rate limiting.** An allowed domain can send as much as it likes.
- **Editing changes the text and the pointed elements**, not the attachments.
- **Screenshots use `getDisplayMedia`**, so the browser asks the reviewer to share their
  screen. On browsers without it they can attach a screenshot they took themselves.

See [SECURITY.md](SECURITY.md) for the full picture.

## How it's built

```
widget/feedtack.js   the widget. one file, no dependencies, no build step
worker/          Cloudflare Worker + D1 + Resend
wordpress/       WordPress plugin (source and installable zip)
demo/            a fake client site to try it on
qa/              browser-driven tests (Playwright)
```

Running the checks, and what we ask of a pull request, is in [CONTRIBUTING.md](CONTRIBUTING.md),
along with the [code of conduct](CODE_OF_CONDUCT.md). Changes are listed in
[CHANGELOG.md](CHANGELOG.md). Every push and pull request runs
[CI](.github/workflows/ci.yml): the code parses, the plugin's production lock still holds,
and the three copies of the widget still match.

The comments are in English. Some names are not: the API routes, the JSON fields, the config
variables and the SQL columns were written in Spanish and renaming them would break every
install that already exists, so they stay until there is a version that can afford it. The
interface is bilingual, and so is the notification email (`EMAIL_LANG`).

## Licence

MIT. Built at [Websalia](https://websalia.com), a web agency in Barcelona, because we got
tired of that email. The first day it went in front of a real client it grew per-person
links, a name that's asked once, and the arrow keys.
