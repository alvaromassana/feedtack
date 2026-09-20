/**
 * Feedtack — backend for the feedback widget (Cloudflare Worker + D1)
 *
 *   POST   /api/feedback            create a comment (multipart) → stores it and emails you
 *   GET    /api/comentarios?site=X  list the ones on a site
 *   PATCH  /api/comentarios/:id     edit the text (author only)
 *   POST   /api/comentarios/:id/estado   resolve / confirm / reopen / close
 *   DELETE /api/comentarios/:id     delete (team key ONLY, or the author on their own)
 *   GET    /adjuntos/<key>          an attachment stored in R2 (unguessable key)
 *   GET    /salud                   health
 *
 * States: abierto → resuelto (the team) → confirmado | reabierto (the client)
 * The team, with the key, can also close directly (internal notes and reminders that
 * nobody needs to confirm).
 *
 * Secrets: RESEND_API_KEY, CLAVE_ADMIN, TANDAS (set it to "no" to turn batching off)
 * Vars:    DESTINO, REMITENTE, ORIGENES_PERMITIDOS, SITIOS (optional),
 *          VENTANA_MINUTOS, CORTE_COMENTARIOS, BASE_PUBLICA, EMAIL_LANG, ZONA_HORARIA
 * Bindings: DB (D1), ADJUNTOS (R2), TANDAS_DO (Durable Object)
 */

import { DurableObject } from 'cloudflare:workers';

const MAX_TOTAL = 22 * 1024 * 1024;
const ESTADOS = ['abierto', 'resuelto', 'confirmado', 'reabierto'];

/* Notification batching (8 September 2026). The first event on a site opens the window
   and when it closes ONE email goes out with everything inside it. It counts from the
   FIRST one, not the last: otherwise a running conversation delays the email forever. */
const VENTANA_MINUTOS = 10;
const CORTE_COMENTARIOS = 10;

/* Resend caps at 40 MB per email and a single comment accepts 22 attachments, so files
   ride inside the email while they fit in this budget and the rest are linked to R2.
   These are RAW bytes and the email travels as base64, which is a third bigger: 15 MB of
   screenshots is about 20 MB of request. Hence the margin; raising it much burns it. */
const PRESUPUESTO_ADJUNTOS = 15 * 1024 * 1024;

/* From here on a notification goes out without its attachments: one file that Resend
   rejects cannot be allowed to block an entire site's queue. */
const INTENTOS_SIN_ADJUNTOS = 5;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origen = request.headers.get('Origin') || '';
    const cors = cabecerasCors(origen, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/salud') return await salud(env, cors);

    /* Attachments are opened from the email, that is, from a mail client that sends no
       Origin: this route goes BEFORE the CORS filter on purpose, like /salud. What
       protects it is that the key carries 32 random characters and there is no way to
       list the bucket; it is not authentication, and SECURITY.md says so. */
    const adj = url.pathname.match(/^\/adjuntos\/(.+)$/);
    if (adj && (request.method === 'GET' || request.method === 'HEAD')) {
      let clave;
      // A half-written %AA makes decodeURIComponent throw, and this route does not go
      // through the CORS filter: without this, anyone gets a 500 with a bent URL.
      try { clave = decodeURIComponent(adj[1]); }
      catch { return new Response('no encontrado', { status: 404 }); }
      return await servirAdjunto(clave, env, request.method);
    }

    if (!cors['Access-Control-Allow-Origin']) {
      return json({ error: 'origen no permitido' }, 403, {});
    }

    try {
      if (url.pathname === '/api/feedback' && request.method === 'POST') {
        return await crear(request, env, cors);
      }
      if (url.pathname === '/api/comentarios' && request.method === 'GET') {
        return await listar(url, env, cors);
      }
      const r = url.pathname.match(/^\/api\/comentarios\/([\w-]+)\/respuestas$/);
      if (r && request.method === 'POST') {
        return await responder(r[1], request, env, cors);
      }
      const m = url.pathname.match(/^\/api\/comentarios\/([\w-]+)(\/estado)?$/);
      if (m && m[2] && request.method === 'POST') {
        return await cambiarEstado(m[1], request, env, cors);
      }
      if (m && !m[2] && request.method === 'PATCH') {
        return await editar(m[1], request, env, cors);
      }
      if (m && !m[2] && request.method === 'DELETE') {
        return await eliminar(m[1], request, env, cors);
      }
    } catch (e) {
      console.log('fallo', e.message, e.stack);
      return json({ error: 'fallo interno' }, 500, cors);
    }

    return json({ error: 'no encontrado' }, 404, cors);
  }
};

// ───────────────────────────────────────────────────────────────── crear

