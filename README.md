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

## Modos

| URL | Modo |
|---|---|
| `/` | 1v1 contra un bot |
| `/?2v2` | 2v2 — vos + un compañero bot contra dos rivales |

En 2v2 el compañero usa una variante más clara del color de equipo y una flecha
marca cuál sos vos. Los bots se reparten roles: el que está más cerca va a la
pelota y el otro cubre el arco, para que no se amontonen los dos.

## Flags de URL

- `?debug` — overlay de físicas (puntos, constraints, velocidades)
- `?bots` — IA vs IA (para observar el juego solo)
- `?fast` — partido de 30 segundos
- `?2v2` — partido de dos contra dos

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

### Potencia: carga × energía × fuego

La fuerza del golpe se decide **al soltar** y depende de cuánto mantuviste
`Space` y de cuánta energía de orbes tenés en el frasco. Promedio de 6 tiros
por fila:

| | Velocidad de la pelota |
|---|---|
| Toque rápido, sin energía | 1133 |
| Carga máxima, sin energía | 1392 |
| Carga máxima, frasco al 49% | 1650 |
| **Carga máxima, frasco al 51%** | **2187** 🔥 |
| **Carga máxima, frasco lleno** | **2445** 🔥 |

### 🔥 Tiro de fuego

Con **media reserva o más**, el golpe sale inflamado: suma potencia encima de
todo lo demás y **prende la pelota**, que vuela con una estela de cometa
naranja hasta ~2,4 s. Es un umbral y no una rampa a propósito — mirás el frasco
y ya sabés si te toca el cañonazo, así guardar energía deja de ser abstracto.

El salto en el umbral es del 33% (1650 → 2187), y hay un **piso garantizado**
(`fireMinPower`): gastar media reserva siempre paga, aunque conectes mal.

Un tiro normal recorre ~1955 de cancha antes de volverse defendible; uno
inflamado, **2605 de los 3169** que mide el campo — llega al arco rival desde
tu propia mitad.

El anillo de carga lo anticipa todo: se llena mientras mantenés, destella al
máximo, un anillo interior muestra la energía, y **se vuelve naranja con
lenguas de fuego girando** cuando el tiro va a salir inflamado.

Cada golpe gasta 30 de energía, así que la reserva se reparte entre impulso
mágico y cañonazos. Poner `CFG.whip.energyCost` en 0 si preferís que no gaste.
Todo el escalado vive en `CFG.whip` (`chargeFull`, `chargeBonus`, `energyBonus`,
`fireThreshold`, `fireBonus`, `fireMinPower`).

Cómo funciona por debajo: el cuerpo orbita **el agarre de las manos**, no el
centro de la escoba. Por eso el pie llega a 131 de alcance efectivo contra los 96
del palo. Complemento necesario: solo la **punta** de la escoba pega fuerte — si
todo el palo golpeara, barrería un círculo mayor que las piernas y le robaría
todos los contactos al cuerpo.

## Cámara

Dinámica: sigue el **promedio entre vos y la pelota**, y se acerca cuando la
tenés cerca (jugada en marcha) y se aleja cuando está lejos (más contexto para
ubicarse). Ya no muestra el mapa completo, así que los arcos quedan fuera de
cuadro seguido — para eso hay **flechas en el borde de la pantalla**, en el
color del equipo dueño, que apuntan hacia el arco cuando no está visible.

El paneo nunca deja ver más allá del borde del mapa pintado (clamp contra los
límites de la imagen). Ajustable en `CFG.camera` (`closeDist`, `farDist`,
`zoomClose`, `zoomFar`, `followSpeed`, `zoomSpeed`).

Los temblores de cámara por golpe suelto se sacaron: ahora quedan reservados
para la explosión de gol, que sigue siendo el único momento con sacudida
grande y controlada.

## Embestidas

Chocar a un rival lo empuja y lo desestabiliza, y **la fuerza sale de tu
velocidad de acercamiento** — pega con la escoba o con el cuerpo, da igual.
Es una jugada: sacar al rival de posición antes de que llegue a la pelota.

| Tu velocidad al embestir | El rival sale despedido a |
|---|---|
| 150 (rozando) | 60 — nada |
| 400 | 77 |
| 800 | 341 |
| 1300 (a fondo con boost) | 1262 |

Además le mete un giro que le arruina el apuntado un instante, y despega al que
estuviera clavado en una pared.

Tiene costo: embestir te frena fuerte (medido: 1300 → 198). Fallar la embestida
te deja fuera de posición, que es el riesgo que la hace una decisión.

A un **compañero** apenas lo movés (el bonus de embestida baja al 22% y el
rebote entre aliados es la mitad de duro). Igual se estorban si se chocan — no
se atraviesan — porque eso es parte del humor del deporte.

Ajustable en `CFG.ram` (`minSpeed`, `push`, `maxPush`, `spin`, `recoil`,
`allyMul`, `cooldown`).

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

## ✨ Orbe fugitivo — energía ilimitada

Cada ~40 s aparece un orbe **dorado y mucho más grande** que **huye de todos**.
Atraparlo da **9 segundos de energía ilimitada**: el frasco no baja, el impulso
es gratis y todos los golpes salen inflamados.

