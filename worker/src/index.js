/**
 * Feedtack — backend del widget de feedback (Cloudflare Worker + D1)
 *
 *   POST   /api/feedback            crear comentario (multipart) → guarda y avisa por correo
 *   GET    /api/comentarios?site=X  listar los de una web
 *   PATCH  /api/comentarios/:id     editar el texto (solo su autor)
 *   POST   /api/comentarios/:id/estado   resolver / confirmar / reabrir / cerrar
 *   DELETE /api/comentarios/:id     eliminar (SOLO con clave de administración)
 *   GET    /adjuntos/<clave>        una captura guardada en R2 (clave irrepetible)
 *   GET    /salud
 *
 * Estados: abierto → resuelto (el equipo) → confirmado | reabierto (el cliente)
 * El equipo, con clave, puede además cerrar directamente (notas internas y
 * recordatorios que no necesitan que nadie confirme nada).
 *
 * Secrets: RESEND_API_KEY, CLAVE_ADMIN, TANDAS (ponerla a "no" apaga la agrupación)
 * Vars:    DESTINO, REMITENTE, ORIGENES_PERMITIDOS, SITIOS (opcional),
 *          VENTANA_MINUTOS, CORTE_COMENTARIOS, BASE_PUBLICA
 * Bindings: DB (D1), ADJUNTOS (R2), TANDAS_DO (Durable Object)
 */

import { DurableObject } from 'cloudflare:workers';

const MAX_TOTAL = 22 * 1024 * 1024;
const ESTADOS = ['abierto', 'resuelto', 'confirmado', 'reabierto'];

/* Agrupación de avisos (8-sep-2026). El primer evento de una web abre la ventana y al
   cerrarse sale UN correo con todo lo de dentro. Se cuenta desde el PRIMERO, no desde
   el último: si no, una conversación seguida retrasa el aviso indefinidamente. */
const VENTANA_MINUTOS = 10;
const CORTE_COMENTARIOS = 10;

/* Resend topa en 40 MB por correo y un solo comentario admite 22, así que en el correo
   van las capturas mientras quepan en este presupuesto y el resto va enlazado a R2.
   Se cuentan bytes EN CRUDO y el correo viaja en base64, que abulta un tercio más: 15 MB
   de capturas son unos 20 MB de petición. De ahí el margen; subirlo mucho lo agota. */
const PRESUPUESTO_ADJUNTOS = 15 * 1024 * 1024;

/* A partir de aquí un aviso se manda sin sus adjuntos: un fichero que Resend rechaza no
   puede quedarse bloqueando la cola de una web entera. */
