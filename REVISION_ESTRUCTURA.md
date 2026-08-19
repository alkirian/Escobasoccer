# Revisión de estructura — para actualizar tranquilo

Auditoría de arquitectura, no de bugs. El objetivo es que dentro de tres
meses puedas volver y agregar cosas sin romper nada.

**Veredicto corto**: la estructura está sana. Las decisiones de fondo (paso
fijo, separación simulación/dibujo, personajes como funciones puras,
persistencia por módulo) son correctas y aguantan crecer. Lo que hay son
**tres deudas concretas** y varias cosas menores.

---

## 🔴 Deuda 1 — `menu.js` quedó huérfano (670 líneas muertas)

**Hallazgo**: desde que `index.html` pasó a ser el menú HTML, **ningún
archivo importa `menu.js`**. Lo verifiqué: cero referencias reales, solo dos
comentarios que lo mencionan.

Son 670 líneas de un menú canvas completo — con animaciones, hit-testing y
opciones — que ya no corre nunca.

**Por qué importa**: código muerto es la trampa clásica. Dentro de dos meses
vas a abrir `menu.js` para tocar algo, lo vas a modificar, y no va a pasar
nada. Y peor: exporta `DEFAULT_OPTS`, que hace creer que sigue siendo la
fuente de verdad de las opciones.

**Qué haría**: borrarlo. Está en el historial de git si algún día lo querés
de vuelta. Si te da cosa borrarlo, moverlo a `src/_archivo/`.

---

## 🔴 Deuda 2 — Dos dueños de la misma clave, con defaults distintos

`escoba.menu.v1` la escriben **`menu.js`** (huérfano) y **`opciones.html`**,
cada uno con su propia lista de valores por defecto:

| Archivo | Defaults |
|---|---|
| `menu.js` (muerto) | `duration: 120, difficulty: 'normal', sound: true, orbs: true` |
| `opciones.html` (vivo) | `sound: true, orbs: true` |

Y `jugar.js` la **lee** para sacar sonido/orbes, pero guarda su propia config
en `escoba.prep.v1`. O sea: la duración y la dificultad viven en `prep.v1`,
pero el sonido en `menu.v1`, por razones históricas.

**Riesgo real**: agregás una opción nueva en Opciones, y no aparece en el
partido porque `jugar.js` solo lee dos campos.

**Qué haría**: un módulo `opciones.js` que sea el ÚNICO dueño de las
preferencias, con su `load()`/`save()` y sus defaults en un solo lugar —
igual que hiciste con `stats.js`, `challenges.js` y `torneo.js`, que están
bien resueltos. Renombrar la clave a `escoba.opts.v1` de paso.

---

## 🟡 Deuda 3 — `render.js` hace demasiado (2816 líneas, 43 métodos)

Hoy `render.js` dibuja: el mapa, los portales, las sombras, los personajes,
la pelota, las partículas, el HUD, el marcador, la pausa, la pantalla de
controles, el coach, los desafíos, el confetti, los replays y los
indicadores fuera de cámara.

Son al menos **cuatro responsabilidades distintas** en un archivo.

**Por qué importa (y por qué NO es urgente)**: no está roto y funciona. Pero
es el archivo que más vas a tocar, y cada cosa nueva lo hace más pesado de
navegar. Cuando quieras agregar la próxima pantalla, vas a pelearte con él.

**Qué haría, cuando toque**: partirlo en tres, sin cambiar una línea de
lógica — solo mover métodos:
- `render.js` → orquestador + mundo (mapa, portales, sombras, pelota)
- `hud.js` → marcador, barras, hints, coach, toasts, indicadores
- `screens.js` → pausa, controles, fin de partido, confetti

Es refactor mecánico y de bajo riesgo. **No lo haría ahora** salvo que ya te
esté molestando: es trabajo sin recompensa visible.

---

## 🟡 Menor — `characters.js` (2954 líneas) y su repetición

