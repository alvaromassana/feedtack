-- Feedtack — review comments on websites

CREATE TABLE IF NOT EXISTS comentarios (
  id          TEXT PRIMARY KEY,
  site        TEXT NOT NULL,

  -- where it was written
  url         TEXT NOT NULL,
  ruta        TEXT NOT NULL,
  titulo      TEXT,

  -- what it says
  mensaje     TEXT NOT NULL DEFAULT '',
  senalados   TEXT NOT NULL DEFAULT '[]',   -- JSON: [{selector, texto, rect}]
  n_adjuntos  INTEGER NOT NULL DEFAULT 0,   -- how many files it carries
  -- WHICH files (21 September 2026). JSON: [{clave, nombre, tipo, bytes}], the files
  -- themselves live in R2. Until this column existed only the count was stored and the
  -- keys lived in `avisos_pendientes`, the notification queue, which groups replies under
  -- their parent, so the panel could say "2 attachments" and nobody could tell what they
  -- were. Empty on anything written before this, and on installs with no BASE_PUBLICA
  -- (there the files ride inside the email and never reach R2).
  adjuntos    TEXT NOT NULL DEFAULT '[]',

  -- who
  autor       TEXT NOT NULL DEFAULT '',
  autor_id    TEXT NOT NULL,                -- anonymous identity kept in the browser

  -- where it stands
  --   abierto     the client has just written it
  --   resuelto    we fixed it, waiting for the client to look
  --   confirmado  the client signed it off (end of the road)
  --   reabierto   the client says it is not right
  estado      TEXT NOT NULL DEFAULT 'abierto',

  contexto    TEXT NOT NULL DEFAULT '{}',   -- JSON: browser, window, and so on
  historial   TEXT NOT NULL DEFAULT '[]',   -- JSON: [{momento, de, a, texto_anterior}]

  creado      TEXT NOT NULL,
  actualizado TEXT NOT NULL
);

-- The panel always asks for "everything on this site, open ones first"
CREATE INDEX IF NOT EXISTS idx_site_estado ON comentarios (site, estado, creado);
CREATE INDEX IF NOT EXISTS idx_site_ruta   ON comentarios (site, ruta);

-- Replies inside a comment (7 September 2026). They live in their OWN table rather than
-- as comments with a parent: sharing a table would mean every query for the list, the pins
-- and the counters had to remember to exclude them, and the one that forgot would draw a
-- pin per reply. Here they cannot slip through.
CREATE TABLE IF NOT EXISTS respuestas (
  id           TEXT PRIMARY KEY,
  comentario   TEXT NOT NULL,
  site         TEXT NOT NULL,
  mensaje      TEXT NOT NULL DEFAULT '',
  senalados    TEXT NOT NULL DEFAULT '[]',   -- a reply can point at another area without creating a pin
  n_adjuntos   INTEGER NOT NULL DEFAULT 0,
  adjuntos     TEXT NOT NULL DEFAULT '[]',   -- same as in `comentarios`: WHICH files, see above
  autor        TEXT NOT NULL DEFAULT '',
  autor_id     TEXT NOT NULL,
  creado       TEXT NOT NULL,
  FOREIGN KEY (comentario) REFERENCES comentarios(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_resp_comentario ON respuestas (comentario, creado);

-- Queue of batched notifications (8 September 2026). One email used to go out per event;
-- now the first event on a site opens a window, and when it closes ONE email goes out with
-- everything that landed inside it.
--
-- The queue lives in D1 and not in the Durable Object's own storage on purpose: this way you
-- can look at it with `wrangler d1 execute` when something does not arrive, and a
-- notification that failed is still there (the next batch picks it up) instead of vanishing.
--
-- Attachments do NOT fit here: they go to R2 and this row keeps only their key, name and
-- size. That is the price of deferring: the file used to travel straight to the email and
-- was not stored anywhere (`n_adjuntos` was only a counter).
CREATE TABLE IF NOT EXISTS avisos_pendientes (
  id         TEXT PRIMARY KEY,
  site       TEXT NOT NULL,
  tipo       TEXT NOT NULL,              -- nuevo | respuesta | editado | reabierto
  comentario TEXT,                       -- which comment it refers to, so the email can group them
  payload    TEXT NOT NULL,              -- JSON of the notification WITHOUT the binaries
  adjuntos   TEXT NOT NULL DEFAULT '[]', -- JSON: [{clave, nombre, tipo, bytes}] in R2
  creado     TEXT NOT NULL,
  enviado    TEXT,                       -- NULL = pending. ISO date once it went out
  intentos   INTEGER NOT NULL DEFAULT 0, -- from 5 on it is sent without attachments (one big file cannot block the queue)

  -- 🔒 The two RESERVATION columns, and they are not decoration: without them the same
  -- email can go out TWICE. Inside a Durable Object, an `await` that is not on its own
  -- storage (D1, R2, Resend) does NOT block new events from coming in, so the count cut-off
  -- can re-enter while the previous batch is still uploading to Resend and read the same
  -- rows, which are not marked yet. The reservation is one atomic UPDATE: whoever takes the
  -- rows is whoever sends them, and nobody else sees them. A reservation older than 15
  -- minutes is considered dead (the worker died mid-send) and is picked up again.
  reclamo    TEXT,                       -- id of whoever has it in flight
  reclamado  TEXT                        -- when they took it (ISO)
);
CREATE INDEX IF NOT EXISTS idx_avisos_pend ON avisos_pendientes (site, enviado, creado);
CREATE INDEX IF NOT EXISTS idx_avisos_reclamo ON avisos_pendientes (reclamo);
