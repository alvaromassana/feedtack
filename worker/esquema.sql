-- Feedtack — comentarios de revisión de webs

CREATE TABLE IF NOT EXISTS comentarios (
  id          TEXT PRIMARY KEY,
  site        TEXT NOT NULL,

  -- dónde se hizo
  url         TEXT NOT NULL,
  ruta        TEXT NOT NULL,
  titulo      TEXT,

  -- qué dice
  mensaje     TEXT NOT NULL DEFAULT '',
  senalados   TEXT NOT NULL DEFAULT '[]',   -- JSON: [{selector, texto, rect}]
  n_adjuntos  INTEGER NOT NULL DEFAULT 0,   -- los archivos viajan por correo, aquí solo el recuento

  -- quién
  autor       TEXT NOT NULL DEFAULT '',
  autor_id    TEXT NOT NULL,                -- identidad anónima guardada en el navegador

  -- en qué punto está
  --   abierto     el cliente lo acaba de escribir
  --   resuelto    lo hemos arreglado, esperando que el cliente lo mire
  --   confirmado  el cliente ha dado el visto bueno (fin del recorrido)
  --   reabierto   el cliente dice que no está bien
  estado      TEXT NOT NULL DEFAULT 'abierto',

  contexto    TEXT NOT NULL DEFAULT '{}',   -- JSON: navegador, ventana, etc.
  historial   TEXT NOT NULL DEFAULT '[]',   -- JSON: [{momento, de, a, texto_anterior}]

  creado      TEXT NOT NULL,
  actualizado TEXT NOT NULL
);

-- El panel siempre pide "todos los de esta web, los pendientes primero"
CREATE INDEX IF NOT EXISTS idx_site_estado ON comentarios (site, estado, creado);
CREATE INDEX IF NOT EXISTS idx_site_ruta   ON comentarios (site, ruta);

-- Respuestas dentro de un comentario (7-sep-2026). Van en su PROPIA tabla y no como
-- comentarios con padre: si compartieran tabla, cada consulta de la lista, de las
-- chinchetas y de los contadores tendría que acordarse de excluirlas, y la que se
-- olvidara pintaría una chincheta por cada respuesta. Aquí no pueden colarse.
CREATE TABLE IF NOT EXISTS respuestas (
  id           TEXT PRIMARY KEY,
  comentario   TEXT NOT NULL,
  site         TEXT NOT NULL,
  mensaje      TEXT NOT NULL DEFAULT '',
  senalados    TEXT NOT NULL DEFAULT '[]',   -- puede señalar otra zona, sin crear marcador
  n_adjuntos   INTEGER NOT NULL DEFAULT 0,
  autor        TEXT NOT NULL DEFAULT '',
  autor_id     TEXT NOT NULL,
  creado       TEXT NOT NULL,
  FOREIGN KEY (comentario) REFERENCES comentarios(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_resp_comentario ON respuestas (comentario, creado);