const INTENTOS_SIN_ADJUNTOS = 5;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origen = request.headers.get('Origin') || '';
    const cors = cabecerasCors(origen, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/salud') return await salud(env, cors);

    /* Las capturas se abren desde el correo, o sea desde un cliente de correo que no manda
       Origin: esta ruta va ANTES del filtro de CORS a propósito, como /salud. Lo que la
       protege es que la clave lleva 32 caracteres al azar y no hay forma de listar el
       bucket; no es autenticación y está dicho en la ficha. */
    const adj = url.pathname.match(/^\/adjuntos\/(.+)$/);
    if (adj && (request.method === 'GET' || request.method === 'HEAD')) {
      let clave;
      // Un %AA a medias hace lanzar a decodeURIComponent, y esta ruta no pasa por el
      // filtro de CORS: sin esto, cualquiera saca un 500 de aquí con una URL torcida.
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

  /* El comentario ya está guardado: a partir de aquí ningún fallo del aviso puede
     devolver error, porque el widget lo leería como "no se ha enviado" y la persona
     volvería a escribirlo. Antes esta llamada iba sin red y un fallo de Resend acababa
     en un 500 sobre un comentario guardado. */
  await encolar(env, {
    tipo: 'nuevo',
    site, mensaje, autor, contexto, senalados, adjuntos, id
  });

  return json({ ok: true, id }, 200, cors);
}

// ────────────────────────────────────────────────────────────── responder

/* Una respuesta dentro de un comentario. Admite lo mismo que un comentario (texto,
   adjuntos y señalar una zona) porque a mitad de una conversacion hace falta poder
   decir "me refiero a ESTO". Lo que NO hace es crear un marcador nuevo en la pagina:
   la conversacion entera cuelga del comentario original y se lee dentro de el. */
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

  // Solo el autor edita lo suyo. Es una web de revisión privada, no autenticación fuerte.
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

  // Avisamos de la edición para que no trabajemos sobre la versión vieja
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

/* Borrar es la única acción sin vuelta atrás, así que la reservamos al equipo
   y mandamos copia por correo: si alguien borra algo por error, queda el rastro. */
async function eliminar(id, request, env, cors) {
  const cuerpo = await request.json().catch(() => ({}));

  const fila = await env.DB.prepare('SELECT * FROM comentarios WHERE id = ?').bind(id).first();
  if (!fila) return json({ error: 'no existe' }, 404, cors);

  /* Borra el equipo (con clave) o el AUTOR lo suyo. Lo segundo se apoya en el mismo
     id anónimo de navegador con el que ya se edita lo propio: quien escribió algo por
     error tiene que poder quitarlo sin pedírnoslo. No es autenticación y no pretende
     serlo (está escrito en la ficha de la herramienta); es una herramienta de revisión
     entre gente que se conoce, sobre un entorno que no es público. Se avisa por correo
     en los dos casos, que es el único rastro que queda. */
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

/* Los adjuntos se recogen UNA vez y en crudo (ArrayBuffer). Antes se pasaban a base64
   aquí mismo, que era gastar un 33% de memoria por un formato que solo necesita el
   correo: a R2 van tal cual. */
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

/* Un aviso agrupable: se guarda en la cola, sus adjuntos van a R2, y se le dice al
   Durable Object de ESA web que abra (o cuente en) su ventana.
   Tres cosas que decide esta función y no otra:
   1. El correo de ELIMINADO no espera nunca: es el único rastro que queda de algo que
      ya no está, así que se manda en el acto con su copia dentro.
   2. Si falta cualquier pieza (R2, el DO, o la agrupación está apagada), se cae al
      camino de antes: un correo inmediato con los adjuntos. Diferir es una mejora de
      ruido; perder un aviso no es aceptable a cambio.
   3. Nunca lanza. Quien la llama ya ha guardado el comentario. */
async function encolar(env, datos) {
  const conAdjuntos = (datos.adjuntos || []).length > 0;

  /* Cuatro motivos para no diferir, y el cuarto es el que casi se cuela: sin URL pública
     configurada, un adjunto que no cabe en el correo no se puede enlazar, así que
     diferirlo lo haría desaparecer sin decir nada (queda en R2 y nadie lo alcanza).
     Fallar cerrado aquí = seguir haciendo lo de antes, que funciona. */
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
    /* 🔒 Antes de mandarlo a mano hay que SACARLO de la cola. Si se queda ahí, la tanda
       siguiente lo arrastra y el mismo aviso sale dos veces. Y si el DELETE no borra
       nada es que ya lo mandó la tanda (o lo tiene en vuelo): entonces aquí no se manda
       nada, porque eso sería el duplicado que se intenta evitar. */
    if (filaId) {
      const borrado = await seguro(() => env.DB.prepare(
        'DELETE FROM avisos_pendientes WHERE id = ? AND enviado IS NULL AND reclamo IS NULL'
      ).bind(filaId).run(), 'sacar de la cola');
      if (borrado && borrado.meta && borrado.meta.changes === 0) return;
    }
    await seguro(() => avisar(env, datos), 'aviso inmediato tras fallo de cola');
  }
}

/* Envuelve algo que no debe poder tumbar la petición: el comentario del cliente ya está
   guardado y un fallo del aviso no puede devolverle un error (volvería a escribirlo). */
async function seguro(fn, qué) {
  try { return await fn(); }
  catch (e) { console.error(`feedtack: fallo en ${qué}:`, e && e.message); return null; }
}

/* /salud dice si la agrupación está DE VERDAD en pie. Existe por un modo de fallo mudo:
   si el esquema no se ha aplicado, cada encolar revienta, cae al aviso inmediato, y todo
   parece funcionar igual que siempre (un correo por evento) sin que nada avise de que la
   agrupación nunca se activó. Aquí eso se ve, y una cola con avisos viejos también. */
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
    /* No es "ok": la agrupación está configurada y no puede funcionar. */
    return json({
      ok: false, servicio: 'feedtack', tandas: 'configuradas pero SIN TABLA',
      cola: 'falta avisos_pendientes: aplica worker/esquema.sql', detalle: String(e && e.message)
    }, 500, cors);
  }
}