El partido no se detiene: ir por él es soltar la pelota, y ahí está la decisión.

**El bucle de diseño**: el fugitivo vuela más rápido que una escoba normal
(823) pero más lento que una con impulso (1663) — para alcanzarlo hay que
gastar reserva, y lo que reparte es reserva. Apostás energía para ganar energía
infinita. Medido con 12 persecuciones por fila:

| | Lo atrapa | Tiempo promedio |
|---|---|---|
| Con impulso (frasco lleno) | **9/12** | 6,8 s |
| Sin impulso (frasco vacío) | 3/12 | los que salen son spawns con suerte |

Gastar energía **triplica** las chances.

**Cómo escapa**: huye de cada perseguidor en *diagonal* (no en línea recta, que
sería fácil de interceptar), esquiva las paredes antes de que lo acorralen, y
deambula tranquilo cuando nadie lo persigue.

**Cansancio** — es lo que le da arco a la persecución. La reserva llena da
apenas ~2 s de impulso, así que sin esto el orbe se escapaba siempre pasada esa
ventana. Esprintar lo agota en ~4 s, y agotado corre más lento que vos **y casi
no zigzaguea**. Eso segundo importa más que lo primero: medido, un orbe cansado
corría a 626 contra 860 del jugador y aun así la distancia oscilaba entre 100 y
380 sin cerrar nunca, porque la escoba tiene demasiada inercia para seguir un
zigzag. Recién cuando deja de esquivar, la persecución converge.

Si nadie lo alcanza en 20 s se desvanece (parpadea antes de irse) y vuelve más
tarde. Un anillo dorado avisa dónde va a aparecer 1,6 s antes, hay una **flecha
en el borde de la pantalla** cuando queda fuera de cámara, y mientras dura el
premio el frasco se vuelve oro con un contador `∞ 9.0s`.

Los bots también lo persiguen — va el mejor parado del equipo, salvo que esté
apagando un incendio en su propio arco, y gasta impulso para alcanzarlo.

Todo en `CFG.runner` (`speed`, `every`, `life`, `buff`, `fleeRange`, `dodge`,
`panicGain`, `stamDrain`, `tiredSpeed`, `tiredDodge`, `chaseRange`).

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

**Gol (estilo Rocket League)**: el portal acumula energía una fracción de
segundo y después **detona**. Fogonazo blanco de pantalla, onda expansiva y
**todos los magos salen volando** — sin soltar la escoba, girando y estampados
contra el campo por un sesgo hacia abajo. Cámara lenta para ver el caos, y
vuelta rápida al juego.

El alcance (3600) supera la diagonal de la cancha a propósito: **nadie se
salva**. Medido en 2v2, un gol en el arco derecho lanza a los cuatro:

| Distancia al portal | Velocidad antes → después |
|---|---|
| 1481 (encima) | 735 → **2958** |
| 3046 | 1097 → 2344 |
| 3092 | 404 → 1619 |
| 3142 (arco opuesto) | 488 → 1434 |

El piso del falloff (`minPush`) es lo que garantiza que el del arco opuesto
igual se entere. Ajustable en `CFG.intro` y `CFG.goalBlast`.

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
su límite físico. La cámara es dinámica (ver sección "Cámara" más arriba) —
la imagen es fija, la cámara la recorre.

Los límites viven en `CFG.arena` (`L`/`R`/`T`/`B`, `portalY`, `portalR`) y están
calibrados a mano sobre el arte: los laterales en el plano de los arcos
rúnicos, el suelo sobre el césped. `?debug` dibuja esos límites encima de la
imagen para verificar la calibración.

Para cambiar de mapa: reemplazar la imagen, ajustar `src`/`imgW`/`imgH` y
recalibrar `L`/`R`/`T`/`B` con `?debug`.

### Dos escalas independientes

Arriba de `config.js` hay dos constantes que no hay que confundir:

- **`MAP`** (1.28) estira la imagen y los límites por igual → agranda la
  **cancha**. Da más espacio para volar (necesario en 2v2), pero achica a los
  magos en pantalla.
- **`CHAR`** (1.4) multiplica la escoba, las posturas del ragdoll, los radios de
  colisión y los grosores de dibujo → agranda al **personaje** sin tocar el
  campo. Es el contrapeso de `MAP`.

`CHAR` está pensado para tocarse solo: todo lo que depende del tamaño del mago
sale de `CFG.charScale`. Verificado que no altera el balance — 9 partidos
bot-vs-bot dan 10,3 goles por partido con `CHAR` 1.4 contra 10,0 con 1.0.
- `collisions.js` — cuerpo↔pelota, escoba↔pelota, jugador↔jugador (embestidas)
- `bot.js` — IA: ataque/defensa/rodeo/anti-atasco, cursor con velocidad limitada
- `match.js` — countdown, goles (slowmo), marcador, tiempo, gol de oro
- `render.js` — escena 2.5D (parallax, portales, personajes desde el ragdoll), HUD
- `sound.js` — audio 100% sintetizado (WebAudio, sin assets)

En consola: `window.__sim(segundos)` simula el partido sin render (testing de físicas).