async function crear(request, env, cors) {
  let form;
  try { form = await request.formData(); }
  catch { return json({ error: 'formulario ilegible' }, 400, cors); }

  const site = texto(form.get('site'), 80) || 'sin-identificar';
  const sitios = lista(env.SITIOS);
  if (sitios.length && !sitios.includes(site)) {
    return json({ error: 'sitio no reconocido' }, 403, cors);
  }

  const autorId = texto(form.get('autor_id'), 60);
  if (!autorId) return json({ error: 'falta el identificador de autor' }, 400, cors);

  const mensaje = texto(form.get('mensaje'), 8000);
  const autor = texto(form.get('autor'), 120);
  const contexto = parsear(form.get('contexto')) || {};
  const senalados = parsear(form.get('senalados')) || [];

  const recogidos = await recogerAdjuntos(form);
  if (recogidos.error) return json({ error: recogidos.error }, 413, cors);
  const adjuntos = recogidos.adjuntos;

  if (!mensaje && !senalados.length && !adjuntos.length) {
    return json({ error: 'comentario vacío' }, 400, cors);
  }

  const id = crypto.randomUUID();
  const ahora = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO comentarios
     (id, site, url, ruta, titulo, mensaje, senalados, n_adjuntos, autor, autor_id,
      estado, contexto, historial, creado, actualizado)
     VALUES (?,?,?,?,?,?,?,?,?,?,'abierto',?,'[]',?,?)`
  ).bind(
    id, site, contexto.url || '', contexto.ruta || '/', contexto.titulo || '',
    mensaje, JSON.stringify(senalados), adjuntos.length, autor, autorId,
    JSON.stringify(contexto), ahora, ahora
  ).run();

  /* The comment is already stored: from here on no failure of the notification may
     return an error, because the widget would read it as "it did not send" and the
     person would write it again. This call used to have no net, and a Resend failure
     ended in a 500 on top of a comment that was safely saved. */
  await encolar(env, {
    tipo: 'nuevo',
    site, mensaje, autor, contexto, senalados, adjuntos, id
  });

  return json({ ok: true, id }, 200, cors);
}

// ────────────────────────────────────────────────────────────── responder

/* A reply inside a comment. It accepts the same as a comment (text, attachments and
   pointing at an area) because halfway through a conversation you need to be able to say
   "I mean THIS". What it does NOT do is create a new pin on the page: the whole
   conversation hangs off the original comment and is read inside it. */
async function responder(comentarioId, request, env, cors) {
  let form;
  try { form = await request.formData(); }
  catch { return json({ error: 'formulario ilegible' }, 400, cors); }

  const padre = await env.DB.prepare('SELECT * FROM comentarios WHERE id = ?').bind(comentarioId).first();
  if (!padre) return json({ error: 'ese comentario no existe' }, 404, cors);

  const autorId = texto(form.get('autor_id'), 60);
  if (!autorId) return json({ error: 'falta el identificador de autor' }, 400, cors);

  const mensaje = texto(form.get('mensaje'), 8000);
  const autor = texto(form.get('autor'), 120);
  const senalados = parsear(form.get('senalados')) || [];

  const recogidos = await recogerAdjuntos(form);
  if (recogidos.error) return json({ error: recogidos.error }, 413, cors);
  const adjuntos = recogidos.adjuntos;

  if (!mensaje && !senalados.length && !adjuntos.length) {
    return json({ error: 'respuesta vacía' }, 400, cors);
  }

  const id = crypto.randomUUID();
  const ahora = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO respuestas (id, comentario, site, mensaje, senalados, n_adjuntos, autor, autor_id, creado)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(id, comentarioId, padre.site, mensaje, JSON.stringify(senalados), adjuntos.length, autor, autorId, ahora).run();

  /* Se toca la fecha del comentario para que suba en la lista: una conversacion viva
     tiene que verse antes que una parada. */
  await env.DB.prepare('UPDATE comentarios SET actualizado = ? WHERE id = ?').bind(ahora, comentarioId).run();

  await encolar(env, {
    tipo: 'respuesta',
    site: padre.site, mensaje, autor,
    contexto: JSON.parse(padre.contexto || '{}'),
    senalados, adjuntos, id: comentarioId,
    anterior: padre.mensaje
  });

  return json({ ok: true, id }, 200, cors);
}

// ───────────────────────────────────────────────────────────────── listar

async function listar(url, env, cors) {
  const site = texto(url.searchParams.get('site'), 80);
  if (!site) return json({ error: 'falta el sitio' }, 400, cors);

  const { results } = await env.DB.prepare(
    `SELECT id, url, ruta, titulo, mensaje, senalados, n_adjuntos, autor, autor_id,
            estado, creado, actualizado, historial
     FROM comentarios WHERE site = ? ORDER BY creado ASC`
  ).bind(site).all();

  /* Las respuestas se traen de una vez y se reparten en memoria: una consulta mas, no
     una por comentario. */
  const { results: resp } = await env.DB.prepare(
    `SELECT id, comentario, mensaje, senalados, n_adjuntos, autor, autor_id, creado
     FROM respuestas WHERE site = ? ORDER BY creado ASC`
  ).bind(site).all();

  const porComentario = {};
  (resp || []).forEach(r => {
    (porComentario[r.comentario] = porComentario[r.comentario] || []).push({
      id: r.id,
      mensaje: r.mensaje,
      senalados: JSON.parse(r.senalados || '[]'),
      nAdjuntos: r.n_adjuntos,
      autor: r.autor,
      autorId: r.autor_id,
      creado: r.creado
    });
  });

  const comentarios = (results || []).map(c => ({
    id: c.id,
    respuestas: porComentario[c.id] || [],
    url: c.url,
    ruta: c.ruta,
    titulo: c.titulo,
    mensaje: c.mensaje,
    senalados: JSON.parse(c.senalados || '[]'),
    nAdjuntos: c.n_adjuntos,
    autor: c.autor,
    autorId: c.autor_id,
    estado: c.estado,
    creado: c.creado,
    actualizado: c.actualizado,
    editado: JSON.parse(c.historial || '[]').some(h => h.texto_anterior != null)
  }));

  return json({ ok: true, comentarios }, 200, cors);
}

// ───────────────────────────────────────────────────────────────── editar

async function editar(id, request, env, cors) {
  const cuerpo = await request.json().catch(() => null);
  if (!cuerpo) return json({ error: 'cuerpo ilegible' }, 400, cors);

  const autorId = texto(cuerpo.autor_id, 60);
  const nuevo = texto(cuerpo.mensaje, 8000);
  if (!autorId) return json({ error: 'falta el identificador de autor' }, 400, cors);

  const fila = await env.DB.prepare('SELECT * FROM comentarios WHERE id = ?').bind(id).first();
  if (!fila) return json({ error: 'no existe' }, 404, cors);

  // Only the author edits their own. This is a private review site, not strong auth.
  if (fila.autor_id !== autorId) return json({ error: 'no es tuyo' }, 403, cors);

  const senalados = Array.isArray(cuerpo.senalados)
    ? cuerpo.senalados : JSON.parse(fila.senalados || '[]');

  if (!nuevo && !senalados.length) {
    return json({ error: 'el comentario no puede quedar vacío' }, 400, cors);
  }
  if (nuevo === fila.mensaje && JSON.stringify(senalados) === fila.senalados) {
    return json({ ok: true, sinCambios: true }, 200, cors);
  }

  const ahora = new Date().toISOString();
  const historial = JSON.parse(fila.historial || '[]');
  historial.push({ momento: ahora, accion: 'editado', texto_anterior: fila.mensaje });

  await env.DB.prepare(
    `UPDATE comentarios SET mensaje = ?, senalados = ?, historial = ?, actualizado = ?
     WHERE id = ?`
  ).bind(nuevo, JSON.stringify(senalados), JSON.stringify(historial), ahora, id).run();

  // We send the edit by email so nobody works off the old version
  await encolar(env, {
    tipo: 'editado',
    site: fila.site,
    mensaje: nuevo,
    anterior: fila.mensaje,
    autor: fila.autor,
    contexto: JSON.parse(fila.contexto || '{}'),
    senalados,
    adjuntos: [],
    id
  });

  return json({ ok: true }, 200, cors);
}

// ─────────────────────────────────────────────────────────── cambiar estado

async function cambiarEstado(id, request, env, cors) {
  const cuerpo = await request.json().catch(() => null);
  if (!cuerpo) return json({ error: 'cuerpo ilegible' }, 400, cors);

  const nuevo = texto(cuerpo.estado, 20);
  if (!ESTADOS.includes(nuevo)) return json({ error: 'estado no válido' }, 400, cors);

  const fila = await env.DB.prepare('SELECT * FROM comentarios WHERE id = ?').bind(id).first();
  if (!fila) return json({ error: 'no existe' }, 404, cors);

  const admin = esAdmin(cuerpo.clave, env);

  const suyo = cuerpo.autor_id && String(cuerpo.autor_id) === String(fila.autor_id);

  /* El equipo (con clave) manda: puede resolver, y puede cerrar directamente lo suyo
     o una nota interna, sin esperar a que nadie confirme.

     Sin clave hay dos cosas permitidas:
     - confirmar o reabrir algo que YA hemos resuelto (es su palabra la que cierra), y
     - CERRAR lo suyo cuando sigue abierto: se equivoco, ya no aplica, o lo resolvio por
       otra via. Sin esto, quien escribe se queda atrapado con un comentario que ya no
       quiere y su unica salida es borrarlo, que se lleva el rastro por delante.

     Lo que NO puede nadie sin clave es marcar algo como RESUELTO: eso es afirmar que el
     trabajo esta hecho, y solo puede decirlo quien lo ha hecho. */
  if (!admin) {
    if (nuevo === 'resuelto' || nuevo === 'abierto') {
      return json({ error: 'hace falta la clave de administración' }, 403, cors);
    }
    const cerrandoLoSuyo = suyo && nuevo === 'confirmado' &&
      (fila.estado === 'abierto' || fila.estado === 'reabierto');
    if (fila.estado !== 'resuelto' && !cerrandoLoSuyo) {
      return json({ error: 'solo se puede confirmar o reabrir algo ya resuelto, o cerrar lo tuyo' }, 409, cors);
    }
  }

  const ahora = new Date().toISOString();
  const historial = JSON.parse(fila.historial || '[]');
  historial.push({ momento: ahora, accion: 'estado', de: fila.estado, a: nuevo });

  await env.DB.prepare(
    'UPDATE comentarios SET estado = ?, historial = ?, actualizado = ? WHERE id = ?'
  ).bind(nuevo, JSON.stringify(historial), ahora, id).run();

  // Si el cliente reabre algo, hay que enterarse
  if (nuevo === 'reabierto') {
    await encolar(env, {
      tipo: 'reabierto',
      site: fila.site,
      mensaje: fila.mensaje,
      autor: fila.autor,
      contexto: JSON.parse(fila.contexto || '{}'),
      senalados: JSON.parse(fila.senalados || '[]'),
      adjuntos: [], id
    });
  }

  return json({ ok: true, estado: nuevo }, 200, cors);
}

// ──────────────────────────────────────────────────────────────── eliminar

/* Deleting is the only action with no way back, so it is kept for the team and a copy
   goes out by email: if somebody deletes something by mistake, the trace remains. */
async function eliminar(id, request, env, cors) {
  const cuerpo = await request.json().catch(() => ({}));

  const fila = await env.DB.prepare('SELECT * FROM comentarios WHERE id = ?').bind(id).first();
  if (!fila) return json({ error: 'no existe' }, 404, cors);

  /* The team deletes (with the key), or the AUTHOR deletes their own. The second leans
     on the same anonymous browser id already used to edit your own: whoever wrote
     something by mistake has to be able to remove it without asking us. It is not
     authentication and does not pretend to be (SECURITY.md says so); this is a review
     tool between people who know each other, on an environment that is not public.
     Both cases send an email, which is the only trace left. */
  const suyo = cuerpo.autor_id && String(cuerpo.autor_id) === String(fila.autor_id);
  if (!esAdmin(cuerpo.clave, env) && !suyo) {
    return json({ error: 'solo el equipo o quien lo escribió pueden eliminarlo' }, 403, cors);
  }

  await env.DB.prepare('DELETE FROM comentarios WHERE id = ?').bind(id).run();

  /* El aviso va DESPUES de borrar, asi que si falla el borrado ya esta hecho: devolver
     error haria que el usuario reintentase algo que ya ocurrio, y encima viendo un fallo.
     Se avisa de que la copia no salio, que es lo unico que se pierde. */
  let copiaEnviada = true;
  try {
    await avisar(env, {
      tipo: 'eliminado',
      porSuAutor: !!suyo,
      site: fila.site,
      mensaje: fila.mensaje,
      autor: fila.autor,
      contexto: JSON.parse(fila.contexto || '{}'),
      senalados: JSON.parse(fila.senalados || '[]'),
      adjuntos: [], id
    });
  } catch (e) {
    copiaEnviada = false;
    console.error('feedtack: borrado OK pero la copia por correo fallo', id, e && e.message);
  }

  return json({ ok: true, eliminado: id, copiaEnviada }, 200, cors);
}

// ──────────────────────────────────────────────────── adjuntos y cola de tandas

/* Attachments are collected ONCE and raw (ArrayBuffer). They used to be turned into
   base64 right here, which spent 33% more memory on a format only the email needs: they
   go to R2 as they are. */
async function recogerAdjuntos(form) {
  const adjuntos = [];
  let total = 0;
  for (const [clave, valor] of form.entries()) {
    if (!clave.startsWith('adjunto') || typeof valor === 'string') continue;
    total += valor.size;
    if (total > MAX_TOTAL) return { error: 'adjuntos demasiado grandes' };
    adjuntos.push({
      filename: nombreSeguro(valor.name || clave),
      contentType: valor.type || 'application/octet-stream',
      datos: await valor.arrayBuffer()
    });
  }
  return { adjuntos };
}

/* A batchable notification: it goes into the queue, its attachments go to R2, and THAT
   site's Durable Object is told to open (or count into) its window.
   Three things this function decides and nobody else does:
   1. The DELETED email never waits: it is the only trace left of something that is no
      longer there, so it goes out at once with its copy inside.
   2. If any piece is missing (R2, the DO, or batching is off), it falls back to the old
      path: an immediate email with the attachments. Deferring is a noise improvement;
      losing a notification is not an acceptable price for it.
   3. It never throws. Whoever calls it has already stored the comment. */
async function encolar(env, datos) {
  const conAdjuntos = (datos.adjuntos || []).length > 0;

  /* Four reasons not to defer, and the fourth is the one that nearly slipped through:
     with no public URL configured, an attachment that does not fit in the email cannot be
     linked, so deferring it would make it vanish without a word (it sits in R2 and nobody
     can reach it). Failing closed here = keep doing what worked before. */
  if (datos.tipo === 'eliminado' || env.TANDAS === 'no' ||
      !env.TANDAS_DO || !env.ADJUNTOS || !env.DB ||
      (conAdjuntos && !env.BASE_PUBLICA)) {
    return await seguro(() => avisar(env, datos), 'aviso inmediato');
  }

  let filaId = null;
  try {
    const guardados = [];
    for (const a of datos.adjuntos || []) {
      const clave = `${datos.site}/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}/${claveAleatoria()}/${a.filename}`;
      await env.ADJUNTOS.put(clave, a.datos, { httpMetadata: { contentType: a.contentType } });
      guardados.push({ clave, nombre: a.filename, tipo: a.contentType, bytes: a.datos.byteLength });
    }

    const { adjuntos, ...resto } = datos;
    filaId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO avisos_pendientes (id, site, tipo, comentario, payload, adjuntos, creado)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(
      filaId, datos.site, datos.tipo, datos.id || null,
      JSON.stringify(resto), JSON.stringify(guardados), new Date().toISOString()
    ).run();

    const stub = env.TANDAS_DO.get(env.TANDAS_DO.idFromName(datos.site));
    await stub.encolar(datos.site);
  } catch (e) {
    console.error('feedtack: la cola fallo, se avisa en el acto', e && e.message);
    /* 🔒 Before sending it by hand it has to be TAKEN OUT of the queue. Left there, the
       next batch drags it along and the same notification goes out twice. And if the
       DELETE removes nothing, the batch already sent it (or has it in flight): then
       nothing is sent here, because that would be the duplicate this avoids. */
    if (filaId) {
      const borrado = await seguro(() => env.DB.prepare(
        'DELETE FROM avisos_pendientes WHERE id = ? AND enviado IS NULL AND reclamo IS NULL'
      ).bind(filaId).run(), 'sacar de la cola');
      if (borrado && borrado.meta && borrado.meta.changes === 0) return;
    }
    await seguro(() => avisar(env, datos), 'aviso inmediato tras fallo de cola');
  }
}

/* Wraps something that must not be able to bring the request down: the client's comment
   is already stored and a failed notification cannot hand them an error (they would just
   write it again). */
async function seguro(fn, qué) {
  try { return await fn(); }
  catch (e) { console.error(`feedtack: fallo en ${qué}:`, e && e.message); return null; }
}

/* /salud says whether batching is REALLY up. It exists because of a mute failure mode:
   if the schema was never applied, every enqueue blows up, falls back to the immediate
   email, and everything looks exactly as it always did (one email per event) with nothing
   saying batching never came on. Here that shows, and so does a queue going stale. */
async function salud(env, cors) {
  const base = { ok: true, servicio: 'feedtack', tandas: env.TANDAS === 'no' ? 'apagadas' : 'activas' };
  if (!env.DB) return json({ ...base, cola: 'sin base de datos' }, 200, cors);
  try {
    const r = await env.DB.prepare(
      'SELECT COUNT(*) n, MIN(creado) viejo FROM avisos_pendientes WHERE enviado IS NULL'
    ).first();
    const minutos = r && r.viejo ? Math.round((Date.now() - Date.parse(r.viejo)) / 60000) : 0;
    return json({ ...base, cola: { pendientes: r ? r.n : 0, mas_viejo_minutos: minutos } }, 200, cors);
  } catch (e) {
    /* Not "ok": batching is configured and cannot work. */
    return json({
      ok: false, servicio: 'feedtack', tandas: 'configuradas pero SIN TABLA',
      cola: 'falta avisos_pendientes: aplica worker/esquema.sql', detalle: String(e && e.message)
    }, 500, cors);
  }
}

async function servirAdjunto(clave, env, metodo) {
  /* The full shape of the key is required (site / date / 32 random / name). Without it a
     half key would be an invitation to try prefixes, and although R2 does not serve
     prefixes, whoever reads the logs could not tell probing from a normal download. */
  if (!env.ADJUNTOS || !/^[\w.-]+\/\d{8}\/[0-9a-f]{32}\/.+$/.test(clave)) {
    return new Response('no encontrado', { status: 404 });
  }
  const obj = await env.ADJUNTOS.get(clave);
  if (!obj) return new Response('no encontrado', { status: 404 });

  const cabeceras = new Headers();
  obj.writeHttpMetadata(cabeceras);
  const tipo = cabeceras.get('Content-Type') || 'application/octet-stream';

  /* 🔒 The file was uploaded by the client and its type was chosen by their browser, so
     it is served as a suspect: only real images open in the browser, everything else is
     downloaded. An SVG (or an HTML in disguise) served `inline` would run its own script
     on the worker's domain. `nosniff` closes the other half: without it, the browser can
     decide on its own that a PNG is HTML. */
  const seguras = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const nombre = nombreSeguro(clave.split('/').pop());
  cabeceras.set('Content-Disposition',
    `${seguras.includes(tipo.split(';')[0].trim().toLowerCase()) ? 'inline' : 'attachment'}; filename="${nombre}"`);
  cabeceras.set('X-Content-Type-Options', 'nosniff');
  cabeceras.set('Content-Security-Policy', "sandbox; default-src 'none'");
  cabeceras.set('Cache-Control', 'private, max-age=86400');
  cabeceras.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(metodo === 'HEAD' ? null : obj.body, { headers: cabeceras });
}

/* Huella corta y estable de una cadena (FNV-1a). No es seguridad, es desempate. */
function huella(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const claveAleatoria = () =>
  [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

/* One instance per site (`idFromName(site)`), so two sites never mix into the same email
   and one site's clock never drags another's. It is single-threaded per instance: two
   simultaneous comments cannot open two windows or send two emails. */
export class Tandas extends DurableObject {
  async encolar(site) {
    await this.ctx.storage.put('site', site);
    const n = ((await this.ctx.storage.get('n')) || 0) + 1;
    await this.ctx.storage.put('n', n);

    const corte = Number(this.env.CORTE_COMENTARIOS || CORTE_COMENTARIOS);
    if (n >= corte) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.put('n', 0);
      return await this.enviar('corte');
    }
    /* The window opens with the FIRST one and is not touched afterwards: if every event
       reset it, a running conversation would postpone the email forever. */
    if ((await this.ctx.storage.getAlarm()) == null) {
      const minutos = Number(this.env.VENTANA_MINUTOS || VENTANA_MINUTOS);
      await this.ctx.storage.setAlarm(Date.now() + Math.max(1000, minutos * 60000));
    }
  }

  async alarm() {
    await this.enviar('ventana');
  }

  /* One batch in flight. An `await` that is not on the Durable Object's own storage (D1,
     R2, Resend) does NOT stop new events coming in, so without this lock the count
     cut-off re-enters while the upload to Resend is happening. The in-memory lock avoids
     the repeated work; what really guarantees it does not go out twice is the reservation
     in the database, because the instance can restart and lose this variable. */
  async enviar(motivo) {
    if (this.enviando) { this.pendienteOtra = true; return; }
    this.enviando = true;
    try { await this.tanda(motivo); }
    finally { this.enviando = false; }
    if (this.pendienteOtra) { this.pendienteOtra = false; await this.enviar('cola'); }
  }

  async tanda(motivo) {
    const site = await this.ctx.storage.get('site');
    if (!site) return;

    const reclamo = crypto.randomUUID();
    const ahora = new Date();
    const muerta = new Date(ahora.getTime() - 15 * 60000).toISOString();

    /* Atomic RESERVATION: a single UPDATE takes the rows and returns the ones it took.
       Whoever does not take them sees nothing and sends nothing. Dead reservations (older
       than 15 minutes) are picked up too, which is how a send that was left half done
       because the worker died gets recovered. */
    let pendientes = [];
    try {
      const { results } = await this.env.DB.prepare(
        `UPDATE avisos_pendientes SET reclamo = ?, reclamado = ?
         WHERE site = ? AND enviado IS NULL AND (reclamo IS NULL OR reclamado < ?)
         RETURNING id, tipo, comentario, payload, adjuntos, creado, intentos`
      ).bind(reclamo, ahora.toISOString(), site, muerta).all();
      pendientes = (results || []).sort((a, b) => (a.creado < b.creado ? -1 : 1));
    } catch (e) {
      /* If the database does not answer, the window must NOT stay closed over
         notifications nobody sent: it retries. That is the failure that leaves the
         inbox silent. */
      console.error('feedtack: no se pudo reservar la tanda de', site, e && e.message);
      await this.ctx.storage.setAlarm(Date.now() + 2 * 60000);
      return;
    }

    if (!pendientes.length) return;

    try {
      await enviarTanda(this.env, site, pendientes, motivo);
    } catch (e) {
      /* A Resend failure loses nothing: the reservation is released, the attempt is
         counted and it tries again in two minutes. From the fifth on, the batch goes out
         WITHOUT attachments, which is the likeliest reason for Resend to say no, so at
         least the text arrives. And from the tenth on it stops insisting: the rows stay
         pending (the next event drags them along) and show up in /salud as a stale
         queue, instead of retrying in a loop forever. */
      console.error('feedtack: la tanda de', site, 'no salio', e && e.message);
      await seguro(() => this.env.DB.prepare(
        'UPDATE avisos_pendientes SET reclamo = NULL, reclamado = NULL, intentos = intentos + 1 WHERE reclamo = ?'
      ).bind(reclamo).run(), 'soltar la reserva');
      const insistidos = Math.max(...pendientes.map(p => p.intentos || 0)) + 1;
      if (insistidos < 10) await this.ctx.storage.setAlarm(Date.now() + 2 * 60000);
      else console.error('feedtack: la cola de', site, 'lleva', insistidos, 'intentos, se deja de insistir');
      return;
    }

    /* Already sent. If this UPDATE fails, the rows stay reserved and are NOT sent again
       until the reservation expires: that is the right direction for the error to fall
       (better a repeated notification in 15 minutes than a lost one). */
    await seguro(() => this.env.DB.prepare(
      'UPDATE avisos_pendientes SET enviado = ? WHERE reclamo = ?'
    ).bind(ahora.toISOString(), reclamo).run(), 'marcar la tanda como enviada');
  }
}

/* Builds and sends a batch email. Attachments are pulled from R2 and ride inside the
   email while they fit the budget; the ones that do not fit are linked, which is the same
   thing that was needed for those already coming from a failed attempt. */
async function enviarTanda(env, site, pendientes, motivo) {
  idiomaCorreo(env);
  const base = (env.BASE_PUBLICA || '').replace(/\/$/, '');
  const eventos = [];
  const adjuntosCorreo = [];
  let presupuesto = PRESUPUESTO_ADJUNTOS;

  for (const fila of pendientes) {
    const datos = JSON.parse(fila.payload);
    const guardados = JSON.parse(fila.adjuntos || '[]');
    const sinAdjuntos = fila.intentos >= INTENTOS_SIN_ADJUNTOS;
    const listado = [];

    for (const a of guardados) {
      const enlace = base ? `${base}/adjuntos/${a.clave.split('/').map(encodeURIComponent).join('/')}` : '';
      let adjuntado = false;
      if (!sinAdjuntos && a.bytes <= presupuesto) {
        const obj = await env.ADJUNTOS.get(a.clave);
        if (obj) {
          adjuntosCorreo.push({
            filename: a.nombre,
            content: base64(await obj.arrayBuffer()),
            contentType: a.tipo
          });
          presupuesto -= a.bytes;
          adjuntado = true;
        }
      }
      listado.push({ ...a, enlace, adjuntado });
    }

    eventos.push({ ...datos, tipo: fila.tipo, creado: fila.creado, adjuntos: listado });
  }

  const resumen = resumenTanda(eventos, motivo);
  const html = preheader(resumen) + (eventos.length === 1
    ? plantilla({ ...eventos[0], adjuntos: eventos[0].adjuntos })
    : plantillaTanda(site, eventos, motivo));

  await mandar(env, { asunto: asuntoTanda(site), html, adjuntos: adjuntosCorreo, site });
}

/* 🔴 A batch's subject is FIXED per site, and this was measured against real Gmail on 8
   September: with identical References and In-Reply-To but a changing subject ("3
   comments" / "2 comments"), Gmail opened TWO threads. The headers are not enough: Gmail
   also demands the subject be the same (it only forgives "Re:"). So whatever varies goes
   into the body, and what acts as the headline is the preview line (the preheader), which
   Gmail does show next to the subject in the list.
   The DELETED one keeps its own subject on purpose: it is the only trace of something
   that is no longer there and cannot end up buried inside a forty-email thread. */
function asuntoTanda(site) {
  return `💬 Feedtack · ${site}`;
}

/* The real headline: what Gmail paints after the subject in the list. */
function resumenTanda(eventos, motivo) {
  if (eventos.length === 1) {
    const e = eventos[0];
    return `${T.mote[e.tipo] || ''}${resumir(e.mensaje, e.senalados)}`;
  }
  const cuenta = {};
  eventos.forEach(e => { cuenta[e.tipo] = (cuenta[e.tipo] || 0) + 1; });
  const partes = ['nuevo', 'respuesta', 'editado', 'reabierto']
    .map(k => (cuenta[k] ? T.cuenta[k](cuenta[k]) : ''))
    .filter(Boolean).join(', ');
  const lleno = motivo === 'corte' ? ` ${T.tandaLlena}` : '';
  return `${partes}${lleno}: "${resumir(eventos[0].mensaje, eventos[0].senalados)}"`;
}

/* Invisible block Gmail uses as the preview line. It goes before everything else. */
function preheader(texto) {
  return `<div style="display:none;font-size:1px;color:#f1f5f9;max-height:0;overflow:hidden">${esc(texto)}</div>`;
}

/* ─────────────────────────────────────────────── language of the notification email
   Every word a Feedtack email says is in this table. Spanish is the default because
   that is what every deployment made before this existed already receives; set

     EMAIL_LANG = "en"

   in wrangler.toml (or as a secret) to get the English one. Nothing else in the
   project reads it: the widget picks its own language from the page.

   This is the first English-named variable in the Worker on purpose. The rest
   (DESTINO, REMITENTE, ORIGENES_PERMITIDOS...) are still Spanish, and renaming those
   breaks existing deployments, so it is a separate decision. */
const IDIOMAS = {
  es: {
    locale: 'es-ES', html: 'es',
    pagina: 'Página', url: 'URL', enviadoPor: 'Enviado por', pantalla: 'Pantalla',
    navegador: 'Navegador', momento: 'Momento',
    ventanaMonitor: (v, p) => `${v} (ventana), ${p} (monitor)`,
    sinIdentificar: 'sin identificar',
    portada: 'Portada',
    antesDecia: 'Antes decía',
    vacio: '(vacío)',
    senalados: n => (n > 1 ? `${n} elementos señalados` : 'Elemento señalado'),
    desdeArriba: (w, h, y) => `${w}×${h} px, a ${y} px del principio de la página`,
    sinTexto: 'Sin texto, mira los adjuntos.',
    sinTextoTanda: 'Sin texto, mira lo señalado y los adjuntos.',
    adjuntos: n => `${n} adjunto${n > 1 ? 's' : ''}`,
    adjunto: 'adjunto',
    noCabia: 'no cabía en el correo, se abre con el enlace',
    banda: {
      nuevo: 'Nuevo comentario en', editado: 'Comentario EDITADO en',
      reabierto: 'Comentario REABIERTO en', eliminado: 'Comentario ELIMINADO en',
      respuesta: 'Respuesta en un comentario de'
    },
    mote: { nuevo: '', editado: '[editado] ', reabierto: '[reabierto] ',
            eliminado: '[ELIMINADO] ', respuesta: '[respuesta] ' },
    tarjeta: { nuevo: 'Comentario nuevo', respuesta: 'Respuesta',
               editado: 'Comentario editado', reabierto: 'Comentario reabierto' },
    cuenta: {
      nuevo: n => `${n} comentario${n > 1 ? 's' : ''}`,
      respuesta: n => `${n} respuesta${n > 1 ? 's' : ''}`,
      editado: n => `${n} editado${n > 1 ? 's' : ''}`,
      reabierto: n => `${n} reabierto${n > 1 ? 's' : ''}`
    },
    tandaLlena: '(tanda llena)',
    tandaLlenaCorta: 'tanda llena',
    franja: (a, b) => `${a} a ${b}`,
    novedades: (n, site) => `${n} novedades en ${site}`,
    paginas: n => `${n} páginas`,
    borrado: porSuAutor => 'Este comentario se ha <b>borrado</b> de la lista' +
      (porSuAutor ? ', y lo ha borrado <b>quien lo escribió</b>' : ' desde el equipo') +
      '. Esta copia es el único rastro que queda.<br>',
    pie: site => `Enviado desde el widget Feedtack, instalado en la web de ${site}. ` +
      'Responder a este correo NO llega al cliente.',
    pieTanda: (min, corte, site) => `Una tanda reúne lo que llega en ${min} minutos desde ` +
      `el primer aviso, o ${corte} avisos, lo que pase antes. Enviado desde el widget ` +
      `Feedtack instalado en la web de ${site}. Responder a este correo NO llega al cliente.`,
    desconocido: 'desconocido',
    en: 'en'
  },
  en: {
    locale: 'en-GB', html: 'en',
    pagina: 'Page', url: 'URL', enviadoPor: 'Sent by', pantalla: 'Screen',
    navegador: 'Browser', momento: 'When',
    ventanaMonitor: (v, p) => `${v} (window), ${p} (monitor)`,
    sinIdentificar: 'not identified',
    portada: 'Home',
    antesDecia: 'It used to say',
    vacio: '(empty)',
    senalados: n => (n > 1 ? `${n} elements pointed at` : 'Element pointed at'),
    desdeArriba: (w, h, y) => `${w}×${h} px, ${y} px from the top of the page`,
    sinTexto: 'No text, look at the attachments.',
    sinTextoTanda: 'No text, look at what was pointed at and at the attachments.',
    adjuntos: n => `${n} attachment${n > 1 ? 's' : ''}`,
    adjunto: 'attachment',
    noCabia: 'too big for the email, open it with the link',
    banda: {
      nuevo: 'New comment on', editado: 'Comment EDITED on',
      reabierto: 'Comment REOPENED on', eliminado: 'Comment DELETED on',
      respuesta: 'Reply to a comment on'
    },
    mote: { nuevo: '', editado: '[edited] ', reabierto: '[reopened] ',
            eliminado: '[DELETED] ', respuesta: '[reply] ' },
    tarjeta: { nuevo: 'New comment', respuesta: 'Reply',
               editado: 'Comment edited', reabierto: 'Comment reopened' },
    cuenta: {
      nuevo: n => `${n} comment${n > 1 ? 's' : ''}`,
      respuesta: n => `${n} repl${n > 1 ? 'ies' : 'y'}`,
      editado: n => `${n} edited`,
      reabierto: n => `${n} reopened`
    },
    tandaLlena: '(batch full)',
    tandaLlenaCorta: 'batch full',
    franja: (a, b) => `${a} to ${b}`,
    novedades: (n, site) => `${n} updates on ${site}`,
    paginas: n => `${n} pages`,
    borrado: porSuAutor => 'This comment has been <b>deleted</b> from the list' +
      (porSuAutor ? ', by <b>whoever wrote it</b>' : ', by the team') +
      '. This copy is the only trace left.<br>',
    pie: site => `Sent from the Feedtack widget installed on ${site}. ` +
      'Replying to this email does NOT reach the client.',
    pieTanda: (min, corte, site) => `A batch gathers whatever arrives within ${min} minutes ` +
      `of the first notification, or ${corte} notifications, whichever comes first. Sent from ` +
      `the Feedtack widget installed on ${site}. Replying to this email does NOT reach the client.`,
    desconocido: 'unknown',
    en: 'on'
  }
};

/* Resolved once per email, from the two places that build one (avisar and enviarTanda).
   It is configuration, constant for a deployment, so a module-level value is enough:
   there is no per-request state here to leak between isolates. */
let T = IDIOMAS.es;
let ZONA = 'Europe/Madrid';
function idiomaCorreo(env) {
  T = IDIOMAS[String(env.EMAIL_LANG || 'es').toLowerCase().slice(0, 2)] || IDIOMAS.es;
  ZONA = env.ZONA_HORARIA || 'Europe/Madrid';
}

// ────────────────────────────────────────────────────────────────── correo

const ICONO = { nuevo: '💬', editado: '✏️', reabierto: '🔁', eliminado: '🗑️', respuesta: '↩️' };
/* Los motes y las bandas viven ahora en IDIOMAS (T.mote, T.banda). */

async function avisar(env, datos) {
  idiomaCorreo(env);
  const resumen = `${T.mote[datos.tipo] || ''}${resumir(datos.mensaje, datos.senalados)}`;
  /* A deletion carries its own subject (and therefore its own thread) on purpose: it is
     the only trace of something that no longer exists. Everything else uses the site's
     fixed subject, so it lands in the same thread as the batches even when it went out
     through the emergency path. */
  const asunto = datos.tipo === 'eliminado'
    ? `🗑️ Feedtack · ${datos.site}: ${T.mote.eliminado}${resumir(datos.mensaje, datos.senalados)}`
    : `💬 Feedtack · ${datos.site}`;
  await mandar(env, {
    asunto,
    html: preheader(resumen) + plantilla(datos),
    adjuntos: datos.adjuntos || [],
    site: datos.site
  });
}

async function mandar(env, { asunto, html, adjuntos, site }) {
  // Sin configurar no se manda nada: nunca un destinatario por defecto.
  if (!env.RESEND_API_KEY || !env.DESTINO || !env.REMITENTE) {
    console.log('sin configurar: falta RESEND_API_KEY, DESTINO o REMITENTE');
    return;
  }

  /* Everything from one site hangs off the same made-up message, so Gmail collapses it
     into ONE thread per site instead of leaving 40 loose emails in the inbox. The id
     exists in no mailbox and does not need to: what groups them is that they all cite it.
     It carries a fingerprint of the RAW name because sanitising merges different things
     ("new site" and "new-site" would give the same id, and two sites would share a
     thread). */
  const crudo = String(site || 'sin-identificar');
  const raiz = `<feedtack.${crudo.replace(/[^\w.-]/g, '-')}.${huella(crudo)}@feedtack.dev>`;

  const r = await fetch(`${env.RESEND_URL || 'https://api.resend.com'}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env.REMITENTE,
      to: lista(env.DESTINO),
      subject: asunto,
      html,
      headers: { References: raiz, 'In-Reply-To': raiz },
      attachments: (adjuntos || []).map(a => ({
        filename: a.filename,
        content: a.content != null ? a.content : base64(a.datos),
        contentType: a.contentType
      }))
    })
  });
  if (!r.ok) {
    const cuerpo = await r.text();
    console.log('resend error', r.status, cuerpo);
    throw new Error(`resend ${r.status}: ${cuerpo.slice(0, 200)}`);
  }
}