async function servirAdjunto(clave, env, metodo) {
  /* Se exige la forma completa de la clave (web / fecha / 32 al azar / nombre). Sin esto
     una clave a medias sería una invitación a probar prefijos, y aunque R2 no sirve
     prefijos, el que mira los logs no distinguiría un tanteo de una descarga normal. */
  if (!env.ADJUNTOS || !/^[\w.-]+\/\d{8}\/[0-9a-f]{32}\/.+$/.test(clave)) {
    return new Response('no encontrado', { status: 404 });
  }
  const obj = await env.ADJUNTOS.get(clave);
  if (!obj) return new Response('no encontrado', { status: 404 });

  const cabeceras = new Headers();
  obj.writeHttpMetadata(cabeceras);
  const tipo = cabeceras.get('Content-Type') || 'application/octet-stream';

  /* 🔒 El fichero lo ha subido el cliente y el tipo lo eligió su navegador, así que aquí
     se sirve como sospechoso: solo las imágenes de verdad se abren en el navegador, y
     todo lo demás se descarga. Un SVG (o un HTML disfrazado) servido `inline` ejecutaría
     su propio script en el dominio del worker. `nosniff` cierra la otra mitad: sin él,
     el navegador puede decidir por su cuenta que un PNG es HTML. */
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

/* Una instancia por web (`idFromName(site)`), así que dos webs no se mezclan nunca en el
   mismo correo y el reloj de una no arrastra a la otra. Es de un solo hilo por instancia:
   dos comentarios simultáneos no pueden abrir dos ventanas ni mandar dos correos. */
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
    /* La ventana se abre con el PRIMERO y no se toca después: si cada evento la
       reiniciara, una conversación seguida aplazaría el correo sin final. */
    if ((await this.ctx.storage.getAlarm()) == null) {
      const minutos = Number(this.env.VENTANA_MINUTOS || VENTANA_MINUTOS);
      await this.ctx.storage.setAlarm(Date.now() + Math.max(1000, minutos * 60000));
    }
  }

  async alarm() {
    await this.enviar('ventana');
  }

  /* Una sola tanda en vuelo. Un `await` que no sea del almacén del Durable Object (D1,
     R2, Resend) NO impide que le entren eventos nuevos, así que sin este cerrojo el
     corte por número reentra mientras se sube a Resend. El cerrojo en memoria evita el
     trabajo repetido; lo que de verdad garantiza que no salga dos veces es la reserva
     en la base, porque la instancia puede reiniciarse y perder esta variable. */
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

    /* RESERVA atómica: un solo UPDATE se lleva las filas y devuelve las que se ha
       llevado. Quien no se las lleve no ve nada y no manda nada. Se recogen también las
       reservas muertas (más de 15 minutos), que es como se recupera un envío que se
       quedó a medias porque el worker se murió. */
    let pendientes = [];
    try {
      const { results } = await this.env.DB.prepare(
        `UPDATE avisos_pendientes SET reclamo = ?, reclamado = ?
         WHERE site = ? AND enviado IS NULL AND (reclamo IS NULL OR reclamado < ?)
         RETURNING id, tipo, comentario, payload, adjuntos, creado, intentos`
      ).bind(reclamo, ahora.toISOString(), site, muerta).all();
      pendientes = (results || []).sort((a, b) => (a.creado < b.creado ? -1 : 1));
    } catch (e) {
      /* Si la base no contesta, la ventana NO se puede quedar cerrada sobre avisos que
         nadie ha mandado: se vuelve a intentar. Es el fallo que deja el buzón mudo. */
      console.error('feedtack: no se pudo reservar la tanda de', site, e && e.message);
      await this.ctx.storage.setAlarm(Date.now() + 2 * 60000);
      return;
    }

    if (!pendientes.length) return;

    try {
      await enviarTanda(this.env, site, pendientes, motivo);
    } catch (e) {
      /* Un fallo de Resend no pierde nada: se suelta la reserva, se cuenta el intento y
         se vuelve a probar en dos minutos. A partir del quinto la tanda sale SIN
         adjuntos, que es el motivo más probable de que Resend diga que no, así que al
         menos el texto llega. Y a partir del décimo se deja de insistir: las filas se
         quedan pendientes (las arrastra el evento siguiente) y salen en /salud como
         cola vieja, en vez de reintentar en bucle para siempre. */
      console.error('feedtack: la tanda de', site, 'no salio', e && e.message);
      await seguro(() => this.env.DB.prepare(
        'UPDATE avisos_pendientes SET reclamo = NULL, reclamado = NULL, intentos = intentos + 1 WHERE reclamo = ?'
      ).bind(reclamo).run(), 'soltar la reserva');
      const insistidos = Math.max(...pendientes.map(p => p.intentos || 0)) + 1;
      if (insistidos < 10) await this.ctx.storage.setAlarm(Date.now() + 2 * 60000);
      else console.error('feedtack: la cola de', site, 'lleva', insistidos, 'intentos, se deja de insistir');
      return;
    }

    /* Ya está enviado. Si este UPDATE falla, las filas se quedan reservadas y NO se
       vuelven a mandar hasta que la reserva caduque: es la dirección correcta del error
       (mejor un aviso repetido dentro de 15 minutos que uno perdido). */
    await seguro(() => this.env.DB.prepare(
      'UPDATE avisos_pendientes SET enviado = ? WHERE reclamo = ?'
    ).bind(ahora.toISOString(), reclamo).run(), 'marcar la tanda como enviada');
  }
}

