# Contributing

Thanks for taking a look. Feedtack is small on purpose: one widget file, one Worker,
one WordPress plugin. Contributions that keep it that way are the easiest to merge.

## Before you open a pull request

- **Open an issue first** for anything bigger than a typo, so we can agree on the shape
  before you spend time on it.
- **No build step, no dependencies.** The widget is plain JavaScript in a single file and
  has to stay that way. If your change needs a bundler or a library, it probably belongs
  somewhere else.
- **Comments are in English; some names are still Spanish.** The comments were translated
  in September 2026. What has NOT changed, because it would break existing installs, is the
  public surface: the API routes (`/api/comentarios`, `/api/feedback`, `/salud`), the JSON
  field names (`mensaje`, `senalados`, `autor`, `estado`, `ruta`, `creado`...), the config
  variables (`DESTINO`, `REMITENTE`, `ORIGENES_PERMITIDOS`...) and the SQL columns. Match
  what is around you rather than renaming as you go.
- **The user interface is bilingual** (`es` / `en`), and any new string has to be added to
  both languages: in the `TEXTOS` table for the widget, in `IDIOMAS` for the email, and in
  the gettext catalogue for the WordPress plugin. For the plugin that means wrapping it in
  `esc_html__( '...', 'feedtack' )` and then:

  ```bash
  wp i18n make-pot wordpress/feedtack wordpress/feedtack/languages/feedtack.pot --domain=feedtack --slug=feedtack --skip-js
  wp i18n update-po wordpress/feedtack/languages/feedtack.pot wordpress/feedtack/languages/feedtack-es_ES.po
  # translate the new msgstr, then
  wp i18n make-mo wordpress/feedtack/languages && wp i18n make-php wordpress/feedtack/languages
  ```

  `php wordpress/prueba-traduccion.php` fails if you skip any of that, and so does CI.
- **Keep the production lock.** Anything that makes it easier to run this on a live site
  is a no.

## Running the checks

```bash
# demo in local (serve dist/, the paths are absolute)
cp widget/feedtack.js dist/ && cp demo/*.html dist/
(cd dist && python3 -m http.server 8791 --bind 127.0.0.1)

node qa/qa-estados.mjs        # visual states, exits 1 on failure
node qa/qa-persistencia.mjs   # don't lose what you typed when pointing
node qa/qa-invitacion.mjs     # the nudge to point at things
node qa/qa-permisos.mjs KEY   # who can do what (writes to a real backend)
node qa/qa-ciclo.mjs KEY      # full lifecycle (writes to a real backend)

# these four need nothing but node and php, and CI runs them on every pull request
php wordpress/prueba-guardarrail.php   # the production lock, 20 cases, no WordPress needed
php wordpress/prueba-traduccion.php    # every plugin string has its Spanish translation
(cd worker && node qa/qa-idiomas.mjs)  # both email languages are in step
(cd worker && node qa/qa-tandas.mjs)   # email batching, with the Worker booted locally
(cd worker && npx wrangler deploy --dry-run --outdir /tmp/build)   # the Worker builds
```

🔴 The browser tests in `qa/` drive Playwright's Chromium through **absolute paths
hardcoded to the author's machine** (look at the first lines of any of them). You have to
edit those paths before they run anywhere else, and two of them write to a real backend
and need a key. That is why CI does not run them.

🔴 `node --check` is not enough for the Worker: a quote mismatch inside a nested template
literal parses fine and silently changes what the email says. Use the wrangler dry-run,
which is what CI does.

## Pull request checklist

- [ ] The relevant QA script still passes, and if you changed behaviour, there's a case for it.
- [ ] Strings exist in both `es` and `en`.
- [ ] `CHANGELOG.md` has a line under *Unreleased*.
- [ ] If you touched the plugin, `wordpress/feedtack.zip` is rebuilt from `wordpress/feedtack/`.

## Reporting a security issue

Please don't open a public issue. See [SECURITY.md](SECURITY.md).

## Code of conduct

Be decent, and assume the other person is too. The long version, and where to report
something that needs it, is in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