// ──────────────────────────────────────────────────────────────── auxiliares

function cabecerasCors(origen, env) {
  const permitidos = lista(env.ORIGENES_PERMITIDOS);
  const base = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  const ok = permitidos.some(p => {
    if (p === '*') return true;
    if (p.startsWith('*.')) {
      try { return new URL(origen).hostname.endsWith(p.slice(1)); } catch { return false; }
    }
    return p === origen;
  });
  if (ok && origen) base['Access-Control-Allow-Origin'] = origen;
  else if (permitidos.includes('*')) base['Access-Control-Allow-Origin'] = '*';
  return base;
}

const lista = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);

/* Constant-time comparison, so the key does not leak one character at a time. */
function esAdmin(clave, env) {
  const a = String(clave == null ? '' : clave);
  const b = String(env.CLAVE_ADMIN || '');
  if (!b || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}
const texto = (v, max) => (v == null ? '' : String(v)).slice(0, max);

function json(cuerpo, estado, cors) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json', ...cors }
  });
}

function parsear(v) {
  if (!v) return null;
  try { return JSON.parse(v.toString()); } catch { return null; }
}

function base64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return btoa(bin);
}

const nombreSeguro = n => String(n).replace(/[^\w.\- ]+/g, '_').slice(0, 100) || 'adjunto';

