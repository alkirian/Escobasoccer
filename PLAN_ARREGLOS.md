# Plan de arreglos — auditoría Escoba Voladora

Orden: de mayor impacto a menor, y dentro de eso, los aislados antes que los
que se tocan entre sí. Cada paso se verifica antes de pasar al siguiente.

---

## Paso 1 — Festejo del gol acortado por la cámara lenta (CRÍTICO)

**Problema**: `match.update(dtReal)` corre en tiempo real mientras el mundo
va al 22%. Los temporizadores del festejo avanzan 4.5× más rápido que la
escena que cronometran.

**La trampa**: no se puede escalar todo el `dt` de `match.update`, porque
`timeLeft` (reloj del partido) SÍ debe correr en tiempo real. Solo los
temporizadores del estado `goal` deben ir en tiempo de juego.

**Solución**: `Match.update()` recibe el `dt` real y escala internamente solo
lo del estado `goal` (`goalT`, `blastT`, `slowT`, `blastWave`, `flashT`,
`scorePunch`) por `this.timeScale`.

**Verificación**: medir con el loop real que el festejo dura
`CFG.match.goalPause` (2.6 s) y la cámara lenta `CFG.goalBlast.slowmoTime`
(1.25 s), ambos en segundos reales.

---

## Paso 2 — Móvil: sin dash, sin giro, sin boost (CRÍTICO)

**Problema**: dash/giro/boost viven dentro del `else` de mouse/teclado. La
rama táctil no los ejecuta.

**Decisión de diseño**: extraer la lógica compartida a una función que
ambas ramas llamen, en vez de duplicarla. Duplicar garantiza que vuelvan a
divergir.

**Solución**:
- Sacar recarga de dash, disparo de dash, cooldown/carga de giro y
  `updateEnergy` a un bloque común que corra para las dos ramas.
- Táctil: mapear el botón GOLPE al sistema de giro (no al latigazo viejo),
  y agregar un gesto para el dash (doble toque en el joystick o botón
  propio).
- Que el boost funcione en táctil.

**Verificación**: con `touch.active`, las cargas se recargan, el giro
dispara y la energía se gasta.

---

## Paso 3 — El reloj adelanta con frames lentos (MEDIO)

**Problema**: el acumulador descarta física cuando se pasa de `maxSteps`,
pero `timeLeft` se descuenta con el `dtReal` completo. Con frames de 100 ms
se pierde 50% de la física y el reloj corre igual.

**Solución**: descontar `timeLeft` con el tiempo **efectivamente simulado**,
no con el tiempo real. El loop ya sabe cuántos pasos ejecutó.

**Verificación**: simular tandas de frames lentos y comprobar que el reloj
y la física avanzan juntos.

---

## Paso 4 — Bot que cubre en 2v2 se para mal (MEDIO)

**Problema**: `bot.js:135` interpola la Y hacia `0` absoluto en vez de hacia
`portalY` (97.28). El defensor queda ~97 unidades arriba del arco.

**Solución**: interpolar hacia `ownPortal.y`, igual que ya hace la X.

**Verificación**: medir la distancia media del cubridor al centro del arco
antes y después.

---

## Paso 5 — HUD duplica constantes del dash (MENOR)

**Problema**: `render.js` define `DASH_RECHARGE = 4.0, DASH_MAX = 2` a mano.

**Solución**: exponer el tuning del dash en `world.dashState` (o en CFG) y
que el HUD lo lea de ahí.

**Verificación**: cambiar el tuning y confirmar que el HUD lo refleja.

---

## Paso 6 — Limpieza (MENOR)

- `?bots`: no dibujar los controles del jugador (rayos, anillo de carga)
  cuando el humano no controla nada.
- `CFG.ram.freeStuck`: renombrar a algo que describa su uso actual
  (cancelar aturdimiento), y actualizar el comentario.

---

## Paso 7 — Segunda pasada de revisión

Tras aplicar todo: repetir la auditoría sobre las zonas tocadas, buscando
regresiones y problemas nuevos que los cambios hayan destapado. Reportar y
arreglar lo que aparezca.
