/**
 * Tack Comment — backend del widget de feedback (Cloudflare Worker + D1)
 *
 *   POST   /api/feedback            crear comentario (multipart) → guarda y avisa por correo
 *   GET    /api/comentarios?site=X  listar los de una web
 *   PATCH  /api/comentarios/:id     editar el texto (solo su autor)
 *   POST   /api/comentarios/:id/estado   resolver / confirmar / reabrir / cerrar
 *   DELETE /api/comentarios/:id     eliminar (SOLO con clave de administración)
 *   GET    /salud
 *
 * Estados: abierto → resuelto (el equipo) → confirmado | reabierto (el cliente)
 * El equipo, con clave, puede además cerrar directamente (notas internas y
 * recordatorios que no necesitan que nadie confirme nada).
 *
 * Secrets: RESEND_API_KEY, CLAVE_ADMIN
 * Vars:    DESTINO, REMITENTE, ORIGENES_PERMITIDOS, SITIOS (opcional)
 */

const MAX_TOTAL = 22 * 1024 * 1024;
const ESTADOS = ['abierto', 'resuelto', 'confirmado', 'reabierto'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origen = request.headers.get('Origin') || '';
    const cors = cabecerasCors(origen, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/salud') return json({ ok: true, servicio: 'tack' }, 200, cors);

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

  const adjuntos = [];
  let total = 0;
  for (const [clave, valor] of form.entries()) {
    if (!clave.startsWith('adjunto') || typeof valor === 'string') continue;
    total += valor.size;
    if (total > MAX_TOTAL) return json({ error: 'adjuntos demasiado grandes' }, 413, cors);
    adjuntos.push({
      filename: nombreSeguro(valor.name || clave),
      content: base64(await valor.arrayBuffer()),
      contentType: valor.type || 'application/octet-stream'
    });
  }

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

  await avisar(env, {
    tipo: 'nuevo',
    site, mensaje, autor, contexto, senalados, adjuntos, id
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

  const comentarios = (results || []).map(c => ({
    id: c.id,
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
  await avisar(env, {
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
    await avisar(env, {
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
    console.error('tack: borrado OK pero la copia por correo fallo', id, e && e.message);
  }

  return json({ ok: true, eliminado: id, copiaEnviada }, 200, cors);
}

// ────────────────────────────────────────────────────────────────── correo

async function avisar(env, datos) {
  // Sin configurar no se manda nada: nunca un destinatario por defecto.
  if (!env.RESEND_API_KEY || !env.DESTINO || !env.REMITENTE) {
    console.log('sin configurar: falta RESEND_API_KEY, DESTINO o REMITENTE');
    return;
  }

  const prefijo = { nuevo: '💬', editado: '✏️', reabierto: '🔁', eliminado: '🗑️' }[datos.tipo] || '💬';
  const mote = { nuevo: '', editado: '[editado] ', reabierto: '[reabierto] ', eliminado: '[ELIMINADO] ' }[datos.tipo] || '';
  const asunto = `${prefijo} Tack · ${datos.site}: ${mote}${resumir(datos.mensaje, datos.senalados)}`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env.REMITENTE,
      to: lista(env.DESTINO),
      subject: asunto,
      html: plantilla(datos),
      attachments: datos.adjuntos
    })
  });
  if (!r.ok) console.log('resend error', r.status, await r.text());
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
    eliminado: ['#450a0a', 'Comentario ELIMINADO en']
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
      ${adjuntos.map(a => `<div style="font:400 13px/1.7 -apple-system,sans-serif;color:#475569">📎 ${esc(a.filename)}</div>`).join('')}
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
      ${tipo === 'eliminado' ? 'Este comentario se ha <b>borrado</b> de la lista' + (porSuAutor ? ', y lo ha borrado <b>quien lo escribió</b>' : ' desde el equipo') + '. Esta copia es el único rastro que queda.<br>' : ''}Enviado desde el widget Tack Comment, instalado en la web de ${esc(site)}. Responder a este correo NO llega al cliente.
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
