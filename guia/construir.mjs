/**
 * Genera la guía para clientes en los dos idiomas desde una sola fuente de textos,
 * para que no se desincronicen.
 *
 *   node guia/construir.mjs
 *
 * Salida: guia/index.html (es) y guia/en/index.html (en). Estáticas, sin dependencias.
 * Los clips los graba qa/guia-clips.mjs y viven en guia/clips/.
 */
import { mkdirSync, writeFileSync } from 'fs';

const DIR = new URL('./', import.meta.url).pathname;

/* Cada sección: título de cuatro palabras, UNA frase, y su clip. El orden es el que
   vive el cliente, no el del menú del widget. */
const SECCIONES = [
  { clip: '01-entrar', es: ['Entras por tu enlace', 'Abre la web con el enlace que te hemos mandado y pulsa la pestaña de la derecha: tu nombre ya está puesto y no tienes que registrarte.'],
    en: ['Open your personal link', 'Open the site with the link we sent you and click the tab on the right: your name is already filled in, and there is nothing to sign up for.'] },
  { clip: '02-senalar', es: ['Señala de qué hablas', 'Pulsa Señalar elemento y haz clic en lo que quieras comentar; con las flechas del teclado coges el bloque entero o el de al lado.'],
    en: ['Point at the thing', 'Click Point at element and click whatever you want to comment on; the arrow keys move you to the whole block or to the one next to it.'] },
  { clip: '03-contar', es: ['Cuéntalo con sus imágenes', 'Escribe el comentario y, si se ve mejor enseñándolo, adjunta una captura o una foto en el mismo comentario.'],
    en: ['Say it with images', 'Write your comment and, if it is easier to show than to tell, attach a screenshot or a photo in the same comment.'] },
  { clip: '04-enviar', es: ['Lo envías y listo', 'Al enviarlo nos llega al momento con la página y el navegador que estabas usando, y tú ves un Recibido.'],
    en: ['Send it and done', 'When you send it we get it straight away, along with the page and browser you were using, and you see a confirmation.'] },
  { clip: '05-marcado', es: ['La página queda marcada', 'Cada comentario deja una chincheta numerada en su sitio, y si te estorban para mirar la web las escondes con una casilla.'],
    en: ['The page gets pinned', 'Each comment leaves a numbered pin where it belongs, and if they get in your way there is a checkbox to hide them.'] },
  { clip: '06-historial', es: ['Todo queda por escrito', 'En Historial tienes lo dicho hasta ahora, filtrado por pendiente o resuelto, y al abrir un comentario se resalta la zona y puedes cambiar el texto.'],
    en: ['Everything stays written down', 'History has everything said so far, filtered by open or resolved, and opening a comment highlights the area and lets you edit your text.'] },
  { clip: '07-responder', es: ['Cada comentario es conversación', 'Puedes responder dentro del comentario tantas veces como haga falta, y en la respuesta también puedes señalar una zona o adjuntar una imagen.'],
    en: ['Each comment is a conversation', 'You can reply inside a comment as many times as you need, and a reply can also point at an area or attach an image.'] },
  { clip: '08-cerrar-eliminar', es: ['Cierras o borras lo tuyo', 'Si ya no hace falta, lo marcas como resuelto tú misma; y si prefieres que desaparezca, puedes eliminarlo.'],
    en: ['Close or delete yours', 'If it is no longer needed you can mark it resolved yourself, and if you would rather it disappeared, you can delete it.'] },
  { clip: '09-confirmar', es: ['Confirmas lo que arreglamos', 'Cuando damos algo por arreglado te lo dejamos marcado: si te encaja lo confirmas, y si sigue mal lo reabres con un clic.'],
    en: ['Confirm what we fixed', 'When we mark something as fixed you get the last word: confirm it if it works for you, or reopen it in one click if it does not.'] }
];

const EJEMPLOS = [
  { clip: 'ejemplo-1-titular', es: ['El titular no convence', 'De principio a fin: señalar el titular, contar qué falla y enviarlo.'],
    en: ['The headline is not right', 'Start to finish: point at the headline, say what is wrong and send it.'] },
  { clip: 'ejemplo-2-foto', es: ['Una foto se ve rara', 'Con captura adjunta, y lo que pasa después, cuando lo damos por resuelto.'],
    en: ['A photo looks wrong', 'With a screenshot attached, and what happens later when we mark it as fixed.'] }
];

