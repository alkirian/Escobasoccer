# Auditoría del juego principal — Escoba Voladora

> **ESTADO: los 7 hallazgos están ARREGLADOS y verificados.**
> Ver `PLAN_ARREGLOS.md` para el detalle de cada cambio. Este documento
> queda como registro de qué se encontró y cómo se midió.


Alcance: `main.js` y sus módulos (match, player, broom, rider, bot, ball,
arena, collisions, orbs, camera, render, config). No se tocó código.

Método: lectura cruzada de los módulos + verificación en el navegador con
`window.__stepOnce` / `window.__sim` sobre el juego corriendo.

---

## CRÍTICO

### 1. La cámara lenta del gol acorta el festejo a menos de la mitad
**`main.js:573`** (`match.update(dtReal, world)`) contra **`main.js:594`**
(`acc += dtReal * match.timeScale`) · **confirmado**

`Match.update()` recibe **tiempo real** mientras la física corre al 22%.
Todos los temporizadores del festejo (`goalT`, `slowT`, `blastWave`,
`flashT`, `scorePunch`) viven dentro de `match.update`, así que avanzan
**4.5× más rápido que el mundo que están cronometrando**.

Traza medida, muestras equiespaciadas durante un gol:

| timeScale | cuánto baja `goalT` por muestra |
|---|---|
| 1.00 (antes de la explosión) | 0.05 |
| 0.22 (cámara lenta) | **0.23** |

Efecto: `CFG.match.goalPause` dice 2.6 s, pero el tramo en cámara lenta se
consume en ~0.58 s de tiempo real. La explosión, que es el momento más
vistoso del juego, se corta antes de poder verse — y el saque siguiente
llega antes de lo que el config declara.

Es además la causa raíz de que el slowmo "no se sienta": no es solo que se
vea a tirones (eso ya se arregló), es que **dura mucho menos de lo
configurado**.

*Nota sobre el fix*: no alcanza con pasar `dtReal * timeScale` a
`match.update`, porque `timeLeft` (el reloj del partido) sí debe correr en
tiempo real. Hay que escalar solo los temporizadores del estado `goal`.

---

### 2. En móvil el dash nunca se recarga y el giro no existe
**`main.js:262-273`** (rama `touch.active`) · **confirmado**

Toda la lógica de dash (recarga, disparo, cooldown) y de giro/carga vive
dentro del `else` de mouse/teclado. La rama táctil no la ejecuta nunca.

Medido: con `touch.active`, arrancando en 0 cargas y jugando 10 s, las
cargas siguen en **0** (`rechargeT` ni siquiera avanza).

Consecuencias en móvil:
- El dash se puede usar 2 veces por partido y nunca más.
- El HUD dibuja los dos ⚡ y el contador de recarga, que **mienten**.
- El golpe es el latigazo viejo (`control.tuck`), no el sistema de giro que
  usa el jugador de escritorio: son dos juegos distintos según el
  dispositivo.
- Tampoco hay boost (`updateEnergy(dt, false)` fijo), así que la barra de
  energía verde no cumple ninguna función.

Dado que hay una versión móvil explícita (viewport, joystick, aviso de
rotar pantalla), esto deja esa versión a medio camino.

---

## MEDIO

### 3. Con frames lentos el reloj adelanta respecto al juego
**`main.js:531`** (`dtReal` capeado a 0.1) y **`main.js:596-602`**
(`maxSteps = 6`) · **confirmado**

El acumulador ejecuta como máximo 6 pasos por frame y descarta el resto
(`if (steps === maxSteps) acc = 0`). Pero `timeLeft` se descuenta con
`dtReal` completo.

| Duración del frame | Física simulada | Tiempo perdido |
|---|---|---|
| 16 ms (normal) | 100% | 0% |
| 100 ms (pico de lag) | 50% | **50%** |

El cap de 0.1 s en `dtReal` acota el daño, pero en una tanda de frames
lentos el cronómetro corre hasta el doble de rápido que el partido. En un
partido de 2:30 con lag sostenido se pierde tiempo de juego real.

