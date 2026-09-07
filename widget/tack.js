/*!
 * Tack Comment — widget de feedback para webs en construcción (Websalia)
 * Un solo fichero, sin dependencias, aislado en Shadow DOM.
 *
 *   <script src="https://cdn.jsdelivr.net/gh/alvaromassana/tack-comment@main/widget/tack.js"
 *           data-site="cliente-slug"
 *           data-endpoint="https://tack-api.../api"
 *           data-color="#4f46e5" defer></script>
 *
 * Se pone una vez en el pie y funciona en TODAS las páginas de la web.
 * Solo debe estar presente en entornos de revisión, nunca en producción.
 */
(function () {
  'use strict';

  if (window.__tackLoaded) return;
  window.__tackLoaded = true;

  var script = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();

  var base = (script.getAttribute('data-endpoint') || '').replace(/\/(api\/)?feedback\/?$/, '').replace(/\/$/, '');

  var CFG = {
    site: script.getAttribute('data-site') || 'sin-identificar',
    api: base || '',
    color: script.getAttribute('data-color') || '#4f46e5',
    label: script.getAttribute('data-label') || 'Comentar',
    position: script.getAttribute('data-position') || 'bottom-right'
  };

  var MAX_FILE_BYTES = 8 * 1024 * 1024;
  var MAX_TOTAL_BYTES = 20 * 1024 * 1024;
  var MAX_AUDIO_MS = 120000;

  // La clave de administración llega por la URL (?tack_admin=...) y se queda
  // en este navegador. Es lo que nos deja marcar cosas como resueltas.
  var CLAVE_ADMIN = (function () {
    try {
      var p = new URLSearchParams(location.search).get('tack_admin');
      if (p) { localStorage.setItem('tack_admin', p); return p; }
      return localStorage.getItem('tack_admin') || '';
    } catch (e) { return ''; }
  })();

  // El nombre puede llegar por la URL (?tack_yo=Sol) y se queda en este navegador.
  // Existe porque el campo "Tu nombre" es opcional y en la práctica se salta: con varias
  // personas revisando la misma web, saber quién pidió cada cambio es justo lo que hace
  // falta. Así cada una entra por su enlace y firma sin escribir nada.
  (function () {
    try {
      var y = new URLSearchParams(location.search).get('tack_yo');
      if (y) localStorage.setItem('tack_autor', y.slice(0, 60));
    } catch (e) {}
  })();

  // Identidad anónima por navegador: es lo que permite editar lo propio.
  var AUTOR_ID = (function () {
    try {
      var v = localStorage.getItem('tack_autor_id');
      if (!v) {
        v = 'a-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem('tack_autor_id', v);
      }
      return v;
    } catch (e) { return 'a-' + Date.now().toString(36); }
  })();


  // ------------------------------------------------------------------ idiomas

  var TEXTOS = {
    es: {
      titulo: 'Comentarios', pestNuevo: 'Añadir feedback', pestLista: 'Historial',
      cerrar: 'Cerrar', volver: 'Volver a la lista',
      placeholder: 'Cuéntanos qué cambiarías. Puedes señalar uno o varios elementos, adjuntar una captura y grabar una nota de voz, todo en el mismo comentario.',
      tuComentario: 'Tu comentario', tuNombre: 'Tu nombre (opcional)',
      senalar: 'Señalar elemento', senalarOtro: 'Señalar elemento', captura: 'Captura',
      notaVoz: 'Nota de voz', adjuntar: 'Adjuntar', parar: 'Parar',
      enviar: 'Enviar comentario', enviando: 'Enviando…',
      pieEnvio: 'Se envía junto a la página y el navegador que estás usando.',
      senalado: 'Señalado: ', quitarElemento: 'Quitar este elemento', quitarAdjunto: 'Quitar adjunto',
      escuchar: 'Escuchar la nota de voz', notaDeVoz: 'Nota de voz',
      clicParaComentar: 'Haz clic en lo que quieras comentar', paraSalir: 'para salir',
      invitaTitulo: '¿Nos señalas a qué te refieres?',
      invitaTexto: 'Si lo señalas, sabemos exactamente de qué hablas y luego puedes volver a este punto desde la lista. Sin señalar, el comentario queda suelto en la página.',
      invitaSi: 'Señalar dónde', invitaNo: 'Enviar sin señalar',
      nivelAyuda: 'para subir o bajar de elemento', nivelHermanos: 'para ir al de al lado',
      hechoPor: 'Hecho por ',
      ocultarMarcas: 'Ocultar marcadores de feedback', resaltarFijo: 'Resaltar selección de feedback', sinSenalar: 'Este comentario no señalaba ningún elemento, así que no hay sitio al que ir.',
      errQuienEres: 'Pon tu nombre, para que sepamos de quién es cada comentario. Solo esta vez.',
      tuNombreObl: 'Tu nombre',
      recibido: 'Recibido, gracias',
      recibidoTexto: 'Lo revisamos y te contamos. Puedes editarlo mientras tanto desde "Ya dichos".',
      verTodos: 'Ver todos', escribirOtro: 'Escribir otro',
      filtroPendientes: 'Pendientes', filtroResueltos: 'Resueltos', filtroTodos: 'Todos',
      enEstaPagina: 'En esta página', portada: 'Portada',
      vacioPendientes: 'No queda nada pendiente por aquí.',
      vacioResueltos: 'Todavía no hay nada resuelto.',
      vacioTodos: 'Aún no hay comentarios. Escribe el primero.',
      sinTexto: '(sin texto, con adjuntos)', sinTextoDetalle: '(sin texto)',
      tuyo: 'tuyo', loEscribisteTu: 'lo escribiste tú', editadoMarca: '· editado',
      comentario: 'Comentario ', noExiste: 'Ese comentario ya no está.',
      escrito: 'Escrito ', por: ' por ', editado: 'Editado ',
      adjuntosCorreo: ' adjunto(s), en el correo que nos llegó', estaEn: 'Está en ',
      editar: 'Editar', editarAria: 'Editar el comentario',
      guardar: 'Guardar cambios', guardando: 'Guardando…', cancelar: 'Cancelar',
      avisoEdicion: 'Te avisamos: nos llega el aviso de que lo has cambiado.',
      resolver: 'Marcar como resuelto', hecha: 'Marcar como hecha',
      confirmar: 'Está bien así', reabrir2: 'No, sigue mal', reabrir: 'Reabrir',
      irPagina: 'Ir a esa página', irAlSitio: 'Ir al sitio', irAlSitioOtra: 'Ir al sitio (otra página)', unMomento: 'Un momento…',
      notaResuelto: 'Lo hemos dado por arreglado. Dinos si te encaja o si sigue sin estar bien.',
      eliminar: 'Eliminar comentario', eliminando: 'Eliminando…',
      eliminarSi: 'Sí, eliminar', eliminarNo: 'No',
      eliminarAviso: 'Se borra para todos y no se puede deshacer. Te llegará una copia por correo, que será el único rastro.',
      eliminarAvisoMio: 'Se borra y no se puede deshacer. Nos llegará una copia por correo, que será el único rastro.',
      estados: { abierto: 'Pendiente', resuelto: 'Resuelto', confirmado: 'Cerrado', reabierto: 'Reabierto' },
      ahora: 'ahora', minutos: 'hace %s min', horas: 'hace %s h', dias: 'hace %s d',
      errVacio: 'Escribe un comentario, señala un elemento o adjunta algo.',
      errSinEndpoint: 'El widget no tiene endpoint configurado (data-endpoint).',
      errEnvio: 'No se pudo enviar (%s). Inténtalo otra vez en un momento.',
      errGuardar: 'No se pudo guardar (%s).', errCambiar: 'No se pudo cambiar (%s).',
      errEliminar: 'No se pudo eliminar (%s).',
      errNoVacio: 'El comentario no puede quedar vacío.',
      errCaptura: 'No se pudo capturar la pantalla (o cancelaste). Puedes adjuntar una captura hecha a mano.',
      errSinCaptura: 'Tu navegador no permite capturar la pantalla. Puedes hacer la captura tú y adjuntarla con "Adjuntar".',
      errSinAudio: 'Tu navegador no permite grabar audio.',
      errMicro: 'No se pudo acceder al micrófono. Revisa los permisos del navegador.',
      errPesado: '"%s" pesa %s y el máximo por archivo son %s.',
      errTotal: 'Entre todos los adjuntos superas %s. Quita alguno.'
    },
    en: {
      titulo: 'Comments', pestNuevo: 'Add feedback', pestLista: 'History',
      cerrar: 'Close', volver: 'Back to list',
      placeholder: 'Tell us what you would change. You can point at one or more elements, attach a screenshot and record a voice note, all in the same comment.',
      tuComentario: 'Your comment', tuNombre: 'Your name (optional)',
      senalar: 'Point at element', senalarOtro: 'Point at element', captura: 'Screenshot',
      notaVoz: 'Voice note', adjuntar: 'Attach', parar: 'Stop',
      enviar: 'Send comment', enviando: 'Sending…',
      pieEnvio: 'Sent along with the page and browser you are using.',
      senalado: 'Pointed at: ', quitarElemento: 'Remove this element', quitarAdjunto: 'Remove attachment',
      escuchar: 'Play the voice note', notaDeVoz: 'Voice note',
      clicParaComentar: 'Click whatever you want to comment on', paraSalir: 'to exit',
      invitaTitulo: 'Want to point at it?',
      invitaTexto: 'If you point at it we know exactly what you mean, and you can come back to this spot from the list. Without it, the comment floats loose on the page.',
      invitaSi: 'Point at it', invitaNo: 'Send without pointing',
      nivelAyuda: 'to go up or down a level', nivelHermanos: 'to move sideways',
      hechoPor: 'Made by ',
      ocultarMarcas: 'Hide feedback markers', resaltarFijo: 'Highlight the selected area', sinSenalar: 'This comment did not point at any element, so there is nowhere to go.',
      errQuienEres: 'Add your name, so we know who each comment is from. Just this once.',
      tuNombreObl: 'Your name',
      recibido: 'Got it, thanks',
      recibidoTexto: 'We will look at it and get back to you. You can still edit it from "Already said".',
      verTodos: 'See all', escribirOtro: 'Write another',
      filtroPendientes: 'Open', filtroResueltos: 'Resolved', filtroTodos: 'All',
      enEstaPagina: 'On this page', portada: 'Home',
      vacioPendientes: 'Nothing left open here.',
      vacioResueltos: 'Nothing resolved yet.',
      vacioTodos: 'No comments yet. Write the first one.',
      sinTexto: '(no text, has attachments)', sinTextoDetalle: '(no text)',
      tuyo: 'yours', loEscribisteTu: 'you wrote this', editadoMarca: '· edited',
      comentario: 'Comment ', noExiste: 'That comment is gone.',
      escrito: 'Written ', por: ' by ', editado: 'Edited ',
      adjuntosCorreo: ' attachment(s), in the email we got', estaEn: 'It is on ',
      editar: 'Edit', editarAria: 'Edit the comment',
      guardar: 'Save changes', guardando: 'Saving…', cancelar: 'Cancel',
      avisoEdicion: 'Heads up: we get notified that you changed it.',
      resolver: 'Mark as resolved', hecha: 'Mark as done',
      confirmar: 'Looks good', reabrir2: 'No, still wrong', reabrir: 'Reopen',
      irPagina: 'Go to that page', irAlSitio: 'Go to it', irAlSitioOtra: 'Go to it (another page)', unMomento: 'One moment…',
      notaResuelto: 'We think it is fixed. Tell us if it works for you or if it is still wrong.',
      eliminar: 'Delete comment', eliminando: 'Deleting…',
      eliminarSi: 'Yes, delete', eliminarNo: 'No',
      eliminarAviso: 'It is deleted for everyone and cannot be undone. You will get a copy by email, which will be the only trace left.',
      eliminarAvisoMio: 'It is deleted and cannot be undone. We will get a copy by email, which will be the only trace left.',
      estados: { abierto: 'Open', resuelto: 'Resolved', confirmado: 'Closed', reabierto: 'Reopened' },
      ahora: 'just now', minutos: '%s min ago', horas: '%s h ago', dias: '%s d ago',
      errVacio: 'Write a comment, point at an element or attach something.',
      errSinEndpoint: 'The widget has no endpoint configured (data-endpoint).',
      errEnvio: 'Could not send (%s). Try again in a moment.',
      errGuardar: 'Could not save (%s).', errCambiar: 'Could not change (%s).',
      errEliminar: 'Could not delete (%s).',
      errNoVacio: 'The comment cannot be left empty.',
      errCaptura: 'Could not capture the screen (or you cancelled). You can attach a screenshot taken by hand.',
      errSinCaptura: 'Your browser does not allow screen capture. Take the screenshot yourself and use "Attach".',
      errSinAudio: 'Your browser does not allow audio recording.',
      errMicro: 'Could not access the microphone. Check your browser permissions.',
      errPesado: '"%s" weighs %s and the maximum per file is %s.',
      errTotal: 'All attachments together exceed %s. Remove one.'
    }
  };

  /* Idioma: data-lang manda, si no el <html lang>, si no el del navegador.
     Cualquier cosa que no sea español cae a inglés. */
  var IDIOMA = (function () {
    var d = (script.getAttribute('data-lang') || '').toLowerCase();
    if (TEXTOS[d]) return d;
    var l = (document.documentElement.getAttribute('lang') || navigator.language || 'en').toLowerCase();
    return l.indexOf('es') === 0 ? 'es' : 'en';
  })();

  var T = TEXTOS[IDIOMA];

  /* txt('clave', valor1, valor2...) sustituye los %s por orden. */
  function txt(clave) {
    var s = T[clave];
    if (s == null) return clave;
    var args = [].slice.call(arguments, 1);
    return args.length ? s.replace(/%s/g, function () { return args.shift(); }) : s;
  }

  // ---------------------------------------------------------------- utilidades

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function bytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function haceRato(iso) {
    var s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return txt('ahora');
    if (s < 3600) return txt('minutos', Math.floor(s / 60));
    if (s < 86400) return txt('horas', Math.floor(s / 3600));
    if (s < 604800) return txt('dias', Math.floor(s / 86400));
    return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }

  function cssPath(node) {
    if (!node || node.nodeType !== 1) return '';
    if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) return '#' + node.id;
    var parts = [], cur = node;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      var sel = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) { parts.unshift('#' + cur.id); break; }
      var cls = (cur.getAttribute('class') || '').trim().split(/\s+/)
        .filter(function (c) { return c && c.length < 40 && !/^(is-|has-|active|open|hover|focus)/.test(c); })
        .slice(0, 2);
      if (cls.length) sel += '.' + cls.join('.');
      var parent = cur.parentNode;
      if (parent && parent.nodeType === 1) {
        var sameTag = [].filter.call(parent.children, function (c) { return c.tagName === cur.tagName; });
        if (sameTag.length > 1) sel += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
      }
      parts.unshift(sel);
      cur = cur.parentNode;
      if (cur === document.body) { parts.unshift('body'); break; }
    }
    return parts.join(' > ');
  }

  function contexto() {
    return {
      url: location.href, titulo: document.title, ruta: location.pathname,
      viewport: window.innerWidth + 'x' + window.innerHeight,
      pantalla: screen.width + 'x' + screen.height,
      dpr: window.devicePixelRatio || 1, scroll: Math.round(window.scrollY),
      navegador: navigator.userAgent, idioma: navigator.language,
      momento: new Date().toISOString()
    };
  }

  /* Posición real del elemento HOY. El rect guardado se hizo con otro tamaño de
     ventana, así que si el elemento sigue existiendo mandamos sobre el guardado. */
  function posicionDe(s) {
    if (s.selector) {
      try {
        var n = document.querySelector(s.selector);
        if (n) {
          var r = n.getBoundingClientRect();
          if (r.width || r.height) {
            return { y: r.top + scrollY, h: r.height, x: r.left + scrollX, w: r.width, vivo: true };
          }
        }
      } catch (e) {}
    }
    return s.rect ? { y: s.rect.y, h: s.rect.h, x: s.rect.x, w: s.rect.w, vivo: false } : null;
  }

  // ------------------------------------------------------------------ estilos

  var CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.tk, .tk * {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px; line-height: 1.5; margin: 0; padding: 0; -webkit-font-smoothing: antialiased;
}
.tk { position: fixed; z-index: 2147483000; color: #e2e8f0; }
.tk.bottom-right { right: 20px; bottom: 20px; }
.tk.bottom-left  { left: 20px;  bottom: 20px; }
.tk.top-right    { right: 20px; top: 20px; }

/* ---- burbuja ---- */
.burbuja {
  display: inline-flex; align-items: center; gap: 9px; height: 46px; padding: 0 18px 0 15px;
  background: #0f172a; color: #fff; border: 0; border-radius: 999px;
  font-weight: 600; font-size: 14px; cursor: pointer;
  box-shadow: 0 6px 24px rgba(2,6,23,.28), 0 0 0 1px rgba(255,255,255,.08) inset;
  transition: transform .18s cubic-bezier(.23,1,.32,1), box-shadow .18s cubic-bezier(.23,1,.32,1);
}
.burbuja:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(2,6,23,.34), 0 0 0 1px rgba(255,255,255,.12) inset; }
.burbuja:active { transform: scale(.97); }
.burbuja:focus-visible { outline: 2px solid var(--acento); outline-offset: 3px; }
.burbuja .punto { width: 8px; height: 8px; border-radius: 50%; background: var(--acento); flex: none; }
.burbuja .cuenta {
  min-width: 21px; height: 21px; padding: 0 6px; border-radius: 999px;
  background: var(--acento); color: #fff; font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; margin-left: 1px;
}

