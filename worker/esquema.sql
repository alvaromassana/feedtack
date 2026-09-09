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

-- Cola de avisos por tanda (8-sep-2026). Antes salía un correo por cada cosa que
-- pasaba; ahora el primer evento de una web abre una ventana y al cerrarse sale UN
-- correo con todo lo que haya caído dentro.
--
-- La cola vive en D1 y no en el almacén del Durable Object a propósito: así se puede
-- mirar con `wrangler d1 execute` cuando algo no llega, y un aviso que falló sigue
-- ahí (lo recoge la tanda siguiente) en vez de desaparecer.
--
-- Los adjuntos NO caben aquí: van a R2 y esta fila guarda solo su clave, su nombre y
-- su tamaño. Es la consecuencia de diferir: antes el fichero viajaba directo al correo
-- y no se guardaba en ningún sitio (`n_adjuntos` era solo un contador).
CREATE TABLE IF NOT EXISTS avisos_pendientes (
  id         TEXT PRIMARY KEY,
  site       TEXT NOT NULL,
  tipo       TEXT NOT NULL,              -- nuevo | respuesta | editado | reabierto
  comentario TEXT,                       -- a qué comentario se refiere (para agrupar en el correo)
  payload    TEXT NOT NULL,              -- JSON del aviso SIN los binarios
  adjuntos   TEXT NOT NULL DEFAULT '[]', -- JSON: [{clave, nombre, tipo, bytes}] en R2
  creado     TEXT NOT NULL,
  enviado    TEXT,                       -- NULL = pendiente. Fecha ISO cuando salió
  intentos   INTEGER NOT NULL DEFAULT 0, -- a partir de 5 se manda sin adjuntos (uno grande no puede bloquear la cola)

  -- 🔒 Las dos columnas de RESERVA, y no son adorno: sin ellas el mismo correo puede
  -- salir DOS veces. Dentro de un Durable Object, un `await` que no sea de su almacén
  -- (D1, R2, Resend) NO bloquea la entrada de eventos nuevos, así que el corte por
  -- número puede volver a entrar mientras la tanda anterior está subiendo a Resend y
  -- leer las mismas filas, que todavía no están marcadas. La reserva es un UPDATE
  -- atómico: quien se lleva las filas es quien las manda, y nadie más las ve.
  -- Una reserva de hace más de 15 minutos se considera muerta (el worker se cayó a
  -- mitad del envío) y se vuelve a coger.
  reclamo    TEXT,                       -- identificador de quien la tiene en vuelo
  reclamado  TEXT                        -- cuándo la cogió (ISO)
);
CREATE INDEX IF NOT EXISTS idx_avisos_pend ON avisos_pendientes (site, enviado, creado);
CREATE INDEX IF NOT EXISTS idx_avisos_reclamo ON avisos_pendientes (reclamo);