Los 9 héroes comparten patrones muy parecidos: contorno + degradado +
detalles, cabeza con ojos, escoba con `broomBase`. Ya extrajiste `eyes()`,
`fists()`, `broomBase()` y `axis()`, que es exactamente lo correcto.

Pero cada héroe todavía repite mucho: el torso con degradado y contorno
aparece 9 veces con variaciones mínimas.

**Qué haría**: cuando agregues el personaje 12 o 13, extraer un
`torsoBase(ctx, r, p, opts)` como hiciste con `broomBase`. **Hoy no**: con 9
personajes la repetición todavía es legible, y abstraer de más ahora te
ataría las manos para diseños raros.

**Lo que sí haría ya**: partir el archivo en `characters/` con un archivo por
héroe (`valka.js`, `petra.js`…) y un `index.js` que los junte. Es mover
código, cero riesgo, y hace que trabajar en un personaje no implique
scrollear 3000 líneas.

---

## 🟢 Lo que está BIEN y no hay que tocar

1. **Paso fijo + separación simulación/dibujo.** Es la decisión estructural
   más importante del proyecto y está bien tomada.
2. **Persistencia modular**: `stats.js`, `challenges.js`, `torneo.js`,
   `vecskin.js` — cada uno dueño de su clave, con load/save propios. Es el
   patrón correcto; solo falta que las opciones lo sigan (Deuda 2).
3. **Personajes como funciones puras** `draw(ctx, r, player, ...)`. Sumar
   uno nuevo no toca el motor.
4. **`characterId` reactivo** en Player. Evita toda una clase de bugs.
5. **Fallbacks defensivos**: `TRAILS[id] || trailMago`, `mods` con guardas,
   `statsOf()` con neutral. Un personaje mal registrado degrada, no rompe.
6. **Comentarios que explican el PORQUÉ.** Vale la pena decirlo: los
   comentarios del proyecto explican decisiones y mediciones, no lo obvio.
   Eso es lo que hace que se pueda volver en tres meses.

---

## 🟢 Propuestas de mejora (orden por valor/esfuerzo)

### 1. Un `CHANGELOG.md` ⭐ *lo más útil por lo más barato*
No existe. Con la cantidad de cosas que cambiaron, sin él no hay forma de
saber qué trajo la v1.1 vs la v1.0. Diez líneas por versión alcanzan.

### 2. Congelar las claves de storage en un solo lugar
Un `storage.js` que exporte las constantes de las 11 claves. Hoy están como
strings sueltos en 9 archivos: un typo en una es un bug silencioso (leés una
clave que no existe y arrancás de cero sin darte cuenta).

### 3. Versionar los datos guardados
Las claves dicen `.v1`, pero **no hay código que migre** si algún día pasás
a `.v2`. Con jugadores reales, cambiar el formato de `stats.v1` les borraría
los récords. Una función `migrate(data)` en cada módulo, aunque hoy no haga
nada, deja la puerta abierta.

### 4. Limpiar `abilities.js` (450 líneas)
Solo lo usa `heroes.js`, que es una escena de prueba en `/dev`. O se integra
al juego o se archiva con la escena.

### 5. Un `README` técnico corto
Qué archivo hace qué, en 30 líneas. Para vos dentro de tres meses.

### 6. Semilla para el azar
Ya lo mencioné para el online, pero también sirve acá: haría los replays
exactos y los tests reproducibles.

---

## Plan sugerido (una tarde)

**Limpieza barata, cero riesgo:**
1. Borrar `menu.js` (o archivarlo)
2. Crear `CHANGELOG.md`
3. Crear `storage.js` con las claves
4. Decidir qué hacer con `abilities.js`
5. Unificar opciones en `opciones.js`

**Refactor mecánico, cuando moleste:**
6. Partir `characters.js` en carpeta
7. Partir `render.js` en tres

**No haría ahora**: abstraer más los personajes, ni tocar la física, ni
reorganizar el motor. Está bien como está.
