-- Which files a comment carries, not just how many (21 September 2026).
--
-- `esquema.sql` creates tables with IF NOT EXISTS, so a database that already exists does
-- NOT gain the column on its own: this file has to be run once, by hand.
--
--   npx wrangler d1 execute <your-database> --remote --file worker/migraciones/2026-09-21-adjuntos.sql
--
-- D1 has no ADD COLUMN IF NOT EXISTS: on a database that already has the column this
-- fails with "duplicate column name", which is harmless and means there is nothing to do.
--
-- Run it BEFORE deploying the Worker that reads the column: a deploy without the column
-- makes every listing fail, and the panel draws an empty list without a word. The other
-- way round is harmless (the column sits there until the code uses it).

ALTER TABLE comentarios ADD COLUMN adjuntos TEXT NOT NULL DEFAULT '[]';
ALTER TABLE respuestas  ADD COLUMN adjuntos TEXT NOT NULL DEFAULT '[]';

-- And what can be recovered from before, which is not nothing: the notification queue
-- keeps the keys of everything it ever sent (rows are marked `enviado`, never deleted),
-- so the names of whatever is still in that queue can be filled in.

UPDATE comentarios
SET adjuntos = (SELECT a.adjuntos FROM avisos_pendientes a
                WHERE a.comentario = comentarios.id AND a.tipo = 'nuevo' AND a.adjuntos != '[]'
                ORDER BY a.creado LIMIT 1)
WHERE n_adjuntos > 0 AND adjuntos = '[]'
  AND EXISTS (SELECT 1 FROM avisos_pendientes a
              WHERE a.comentario = comentarios.id AND a.tipo = 'nuevo' AND a.adjuntos != '[]');

-- Replies are only filled in when there is NO doubt about whose file it is. In the queue
-- a reply hangs off its PARENT comment, so with two replies carrying files there is no
-- way to tell which is which, and a name on the wrong reply is worse than no name: it
-- would be a lie nobody could catch. Both counts have to be exactly one.
UPDATE respuestas
SET adjuntos = (SELECT a.adjuntos FROM avisos_pendientes a
                WHERE a.comentario = respuestas.comentario AND a.tipo = 'respuesta' AND a.adjuntos != '[]')
WHERE n_adjuntos > 0 AND adjuntos = '[]'
  AND (SELECT COUNT(*) FROM avisos_pendientes a
       WHERE a.comentario = respuestas.comentario AND a.tipo = 'respuesta' AND a.adjuntos != '[]') = 1
  AND (SELECT COUNT(*) FROM respuestas r2
       WHERE r2.comentario = respuestas.comentario AND r2.n_adjuntos > 0) = 1;