/* ---- panel ---- */
.panel {
  width: 400px; max-width: calc(100vw - 32px); max-height: calc(100vh - 48px);
  background: #0f172a; border-radius: 16px; overflow: hidden;
  box-shadow: 0 24px 60px rgba(2,6,23,.45), 0 0 0 1px rgba(255,255,255,.08);
  display: flex; flex-direction: column;
  animation: aparecer .22s cubic-bezier(.23,1,.32,1);
}
@keyframes aparecer { from { opacity: 0; transform: translateY(8px) scale(.98); } }
@media (prefers-reduced-motion: reduce) { .panel { animation: none; } .burbuja { transition: none; } }

.cab { display: flex; align-items: center; gap: 10px; padding: 15px 16px 0; flex: none; }
.cab h2 { font-size: 15px; font-weight: 600; color: #f8fafc; flex: 1; }
.cab .sub { font-size: 12px; color: #94a3b8; font-weight: 400; display: block; margin-top: 2px; }
.cerrar, .atras {
  width: 28px; height: 28px; border: 0; border-radius: 8px; cursor: pointer;
  background: transparent; color: #94a3b8; font-size: 18px; line-height: 1; flex: none;
  display: flex; align-items: center; justify-content: center; font-family: inherit;
}
/* margin-left:auto la empuja a su esquina: el titulo va dentro de un div que no crece,
   asi que sin esto el aspa se quedaba flotando pegada al texto. */
.cab .cerrar { margin-left: auto; align-self: flex-start; }
.cerrar:hover, .atras:hover { background: rgba(255,255,255,.07); color: #f8fafc; }
.atras svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

/* ---- pestañas ---- */
.pestanas { display: flex; gap: 3px; padding: 12px 16px 0; flex: none; }
.pest {
  flex: 1; height: 34px; border: 0; border-radius: 8px; cursor: pointer; font-family: inherit;
  background: transparent; color: #94a3b8; font-size: 13px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  transition: background .15s cubic-bezier(.23,1,.32,1), color .15s;
}
.pest:hover { background: rgba(255,255,255,.05); color: #e2e8f0; }
.pest[aria-selected=true] { background: #1e293b; color: #f8fafc; }
.pest .n {
  min-width: 19px; height: 19px; padding: 0 5px; border-radius: 999px; background: #334155;
  color: #cbd5e1; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center;
}
.pest[aria-selected=true] .n { background: var(--acento); color: #fff; }

.cuerpo { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }

.tk textarea, .tk input[type=text] {
  /* El .tk de delante NO sobra: el reset de arriba (.tk *) pone padding 0 y le gana por
     especificidad a un selector de elemento pelado, asi que el texto tocaba el borde.
     Ojo: aqui dentro NO se pueden usar acentos graves, esto es un template literal. */
  width: 100%; background: #1e293b; color: #f1f5f9; border: 1px solid #334155;
  border-radius: 10px; padding: 11px 13px; font-size: 14px; resize: vertical; font-family: inherit;
}
textarea { min-height: 88px; }
textarea:focus, input[type=text]:focus { outline: none; border-color: var(--acento); box-shadow: 0 0 0 3px color-mix(in srgb, var(--acento) 25%, transparent); }
textarea::placeholder, input::placeholder { color: #64748b; }

/* ---- acciones ---- */
.acciones { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.acciones--2 { grid-template-columns: repeat(2, 1fr); }
.acc {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
  padding: 11px 4px; background: #1e293b; border: 1px solid #334155; border-radius: 10px;
  color: #cbd5e1; font-size: 11px; font-weight: 500; cursor: pointer; text-align: center; font-family: inherit;
  transition: background .15s cubic-bezier(.23,1,.32,1), border-color .15s cubic-bezier(.23,1,.32,1);
}
.acc:hover { background: #273549; border-color: #475569; color: #f1f5f9; }
.acc:active { transform: scale(.97); }
.acc svg { width: 17px; height: 17px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.acc.grabando { border-color: #ef4444; background: rgba(239,68,68,.16); color: #fecaca; }

/* Llamada de atención al botón de señalar cuando alguien va a enviar sin señalar.
   Se repite 3 veces y para: un pulso infinito acaba siendo ruido. */
.acc.llamando {
  border-color: var(--acento);
  background: color-mix(in srgb, var(--acento) 20%, #1e293b);
  color: #fff;
  animation: llamada 1.5s cubic-bezier(.23,1,.32,1) 3;
}
@keyframes llamada {
  0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--acento) 60%, transparent); }
  65%  { box-shadow: 0 0 0 11px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@media (prefers-reduced-motion: reduce) { .acc.llamando { animation: none; } }

/* ---- sugerencia de señalar ---- */
.sugerencia {
  background: color-mix(in srgb, var(--acento) 13%, #1e293b);
  border: 1px solid color-mix(in srgb, var(--acento) 42%, transparent);
  border-radius: 10px; padding: 13px 14px;
  display: flex; flex-direction: column; gap: 11px;
  animation: aparecer .22s cubic-bezier(.23,1,.32,1);
}
.sugerencia h4 { font-size: 13.5px; font-weight: 600; color: #f8fafc; }
.sugerencia p { font-size: 12.5px; color: #cbd5e1; line-height: 1.55; }
.sugerencia .opciones { display: flex; gap: 8px; }
.sugerencia .opciones button { height: 36px; flex: 1; border-radius: 9px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
.sugerencia .si { border: 0; background: var(--acento); color: #fff; }
.sugerencia .si:hover { filter: brightness(1.12); }
.sugerencia .no { border: 1px solid #475569; background: transparent; color: #cbd5e1; font-weight: 500; }
.sugerencia .no:hover { background: rgba(255,255,255,.06); color: #f1f5f9; }

/* ---- adjuntos ---- */
.adjuntos { display: flex; flex-direction: column; gap: 6px; }
.adj { display: flex; align-items: center; gap: 9px; padding: 7px 9px; background: #1e293b; border: 1px solid #334155; border-radius: 9px; font-size: 12px; }
.adj .mini { width: 30px; height: 30px; border-radius: 6px; object-fit: cover; flex: none; background: #334155; }
.adj .nom { flex: 1; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.adj .peso { color: #64748b; font-size: 11px; flex: none; }
.quitar {
  border: 0; background: transparent; color: #64748b; cursor: pointer; padding: 2px 5px;
  font-size: 16px; line-height: 1; flex: none; border-radius: 5px; font-family: inherit;
}
.quitar:hover { color: #f87171; background: rgba(248,113,113,.12); }
.play { width: 30px; height: 30px; flex: none; border: 0; border-radius: 50%; background: var(--acento); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.play:hover { filter: brightness(1.12); }
.play svg { width: 12px; height: 12px; fill: currentColor; stroke: none; }
.onda { flex: 1; height: 3px; background: #334155; border-radius: 2px; overflow: hidden; }
.onda i { display: block; height: 100%; width: 0; background: var(--acento); transition: width .1s linear; }

/* ---- señalados ---- */
.senalado { display: flex; align-items: center; gap: 9px; padding: 9px 11px; background: color-mix(in srgb, var(--acento) 14%, #1e293b); border: 1px solid color-mix(in srgb, var(--acento) 45%, transparent); border-radius: 9px; font-size: 12px; }
.senalado .txt { flex: 1; color: #e2e8f0; overflow: hidden; }
.senalado code { display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: color-mix(in srgb, var(--acento) 55%, #fff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 3px; }

/* ---- pie ---- */
.enviar {
  flex: 1; height: 42px; border: 0; border-radius: 10px; cursor: pointer; font-family: inherit;
  background: var(--acento); color: #fff; font-weight: 600; font-size: 14px;
  transition: filter .15s cubic-bezier(.23,1,.32,1);
}
.enviar:hover:not(:disabled) { filter: brightness(1.12); }
.enviar:active:not(:disabled) { transform: scale(.98); }
.enviar:disabled { opacity: .5; cursor: not-allowed; }
/* Mientras se invita a señalar, el botón de enviar deja de competir por la atención:
   si no, hay dos botones de acento y el más grande empuja a lo contrario del aviso. */
.enviar.atenuado { background: #1e293b; color: #94a3b8; border: 1px solid #334155; font-weight: 500; }
.enviar.atenuado:hover:not(:disabled) { background: #273549; color: #e2e8f0; filter: none; }
.secundario { height: 42px; padding: 0 16px; border: 1px solid #334155; background: #1e293b; color: #e2e8f0; border-radius: 10px; cursor: pointer; font-size: 14px; font-weight: 500; font-family: inherit; }
.secundario:hover { background: #273549; }

.ir-sitio { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 10px 12px; background: #1e293b; border: 1px solid #334155; border-radius: 10px; color: #cbd5e1; font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit; transition: background .15s, border-color .15s; }
.ir-sitio:hover { background: #273549; border-color: #475569; color: #f1f5f9; }
.ir-sitio svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; }

.ocultar { display: flex; align-items: center; gap: 8px; margin: 0 16px 4px; padding: 9px 11px; border: 1px solid #1e293b; border-radius: 8px; cursor: pointer; color: #94a3b8; font-size: 12px; user-select: none; }
.ocultar:hover { border-color: #334155; color: #cbd5e1; }
.ocultar input { accent-color: var(--acento); width: 15px; height: 15px; cursor: pointer; margin: 0; }

/* Aviso cuando pedimos el nombre por primera vez. */
input[type=text].pide { border-color: #f87171 !important; box-shadow: 0 0 0 3px rgba(248,113,113,.18) !important; }

/* Firma. Va al pie, en gris y pequeña: quien abre esto es un cliente mirando SU
   web, y la firma no debe competir con el comentario que va a escribir. */
.firma { padding: 10px 16px 13px; margin-top: 2px; text-align: center; font-size: 11px; line-height: 1.4; color: #64748b; border-top: 1px solid #1e293b; }
.firma a { color: #94a3b8; text-decoration: none; font-weight: 600; }
.firma a:hover { color: var(--acento); text-decoration: underline; }
.pie { display: flex; align-items: center; gap: 8px; }
.nota { font-size: 11px; color: #64748b; text-align: center; }
.error { font-size: 12px; color: #fca5a5; background: rgba(239,68,68,.12); border: 1px solid rgba(239,68,68,.3); border-radius: 8px; padding: 8px 10px; }

/* ---- lista de comentarios ---- */
.filtros { display: flex; gap: 5px; flex: none; }
.filtro {
  height: 28px; padding: 0 11px; border-radius: 999px; border: 1px solid #334155; background: transparent;
  color: #94a3b8; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit;
}
.filtro:hover { border-color: #475569; color: #e2e8f0; }
.filtro[aria-pressed=true] { background: #1e293b; border-color: var(--acento); color: #f8fafc; }

.grupo { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .06em; margin: 10px 0 -2px; }
.grupo:first-child { margin-top: 0; }

.tarjeta {
  display: flex; gap: 10px; padding: 11px 12px; background: #1e293b; border: 1px solid #334155;
  border-radius: 10px; cursor: pointer; text-align: left; width: 100%; font-family: inherit;
  transition: border-color .15s cubic-bezier(.23,1,.32,1), background .15s;
}
.tarjeta:hover { background: #273549; border-color: #475569; }
.tarjeta .marca-n {
  width: 22px; height: 22px; border-radius: 50%; flex: none; font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; color: #fff; margin-top: 1px;
}
.tarjeta .med { flex: 1; min-width: 0; }
.tarjeta .txt { color: #e2e8f0; font-size: 13.5px; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tarjeta .meta { font-size: 11.5px; color: #64748b; margin-top: 5px; display: flex; gap: 7px; flex-wrap: wrap; align-items: center; }
.tarjeta .chapa { padding: 1px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
.tarjeta .tuyo { color: var(--acento); font-weight: 600; }

.vacio { text-align: center; padding: 34px 20px; color: #64748b; font-size: 13.5px; line-height: 1.6; }

/* ---- eliminar (solo el equipo) ---- */
.borrar {
  width: 100%; height: 34px; border: 1px solid #334155; background: transparent;
  color: #64748b; border-radius: 9px; cursor: pointer; font-size: 12.5px; font-family: inherit;
}
.borrar:hover { border-color: #7f1d1d; color: #f87171; background: rgba(248,113,113,.07); }
.confirmar {
  background: rgba(127,29,29,.18); border: 1px solid rgba(248,113,113,.35);
  border-radius: 10px; padding: 12px 13px; display: flex; flex-direction: column; gap: 10px;
  animation: aparecer .2s cubic-bezier(.23,1,.32,1);
}
.confirmar p { font-size: 12.5px; color: #fecaca; line-height: 1.5; }
.confirmar .opciones { display: flex; gap: 8px; }
.confirmar .opciones button { height: 34px; flex: 1; border-radius: 9px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
.peligro { border: 0; background: #dc2626; color: #fff; }
.peligro:hover:not(:disabled) { background: #b91c1c; }
.peligro:disabled { opacity: .6; cursor: not-allowed; }

/* ---- detalle ---- */
.detalle .mensaje { font-size: 14.5px; color: #f1f5f9; line-height: 1.6; white-space: pre-wrap; }
.detalle .datos { font-size: 12px; color: #64748b; display: flex; flex-direction: column; gap: 4px; }
.detalle .datos b { color: #94a3b8; font-weight: 600; }
.linea { height: 1px; background: #1e293b; }

/* ---- estado enviado ---- */
.hecho { padding: 34px 24px 30px; text-align: center; }
.hecho .marca { width: 46px; height: 46px; margin: 0 auto 14px; border-radius: 50%; background: color-mix(in srgb, var(--acento) 20%, transparent); display: flex; align-items: center; justify-content: center; }
.hecho .marca svg { width: 22px; height: 22px; stroke: var(--acento); fill: none; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.hecho h3 { font-size: 15px; color: #f8fafc; font-weight: 600; margin-bottom: 5px; }
.hecho p { font-size: 13px; color: #94a3b8; }
`;

  // Lo que va en el documento real (fuera del shadow)
  var CSS_DOC = `
.tk-senalando, .tk-senalando * { cursor: crosshair !important; }
.tk-marca {
  position: absolute; pointer-events: none; z-index: 2147482000;
  border: 2px solid var(--tk-acento, #4f46e5);
  background: color-mix(in srgb, var(--tk-acento, #4f46e5) 12%, transparent);
  border-radius: 3px; transition: all .07s linear;
}
.tk-etiqueta {
  position: absolute; pointer-events: none; z-index: 2147482001; background: #0f172a; color: #fff;
  font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  padding: 5px 8px; border-radius: 6px; white-space: nowrap; box-shadow: 0 4px 14px rgba(2,6,23,.4);
}
.tk-aviso {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
  z-index: 2147482002; pointer-events: none; background: #0f172a; color: #fff;
  font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  padding: 11px 18px; border-radius: 999px; box-shadow: 0 8px 28px rgba(2,6,23,.45);
  display: flex; align-items: center; gap: 9px; max-width: calc(100vw - 32px);
}
.tk-aviso .tk-sep { width: 1px; height: 14px; background: rgba(255,255,255,.2); }
.tk-aviso .tk-esc { font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; background: rgba(255,255,255,.14); padding: 4px 6px; border-radius: 4px; }

/* chincheta numerada sobre el elemento comentado */
.tk-pin {
  position: absolute; z-index: 2147481500; width: 26px; height: 26px; border-radius: 50% 50% 50% 3px;
  transform: rotate(-45deg); cursor: pointer; border: 2px solid #fff;
  box-shadow: 0 3px 10px rgba(2,6,23,.35);
  display: flex; align-items: center; justify-content: center;
  transition: transform .18s cubic-bezier(.23,1,.32,1);
}
.tk-pin span {
  transform: rotate(45deg); color: #fff;
  font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.tk-pin:hover { transform: rotate(-45deg) scale(1.15); }
.tk-pin.tk-resaltado { animation: tk-latido 1.1s cubic-bezier(.23,1,.32,1) 2; }
@keyframes tk-latido { 0%,100% { transform: rotate(-45deg) scale(1); } 50% { transform: rotate(-45deg) scale(1.32); } }

/* El aro FIJO no lleva el oscurecido de 4000px: se queda puesto mientras lees el
   comentario, y con la pagina oscurecida no podrias leer lo de alrededor, que es
   justo para lo que sirve. En su lugar, borde mas grueso y un halo suave. */
.tk-foco--fijo {
  box-shadow: 0 0 0 3px rgba(2,6,23,.18), 0 0 22px 4px color-mix(in srgb, var(--tk-acento, #4f46e5) 55%, transparent);
  border-width: 3px;
  animation: none;
}

/* aro que resalta el elemento al ir a él desde la lista */
.tk-foco {
  position: absolute; z-index: 2147481400; pointer-events: none; border-radius: 4px;
  border: 2px solid var(--tk-acento, #4f46e5);
  box-shadow: 0 0 0 4000px rgba(2,6,23,.28);
  animation: tk-entra .3s cubic-bezier(.23,1,.32,1);
}
@keyframes tk-entra { from { opacity: 0; } }

/* regleta con la posición de cada comentario en la página */
.tk-regleta {
  position: fixed; right: 0; top: 0; bottom: 0; width: 22px; z-index: 2147481000;
  pointer-events: none;
}
.tk-tick {
  position: absolute; right: 4px; width: 14px; height: 4px; border-radius: 2px;
  pointer-events: auto; cursor: pointer; opacity: .75;
  transition: width .15s cubic-bezier(.23,1,.32,1), opacity .15s;
}
.tk-tick:hover { width: 20px; opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .tk-pin, .tk-tick, .tk-foco { transition: none; animation: none; }
}
`;

  var ICONOS = {
    diana: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg>',
    camara: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2.5h5L16 6"/></svg>',
    imagen: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    micro: '<svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>',
    flecha: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>'
  };

  var COLOR_ESTADO = {
    abierto:    { c: 'var(--acento)', doc: null },
    resuelto:   { c: '#16a34a', doc: '#16a34a' },
    confirmado: { c: '#64748b', doc: '#64748b' },
    reabierto:  { c: '#dc2626', doc: '#dc2626' }
  };
  function colorDe(estado) {
    var e = COLOR_ESTADO[estado] || COLOR_ESTADO.abierto;
    return e.doc || CFG.color;
  }

  // ------------------------------------------------------------------ estado

  var comentarios = [];
  var adjuntos = [];
  var senalados = [];
  var grabando = null;
  var borrador = { mensaje: '', autor: '' };
  // Solo se invita a señalar una vez por comentario: insistir sería un peaje.
  var yaInvitado = false;
  var vista = 'nuevo';        // nuevo | lista | detalle | hecho
  var filtro = 'pendientes';  // pendientes | resueltos | todos
  var detalleId = null;
  var editando = false;
  var abierto = false;
  var cargando = false;

  var esAdmin = function () { return !!CLAVE_ADMIN; };

  // ------------------------------------------------------------- shadow root

  var host = el('div', { id: 'tack-host' });
  host.style.cssText = 'all:initial;position:static';
  var shadow = host.attachShadow({ mode: 'open' });
  shadow.appendChild(el('style', { text: CSS }));

  var raiz = el('div', { class: 'tk ' + CFG.position });
  raiz.style.setProperty('--acento', CFG.color);
  shadow.appendChild(raiz);

  document.head.appendChild(el('style', { text: CSS_DOC }));
  document.documentElement.style.setProperty('--tk-acento', CFG.color);

  // ---------------------------------------------------------------------- API

  function api(ruta, opciones) {
    return fetch(CFG.api + ruta, opciones).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
        return d;
      });
    });
  }

  function cargar() {
    if (!CFG.api) return Promise.resolve();
    cargando = true;
    return api('/api/comentarios?site=' + encodeURIComponent(CFG.site))
      .then(function (d) {
        comentarios = d.comentarios || [];
        cargando = false;
        pintarMarcas();
        if (!abierto) pintarBurbuja();
      })
      .catch(function () { cargando = false; });
  }

  // --------------------------------------------------------------- selectores

  function deEstaPagina(c) { return c.ruta === location.pathname; }

  /* El <title> suele ser "Sección · Nombre del sitio", y en la lista eso ocupa
     tres líneas. Nos quedamos con la primera parte. */
  function nombrePagina(c) {
    var t = (c.titulo || '').split(/\s[·|]\s|\s[–—-]\s/)[0].trim();
    if (!t || t.length < 2) t = c.ruta === '/' ? txt('portada') : c.ruta;
    return t.length > 32 ? t.slice(0, 31) + '…' : t;
  }
  function pendientes() { return comentarios.filter(function (c) { return c.estado === 'abierto' || c.estado === 'reabierto'; }); }

  function filtrados() {
    return comentarios.filter(function (c) {
      if (filtro === 'pendientes') return c.estado === 'abierto' || c.estado === 'reabierto';
      if (filtro === 'resueltos') return c.estado === 'resuelto' || c.estado === 'confirmado';
      return true;
    });
  }

  /* Orden: primero esta página, y dentro de cada página de arriba abajo, como se
     lee. Los que no señalan nada concreto van al final de su grupo. */
  function ordenados(lista) {
    var conY = lista.map(function (c) {
      var p = c.senalados && c.senalados.length ? posicionDe(c.senalados[0]) : null;
      return { c: c, y: p ? p.y : Infinity };
    });
    conY.sort(function (a, b) {
      var ea = deEstaPagina(a.c), eb = deEstaPagina(b.c);
      if (ea !== eb) return ea ? -1 : 1;
      if (a.c.ruta !== b.c.ruta) return a.c.ruta < b.c.ruta ? -1 : 1;
      if (a.y !== b.y) return a.y - b.y;
      return new Date(a.c.creado) - new Date(b.c.creado);
    });
    return conY.map(function (x) { return x.c; });
  }

  // El número que ve el usuario es el orden dentro de su página
  function numeroDe(c) {
    var suPagina = ordenados(comentarios.filter(function (x) { return x.ruta === c.ruta; }));
    return suPagina.findIndex(function (x) { return x.id === c.id; }) + 1;
  }

  // ------------------------------------------------------------ marcas en la página

  var capaPins, regleta;

  /* Esconder las chinchetas. Nace de revisar la web con el cliente delante: las
     chinchetas tapan justo lo que se está mirando y no habia forma de quitarlas sin
     cerrar el widget. Se recuerda entre paginas, que es como se usa. */
  var marcasOcultas = (function () {
    try { return localStorage.getItem('tack_ocultar') === '1'; } catch (e) { return false; }
  })();

  function guardarOcultas() {
    try { localStorage.setItem('tack_ocultar', marcasOcultas ? '1' : '0'); } catch (e) {}
  }

  function pintarMarcas() {
    if (capaPins) capaPins.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    capaPins = [];
    if (regleta && regleta.parentNode) regleta.parentNode.removeChild(regleta);
    regleta = null;
    if (!document.body) return;
    if (marcasOcultas) return;

    var aqui = ordenados(comentarios.filter(deEstaPagina));
    var visibles = aqui.filter(function (c) {
      if (filtro === 'pendientes') return c.estado === 'abierto' || c.estado === 'reabierto';
      if (filtro === 'resueltos') return c.estado === 'resuelto' || c.estado === 'confirmado';
      return true;
    });
    if (!visibles.length) return;

    var alto = Math.max(document.documentElement.scrollHeight, 1);
    regleta = el('div', { class: 'tk-regleta' });

    visibles.forEach(function (c) {
      var p = c.senalados && c.senalados.length ? posicionDe(c.senalados[0]) : null;
      var n = numeroDe(c);
      var color = colorDe(c.estado);

      if (p) {
        var pin = el('div', { class: 'tk-pin', title: (c.mensaje || 'Comentario').slice(0, 80) },
          [el('span', { text: String(n) })]);
        pin.style.background = color;
        pin.style.left = Math.max(4, p.x - 13) + 'px';
        pin.style.top = Math.max(4, p.y - 13) + 'px';
        pin.setAttribute('data-tack-pin', c.id);
        pin.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          abrirDetalle(c.id);
        });
        document.body.appendChild(pin);
        capaPins.push(pin);
      }

      /* Sin elemento señalado no hay posición, y ponerle la marca arriba del todo
         sería mentir sobre dónde está. Esos viven solo en la lista. */
      if (!p) return;
      var tick = el('div', { class: 'tk-tick', title: 'Comentario ' + n });
      tick.style.background = color;
      tick.style.top = (p.y / alto * 100) + '%';
      tick.addEventListener('click', function () { irA(c.id); });
      regleta.appendChild(tick);
    });

    document.body.appendChild(regleta);
  }

  var foco;
  /* Id del comentario cuyo area se queda resaltada. El resaltado normal se va solo a los
     dos segundos; este se queda hasta que se desmarca, para poder leer el comentario
     viendo a que trozo de la pagina se refiere. */
  var resaltadoFijo = null;
  /* El aro. En su version FIJA no oscurece el resto de la pagina: si lo hiciera no se
     podria leer nada alrededor, que es justo para lo que sirve dejarlo puesto. */
  function pintarFoco(id, p, fijo) {
    quitarFoco();
    foco = el('div', { class: fijo ? 'tk-foco tk-foco--fijo' : 'tk-foco' });
    foco.setAttribute('data-tack-foco', id);
    foco.style.left = p.x + 'px'; foco.style.top = p.y + 'px';
    foco.style.width = p.w + 'px'; foco.style.height = p.h + 'px';
    document.body.appendChild(foco);
    if (!fijo) setTimeout(function () { if (foco && !foco.classList.contains('tk-foco--fijo')) quitarFoco(); }, 2200);
  }

  function quitarFoco() {
    if (foco && foco.parentNode) foco.parentNode.removeChild(foco);
    foco = null;
  }

  /* Al cambiar el tamaño de la ventana el area medida se mueve, asi que el aro fijo hay
     que recolocarlo o se queda señalando un sitio que ya no es. */
  function recolocarFoco() {
    if (!resaltadoFijo) return;
    var c = comentarios.filter(function (x) { return x.id === resaltadoFijo; })[0];
    if (!c || !deEstaPagina(c) || !(c.senalados || []).length) return;
    var p = posicionDe(c.senalados[0]);
    if (p) pintarFoco(c.id, p, true);
  }

  function irA(id) {
    var c = comentarios.filter(function (x) { return x.id === id; })[0];
    if (!c) return;

    /* Otra pagina: se navega llevandose el id en el ancla, para que al cargar la nueva
       se abra ese comentario y se baje hasta su sitio. Sin esto te dejaba en lo alto de
       la pagina y tenias que buscarlo tu, que es justo lo que esto viene a evitar. */
    if (!deEstaPagina(c)) {
      location.href = c.url.split('#')[0] + '#tack=' + c.id;
      return;
    }

    var p = c.senalados && c.senalados.length ? posicionDe(c.senalados[0]) : null;
    /* Sin elemento señalado no hay a donde llevarle. Antes esto era un `return` mudo:
       clicabas el comentario y no pasaba nada, que parece que este roto. */
    if (!p) { mostrarError(txt('sinSenalar')); return; }
    /* Y si estaban escondidas, al ir a un comentario se vuelven a ver: si no, el aro
       aparece sin su chincheta y no se entiende de cual es. */
    if (marcasOcultas) { marcasOcultas = false; guardarOcultas(); pintarMarcas(); }

    window.scrollTo({ top: Math.max(0, p.y - window.innerHeight / 3), behavior: 'smooth' });

    pintarFoco(c.id, p, resaltadoFijo === c.id);

    (capaPins || []).forEach(function (pin) {
      if (pin.getAttribute('data-tack-pin') === id) {
        pin.classList.add('tk-resaltado');
        setTimeout(function () { pin.classList.remove('tk-resaltado'); }, 2400);
      }
    });
  }

  function soltarResaltado() {
    if (!resaltadoFijo) return;
    resaltadoFijo = null;
    quitarFoco();
  }

  var reposicionar = (function () {
    var t;
    return function () { clearTimeout(t); t = setTimeout(function () { pintarMarcas(); recolocarFoco(); }, 180); };
  })();
  window.addEventListener('resize', reposicionar);

  // -------------------------------------------------------------- vista burbuja

  function pintarBurbuja() {
    /* Cerrar el panel suelta el resaltado fijo: si no, queda un aro puesto en la pagina
       sin nada que explique de que es. */
    soltarResaltado();
    raiz.textContent = '';
    abierto = false;
    var n = pendientes().length;
    var b = el('button', { class: 'burbuja', type: 'button', 'aria-label': txt('titulo') }, [
      el('span', { class: 'punto' }),
      el('span', { text: CFG.label })
    ]);
    if (n) b.appendChild(el('span', { class: 'cuenta', text: String(n) }));
    b.addEventListener('click', function () {
      vista = comentarios.length ? 'lista' : 'nuevo';
      pintarPanel();
    });
    raiz.appendChild(b);
  }

  // ---------------------------------------------------------------- vista panel

  var refs = {};

  function pintarPanel() {
    raiz.textContent = '';
    abierto = true;
    refs = {};

    if (vista === 'hecho') return pintarHecho();

    var panel = el('div', { class: 'panel', role: 'dialog', 'aria-label': 'Comentarios' });

    if (vista === 'detalle') {
      panel.appendChild(cabeceraDetalle());
      panel.appendChild(cuerpoDetalle());
    } else {
      panel.appendChild(cabecera());
      panel.appendChild(pestanas());
      panel.appendChild(interruptorOcultar());
      panel.appendChild(vista === 'lista' ? cuerpoLista() : cuerpoNuevo());
    }

    panel.appendChild(firma());
    raiz.appendChild(panel);
    if (vista === 'nuevo' && refs.mensaje) refs.mensaje.focus();
  }

  /* Firma discreta. Quien usa esto es un cliente mirando SU web, no el nuestro:
     va al pie, en gris y pequeña, y nunca compite con el comentario que va a escribir. */
  function firma() {
    var a = el('a', { class: 'firma-a', text: 'Websalia', target: '_blank', rel: 'noopener' });
    a.href = 'https://www.websalia.com/?utm_source=tack-comment&utm_medium=widget&utm_campaign=firma';
    return el('div', { class: 'firma' }, [el('span', { text: txt('hechoPor') }), a]);
  }

  function cabecera() {
    var t = el('div', {}, [el('h2', { text: txt('titulo') })]);
    t.querySelector('h2').appendChild(el('span', {
      class: 'sub',
      text: (document.title || location.pathname).slice(0, 46)
    }));
    var x = el('button', { class: 'cerrar', type: 'button', 'aria-label': txt('cerrar'), text: '×' });
    x.addEventListener('click', pintarBurbuja);
    return el('div', { class: 'cab' }, [t, x]);
  }

  /* El interruptor de ocultar los marcadores va debajo de las pestañas y no dentro de una
     de ellas: tapan lo que estás mirando tanto si escribes como si repasas el historial. */
  function interruptorOcultar() {
    var caja = el('label', { class: 'ocultar' });
    var chk = el('input', { type: 'checkbox' });
    chk.checked = marcasOcultas;
    chk.addEventListener('change', function () {
      marcasOcultas = chk.checked;
      guardarOcultas();
      pintarMarcas();
    });
    caja.appendChild(chk);
    caja.appendChild(el('span', { text: txt('ocultarMarcas') }));
    return caja;
  }

  function pestanas() {
    var caja = el('div', { class: 'pestanas', role: 'tablist' });
    var nuevo = el('button', { class: 'pest', type: 'button', role: 'tab', text: txt('pestNuevo') });
    nuevo.setAttribute('aria-selected', vista === 'nuevo');
    nuevo.addEventListener('click', function () { vista = 'nuevo'; pintarPanel(); });

    var lista = el('button', { class: 'pest', type: 'button', role: 'tab' }, [el('span', { text: txt('pestLista') })]);
    lista.setAttribute('aria-selected', vista === 'lista');
    if (comentarios.length) lista.appendChild(el('span', { class: 'n', text: String(comentarios.length) }));
    lista.addEventListener('click', function () { vista = 'lista'; pintarPanel(); });

    caja.appendChild(nuevo);
    caja.appendChild(lista);
    return caja;
  }

  // ------------------------------------------------------------ cuerpo: nuevo

  function cuerpoNuevo() {
    var cuerpo = el('div', { class: 'cuerpo' });

    refs.mensaje = el('textarea', {
      placeholder: txt('placeholder'),
      'aria-label': txt('tuComentario')
    });
    refs.mensaje.value = borrador.mensaje;
    refs.mensaje.addEventListener('input', function () { borrador.mensaje = refs.mensaje.value; });
    cuerpo.appendChild(refs.mensaje);

    refs.senalado = el('div');
    cuerpo.appendChild(refs.senalado);
    pintarSenalado();

    refs.btnSenalar = accion(ICONOS.diana, senalados.length ? txt('senalarOtro') : txt('senalar'), activarSenalar);
    refs.btnCaptura = accion(ICONOS.camara, txt('captura'), hacerCaptura);
    /* Nota de voz retirada de la interfaz el 7-sep-2026 a peticion de Alvaro ("de momento").
       El codigo de grabacion se queda entero: volver a ponerla es descomentar esta linea y
       devolver refs.btnVoz a la fila de acciones. */
    // refs.btnVoz = accion(ICONOS.micro, txt('notaVoz'), alternarVoz);

    var subir = el('input', { type: 'file', accept: 'image/*', multiple: '' });
    subir.style.display = 'none';
    subir.addEventListener('change', function () {
      [].forEach.call(subir.files, function (f) { anadir('imagen', f.name, f); });
      subir.value = '';
    });
    refs.btnImagen = accion(ICONOS.imagen, txt('adjuntar'), function () { subir.click(); });
    refs.btnImagen.style.cssText = 'width:100%;flex-direction:row;gap:7px';

    cuerpo.appendChild(el('div', { class: 'acciones acciones--2' }, [refs.btnSenalar, refs.btnCaptura]));
    cuerpo.appendChild(refs.btnImagen);
    cuerpo.appendChild(subir);

    refs.adjuntos = el('div', { class: 'adjuntos' });
    cuerpo.appendChild(refs.adjuntos);
    pintarAdjuntos();

    refs.autor = el('input', { type: 'text', placeholder: txt('tuNombreObl'), 'aria-label': txt('tuNombreObl') });
    if (!borrador.autor) { try { borrador.autor = localStorage.getItem('tack_autor') || ''; } catch (e) {} }
    refs.autor.value = borrador.autor;
    refs.autor.addEventListener('input', function () { borrador.autor = refs.autor.value; refs.autor.classList.remove('pide'); if (refs.autor.value.trim()) mostrarError(''); });
    cuerpo.appendChild(refs.autor);

    refs.error = el('div');
    cuerpo.appendChild(refs.error);

    refs.sugerencia = el('div');
    cuerpo.appendChild(refs.sugerencia);

    refs.enviar = el('button', { class: 'enviar', type: 'button', text: txt('enviar') });
    refs.enviar.addEventListener('click', enviar);
    cuerpo.appendChild(el('div', { class: 'pie' }, [refs.enviar]));
    cuerpo.appendChild(el('div', { class: 'nota', text: txt('pieEnvio') }));
    return cuerpo;
  }

  function accion(icono, texto, onClick) {
    var b = el('button', { class: 'acc', type: 'button', html: icono });
    b.appendChild(el('span', { text: texto }));
    b.addEventListener('click', onClick);
    return b;
  }

  function pintarSenalado() {
    if (!refs.senalado) return;
    refs.senalado.textContent = '';
    if (!senalados.length) return;
    var caja = el('div');
    caja.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    senalados.forEach(function (s, i) {
      var q = el('button', { class: 'quitar', type: 'button', text: '×', 'aria-label': txt('quitarElemento') });
      q.addEventListener('click', function () { senalados.splice(i, 1); pintarSenalado(); });
      var etq = senalados.length > 1 ? (i + 1) + '. ' : '';
      caja.appendChild(el('div', { class: 'senalado' }, [
        el('div', { class: 'txt' }, [
          el('div', { text: etq + txt('senalado') + (s.texto || s.etiqueta) }),
          el('code', { text: s.selector })
        ]), q
      ]));
    });
    refs.senalado.appendChild(caja);
  }

  function reproductor(a) {
    var audio = new Audio(a.url);
    var barra = el('i');
    var tiempo = el('span', { class: 'peso', text: '0:00' });
    var icono = el('button', { class: 'play', type: 'button', 'aria-label': txt('escuchar') });
    var PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    var PAUSA = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
    icono.innerHTML = PLAY;
    icono.addEventListener('click', function () {
      if (audio.paused) { audio.play(); icono.innerHTML = PAUSA; }
      else { audio.pause(); icono.innerHTML = PLAY; }
    });
    audio.addEventListener('timeupdate', function () {
      if (audio.duration && isFinite(audio.duration)) barra.style.width = (audio.currentTime / audio.duration * 100) + '%';
      var s = Math.floor(audio.currentTime);
      tiempo.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    });
    audio.addEventListener('ended', function () { icono.innerHTML = PLAY; barra.style.width = '0'; tiempo.textContent = '0:00'; });

    var caja = el('span', { class: 'nom' }, [el('span', { text: txt('notaVoz') })]);
    caja.style.cssText = 'display:flex;flex-direction:column;gap:5px;min-width:0';
    caja.appendChild(el('span', { class: 'onda' }, [barra]));
    var env = document.createElement('span');
    env.style.cssText = 'display:contents';
    env.appendChild(icono); env.appendChild(caja); env.appendChild(tiempo);
    return env;
  }

  function pintarAdjuntos() {
    if (!refs.adjuntos) return;
    refs.adjuntos.textContent = '';
    adjuntos.forEach(function (a, i) {
      var fila = el('div', { class: 'adj' });
      if (a.tipo === 'audio') fila.appendChild(reproductor(a));
      else {
        fila.appendChild(el('img', { class: 'mini', src: a.url, alt: '' }));
        fila.appendChild(el('span', { class: 'nom', text: a.nombre }));
      }
      fila.appendChild(el('span', { class: 'peso', text: bytes(a.blob.size) }));
      var q = el('button', { class: 'quitar', type: 'button', text: '×', 'aria-label': txt('quitarAdjunto') });
      q.addEventListener('click', function () {
        URL.revokeObjectURL(a.url); adjuntos.splice(i, 1); pintarAdjuntos();
      });
      fila.appendChild(q);
      refs.adjuntos.appendChild(fila);
    });
  }

  function anadir(tipo, nombre, blob) {
    if (blob.size > MAX_FILE_BYTES) {
      return mostrarError(txt('errPesado', nombre, bytes(blob.size), bytes(MAX_FILE_BYTES)));
    }
    var total = adjuntos.reduce(function (s, a) { return s + a.blob.size; }, 0) + blob.size;
    if (total > MAX_TOTAL_BYTES) return mostrarError(txt('errTotal', bytes(MAX_TOTAL_BYTES)));
    adjuntos.push({ tipo: tipo, nombre: nombre, blob: blob, url: URL.createObjectURL(blob) });
    mostrarError('');
    pintarAdjuntos();
  }

  function mostrarError(msg) {
    if (!refs.error) return;
    refs.error.textContent = '';
    if (msg) refs.error.appendChild(el('div', { class: 'error', text: msg }));
  }

  // ------------------------------------------------------------ cuerpo: lista

  function cuerpoLista() {
    var cuerpo = el('div', { class: 'cuerpo' });

    var caja = el('div', { class: 'filtros' });
    [['pendientes', txt('filtroPendientes')], ['resueltos', txt('filtroResueltos')], ['todos', txt('filtroTodos')]].forEach(function (f) {
      var b = el('button', { class: 'filtro', type: 'button', text: f[1] });
      b.setAttribute('aria-pressed', filtro === f[0]);
      b.addEventListener('click', function () { filtro = f[0]; pintarMarcas(); pintarPanel(); });
      caja.appendChild(b);
    });
    cuerpo.appendChild(caja);

    var lista = ordenados(filtrados());
    if (!lista.length) {
      cuerpo.appendChild(el('div', { class: 'vacio', text:
        filtro === 'pendientes' ? txt('vacioPendientes')
        : filtro === 'resueltos' ? txt('vacioResueltos')
        : txt('vacioTodos') }));
      return cuerpo;
    }

    var rutaActual = null;
    lista.forEach(function (c) {
      if (c.ruta !== rutaActual) {
        rutaActual = c.ruta;
        cuerpo.appendChild(el('div', { class: 'grupo', text:
          deEstaPagina(c) ? txt('enEstaPagina') : nombrePagina(c) }));
      }
      cuerpo.appendChild(tarjeta(c));
    });
    return cuerpo;
  }

  function tarjeta(c) {
    var t = el('button', { class: 'tarjeta', type: 'button' });
    var col = colorDe(c.estado);

    var n = el('div', { class: 'marca-n', text: String(numeroDe(c)) });
    n.style.background = col;
    t.appendChild(n);

    var med = el('div', { class: 'med' });
    med.appendChild(el('div', { class: 'txt', text: c.mensaje || txt('sinTexto') }));

    var meta = el('div', { class: 'meta' });
    var est = COLOR_ESTADO[c.estado] || COLOR_ESTADO.abierto;
    var chapa = el('span', { class: 'chapa', text: T.estados[c.estado] || T.estados.abierto });
    chapa.style.cssText = 'background:' + col + '22;color:' + (c.estado === 'abierto' ? '#e2e8f0' : col);
    meta.appendChild(chapa);
    if (c.autorId === AUTOR_ID) meta.appendChild(el('span', { class: 'tuyo', text: txt('tuyo') }));
    else if (c.autor) meta.appendChild(el('span', { text: c.autor }));
    meta.appendChild(el('span', { text: haceRato(c.creado) }));
    if (c.editado) meta.appendChild(el('span', { text: txt('editadoMarca') }));
    if (c.nAdjuntos) meta.appendChild(el('span', { text: '· ' + c.nAdjuntos + ' adj.' }));
    med.appendChild(meta);
    t.appendChild(med);

    t.addEventListener('click', function () { abrirDetalle(c.id); });
    return t;
  }

  // ---------------------------------------------------------- cuerpo: detalle

  function abrirDetalle(id) {
    detalleId = id;
    editando = false;
    vista = 'detalle';
    abierto = true;
    /* El resaltado viene puesto de serie: al abrir un feedback lo primero que quieres es
       ver a que trozo de pagina se refiere, y que se fuera a los dos segundos obligaba a
       marcarlo a mano cada vez. Solo si señalo algo Y esta en esta pagina; si no, la
       casilla ni se pinta y dejar el estado puesto seria mentira.
       Se fija ANTES de pintar el panel, que es quien lee la casilla. */
    var c = comentarios.filter(function (x) { return x.id === id; })[0];
    resaltadoFijo = (c && deEstaPagina(c) && (c.senalados || []).length) ? id : null;
    pintarPanel();
    irA(id);
  }

  function cabeceraDetalle() {
    var atras = el('button', { class: 'atras', type: 'button', 'aria-label': txt('volver'), html: ICONOS.flecha });
    atras.addEventListener('click', function () { soltarResaltado(); vista = 'lista'; pintarPanel(); });
    var c = comentarios.filter(function (x) { return x.id === detalleId; })[0];
    var t = el('div', {}, [el('h2', { text: txt('comentario') + (c ? numeroDe(c) : '') })]);
    if (c) t.querySelector('h2').appendChild(el('span', { class: 'sub', text: nombrePagina(c) }));
    var x = el('button', { class: 'cerrar', type: 'button', 'aria-label': txt('cerrar'), text: '×' });
    x.addEventListener('click', pintarBurbuja);
    return el('div', { class: 'cab' }, [atras, t, x]);
  }

  function cuerpoDetalle() {
    var cuerpo = el('div', { class: 'cuerpo detalle' });
    var c = comentarios.filter(function (x) { return x.id === detalleId; })[0];
    if (!c) { cuerpo.appendChild(el('div', { class: 'vacio', text: txt('noExiste') })); return cuerpo; }

    var est = COLOR_ESTADO[c.estado] || COLOR_ESTADO.abierto;
    var col = colorDe(c.estado);
    var chapa = el('span', { class: 'chapa', text: T.estados[c.estado] || T.estados.abierto });
    chapa.style.cssText = 'background:' + col + '22;color:' + (c.estado === 'abierto' ? '#e2e8f0' : col) +
      ';padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em';
    var linea = el('div');
    linea.style.cssText = 'display:flex;align-items:center;gap:8px';
    linea.appendChild(chapa);
    if (c.autorId === AUTOR_ID) linea.appendChild(el('span', { class: 'tuyo', text: txt('loEscribisteTu') }));
    cuerpo.appendChild(linea);

    refs.error = el('div');

    if (editando) {
      refs.editar = el('textarea', { 'aria-label': txt('editarAria') });
      refs.editar.value = c.mensaje;
      cuerpo.appendChild(refs.editar);
      cuerpo.appendChild(refs.error);

      var guardar = el('button', { class: 'enviar', type: 'button', text: txt('guardar') });
      guardar.addEventListener('click', function () { guardarEdicion(c, guardar); });
      var cancelar = el('button', { class: 'secundario', type: 'button', text: txt('cancelar') });
      cancelar.addEventListener('click', function () { editando = false; pintarPanel(); });
      cuerpo.appendChild(el('div', { class: 'pie' }, [guardar, cancelar]));
      cuerpo.appendChild(el('div', { class: 'nota', text: txt('avisoEdicion') }));
      setTimeout(function () { refs.editar.focus(); }, 30);
      return cuerpo;
    }

    cuerpo.appendChild(el('div', { class: 'mensaje', text: c.mensaje || txt('sinTextoDetalle') }));

    if (c.senalados && c.senalados.length) {
      var caja = el('div');
      caja.style.cssText = 'display:flex;flex-direction:column;gap:6px';
      c.senalados.forEach(function (s, i) {
        caja.appendChild(el('div', { class: 'senalado' }, [
          el('div', { class: 'txt' }, [
            el('div', { text: (c.senalados.length > 1 ? (i + 1) + '. ' : '') + (s.texto || s.etiqueta || 'elemento') }),
            el('code', { text: s.selector })
          ])
        ]));
      });
      cuerpo.appendChild(caja);
    }

    /* Volver al sitio del feedback en cualquier momento. Al abrir el detalle ya te lleva,
       pero mientras lo lees te mueves por la pagina y hay que poder regresar. Si el
       feedback es de OTRA pagina, esto navega hasta ella. */
    if ((c.senalados || []).length) {
      var deAqui = deEstaPagina(c);
      var irBtn = el('button', { class: 'ir-sitio', type: 'button' });
      irBtn.innerHTML = ICONOS.diana;
      irBtn.appendChild(el('span', { text: deAqui ? txt('irAlSitio') : txt('irAlSitioOtra') }));
      irBtn.addEventListener('click', function () { irA(c.id); });
      cuerpo.appendChild(irBtn);
    }

    /* Mantener el area resaltada mientras se lee el comentario. Solo tiene sentido si
       señalo algo y si ese algo esta en la pagina que estas viendo. */
    if (deEstaPagina(c) && (c.senalados || []).length) {
      var fijar = el('label', { class: 'ocultar' });
      var chkFijar = el('input', { type: 'checkbox' });
      chkFijar.checked = resaltadoFijo === c.id;
      chkFijar.addEventListener('change', function () {
        if (chkFijar.checked) {
          resaltadoFijo = c.id;
          if (marcasOcultas) { marcasOcultas = false; guardarOcultas(); pintarMarcas(); }
          var p = posicionDe(c.senalados[0]);
          if (p) pintarFoco(c.id, p, true);
        } else {
          resaltadoFijo = null;
          quitarFoco();
        }
      });
      fijar.appendChild(chkFijar);
      fijar.appendChild(el('span', { text: txt('resaltarFijo') }));
      cuerpo.appendChild(fijar);
    }

    cuerpo.appendChild(el('div', { class: 'linea' }));
    var datos = el('div', { class: 'datos' });
    datos.appendChild(el('div', { text: txt('escrito') + haceRato(c.creado) + (c.autor ? txt('por') + c.autor : '') }));
    if (c.editado) datos.appendChild(el('div', { text: txt('editado') + haceRato(c.actualizado) }));
    if (c.nAdjuntos) datos.appendChild(el('div', { text: c.nAdjuntos + txt('adjuntosCorreo') }));
    if (!deEstaPagina(c)) datos.appendChild(el('div', { text: txt('estaEn') + c.ruta }));
    cuerpo.appendChild(datos);
    cuerpo.appendChild(refs.error);

    // ---- acciones según quién eres y en qué estado está
    var botones = [];
    var mio = c.autorId === AUTOR_ID;
    var cerrado = c.estado === 'confirmado';

    if (mio && !cerrado) {
      var ed = el('button', { class: 'secundario', type: 'button', text: txt('editar') });
      ed.addEventListener('click', function () { editando = true; pintarPanel(); });
      botones.push(ed);
    }

    if (esAdmin() && !cerrado) {
      if (mio) {
        /* Nota propia del equipo (recordatorio, aviso a un compañero): no tiene
           sentido "resolverla" y quedarse esperando a que alguien la confirme. */
        var hecha = el('button', { class: 'enviar', type: 'button', text: txt('hecha') });
        hecha.addEventListener('click', function () { cambiar(c, 'confirmado', hecha); });
        botones.unshift(hecha);
      } else if (c.estado === 'abierto' || c.estado === 'reabierto') {
        var res = el('button', { class: 'enviar', type: 'button', text: txt('resolver') });
        res.addEventListener('click', function () { cambiar(c, 'resuelto', res); });
        botones.unshift(res);
      }
    }

    // El autor decide sobre lo suyo cuando se lo hemos resuelto
    if (c.estado === 'resuelto' && (mio || !esAdmin())) {
      var ok = el('button', { class: 'enviar', type: 'button', text: txt('confirmar') });
      ok.addEventListener('click', function () { cambiar(c, 'confirmado', ok); });
      var no = el('button', { class: 'secundario', type: 'button', text: txt('reabrir2') });
      no.addEventListener('click', function () { cambiar(c, 'reabierto', no); });
      botones.unshift(no); botones.unshift(ok);
    }

    if (esAdmin() && cerrado) {
      var reabrir = el('button', { class: 'secundario', type: 'button', text: txt('reabrir') });
      reabrir.addEventListener('click', function () { cambiar(c, 'reabierto', reabrir); });
      botones.push(reabrir);
    }

    /* El boton de "ir a esa pagina" solo se queda para los comentarios SIN elemento
       señalado: con elemento ya lo cubre el de arriba, que ademas resalta el sitio. */
    if (!deEstaPagina(c) && !(c.senalados || []).length) {
      var ir = el('button', { class: 'secundario', type: 'button', text: txt('irPagina') });
      ir.addEventListener('click', function () { location.href = c.url; });
      botones.push(ir);
    }

    if (botones.length) {
      var pie = el('div', { class: 'pie' });
      pie.style.flexWrap = 'wrap';
      botones.forEach(function (b) { pie.appendChild(b); });
      cuerpo.appendChild(pie);
    }

    if (c.estado === 'resuelto' && !mio) {
      cuerpo.appendChild(el('div', { class: 'nota', text: txt('notaResuelto') }));
    }

    /* Eliminar lo ve el equipo y, desde el 7-sep-2026, también el autor sobre lo suyo:
       quien escribió algo por error tiene que poder quitarlo sin pedírnoslo. Va aparte
       del resto de botones porque es la única acción sin vuelta atrás, y con
       confirmación en dos pasos dentro del panel. */
    if (esAdmin() || mio) {
      refs.borrar = el('div');
      refs.borrar.style.cssText = 'margin-top:4px';
      cuerpo.appendChild(refs.borrar);
      pintarBorrar(c);
    }

    return cuerpo;
  }

  function pintarBorrar(c, confirmando) {
    if (!refs.borrar) return;
    refs.borrar.textContent = '';

    if (!confirmando) {
      var pedir = el('button', { class: 'borrar', type: 'button', text: txt('eliminar') });
      pedir.addEventListener('click', function () { pintarBorrar(c, true); });
      refs.borrar.appendChild(pedir);
      return;
    }

    var si = el('button', { class: 'peligro', type: 'button', text: txt('eliminarSi') });
    si.addEventListener('click', function () { eliminarComentario(c, si); });
    var no = el('button', { class: 'secundario', type: 'button', text: txt('eliminarNo') });
    no.addEventListener('click', function () { pintarBorrar(c, false); });

    refs.borrar.appendChild(el('div', { class: 'confirmar' }, [
      el('p', { text: esAdmin() ? txt('eliminarAviso') : txt('eliminarAvisoMio') }),
      el('div', { class: 'opciones' }, [si, no])
    ]));
  }

  function eliminarComentario(c, boton) {
    boton.disabled = true;
    boton.textContent = txt('eliminando');
    api('/api/comentarios/' + c.id, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clave: CLAVE_ADMIN, autor_id: AUTOR_ID })
    }).then(function () {
      return cargar();
    }).then(function () {
      detalleId = null;
      vista = 'lista';
      pintarPanel();
    }).catch(function (e) {
      boton.disabled = false;
      boton.textContent = txt('eliminarSi');
      mostrarError(txt('errEliminar', e.message));
    });
  }

  function guardarEdicion(c, boton) {
    var nuevo = (refs.editar.value || '').trim();
    if (!nuevo && !(c.senalados || []).length) return mostrarError(txt('errNoVacio'));
    boton.disabled = true; boton.textContent = txt('guardando');
    api('/api/comentarios/' + c.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autor_id: AUTOR_ID, mensaje: nuevo, senalados: c.senalados })
    }).then(function () {
      return cargar();
    }).then(function () {
      editando = false; pintarPanel();
    }).catch(function (e) {
      boton.disabled = false; boton.textContent = txt('guardar');
      mostrarError(txt('errGuardar', e.message));
    });
  }

  function cambiar(c, estado, boton) {
    var antes = boton.textContent;
    boton.disabled = true; boton.textContent = txt('unMomento');
    api('/api/comentarios/' + c.id + '/estado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: estado, clave: CLAVE_ADMIN })
    }).then(function () {
      return cargar();
    }).then(function () {
      pintarPanel();
    }).catch(function (e) {
      boton.disabled = false; boton.textContent = antes;
      mostrarError(txt('errCambiar', e.message));
    });
  }

  // ------------------------------------------------------- modo señalar elemento

  var marca, etiqueta, aviso, elegido = null;

  function activarSenalar() {
    raiz.style.display = 'none';
    if (regleta) regleta.style.display = 'none';
    (capaPins || []).forEach(function (p) { p.style.display = 'none'; });
    document.documentElement.classList.add('tk-senalando');

    marca = el('div', { class: 'tk-marca' });
    etiqueta = el('div', { class: 'tk-etiqueta' });
    aviso = el('div', { class: 'tk-aviso' }, [
      el('span', { text: txt('clicParaComentar') }),
      el('span', { class: 'tk-sep' }),
      el('span', { class: 'tk-esc', text: '↑↓' }),
      el('span', { text: txt('nivelAyuda') }),
      el('span', { class: 'tk-esc', text: '←→' }),
      el('span', { text: txt('nivelHermanos') }),
      el('span', { class: 'tk-sep' }),
      el('span', { class: 'tk-esc', text: 'Esc' }),
      el('span', { text: txt('paraSalir') })
    ]);
    document.body.appendChild(marca);
    document.body.appendChild(etiqueta);
    document.body.appendChild(aviso);

    document.addEventListener('mousemove', alMover, true);
    document.addEventListener('click', alClicar, true);
    document.addEventListener('keydown', alTeclear, true);
  }

  function objetivo(e) {
    var t = e.target;
    if (!t || t === host || host.contains(t)) return null;
    if (t === marca || t === etiqueta || t === aviso) return null;
    if (t.classList && (t.classList.contains('tk-pin') || t.classList.contains('tk-tick'))) return null;
    if (t === document.documentElement || t === document.body) return null;
    return t;
  }

  /* ¿Este elemento se puede señalar? Descarta lo nuestro, la raíz del documento y
     lo que no ocupa sitio (un contenedor de 0x0 no se puede enmarcar ni entender). */
  function senalable(t) {
    if (!t || t.nodeType !== 1) return false;
    if (t === host || host.contains(t)) return false;
    if (t === marca || t === etiqueta || t === aviso) return false;
    if (t.classList && (t.classList.contains('tk-pin') || t.classList.contains('tk-tick'))) return false;
    if (t === document.documentElement || t === document.body) return false;
    var r = t.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }

  function pintarMarca(t) {
    if (!t) { marca.style.display = 'none'; etiqueta.style.display = 'none'; return; }
    var r = t.getBoundingClientRect();
    marca.style.display = etiqueta.style.display = 'block';
    marca.style.left = (r.left + scrollX) + 'px';
    marca.style.top = (r.top + scrollY) + 'px';
    marca.style.width = r.width + 'px';
    marca.style.height = r.height + 'px';
    etiqueta.textContent = t.tagName.toLowerCase() +
      (t.className && typeof t.className === 'string' ? '.' + t.className.trim().split(/\s+/)[0] : '') +
      '  ' + Math.round(r.width) + '×' + Math.round(r.height);
    var arriba = r.top > 34;
    etiqueta.style.left = (r.left + scrollX) + 'px';
    etiqueta.style.top = (arriba ? r.top + scrollY - 30 : r.bottom + scrollY + 6) + 'px';
  }

  function alMover(e) {
    var t = objetivo(e);
    elegido = t;
    pintarMarca(t);
  }

  /* Moverse por la jerarquía con el teclado. Existe porque el ratón solo alcanza el
     elemento más profundo que hay bajo el cursor: en un hero con slider no hay forma
     de elegir entre la foto, el slider y la sección entera, y son tres comentarios
     distintos. Mismo gesto que el inspector del navegador. */
  function hermano(t, dir) {
    var n = t;
    while (n) {
      n = dir < 0 ? n.previousElementSibling : n.nextElementSibling;
      if (senalable(n)) return n;
    }
    return null;
  }

  function navegar(dir) {
    if (!elegido) return false;
    var destino = null;
    if (dir === 'arriba') {
      var p = elegido.parentElement;
      while (p && !senalable(p)) p = p.parentElement;
      destino = p;
    } else if (dir === 'abajo') {
      var hijos = elegido.children;
      for (var i = 0; i < hijos.length; i++) { if (senalable(hijos[i])) { destino = hijos[i]; break; } }
    } else {
      destino = hermano(elegido, dir === 'anterior' ? -1 : 1);
    }
    if (!destino) return false;
    elegido = destino;
    pintarMarca(elegido);
    // Si el elemento nuevo se sale de la pantalla, acercarlo: si no, enmarcas a ciegas.
    var r = elegido.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) {
      elegido.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(function () { if (elegido) pintarMarca(elegido); }, 260);
    }
    return true;
  }

  function alClicar(e) {
    // Ojo: NO se relee del evento. Si se ha navegado con el teclado, el elemento
    // bueno es el que está enmarcado, no el que hay debajo del cursor.
    var t = elegido || objetivo(e);
    e.preventDefault(); e.stopPropagation();
    if (t) {
      var r = t.getBoundingClientRect();
      var nuevo = {
        selector: cssPath(t), etiqueta: t.tagName.toLowerCase(),
        texto: (t.innerText || t.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
        rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }
      };
      if (!senalados.some(function (s) { return s.selector === nuevo.selector; })) senalados.push(nuevo);
    }
    salirSenalar();
  }

  function alTeclear(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); salirSenalar(); return; }
    var dir = { ArrowUp: 'arriba', ArrowDown: 'abajo', ArrowLeft: 'anterior', ArrowRight: 'siguiente' }[e.key];
    if (!dir) return;
    e.preventDefault(); e.stopPropagation();
    navegar(dir);
  }

  function salirSenalar() {
    elegido = null;
    document.documentElement.classList.remove('tk-senalando');
    [marca, etiqueta, aviso].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
    document.removeEventListener('mousemove', alMover, true);
    document.removeEventListener('click', alClicar, true);
    document.removeEventListener('keydown', alTeclear, true);
    raiz.style.display = '';
    if (regleta) regleta.style.display = '';
    (capaPins || []).forEach(function (p) { p.style.display = ''; });
    vista = 'nuevo';
    pintarPanel();
  }

  // ----------------------------------------------------------- captura de pantalla

  function hacerCaptura() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      return mostrarError(txt('errSinCaptura'));
    }
    raiz.style.display = 'none';
    navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true })
      .then(function (stream) {
        var video = document.createElement('video');
        video.srcObject = stream; video.muted = true;
        return video.play().then(function () {
          return new Promise(function (res) { setTimeout(res, 220); }).then(function () {
            var c = document.createElement('canvas');
            c.width = video.videoWidth; c.height = video.videoHeight;
            c.getContext('2d').drawImage(video, 0, 0);
            stream.getTracks().forEach(function (t) { t.stop(); });
            return new Promise(function (res) { c.toBlob(res, 'image/png'); });
          });
        });
      })
      .then(function (blob) {
        raiz.style.display = ''; vista = 'nuevo'; pintarPanel();
        if (blob) anadir('imagen', 'captura.png', blob);
      })
      .catch(function () {
        raiz.style.display = ''; vista = 'nuevo'; pintarPanel();
        mostrarError(txt('errCaptura'));
      });
  }

  // ------------------------------------------------------------------ nota de voz

  function alternarVoz() {
    if (grabando) return pararVoz();
    if (!navigator.mediaDevices || !window.MediaRecorder) return mostrarError(txt('errSinAudio'));
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var trozos = [];
      var mr = new MediaRecorder(stream);
      mr.ondataavailable = function (e) { if (e.data.size) trozos.push(e.data); };
      mr.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(trozos, { type: mr.mimeType || 'audio/webm' });
        grabando = null; pintarBotonVoz();
        if (blob.size > 1000) anadir('audio', 'nota-de-voz.webm', blob);
      };
      mr.start();
      grabando = { mr: mr, desde: Date.now(), tope: setTimeout(pararVoz, MAX_AUDIO_MS) };
      pintarBotonVoz(); mostrarError('');
    }).catch(function () { mostrarError(txt('errMicro')); });
  }

  function pararVoz() {
    if (!grabando) return;
    clearTimeout(grabando.tope);
    try { grabando.mr.stop(); } catch (e) { grabando = null; pintarBotonVoz(); }
  }

  var tickVoz;
  function pintarBotonVoz() {
    if (!refs.btnVoz) return;
    clearInterval(tickVoz);
    if (grabando) {
      refs.btnVoz.classList.add('grabando');
      var pintar = function () {
        if (!grabando || !refs.btnVoz) return;
        var s = Math.floor((Date.now() - grabando.desde) / 1000);
        refs.btnVoz.innerHTML = ICONOS.stop;
        refs.btnVoz.appendChild(el('span', { text: txt('parar') + '  ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }));
      };
      pintar();
      tickVoz = setInterval(pintar, 1000);
    } else {
      refs.btnVoz.classList.remove('grabando');
      refs.btnVoz.innerHTML = ICONOS.micro;
      refs.btnVoz.appendChild(el('span', { text: txt('notaVoz') }));
    }
  }

  // ---------------------------------------------------------------------- envío

  function enviar() {
    var texto = (refs.mensaje.value || '').trim();
    if (!texto && !adjuntos.length && !senalados.length) {
      return mostrarError(txt('errVacio'));
    }
    if (!CFG.api) return mostrarError(txt('errSinEndpoint'));

    /* Si no ha señalado nada, se lo proponemos UNA vez. Sin señalar, el comentario
       queda suelto en la página: no podemos llevarle de vuelta ni poner la chincheta. */
    if (!senalados.length && !yaInvitado) {
      yaInvitado = true;
      invitarASenalar();
      return;
    }

    if (grabando) pararVoz();

    /* El nombre se pide UNA vez y luego se recuerda. Era opcional y en la practica se
       saltaba: con varias personas revisando la misma web, un comentario sin firmar
       obliga a preguntar de quien era, que es justo el trabajo que esto evita.
       Quien entra por su enlace personal (?tack_yo=) no ve esto nunca. */
    var autor = (refs.autor.value || '').trim();
    if (!autor) {
      mostrarError(txt('errQuienEres'));
      if (refs.autor) { refs.autor.classList.add('pide'); refs.autor.focus(); }
      return;
    }
    try { localStorage.setItem('tack_autor', autor); } catch (e) {}

    refs.enviar.disabled = true;
    refs.enviar.textContent = txt('enviando');
    mostrarError('');

    var fd = new FormData();
    fd.append('site', CFG.site);
    fd.append('mensaje', texto);
    fd.append('autor', autor);
    fd.append('autor_id', AUTOR_ID);
    fd.append('contexto', JSON.stringify(contexto()));
    if (senalados.length) fd.append('senalados', JSON.stringify(senalados));
    adjuntos.forEach(function (a, i) { fd.append('adjunto' + i, a.blob, a.nombre); });

    fetch(CFG.api + '/api/feedback', { method: 'POST', body: fd })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json().catch(function () { return {}; });
      })
      .then(function () {
        adjuntos.forEach(function (a) { URL.revokeObjectURL(a.url); });
        adjuntos = []; senalados = [];
        borrador = { mensaje: '', autor: borrador.autor };
        yaInvitado = false;   // el siguiente comentario vuelve a recibir la invitación
        return cargar();
      })
      .then(function () { vista = 'hecho'; pintarPanel(); })
      .catch(function (err) {
        refs.enviar.disabled = false;
        refs.enviar.textContent = txt('enviar');
        mostrarError(txt('errEnvio', err.message));
      });
  }

  function invitarASenalar() {
    mostrarError('');
    if (!refs.sugerencia) return;

    var si = el('button', { class: 'si', type: 'button', text: txt('invitaSi') });
    si.addEventListener('click', activarSenalar);

    var no = el('button', { class: 'no', type: 'button', text: txt('invitaNo') });
    no.addEventListener('click', function () {
      refs.sugerencia.textContent = '';
      if (refs.enviar) refs.enviar.classList.remove('atenuado');
      enviar();
    });

    refs.sugerencia.textContent = '';
    refs.sugerencia.appendChild(el('div', { class: 'sugerencia' }, [
      el('h4', { text: txt('invitaTitulo') }),
      el('p', { text: txt('invitaTexto') }),
      el('div', { class: 'opciones' }, [si, no])
    ]));

    if (refs.enviar) refs.enviar.classList.add('atenuado');

    // y el botón de señalar llama la atención un momento
    if (refs.btnSenalar) {
      refs.btnSenalar.classList.remove('llamando');
      void refs.btnSenalar.offsetWidth;   // reinicia la animación
      refs.btnSenalar.classList.add('llamando');
    }
    refs.sugerencia.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function pintarHecho() {
    raiz.textContent = '';
    var ver = el('button', { class: 'secundario', type: 'button', text: txt('verTodos') });
    ver.addEventListener('click', function () { vista = 'lista'; pintarPanel(); });
    var otro = el('button', { class: 'secundario', type: 'button', text: txt('escribirOtro') });
    otro.addEventListener('click', function () { vista = 'nuevo'; pintarPanel(); });
    var pie = el('div');
    pie.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:16px';
    pie.appendChild(ver); pie.appendChild(otro);

    raiz.appendChild(el('div', { class: 'panel' }, [
      el('div', { class: 'hecho' }, [
        el('div', { class: 'marca', html: ICONOS.check }),
        el('h3', { text: txt('recibido') }),
        el('p', { text: txt('recibidoTexto') }),
        pie
      ])
    ]));
    setTimeout(function () { if (abierto && vista === 'hecho') pintarBurbuja(); }, 5000);
  }

  // ------------------------------------------------------------------- arranque

  /* ¿Venimos de otra pagina siguiendo un feedback? El id viaja en el ancla. */
  function idDelAncla() {
    try {
      var m = /(?:^|#|&)tack=([\w-]{6,})/.exec(location.hash || '');
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  function arrancar() {
    document.body.appendChild(host);
    pintarBurbuja();
    cargar().then(function () {
      var id = idDelAncla();
      if (!id) return;
      if (!comentarios.some(function (c) { return c.id === id; })) return;
      /* Se limpia el ancla para que al recargar o compartir la direccion no vuelva a
         abrirse solo, y para no dejar basura en la barra. */
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      /* Un respiro antes de medir: al llegar de otra pagina las imagenes perezosas
         todavia estan colocandose y el sitio señalado se mueve. */
      setTimeout(function () { abrirDetalle(id); }, 450);
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();

  window.Tack = {
    abrir: function () { vista = comentarios.length ? 'lista' : 'nuevo'; pintarPanel(); },
    escribir: function () { vista = 'nuevo'; pintarPanel(); },
    cerrar: pintarBurbuja,
    recargar: cargar,
    irA: irA,
    verComentario: abrirDetalle,
    estado: function () { return { comentarios: comentarios, autorId: AUTOR_ID, admin: esAdmin() }; },
    config: CFG
  };
})();