/* Construye y manda el correo de una tanda. Los adjuntos se bajan de R2 y entran en el
   correo mientras quepan en el presupuesto; los que no caben van enlazados, que es lo
   mismo que hacía falta para los que ya venían de un intento fallido. */
async function enviarTanda(env, site, pendientes, motivo) {
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

/* 🔴 El asunto de una tanda es FIJO por web, y esto se midió contra Gmail real el 8-sep:
   con References e In-Reply-To idénticos pero el asunto cambiando ("3 comentarios" /
   "2 comentarios"), Gmail abrió DOS hilos. Las cabeceras no bastan: Gmail exige además
   que el asunto sea el mismo (solo perdona los "Re:"). Así que lo que varía se va al
   cuerpo, y lo que hace de titular es la línea de vista previa (el preheader), que Gmail
   sí muestra al lado del asunto en la lista.
   El de ELIMINADO se queda con asunto propio a propósito: es el único rastro de algo que
   ya no está y no puede quedar enterrado dentro de un hilo de cuarenta correos. */
function asuntoTanda(site) {
  return `💬 Feedtack · ${site}`;
}

/* El titular de verdad: lo que Gmail pinta detrás del asunto en la lista. */
function resumenTanda(eventos, motivo) {
  if (eventos.length === 1) {
    const e = eventos[0];
    return `${MOTE[e.tipo] || ''}${resumir(e.mensaje, e.senalados)}`;
  }
  const cuenta = {};
  eventos.forEach(e => { cuenta[e.tipo] = (cuenta[e.tipo] || 0) + 1; });
  const partes = [
    cuenta.nuevo ? `${cuenta.nuevo} comentario${cuenta.nuevo > 1 ? 's' : ''}` : '',
    cuenta.respuesta ? `${cuenta.respuesta} respuesta${cuenta.respuesta > 1 ? 's' : ''}` : '',
    cuenta.editado ? `${cuenta.editado} editado${cuenta.editado > 1 ? 's' : ''}` : '',
    cuenta.reabierto ? `${cuenta.reabierto} reabierto${cuenta.reabierto > 1 ? 's' : ''}` : ''
  ].filter(Boolean).join(', ');
  const lleno = motivo === 'corte' ? ' (tanda llena)' : '';
  return `${partes}${lleno}: "${resumir(eventos[0].mensaje, eventos[0].senalados)}"`;
}

/* Bloque invisible que Gmail usa como línea de vista previa. Va antes de todo. */
function preheader(texto) {
  return `<div style="display:none;font-size:1px;color:#f1f5f9;max-height:0;overflow:hidden">${esc(texto)}</div>`;
}

// ────────────────────────────────────────────────────────────────── correo

const ICONO = { nuevo: '💬', editado: '✏️', reabierto: '🔁', eliminado: '🗑️', respuesta: '↩️' };
const MOTE = { nuevo: '', editado: '[editado] ', reabierto: '[reabierto] ', eliminado: '[ELIMINADO] ', respuesta: '[respuesta] ' };

async function avisar(env, datos) {
  const resumen = `${MOTE[datos.tipo] || ''}${resumir(datos.mensaje, datos.senalados)}`;
  /* El borrado lleva asunto propio (y por tanto su propio hilo) a propósito: es el único
     rastro de algo que ya no existe. Lo demás usa el asunto fijo de la web, para que caiga
     en el mismo hilo que las tandas aunque haya salido por el camino de emergencia. */
  const asunto = datos.tipo === 'eliminado'
    ? `🗑️ Feedtack · ${datos.site}: [ELIMINADO] ${resumir(datos.mensaje, datos.senalados)}`
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

  /* Todo lo de una web cuelga del mismo mensaje inventado, así que Gmail lo colapsa en
     UN hilo por web en vez de dejar 40 correos sueltos en la bandeja. El id no existe en
     ningún buzón y no hace falta que exista: lo que agrupa es que todos lo citen.
     Lleva pegada una huella del nombre CRUDO porque el saneado junta cosas distintas
     ("web nueva" y "web-nueva" darían el mismo id, y dos webs compartirían hilo). */
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

/* Comparación en tiempo constante para no filtrar la clave carácter a carácter. */
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
    ['Página', c.titulo],
    ['URL', c.url],
    ['Enviado por', autor || 'sin identificar'],
    ['Pantalla', c.viewport ? `${c.viewport} (ventana), ${c.pantalla} (monitor)` : ''],
    ['Navegador', navegadorLegible(c.navegador)],
    ['Momento', c.momento ? new Date(c.momento).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }) : '']
  ].filter(([, v]) => v);

  const banda = {
    nuevo: ['#0f172a', 'Nuevo comentario en'],
    editado: ['#78350f', 'Comentario EDITADO en'],
    reabierto: ['#7f1d1d', 'Comentario REABIERTO en'],
    eliminado: ['#450a0a', 'Comentario ELIMINADO en'],
    respuesta: ['#1e293b', 'Respuesta en un comentario de']
  }[tipo] || ['#0f172a', 'Nuevo comentario en'];

  const bloqueAnterior = anterior != null ? `
    <div style="margin:0 0 18px;padding:12px 14px;background:#fef3c7;border-radius:8px">
      <div style="font:600 11.5px/1.4 -apple-system,sans-serif;color:#92400e;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Antes decía</div>
      <div style="font:400 14px/1.55 -apple-system,sans-serif;color:#78350f;text-decoration:line-through;white-space:pre-wrap">${esc(anterior) || '(vacío)'}</div>
    </div>` : '';

  const bloqueSenalado = senalados.length ? `
    <div style="margin:0 0 20px;padding:14px 16px;background:#eef2ff;border-left:3px solid #4f46e5;border-radius:0 8px 8px 0">
      <div style="font:600 12px/1.4 -apple-system,sans-serif;color:#4338ca;text-transform:uppercase;letter-spacing:.04em;margin-bottom:10px">${senalados.length > 1 ? senalados.length + ' elementos señalados' : 'Elemento señalado'}</div>
      ${senalados.map((s, i) => `
      <div style="${i ? 'margin-top:14px;padding-top:14px;border-top:1px solid #dfe3fb' : ''}">
        ${senalados.length > 1 ? `<div style="font:600 12px/1.4 -apple-system,sans-serif;color:#6366f1;margin-bottom:4px">${i + 1}</div>` : ''}
        ${s.texto ? `<div style="font:400 14px/1.5 -apple-system,sans-serif;color:#1e1b4b;margin-bottom:6px">"${esc(s.texto)}"</div>` : ''}
        <code style="display:block;font:400 12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#4338ca;word-break:break-all">${esc(s.selector)}</code>
        ${s.rect ? `<div style="font:400 12px/1.5 -apple-system,sans-serif;color:#6366f1;margin-top:6px">${s.rect.w}×${s.rect.h} px, a ${s.rect.y} px del principio de la página</div>` : ''}
      </div>`).join('')}
    </div>` : '';

  const bloqueAdjuntos = adjuntos.length ? `
    <div style="margin:20px 0 0;padding-top:16px;border-top:1px solid #e2e8f0">
      <div style="font:600 12px/1.4 -apple-system,sans-serif;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">${adjuntos.length} adjunto${adjuntos.length > 1 ? 's' : ''}</div>
      ${adjuntos.map(lineaAdjunto).join('')}
    </div>` : '';

  return `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f1f5f9">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.1)">
    <div style="padding:20px 24px;background:${banda[0]}">
      <div style="font:600 16px/1.4 -apple-system,sans-serif;color:#fff">${banda[1]} ${esc(site)}</div>
      <div style="font:400 13px/1.5 -apple-system,sans-serif;color:#94a3b8;margin-top:2px">${esc(c.ruta === '/' ? 'Portada' : (c.ruta || ''))}</div>
    </div>
    <div style="padding:24px">
      ${bloqueAnterior}
      ${mensaje ? `<div style="font:400 15px/1.65 -apple-system,sans-serif;color:#0f172a;white-space:pre-wrap;margin-bottom:20px">${esc(mensaje)}</div>` : '<div style="font:400 14px/1.6 -apple-system,sans-serif;color:#94a3b8;font-style:italic;margin-bottom:20px">Sin texto, mira los adjuntos.</div>'}
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
      ${tipo === 'eliminado' ? 'Este comentario se ha <b>borrado</b> de la lista' + (porSuAutor ? ', y lo ha borrado <b>quien lo escribió</b>' : ' desde el equipo') + '. Esta copia es el único rastro que queda.<br>' : ''}Enviado desde el widget Feedtack, instalado en la web de ${esc(site)}. Responder a este correo NO llega al cliente.
    </div>
  </div>
</body></html>`;
}

