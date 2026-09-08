# Videotutorial de Feedtack — notas de montaje

Dos vídeos, grabados sobre la **demo de Vallmar Arquitectura** (cliente ficticio:
`https://feedtack.dev`), con la skill `tutorial-video`.

- `00-entrar/guion.json` → `feedtack-00-entrar.mp4` (1:23) — entrar y dejar el primer comentario.
- `01-despues/guion.json` → `feedtack-01-despues.mp4` (1:33) — lo que pasa con lo que ya has dicho.

```bash
cd "$TUTORIAL_VIDEO"   # tools/tutorial-video del sistema de Websalia
node tutorial-video.mjs todo videos/tutorial/00-entrar/guion.json
node tutorial-video.mjs todo videos/tutorial/01-despues/guion.json
```

🔴 **Un guion por carpeta, siempre.** La herramienta escribe `capturas/` y `capturas/plan.json`
al lado del guion, así que dos guiones en la misma carpeta se pisan las capturas y el montaje del
primero acaba usando el plan del segundo, sin decir nada.

## Nada se envía de verdad

Los dos guiones llevan `simularApi` sobre las seis rutas que el widget escribe. Se comprueba
mirando que la captura NO deje ningún aviso de `ESCRITURA NO SIMULADA`: si una escritura se
escapa del patrón, la herramienta la aborta y lo dice.

🔴 **Los patrones van con `**`, no con `*`.** El widget edita, responde, resuelve y borra en
subrutas del id (`/api/comentarios/<id>/estado`), y `*` no cruza la barra.

## El ejemplo es el mismo de principio a fin

Los dos vídeos usan los mismos dos comentarios que la guía de GIFs, para poder compararlas:

1. **El titular** (`.hero h1`): *"El titular tendría que hablar de rehabilitación, que es lo que
   más nos piden."* Se escribe en el 00 y se edita, se responde y se cierra en el 01.
2. **La foto** (`.hero .media`): *"Esta foto se ve rara en el móvil, se corta por arriba."* Es la
   que damos por resuelta nosotros, y en el 01 se confirma y se reabre.

## Lo que el widget NO tiene hoy, y por eso no sale en la voz

- **Nota de voz**: retirada de la interfaz el 7-sep-2026 a petición de Álvaro
  (`widget/feedtack.js:1113`, comentada). El guion habla solo de captura y adjuntar.
- El disparador es una **pestaña pegada al borde derecho**, no un botón flotante. La franja de
  arriba de la demo todavía dice "el botón de abajo a la derecha": es texto de la demo, no del
  widget, y sale en pantalla mientras la voz dice pestaña.

🔒 **Si el widget vuelve a cambiar, estos vídeos caducan.** No se puede retocar una frase de la
voz sin volver a montar, y una acción o un selector que cambien obligan a recapturar.