function resumir(mensaje, senalados = []) {
  const t = (mensaje || '').replace(/\s+/g, ' ').trim();
  if (t) return t.slice(0, 60) + (t.length > 60 ? '…' : '');
  if (senalados.length > 1) return `comentario sobre ${senalados.length} elementos`;
  if (senalados.length) return 'comentario sobre ' + (senalados[0].texto || senalados[0].etiqueta || 'un elemento');
  return 'nuevo comentario';
}

/* Todo lo que viene de fuera es DATO, nunca markup. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function plantilla({ site, mensaje, anterior, autor, contexto, senalados = [], adjuntos = [], tipo, porSuAutor }) {
  const c = contexto || {};
  const filas = [
    [T.pagina, c.titulo],
    [T.url, c.url],
    [T.enviadoPor, autor || T.sinIdentificar],
    [T.pantalla, c.viewport ? T.ventanaMonitor(c.viewport, c.pantalla) : ''],
    [T.navegador, navegadorLegible(c.navegador)],
    [T.momento, c.momento ? new Date(c.momento).toLocaleString(T.locale, { timeZone: ZONA }) : '']
  ].filter(([, v]) => v);

  const COLOR = { nuevo: '#0f172a', editado: '#78350f', reabierto: '#7f1d1d',
                  eliminado: '#450a0a', respuesta: '#1e293b' };
  const banda = [COLOR[tipo] || '#0f172a', T.banda[tipo] || T.banda.nuevo];

  const bloqueAnterior = anterior != null ? `
    <div style="margin:0 0 18px;padding:12px 14px;background:#fef3c7;border-radius:8px">
      <div style="font:600 11.5px/1.4 -apple-system,sans-serif;color:#92400e;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">${T.antesDecia}</div>
      <div style="font:400 14px/1.55 -apple-system,sans-serif;color:#78350f;text-decoration:line-through;white-space:pre-wrap">${esc(anterior) || T.vacio}</div>
    </div>` : '';

  const bloqueSenalado = senalados.length ? `
    <div style="margin:0 0 20px;padding:14px 16px;background:#eef2ff;border-left:3px solid #4f46e5;border-radius:0 8px 8px 0">
      <div style="font:600 12px/1.4 -apple-system,sans-serif;color:#4338ca;text-transform:uppercase;letter-spacing:.04em;margin-bottom:10px">${T.senalados(senalados.length)}</div>
      ${senalados.map((s, i) => `
      <div style="${i ? 'margin-top:14px;padding-top:14px;border-top:1px solid #dfe3fb' : ''}">
        ${senalados.length > 1 ? `<div style="font:600 12px/1.4 -apple-system,sans-serif;color:#6366f1;margin-bottom:4px">${i + 1}</div>` : ''}
        ${s.texto ? `<div style="font:400 14px/1.5 -apple-system,sans-serif;color:#1e1b4b;margin-bottom:6px">"${esc(s.texto)}"</div>` : ''}
        <code style="display:block;font:400 12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#4338ca;word-break:break-all">${esc(s.selector)}</code>
        ${s.rect ? `<div style="font:400 12px/1.5 -apple-system,sans-serif;color:#6366f1;margin-top:6px">${T.desdeArriba(s.rect.w, s.rect.h, s.rect.y)}</div>` : ''}
      </div>`).join('')}
    </div>` : '';

  const bloqueAdjuntos = adjuntos.length ? `
    <div style="margin:20px 0 0;padding-top:16px;border-top:1px solid #e2e8f0">
      <div style="font:600 12px/1.4 -apple-system,sans-serif;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">${T.adjuntos(adjuntos.length)}</div>
      ${adjuntos.map(lineaAdjunto).join('')}
    </div>` : '';

  return `<!doctype html><html lang="${T.html}"><body style="margin:0;padding:24px;background:#f1f5f9">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.1)">
    <div style="padding:20px 24px;background:${banda[0]}">
      <div style="font:600 16px/1.4 -apple-system,sans-serif;color:#fff">${banda[1]} ${esc(site)}</div>
      <div style="font:400 13px/1.5 -apple-system,sans-serif;color:#94a3b8;margin-top:2px">${esc(c.ruta === '/' ? T.portada : (c.ruta || ''))}</div>
    </div>
    <div style="padding:24px">
      ${bloqueAnterior}
      ${mensaje ? `<div style="font:400 15px/1.65 -apple-system,sans-serif;color:#0f172a;white-space:pre-wrap;margin-bottom:20px">${esc(mensaje)}</div>` : `<div style="font:400 14px/1.6 -apple-system,sans-serif;color:#94a3b8;font-style:italic;margin-bottom:20px">${T.sinTexto}</div>`}
      ${bloqueSenalado}
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
        ${filas.map(([k, v]) => `
        <tr>
          <td style="padding:7px 12px 7px 0;font:600 12px/1.5 -apple-system,sans-serif;color:#64748b;white-space:nowrap;vertical-align:top;width:110px">${esc(k)}</td>
          <td style="padding:7px 0;font:400 13px/1.5 -apple-system,sans-serif;color:#334155;word-break:break-word">${k === 'URL' ? `<a href="${esc(v)}" style="color:#4f46e5;text-decoration:none">${esc(v)}</a>` : esc(v)}</td>
        </tr>`).join('')}
      </table>
      ${bloqueAdjuntos}
    </div>
    <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font:400 12px/1.5 -apple-system,sans-serif;color:#94a3b8">
      ${tipo === 'eliminado' ? T.borrado(porSuAutor) : ''}${T.pie(esc(site))}
    </div>
  </div>
</body></html>`;
}

/* One attachment line. It serves both paths: the immediate one (which only knows the
   name) and the batch one (which also knows whether it rides inside the email or is
   linked). An attachment that does NOT ride is SAID SO, with its size: otherwise it looks
   as if there was no screenshot at all. */
