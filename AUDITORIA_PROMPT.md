# Prompt: auditoría del juego principal — Escoba Voladora

Copiá y pegá todo el bloque de abajo en una sesión de Claude Code (podés usar
esta misma). No pidas que toque código: es solo diagnóstico.

---

Quiero una auditoría completa del **juego principal** de Escoba Voladora
(no las escenas de prueba como dash.js/wasd.js/test.js/heroes.js, ni el
editor). Buscá bugs, casos borde rotos, incoherencias de diseño y cosas que
puedan arruinar una partida real. NO toques código — solo reportá.

## Alcance

Revisá estos módulos y cómo interactúan entre sí:
- `main.js` — loop principal, controles, orquestación de física
- `match.js` — estados del partido (countdown/play/goal/end), reset, slowmo
- `player.js` — jugador (escoba + jinete + control), energía
- `broom.js` — física de la escoba, propulsión, golpazo contra pared
- `rider.js` — ragdoll verlet, poses, latigazo, inercia
- `bot.js` — IA rival
- `ball.js` — física de la pelota
- `arena.js` — colisiones contra el mapa, portales/gol
- `collisions.js` — jugador↔jugador, jugador↔pelota
- `orbs.js` — orbes de energía y el orbe fugitivo
- `camera.js` — cámara de juego
- `render.js` — dibujo, HUD
- `config.js` — todos los números de tuning (para detectar inconsistencias
  entre lo que dice el comentario y el valor real, o valores que no calzan
  con otros relacionados)

## Qué buscar específicamente

1. **Bugs de estado**: campos que un `reset()` no limpia y sobreviven al
   punto siguiente; flags que quedan `true`/activos cuando no deberían;
   referencias a objetos que ya no existen o cambiaron de forma.
2. **Casos borde de física**: división por cero, valores `NaN`/`Infinity` que
   se puedan colar (velocidades extremas, distancias cero, ángulos
   degenerados), timesteps grandes tras un frame lento (tab en segundo plano,
   lag), acumuladores que puedan crecer sin límite.
3. **Condiciones de carrera entre sistemas**: dos sistemas que escriben el
   mismo campo en el mismo frame y se pisan; orden de ejecución del que algo
   depende implícitamente y que un cambio futuro podría romper fácil.
4. **IA (`bot.js`)**: modos de decisión que puedan quedar "pegados" (never
   transiciona), condiciones que se contradicen entre sí, situaciones donde
   el bot puede autolesionarse (autogol, quedar inmóvil, apuntar mal) además
   de las ya conocidas y arregladas.
5. **Consistencia de config**: valores en `config.js` que ya no se leen en
   ningún lado (código muerto de un sistema viejo), o al revés, código que
   lee un campo de config que no existe.
6. **HUD/render**: información que puede mostrarse desincronizada del estado
   real (ej. cargas de dash, energía, cuenta regresiva) en transiciones de
   estado del partido.
7. **Rendimiento**: bucles o asignaciones que crecen con el tiempo de partida
   (arrays que no se acotan, listeners que se duplican), no solo el costo por
   frame ya revisado.
8. **Multiplayer local / 2v2** (`?2v2` en la URL): lógica que asuma 1v1 en
   algún lugar y se rompa con más jugadores.

## Cómo reportar

Para cada hallazgo:
- **Archivo y línea** (o rango) donde está.
- **Qué pasa exactamente** (mecanismo, no solo síntoma).
- **Cómo se dispara**: la secuencia mínima de acciones/estado que lo produce.
- **Severidad**: crítico (rompe la partida o la deja injugable) / medio
  (se nota y molesta, pero el partido sigue) / menor (cosmético o muy raro
  de que ocurra).
- **Confianza**: si lo verificaste corriendo algo (consola del navegador,
  simulación con `window.__sim`/`window.__stepOnce`) marcalo como
  confirmado; si es lectura de código y razonamiento, marcalo como
  sospecha razonada.

Ordená el reporte final por severidad (crítico primero) y no toques nada del
código — esto es solo para decidir después, con vos, qué se arregla y en qué
orden.
