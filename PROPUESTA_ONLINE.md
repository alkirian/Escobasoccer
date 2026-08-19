# Multijugador online: qué hay que tener en cuenta

Análisis honesto antes de decidir. Nada implementado.

---

## Lo primero, sin vueltas

**El online es el cambio más caro que le podés hacer a este juego.** No por
el networking en sí, sino porque toca TODO: física, entrada, cámara, menús,
persistencia, y suma dos cosas que hoy no existen — un servidor que hay que
pagar y mantener, y una superficie de abuso (gente rompiendo el juego a
propósito).

Estimación honesta: **3 a 6 semanas de trabajo enfocado** para algo jugable
de verdad, contra los 2-3 días que llevó cualquier feature grande hasta
ahora. Y a diferencia del resto, no se puede hacer "a medias y mejorar
después": un online que va mal es peor que no tener online.

Dicho eso: **tu juego está mejor preparado que la mayoría.** Abajo el
detalle.

---

## Lo que juega a tu favor (y es mucho)

### 1. Ya tenés paso fijo de física ⭐⭐⭐
`FIXED_DT = 1/120` con acumulador. Esto es **el requisito número uno** del
netcode serio y la razón por la que la mayoría de los juegos hobby no pueden
hacer online sin reescribirse. Vos ya lo tenés y funcionando.

### 2. La física es casi determinista
Conté los usos de aleatoriedad en el código de simulación:

| Módulo | `Math.random` | ¿Afecta el resultado? |
|---|---|---|
| rider, ball, arena, orbs (posición) | **0** | — |
| broom | 2 | Sí: giro del golpazo + fase de flotación |
| collisions | 1 | Sí: giro al embestir |
| match | 1 | Sí: giro de la explosión |
| bot | 1 | Sí: decisión de frenar |
| particles | 21 | **No** (visual puro) |

**Son 5 llamadas reales.** Reemplazarlas por un generador con semilla
compartida es un trabajo de una tarde. Comparado con "reescribir la física
para que sea determinista", que es lo normal, estás a un paso.

### 3. Estado chico
Dos jugadores + pelota = ~40 números por frame. Cabe de sobra en un paquete
de red. Juegos con 50 entidades sufren; vos no.

### 4. Ya separaste simulación de dibujo
`step()` y `renderer.draw()` son independientes. Eso permite correr la
simulación sin dibujar (rebobinar y re-simular), que es exactamente lo que
pide el netcode con predicción.

---

## Lo que juega en contra

### 1. La física es caótica por diseño
Un ragdoll verlet con 9 puntos, constraints iterativos y colisiones
continuas **amplifica cualquier diferencia**. Si dos máquinas divergen en el
último decimal, a los 3 segundos los magos están en lugares distintos.

Peor: **JavaScript no garantiza que `Math.sin`, `Math.cos` o `Math.hypot`
den bit a bit el mismo resultado en distintos navegadores/CPUs.** Chrome en
Windows y Safari en un iPhone pueden diferir en el último bit. Con física
caótica, eso basta para desincronizar.

**Consecuencia importante**: el netcode lockstep/rollback puro (el de los
juegos de pelea) es **riesgoso** acá. Empujaría hacia la opción B de abajo.

### 2. Hoy todo el estado vive en el cliente
Récords, desafíos, torneo, personajes: todo en `localStorage`. Para online
competitivo eso significa que cualquiera se pone 999 victorias editando el
navegador. Si el online tiene ranking, **necesitás cuentas y validación en
servidor** — que es otro proyecto adentro del proyecto.

### 3. Cuesta plata todos los meses
GitHub Pages es gratis porque sirve archivos estáticos. Un servidor de juego
no: necesita un proceso corriendo 24/7.
- Arranque: **US$5-7/mes** (Fly.io, Railway, Hetzner) para decenas de
  partidas simultáneas.
- El costo real no es el server: es que **si no hay nadie conectado, no hay
  partida**. Un juego online vacío se siente peor que uno single player.

---

## Las tres arquitecturas posibles

### Opción A — P2P con rollback (WebRTC)
Los dos navegadores se conectan directo. Cada uno simula todo y corrige.
- ✅ Sin costo de servidor (solo un "matchmaker" mínimo para presentarlos)
- ✅ Latencia mínima (no pasa por un tercero)
- ❌ **Exige determinismo perfecto** — y por lo del punto 1, en JS con esta
  física es una apuesta arriesgada
