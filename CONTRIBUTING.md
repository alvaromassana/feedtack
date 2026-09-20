# Contributing

Thanks for taking a look. Feedtack is small on purpose: one widget file, one Worker,
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
cp widget/feedtack.js dist/ && cp demo/*.html dist/
(cd dist && python3 -m http.server 8791 --bind 127.0.0.1)

node qa/qa-estados.mjs        # visual states, exits 1 on failure
node qa/qa-persistencia.mjs   # don't lose what you typed when pointing
node qa/qa-invitacion.mjs     # the nudge to point at things
node qa/qa-permisos.mjs KEY   # who can do what (writes to a real backend)
node qa/qa-ciclo.mjs KEY      # full lifecycle (writes to a real backend)

# these four need nothing but node and php, and CI runs them on every pull request
php wordpress/prueba-guardarrail.php   # the production lock, 20 cases, no WordPress needed
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