function lineaAdjunto(a) {
  const nombre = esc(a.nombre || a.filename || T.adjunto);
  const mb = a.bytes ? ` (${(a.bytes / 1048576).toFixed(1)} MB)` : '';
  const cuerpo = a.enlace
    ? `<a href="${esc(a.enlace)}" style="color:#4f46e5;text-decoration:none">${nombre}</a>${mb}`
    : `${nombre}${mb}`;
  const nota = a.enlace && a.adjuntado === false
    ? ` <span style="color:#b45309">${T.noCabia}</span>`
    : '';
  return `<div style="font:400 13px/1.7 -apple-system,sans-serif;color:#475569">📎 ${cuerpo}${nota}</div>`;
}

/* The batch email: one card per event, in order, and at the top what you need to know
   without opening anything (how many things and from which pages). When a batch carries a
   SINGLE event this template is not used, the usual one is: a summary of one thing is
   worse than the thing. */
function plantillaTanda(site, eventos, motivo) {
  const rutas = [...new Set(eventos.map(e => (e.contexto || {}).ruta || '/'))];
  const desde = new Date(eventos[0].creado);
  const hasta = new Date(eventos[eventos.length - 1].creado);
  const hora = d => d.toLocaleTimeString(T.locale, { timeZone: ZONA, hour: '2-digit', minute: '2-digit' });
  const franja = T.franja(hora(desde), hora(hasta));

  const tarjetas = eventos.map((e, i) => {
    const c = e.contexto || {};
    const cabecera = `${ICONO[e.tipo] || '💬'} ${T.tarjeta[e.tipo] || e.tipo}`;
    const senal = (e.senalados || []).map(s => `
        <div style="margin-top:8px">
          ${s.texto ? `<div style="font:400 13px/1.5 -apple-system,sans-serif;color:#1e1b4b">"${esc(s.texto)}"</div>` : ''}
          <code style="display:block;font:400 11.5px/1.5 ui-monospace,Menlo,monospace;color:#4338ca;word-break:break-all">${esc(s.selector)}</code>
        </div>`).join('');
    return `
      <div style="${i ? 'margin-top:14px;' : ''}border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
        <div style="padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0">
          <div style="font:600 12.5px/1.4 -apple-system,sans-serif;color:#334155">${cabecera}
            <span style="font-weight:400;color:#94a3b8"> · ${esc(e.autor || T.sinIdentificar)} · ${hora(new Date(e.creado))}</span>
          </div>
          <div style="font:400 12px/1.5 -apple-system,sans-serif;color:#64748b;margin-top:2px">${esc(c.titulo || '')}${c.url ? ` · <a href="${esc(c.url)}" style="color:#4f46e5;text-decoration:none">${esc(c.ruta === '/' ? T.portada : (c.ruta || ''))}</a>` : ''}</div>
        </div>
        <div style="padding:14px">
          ${e.anterior != null && e.tipo === 'editado' ? `<div style="font:400 13px/1.5 -apple-system,sans-serif;color:#92400e;text-decoration:line-through;margin-bottom:8px">${esc(e.anterior) || T.vacio}</div>` : ''}
          ${e.mensaje ? `<div style="font:400 14.5px/1.6 -apple-system,sans-serif;color:#0f172a;white-space:pre-wrap">${esc(e.mensaje)}</div>` : `<div style="font:400 13.5px/1.6 -apple-system,sans-serif;color:#94a3b8;font-style:italic">${T.sinTextoTanda}</div>`}
          ${senal}
          ${(e.adjuntos || []).length ? `<div style="margin-top:10px">${e.adjuntos.map(lineaAdjunto).join('')}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  return `<!doctype html><html lang="${T.html}"><body style="margin:0;padding:24px;background:#f1f5f9">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.1)">
    <div style="padding:20px 24px;background:#0f172a">
      <div style="font:600 16px/1.4 -apple-system,sans-serif;color:#fff">${T.novedades(eventos.length, esc(site))}</div>
      <div style="font:400 13px/1.5 -apple-system,sans-serif;color:#94a3b8;margin-top:2px">${franja} · ${rutas.length === 1 ? esc(rutas[0] === '/' ? T.portada : rutas[0]) : T.paginas(rutas.length)}${motivo === 'corte' ? ` · ${T.tandaLlenaCorta}` : ''}</div>
    </div>
    <div style="padding:20px 24px">${tarjetas}</div>
    <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font:400 12px/1.5 -apple-system,sans-serif;color:#94a3b8">
      ${T.pieTanda(VENTANA_MINUTOS, CORTE_COMENTARIOS, esc(site))}
    </div>
  </div>
</body></html>`;
}

function navegadorLegible(ua) {
  if (!ua) return '';
  const m = [
    [/Edg\/([\d.]+)/, 'Edge'], [/OPR\/([\d.]+)/, 'Opera'],
    [/Chrome\/([\d.]+)/, 'Chrome'], [/Version\/([\d.]+).*Safari/, 'Safari'],
    [/Firefox\/([\d.]+)/, 'Firefox']
  ];
  let nav = T.desconocido;
  for (const [re, nombre] of m) {
    const r = ua.match(re);
    if (r) { nav = `${nombre} ${r[1].split('.')[0]}`; break; }
  }
  const so = /iPhone|iPad/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux' : '';
  return so ? `${nav} ${T.en} ${so}` : nav;
}