- ❌ WebRTC necesita servidores STUN/TURN igual; TURN cuesta
- ❌ Tramposo fácil: cada cliente es autoridad de sí mismo

### Opción B — Servidor autoritativo ⭐ *mi recomendación*
El servidor corre LA simulación. Los clientes mandan input y reciben estado.
- ✅ **No necesita determinismo cross-platform**: solo una máquina simula
- ✅ Anti-trampas real (el cliente no decide nada)
- ✅ Reusás tu código tal cual: el mismo `step()` corre en Node
- ❌ Cuesta plata
- ❌ Necesita interpolación + predicción del lado cliente para que no se
  sienta gomoso — es el trabajo fino

Tu arquitectura ya permite esto casi sin tocar la física: `step(dt)` es una
función pura sobre el mundo. Correrla en Node es cuestión de sacarle las
dependencias de canvas.

### Opción C — Asincrónico (sin tiempo real) 🎯 *el atajo inteligente*
Nada de partidas en vivo. En cambio:
- **Fantasmas**: jugás contra la repetición de la mejor jugada de otro
- **Tablas de récords online**: rachas, goleadas, tiempos
- **Desafíos semanales**: "esta semana, gol más rápido con Petra"

- ✅ **Cuesta casi nada**: una base de datos y un endpoint
- ✅ Sin problemas de latencia, desincronización ni trampas graves
- ✅ Da la sensación de "hay más gente jugando" — que es el 80% del valor
  emocional del online
- ✅ Ya tenés **el sistema de replay hecho**, que es la pieza difícil
- ❌ No es jugar *con* un amigo

---

## Mi recomendación

**Antes de cualquier online, la pregunta no es técnica sino de audiencia:
¿hay gente jugando tu juego hoy?**

Un online sin jugadores es un lobby vacío — y un lobby vacío hace que el
juego se sienta *muerto*, peor que si nunca hubiera tenido online. Es el
error clásico: se invierten seis semanas en multijugador para un juego que
tiene tres jugadores por semana, y esos tres nunca se cruzan.

Por eso propongo este orden:

1. **Ahora: nada de online.** Terminá habilidades únicas, publicá, y mirá
   cuánta gente vuelve. Los números te van a decir si vale la pena.

2. **Si hay tracción: Opción C (asincrónico).** Tablas de récords y
   fantasmas. Costo bajísimo, riesgo casi nulo, y da presencia social real.
   Con el replay que ya tenés, es cuestión de días, no semanas.

3. **Solo si C demuestra que la gente quiere competir: Opción B**
   (servidor autoritativo), empezando por **1v1 privado con código de
   sala** — nada de matchmaking público. "Compartí este código con un
   amigo" evita el problema del lobby vacío por completo: no necesitás masa
   crítica, solo dos personas que se conocen.

4. **Nunca la opción A** con esta física, salvo que primero hagas un
   experimento controlado de determinismo entre dos navegadores distintos.

---

## Si igual querés ir por el online ya

El orden técnico sería:

1. **Semilla compartida para el azar** (reemplazar esas 5 llamadas). Barato
   y útil incluso sin online: haría los replays perfectos.
2. **Sacar `step()` de la dependencia del navegador** para poder correrlo en
   Node. Chequear que `main.js` no mezcle input/render dentro de la
   simulación.
3. **Protocolo de input**: hoy el jugador manda posición de mouse absoluta.
   Por red conviene mandar la intención (ángulo + flags), que es más chico y
   más robusto.
4. **Servidor mínimo**: Node + WebSocket, una sala, dos jugadores, 30 Hz.
5. **Interpolación en el cliente** y recién ahí, si hace falta, predicción.

El paso 1 lo haría **igual, ahora**: es barato y mejora los replays.

---

## En una frase

Tu juego está técnicamente mejor preparado que el 90% de los proyectos
hobby para hacer online — pero el riesgo real no es técnico, es tener un
lobby vacío. Empezá por lo asincrónico, y si la gente pide jugar con
amigos, hacé salas privadas con código antes que matchmaking público.
