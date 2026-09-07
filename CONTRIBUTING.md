# Contributing

Thanks for taking a look. Tack Comment is small on purpose: one widget file, one Worker,
one WordPress plugin. Contributions that keep it that way are the easiest to merge.

## Before you open a pull request

- **Open an issue first** for anything bigger than a typo, so we can agree on the shape
  before you spend time on it.
- **No build step, no dependencies.** The widget is plain JavaScript in a single file and
  has to stay that way. If your change needs a bundler or a library, it probably belongs
  somewhere else.
- **The code and its comments are in Spanish.** That's where the project was written. The
  user interface is bilingual (`es` / `en`), and any new string has to be added to both
  languages in the `TEXTOS` table.
- **Keep the production lock.** Anything that makes it easier to run this on a live site
  is a no.

## Running the checks

```bash
# demo in local (serve dist/, the paths are absolute)
cp widget/tack.js dist/ && cp demo/*.html dist/
(cd dist && python3 -m http.server 8791 --bind 127.0.0.1)

node qa/qa-estados.mjs        # visual states, exits 1 on failure
node qa/qa-persistencia.mjs   # don't lose what you typed when pointing
node qa/qa-invitacion.mjs     # the nudge to point at things
node qa/qa-permisos.mjs KEY   # who can do what (writes to a real backend)
node qa/qa-ciclo.mjs KEY      # full lifecycle (writes to a real backend)
php wordpress/prueba-guardarrail.php   # the production lock, 20 cases, no WordPress needed
```

The browser tests use Playwright's Chromium. Adjust the paths at the top of each script to
where yours lives.

## Pull request checklist

- [ ] The relevant QA script still passes, and if you changed behaviour, there's a case for it.
- [ ] Strings exist in both `es` and `en`.
- [ ] `CHANGELOG.md` has a line under *Unreleased*.
- [ ] If you touched the plugin, `wordpress/tack-comment.zip` is rebuilt from `wordpress/tack-comment/`.

## Reporting a security issue

Please don't open a public issue. See [SECURITY.md](SECURITY.md).