### 4. El bot que cubre en 2v2 se para a la altura equivocada
**`bot.js:135`** (`this.desired.y = bp.y * 0.55`) · **confirmado por lectura
y valores**

En modo `cover` la coordenada X interpola correctamente hacia
`ownPortal.x`, pero la Y interpola hacia **`y = 0` absoluto** en vez de
hacia `portalY`.

`CFG.arena.portalY` vale **97.28**, así que el defensor se posiciona ~97
unidades por encima del centro real del arco que intenta cubrir. Es un
error sistemático, siempre en la misma dirección.

Solo afecta al modo `?2v2`.

### 5. El HUD del dash duplica constantes en vez de leerlas
**`render.js:1432`** (`const DASH_RECHARGE = 4.0, DASH_MAX = 2`) ·
**confirmado**

Los valores reales viven en `main.js:22-27` (`DASH.recharge`,
`DASH.maxCharges`). El HUD los repite a mano. Hoy coinciden, pero cambiar
el tuning en `main.js` deja el HUD mostrando un contador de recarga
incorrecto y, si se cambiara `maxCharges`, dibujando la cantidad
equivocada de rayos, sin ningún error visible que lo delate.

Es deuda, no un bug activo: el síntoma aparece recién cuando alguien
ajuste el dash.

---

## MENOR

### 6. En modo `?bots` el HUD muestra controles que no responden
**`main.js:377`** (`if (!BOTS && !touch.active)`) · **confirmado por lectura**

Con `?bots` el jugador humano lo maneja una IA, así que el bloque de giro
nunca corre y el dash nunca se dispara. Pero `render.js` sigue dibujando la
barra de energía, los dos rayos y el anillo de carga como si fueran
interactivos. Es un modo de observación/debug, así que el impacto real es
bajo.

### 7. `CFG.ram.freeStuck` quedó con nombre de un sistema que ya no existe
**`config.js:282`** · **confirmado**

Se llama `freeStuck` ("liberar al clavado") y su comentario habla de
despegar a quien estaba clavado en una pared, pero la clavada se eliminó.
Hoy lo usa `collisions.js:165` para cancelar el aturdimiento del golpazo
(`slamT`), que es un uso legítimo — el nombre y el comentario son los que
quedaron viejos.

---

## Verificado y SIN problemas

Vale la pena registrar qué se probó y salió bien, para no volver a mirarlo:

- **Limpieza de estado en el reset**: `spin.holdT`, `energy`, `unlimitedT`,
  `ball.fire`, `ball.scale`, `stuck`/`slamT`, `freezeFlip` — todos se
  limpian correctamente entre puntos.
- **Casos degenerados de física**: cursor exactamente sobre el centro de la
  escoba (`atan2(0,0)`), dos jugadores en la misma posición exacta, pelota
  en el centro de la escoba. Ninguno produce `NaN` ni `Infinity`; todos los
  estados quedaron finitos.
- **Crecimiento de arrays**: tras 60 s de juego continuo — partículas 192
  (tope 600), `footTrail` 14, `cape` 6, `ballTrail` 18, `runnerTrail` 16.
  Ninguno crece sin control.
- **2v2 completo**: 40 s de partido con 4 jugadores, 0 posiciones
  inválidas, 4 spawns distintos, marcador normal.
- **Slowmo a tirones**: 0% de frames con la física congelada (era 56%
  antes del arreglo de esta sesión).

---

## Orden sugerido

1. **#1 (festejo acortado)** — es el que más se nota y ya lo estás viendo.
2. **#2 (móvil)** — decide si la versión táctil es un objetivo real; si lo
   es, esto es tan grave como #1.
3. **#3 (reloj con lag)** — barato de arreglar, evita partidos injustos.
4. **#4 (cover en 2v2)** — una línea, solo si te importa el 2v2.
5. **#5, #6, #7** — deuda; cuando toques esos sistemas.
