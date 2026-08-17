# 🧹 Escoba Voladora — MVP

Deporte competitivo 2.5D de fantasía: magos agarrados permanentemente a escobas
controladas físicamente con el mouse usan velocidad, inercia y sus propios
cuerpos ragdoll para pelear por una pelota y meterla en el portal rival.

## Jugar

```bash
node server.js
```

→ http://localhost:5680

## Controles

| Entrada | Acción |
|---|---|
| **Mouse** | Apuntar la escoba (persigue el cursor con inercia física) |
| **Click izquierdo** | Acelerar hacia donde apunta la escoba |
| **Click derecho** | Freno aéreo (el cuerpo sigue de largo → brake kick) |
| **Espacio (mantener)** | Cargar el latigazo (el cuerpo se recoge y se enrolla) |
| **Espacio (soltar)** | Latigazo: el cuerpo gira alrededor de las manos y patea |
| **Shift** | Impulso mágico: gasta la energía de los orbes (2x aceleración) |
| **P / Esc** | Pausa |
| **R** | Reiniciar partido |
| **F3** | Overlay de físicas |

## Flags de URL

- `?debug` — overlay de físicas (puntos, constraints, velocidades)
- `?bots` — IA vs IA (para observar el juego solo)
- `?fast` — partido de 30 segundos

## Reglas

- 1v1, partidos de 2:30. Gol = meter la pelota completamente en el portal rival.
- Empate al final del tiempo → **Gol de Oro** (el siguiente gol gana).
- Sin barra de vida, sin botón de patear: todos los golpes surgen de la física.
- Las manos **nunca** se sueltan de la escoba.

## El golpe (Space)

Mantené `Space` para cargar y soltá para golpear. **Vos apuntás con el mouse, el
golpe pone la potencia.**

Si la pelota está dentro del círculo punteado que aparece al cargar, el golpe se
vuelve *dirigido* y **conecta siempre**: el personaje se lanza hacia ella y sigue
girando y persiguiéndola hasta tocarla — aunque esté de espaldas y aunque los
pies no lleguen de una. Al cargar se ve una flecha desde la pelota mostrando
exactamente por dónde va a salir.

El círculo dibujado es más chico que el radio real de captura (`shownRange`), a
propósito: durante la carga la pelota se mueve, y el margen garantiza que todo lo
que se ve adentro efectivamente conecte. Promete de menos y cumple.

Medido en todo el círculo: conecta 11-12 de cada 12 intentos, error de dirección
~5-7°, la pelota sale a 890-1200 u/s. Fuera del círculo el golpe puede fallar:
ese es el riesgo, y se compromete al soltar.

Un toque corto de `Space` no dispara nada y sigue sirviendo solo para girar más
rápido.

Cómo funciona por debajo: el cuerpo orbita **el agarre de las manos**, no el
centro de la escoba. Por eso el pie llega a 131 de alcance efectivo contra los 96
del palo. Complemento necesario: solo la **punta** de la escoba pega fuerte — si
todo el palo golpeara, barrería un círculo mayor que las piernas y le robaría
todos los contactos al cuerpo.

## Orbes y energía

Orbes mágicos repartidos por la arena. Los del centro caen sobre la ruta directa
a la pelota; los de los costados obligan a desviarse — ahí está la decisión de
ir por la pelota o cargar energía para la próxima jugada.

Atravesarlos los absorbe al instante (partículas que viajan hacia la escoba) y
llena el frasco del HUD. Con `Shift` se gasta esa reserva: **823 → 1663 u/s**,
la reserva completa dura ~2 s. Al recogerse reaparecen a los 7 s, materializándose
de a poco con un anillo de progreso para poder anticiparlos.

Todo se ajusta en `CFG.orbs` (cantidad, posiciones en fracciones del campo,
energía, respawn) y `CFG.boost`.

## Escoba clavada

Si la **punta** pega de frente contra un muro, el suelo o el techo a suficiente
velocidad, la escoba queda clavada hasta 2 s. Las manos siguen agarradas y el
mago forcejea visiblemente: torso estirado hacia donde apuntás, piernas
balanceándose, escoba vibrando, chispas en el punto de impacto. Cinchar (mouse +
acelerador) libera antes — medido: 0.99 s forcejeando contra 1.43 s sin hacer
nada — y al soltarse sale disparado.

Filtros para que sea gracioso y no un castigo: solo con alineación ≥ 0.82
(medido: a 25° clava, a 50° no) y velocidad ≥ 520. Roces y golpes de costado
nunca clavan. Ajustable en `CFG.stuck`.

## Presentación

**Inicio**: la cámara arranca pegada al mago a 2.6x durante ~1 s (se aprecian
skin, capa y sombrero mientras el cuerpo reacciona con físicas), después se abre
revelando rival, pelota, portales y límites, y aterriza exacto en el encuadre de
gameplay justo antes del GO.

**Gol**: el portal acumula energía una fracción de segundo, después detona con
una onda expansiva que empuja físicamente a todos los jugadores en 900 de radio
— salen despedidos girando, sin soltar la escoba. Cámara lenta breve para ver el
caos, y vuelta rápida al juego. Ajustable en `CFG.intro` y `CFG.goalBlast`.

## Escena de práctica

**http://localhost:5680/test** — sin rivales, sin arcos, sin reloj. Solo el
jugador y una pelota que nunca se escapa (los portales son pared). Muestra la
velocidad del último golpe y si salió dirigido o libre. `R` reubica la pelota
delante tuyo.

## Arquitectura (public/src/)

- `config.js` — todos los números de tuning centralizados
- `broom.js` — cuerpo rígido dominante (mouse → torque, thrust, freno)
- `rider.js` — active ragdoll verlet: postura deseada + física, manos fijas
- `ball.js` / `arena.js` — pelota física, muros, portales con succión suave

### El mapa

El campo **es** la imagen `public/1 mapa.jpeg` (2752x1536). El mundo usa
píxeles de esa imagen con el origen en su centro, y la imagen se dibuja dentro
de la transformación de cámara: por eso cada muro pintado cae exactamente sobre
su límite físico. La cámara es fija — siempre se ve el mapa completo, sin paneo
ni zoom.

Los límites viven en `CFG.arena` (`L`/`R`/`T`/`B`, `portalY`, `portalR`) y están
calibrados a mano sobre el arte: los laterales en el plano de los arcos
rúnicos, el suelo sobre el césped. `?debug` dibuja esos límites encima de la
imagen para verificar la calibración.

Para cambiar de mapa: reemplazar la imagen, ajustar `src`/`imgW`/`imgH` y
recalibrar `L`/`R`/`T`/`B` con `?debug`.
- `collisions.js` — cuerpo↔pelota, escoba↔pelota, jugador↔jugador (embestidas)
- `bot.js` — IA: ataque/defensa/rodeo/anti-atasco, cursor con velocidad limitada
- `match.js` — countdown, goles (slowmo), marcador, tiempo, gol de oro
- `render.js` — escena 2.5D (parallax, portales, personajes desde el ragdoll), HUD
- `sound.js` — audio 100% sintetizado (WebAudio, sin assets)

En consola: `window.__sim(segundos)` simula el partido sin render (testing de físicas).