/* Una línea de adjunto. Sirve para los dos caminos: el inmediato (que solo sabe el
   nombre) y el de tanda (que además sabe si viaja dentro del correo o enlazado). Un
   adjunto que NO viaja se DICE, con su tamaño: si no, parece que no había captura. */
function lineaAdjunto(a) {
  const nombre = esc(a.nombre || a.filename || 'adjunto');
  const mb = a.bytes ? ` (${(a.bytes / 1048576).toFixed(1)} MB)` : '';
  const cuerpo = a.enlace
    ? `<a href="${esc(a.enlace)}" style="color:#4f46e5;text-decoration:none">${nombre}</a>${mb}`
    : `${nombre}${mb}`;
  const nota = a.enlace && a.adjuntado === false
    ? ' <span style="color:#b45309">no cabía en el correo, se abre con el enlace</span>'
    : '';
  return `<div style="font:400 13px/1.7 -apple-system,sans-serif;color:#475569">📎 ${cuerpo}${nota}</div>`;
}

/* El correo de una tanda: una tarjeta por evento, en orden, y arriba lo que hay que
   saber sin abrir nada (cuántas cosas y de qué páginas). Cuando la tanda trae UN solo
   evento no se usa esta plantilla, se usa la de siempre: un resumen de una cosa es peor
   que la cosa. */