const SABER = {
  es: {
    titulo: 'Lo que conviene saber',
    puntos: [
      ['Quién eres se guarda en este navegador.', 'Si un día entras desde otro ordenador o desde el móvil, vuelve a abrir tu enlace y seguirás firmando igual.'],
      ['Las imágenes que adjuntas nos llegan por correo.', 'Por eso no las vuelves a ver en la lista: ahí queda el texto de tu comentario.'],
      ['La web que estás viendo es una copia en revisión.', 'No es la que ven tus clientes, así que puedes comentar y probar sin miedo a romper nada.']
    ]
  },
  en: {
    titulo: 'Worth knowing',
    puntos: [
      ['Who you are is stored in this browser.', 'If one day you open it from another computer or from your phone, use your link again and you will keep signing the same way.'],
      ['The images you attach reach us by email.', 'That is why you will not see them again in the list: what stays there is the text of your comment.'],
      ['The site you are looking at is a review copy.', 'It is not the one your customers see, so you can comment and try things without breaking anything.']
    ]
  }
};

const CAB = {
  es: {
    lang: 'es', title: 'Cómo comentar la web, paso a paso',
    h1: 'Cómo comentar la web',
    entradilla: 'Todo lo que se puede hacer, en clips de unos segundos. No hace falta instalar nada ni aprenderse nada, y si solo miras el primero ya puedes empezar. Toca cualquier clip para verlo más grande.',
    ejemplosTit: 'Dos ejemplos de verdad',
    pasosTit: 'Una cosa cada vez',
    pie: 'Hecho por'
  },
  en: {
    lang: 'en', title: 'How to comment on the site, step by step',
    h1: 'How to comment on the site',
    entradilla: 'Everything you can do, in clips of a few seconds. Nothing to install and nothing to learn, and watching the first one is enough to get going. Tap any clip to see it larger.',
    ejemplosTit: 'Two real examples',
    pasosTit: 'One thing at a time',
    pie: 'Made by'
  }
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* El mp4 pesa unas diez veces menos que el GIF (1,5 MB los once frente a 9,2 MB), así que
   en la página manda el vídeo. El poster es un JPG de mitad del clip, no el GIF: un poster
   de 800 KB deja la página inservible en el móvil del cliente, y el primer fotograma sale
   en blanco. El GIF queda de respaldo para el navegador que no reproduzca el vídeo, y es lo
   que se incrusta en el correo. El vídeo se descarga solo cuando entra en pantalla (el
   script del final): once autoplay a la vez son 1,5 MB de golpe en una conexión móvil. */
function pieza(clip, titulo, frase, ruta) {
  return `      <section class="paso">
        <h3>${esc(titulo)}</h3>
        <p>${esc(frase)}</p>
        <video autoplay muted loop playsinline preload="none" poster="${ruta}clips/${clip}.jpg" aria-label="${esc(titulo)}">
          <source data-src="${ruta}clips/${clip}.mp4" type="video/mp4">
          <img src="${ruta}clips/${clip}.gif" alt="${esc(titulo)}">
        </video>
      </section>`;
}

function pagina(idioma) {
  const c = CAB[idioma];
  const ruta = idioma === 'es' ? './' : '../';
  const otro = idioma === 'es'
    ? `<a href="./en/">English</a>`
    : `<a href="../">Español</a>`;

  const ejemplos = EJEMPLOS.map((e) => pieza(e.clip, e[idioma][0], e[idioma][1], ruta)).join('\n');
  const pasos = SECCIONES.map((s) => pieza(s.clip, s[idioma][0], s[idioma][1], ruta)).join('\n');
  const saber = SABER[idioma].puntos
    .map(([a, b]) => `        <li><span>${esc(a)}</span> ${esc(b)}</li>`).join('\n');

  return `<!doctype html>
<html lang="${c.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(c.title)}</title>
<style>
  :root {
    --fondo: #14151a;
    --panel: #1b1d24;
    --linea: #2b2f3a;
    --texto: #f1f3f7;
    --suave: #9aa3b2;
    --acento: #9a6b45;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    background: var(--fondo); color: var(--texto);
    line-height: 1.6; padding: 56px 24px 72px;
  }
  .caja { max-width: 760px; margin: 0 auto; }
  header { margin-bottom: 44px; }
  h1 { font-size: 30px; font-weight: 650; letter-spacing: -.02em; margin-bottom: 12px; }
  .entradilla { color: var(--suave); font-size: 16px; max-width: 60ch; }
  .idioma { margin-top: 18px; font-size: 13.5px; }
  .idioma a { color: var(--suave); text-decoration: none; border-bottom: 1px solid var(--linea); padding-bottom: 2px; }
  .idioma a:hover { color: var(--texto); border-color: var(--acento); }
  h2 {
    font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .09em;
    color: var(--suave); margin: 52px 0 20px; padding-bottom: 10px; border-bottom: 1px solid var(--linea);
  }
  .paso { margin-bottom: 40px; }
  .paso h3 { font-size: 18.5px; font-weight: 620; margin-bottom: 6px; letter-spacing: -.01em; }
  .paso p { color: var(--suave); font-size: 15px; margin-bottom: 16px; max-width: 62ch; }
  .paso video, .paso img {
    width: 100%; height: auto; display: block; border-radius: 12px;
    border: 1px solid var(--linea); background: var(--panel);
  }
  .saber { background: var(--panel); border: 1px solid var(--linea); border-radius: 14px; padding: 24px 26px; }
  .saber ul { list-style: none; }
  .saber li { color: var(--suave); font-size: 15px; padding: 12px 0; border-bottom: 1px solid var(--linea); }
  .saber li:last-child { border-bottom: 0; padding-bottom: 0; }
  .saber li:first-child { padding-top: 0; }
  .saber li span { color: var(--texto); }
  footer { margin-top: 56px; padding-top: 22px; border-top: 1px solid var(--linea); color: var(--suave); font-size: 13.5px; }
  footer a { color: var(--suave); }
  @media (max-width: 600px) {
    body { padding: 36px 18px 56px; }
    h1 { font-size: 25px; }
    .paso { margin-bottom: 34px; }
  }
  @media (prefers-reduced-motion: reduce) { video { animation: none; } }
</style>
</head>
<body>
  <div class="caja">
    <header>
      <h1>${esc(c.h1)}</h1>
      <p class="entradilla">${esc(c.entradilla)}</p>
      <p class="idioma">${otro}</p>
    </header>

    <h2>${esc(c.ejemplosTit)}</h2>
${ejemplos}

    <h2>${esc(c.pasosTit)}</h2>
${pasos}

    <h2>${esc(SABER[idioma].titulo)}</h2>
    <div class="saber">
      <ul>
${saber}
      </ul>
    </div>

    <footer>${esc(c.pie)} <a href="https://www.websalia.com/?utm_source=feedtack&amp;utm_medium=guia" target="_blank" rel="noopener">Websalia</a></footer>
  </div>
<script>
/* Cada vídeo se descarga cuando llega a la pantalla, no al abrir la página. Sin
   IntersectionObserver (navegador viejo) se cargan todos, que es como estaba antes. */
(function () {
  var vids = [].slice.call(document.querySelectorAll('video'));
  function cargar(v) {
    if (v.dataset.puesto) return;
    v.dataset.puesto = '1';
    var s = v.querySelector('source[data-src]');
    if (s) { s.src = s.dataset.src; v.load(); v.play().catch(function () {}); }
  }
  /* En el móvil el clip se queda en unos 350 px de ancho y el panel del widget no se
     lee. Tocarlo lo abre a pantalla completa, que es lo que se espera de un vídeo. */
  vids.forEach(function (v) {
    v.style.cursor = 'zoom-in';
    v.addEventListener('click', function () {
      var f = v.requestFullscreen || v.webkitRequestFullscreen || v.webkitEnterFullscreen;
      if (f) f.call(v);
    });
  });
  if (!('IntersectionObserver' in window)) return vids.forEach(cargar);
  var obs = new IntersectionObserver(function (e) {
    e.forEach(function (x) { if (x.isIntersecting) { cargar(x.target); obs.unobserve(x.target); } });
  }, { rootMargin: '300px 0px' });
  vids.forEach(function (v) { obs.observe(v); });
})();
</script>
</body>
</html>
`;
}

mkdirSync(DIR + 'en', { recursive: true });
writeFileSync(DIR + 'index.html', pagina('es'));
writeFileSync(DIR + 'en/index.html', pagina('en'));
console.log('guia/index.html y guia/en/index.html generadas');