function plantillaTanda(site, eventos, motivo) {
  const rutas = [...new Set(eventos.map(e => (e.contexto || {}).ruta || '/'))];
  const desde = new Date(eventos[0].creado);
  const hasta = new Date(eventos[eventos.length - 1].creado);
  const franja = `${desde.toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })} a ${hasta.toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })}`;

  const tarjetas = eventos.map((e, i) => {
    const c = e.contexto || {};
    const cabecera = `${ICONO[e.tipo] || '💬'} ${{ nuevo: 'Comentario nuevo', respuesta: 'Respuesta', editado: 'Comentario editado', reabierto: 'Comentario reabierto' }[e.tipo] || e.tipo}`;
    const senal = (e.senalados || []).map(s => `
        <div style="margin-top:8px">
          ${s.texto ? `<div style="font:400 13px/1.5 -apple-system,sans-serif;color:#1e1b4b">"${esc(s.texto)}"</div>` : ''}
          <code style="display:block;font:400 11.5px/1.5 ui-monospace,Menlo,monospace;color:#4338ca;word-break:break-all">${esc(s.selector)}</code>
        </div>`).join('');
    return `
      <div style="${i ? 'margin-top:14px;' : ''}border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
        <div style="padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0">
          <div style="font:600 12.5px/1.4 -apple-system,sans-serif;color:#334155">${cabecera}
            <span style="font-weight:400;color:#94a3b8"> · ${esc(e.autor || 'sin identificar')} · ${new Date(e.creado).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div style="font:400 12px/1.5 -apple-system,sans-serif;color:#64748b;margin-top:2px">${esc(c.titulo || '')}${c.url ? ` · <a href="${esc(c.url)}" style="color:#4f46e5;text-decoration:none">${esc(c.ruta === '/' ? 'Portada' : (c.ruta || ''))}</a>` : ''}</div>
        </div>
        <div style="padding:14px">
          ${e.anterior != null && e.tipo === 'editado' ? `<div style="font:400 13px/1.5 -apple-system,sans-serif;color:#92400e;text-decoration:line-through;margin-bottom:8px">${esc(e.anterior) || '(vacío)'}</div>` : ''}
          ${e.mensaje ? `<div style="font:400 14.5px/1.6 -apple-system,sans-serif;color:#0f172a;white-space:pre-wrap">${esc(e.mensaje)}</div>` : '<div style="font:400 13.5px/1.6 -apple-system,sans-serif;color:#94a3b8;font-style:italic">Sin texto, mira lo señalado y los adjuntos.</div>'}
          ${senal}
          ${(e.adjuntos || []).length ? `<div style="margin-top:10px">${e.adjuntos.map(lineaAdjunto).join('')}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  return `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f1f5f9">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.1)">
    <div style="padding:20px 24px;background:#0f172a">
      <div style="font:600 16px/1.4 -apple-system,sans-serif;color:#fff">${eventos.length} novedades en ${esc(site)}</div>
      <div style="font:400 13px/1.5 -apple-system,sans-serif;color:#94a3b8;margin-top:2px">${franja} · ${rutas.length === 1 ? esc(rutas[0] === '/' ? 'Portada' : rutas[0]) : rutas.length + ' páginas'}${motivo === 'corte' ? ' · tanda llena' : ''}</div>
    </div>
    <div style="padding:20px 24px">${tarjetas}</div>
    <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font:400 12px/1.5 -apple-system,sans-serif;color:#94a3b8">
      Una tanda reúne lo que llega en ${VENTANA_MINUTOS} minutos desde el primer aviso, o ${CORTE_COMENTARIOS} avisos, lo que pase antes. Enviado desde el widget Feedtack instalado en la web de ${esc(site)}. Responder a este correo NO llega al cliente.
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
  let nav = 'desconocido';
  for (const [re, nombre] of m) {
    const r = ua.match(re);
    if (r) { nav = `${nombre} ${r[1].split('.')[0]}`; break; }
  }
  const so = /iPhone|iPad/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux' : '';
  return so ? `${nav} en ${so}` : nav;
}
