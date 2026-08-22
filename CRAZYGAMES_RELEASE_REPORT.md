# CrazyGames Release Report — Broomball Blitz (Basic Launch)

```
Rama:     feat/crazygames-release
Version:  0.1.0
Fecha:    2026-08-22

Tamaño ZIP:        0.51 MB  (antes 2.19 MB — ver "Peso" abajo)
Tamaño extraído:   1.02 MB
Cantidad archivos: 50
Archivo más pesado: mapa.webp (0.26 MB)

English:            PASS  (363/363 claves; navigator.language no-es → inglés)
Relative paths:     PASS  (validador: cero absolutas, cero localhost, cero C:\)
Casing:             PASS  (verificado segmento a segmento contra el árbol real)
Chrome:             PASS  (QA automatizada: 7 páginas, 0 errores)
Edge:               PASS  (QA automatizada: 7 páginas, 0 errores)
Console errors:     0     (en ambos navegadores, las 7 páginas)
404s:               0
External requests:  0     (⇒ inmune a AdBlock por construcción)
External ads:       NONE
Custom fullscreen:  NONE  (el validador lo vigila)
Service Worker:     DISABLED  (BUILD_CONFIG.pwa=false; sw.js no viaja)
SDK:                NO CARGA  (BUILD_CONFIG.sdk=false — Basic Launch)
Resoluciones:       PASS  (6 páginas × 10 resoluciones = 60 combinaciones,
                          sin scroll horizontal en ninguna)
60/120/144/165 Hz:  PASS  (desvío 8.3 ms sobre 10 s simulados)
Onboarding:         PASS  (1 clic del portal al gameplay)
Partido completo:   PASS  (countdown → juego → gol → fin, con pantalla final)
Progreso guardado:  PASS  (persiste entre recargas y páginas)
Enlaces internos:   PASS  (ninguno apunta fuera del paquete)
Covers:             LISTAS (3, dimensiones exactas)
Videos preview:     LISTOS (2, 18 s, sin audio)
```

## Cómo se genera y valida

```bash
npm run build:crazygames      # → dist/crazygames/ + los dos ZIP
npm run validate:crazygames   # → "CRAZYGAMES BASIC LAUNCH READY" o exit 1
npm run qa:browsers           # → Chrome + Edge, consola/404/externas/overflow
npm run preview:video         # → los dos videos de preview desde gameplay real
```

El ZIP para el portal: `dist/BroomballBlitz-CrazyGames.zip`
(index.html en la raíz, sin carpeta envolvente).

---

## Cambios de esta ronda

### Nombre: "Escoba Voladora" → **Broomball Blitz**

El portal es mayormente anglófono y su buscador es un canal real de
descubrimiento: un nombre en español que el jugador no puede pronunciar ni
tipear se pierde ahí. *Broomball* dice literalmente qué es el juego (escoba
+ pelota) y *Blitz* aporta la velocidad que promete el tagline. Evita a
propósito el terreno de Quidditch/Harry Potter, que es IP ajena y el portal
revisa copyright.

El nombre es **marca: no se traduce**. Es idéntico en inglés y español; lo
único que cambia por idioma es el subtítulo del `<title>`. Por eso el `<h1>`
del menú no lleva `data-i18n`.

Alcance del cambio: los dos diccionarios i18n (`title.*`, `meta.og.title`),
los `<title>` de las 7 páginas, el `og:title`, el `<h1>` del menú, el texto
de la pantalla de carga, el manifest (`name`/`short_name`), el banner de
consola, `package.json`, `server.js` y el nombre del ZIP
(`BroomballBlitz-CrazyGames.zip`).

Verificado tras el cambio: el logo entra sin desbordes en 800×450, 821×462 y
1920×1080, en ambos idiomas (mide 565–646 px), y la QA de Chrome + Edge
volvió a dar limpia. **Las portadas y los videos no se regeneraron: no
llevan texto incrustado, así que valen igual con el nombre nuevo.**

### Peso: de 2.19 MB a 0.51 MB de ZIP

El mapa era el 73% del paquete (`1 mapa.jpeg`, 1.99 MB). Pasó a
**`mapa.webp` q92: 262 KB, −87%**, con PSNR 43.9 dB contra el original —
por encima de 40 dB la diferencia no es perceptible a ojo, y las
dimensiones (2752×1536) no cambiaron, así que la física y el encuadre
quedaron exactamente igual.

De paso desapareció el espacio en el nombre del archivo, que obligaba a
URL-encodearlo (`1%20mapa.jpeg`) y estaba anotado como riesgo con CDNs.

### Bug de layout: `personajes.html` desbordaba en 821×462

**Este era motivo de rechazo.** `#gridView` no tenía ancho propio, así que
se dimensionaba por su contenido: 10 cards de 150 px mínimo = 960 px de
ancho fijo. En cuanto la ventana bajaba de ~960 px aparecía scroll
horizontal — y 821×462 es una de las resoluciones con las que CrazyGames
hace QA. Se arregló con `width:100%` sobre el contenedor.

Apareció con el rediseño del flujo modo→personajes, posterior al informe
anterior; por eso la QA vieja no lo vio.

### `gameplayStop()` faltaba en pausa

Las señales se emitían mirando sólo `match.state`, así que el portal se
enteraba del fin del partido pero no de las pausas. CrazyGames pide
`gameplayStop()` también en pausa, menú y pantalla de resultados. Ahora el
flanco se calcula sobre `match.state === 'play' && !world.paused`, un
único punto de verdad: cualquier sitio que toque la pausa emite el par
correcto. Verificado con una simulación de la secuencia completa
(arranque → pausa → sigue → gol → saque → fin): `START STOP START STOP
START STOP`, sin duplicados.

Hoy son no-ops (Basic no lleva SDK); esto importa para que las métricas de
Full Launch salgan bien desde el día uno.

### Safe areas móviles

El proyecto no usaba `env(safe-area-inset-*)` en ningún lado, y
`viewport-fit=cover` estaba sólo en index y play. En un teléfono con notch:

- Los controles táctiles se dibujan **dentro del canvas**, así que el CSS
  no los alcanzaba: el botón de pausa (arriba a la derecha) caía bajo el
  notch en landscape y el acelerador sobre la barra de gestos. `touch.js`
  ahora lee los insets y corre los botones hacia adentro — un solo
  `_layout()` alimenta dibujo y hit-testing, así que no pueden
  desincronizarse.
- Las 5 páginas de menú recibieron `viewport-fit=cover` + padding con los
  insets sumados al que ya tenían. En pantallas sin recortes `env()` vale
  0 px y no cambia nada.

### SDK v3 preparado (apagado)

`src/platform/crazygames.js` pasó de ser un esqueleto de comentarios a la
integración real del SDK v3, **gobernada por `BUILD_CONFIG.sdk`**:

- `sdk: false` (lo que se sube ahora): no se pide ningún script externo.
- `sdk: true` (Full Launch): carga el SDK, `init()` asíncrono, y
  `gameplayStart/Stop` pasan por él.

Toda llamada al SDK va envuelta: si el jugador tiene AdBlock, si el script
no carga o si la API cambia, el juego sigue con el comportamiento local. El
validador ahora falla si el paquete sale con `sdk: true` o con un
`<script src="https://...">` en el HTML.

### Enlace interno a una página que no viaja

`personajes.html` tiene un botón "Crear el mío (editor)" hacia
`veditor.html`, y los editores NO entran en el paquete del portal. El enlace
se borraba en runtime (`externalLinks:false`), y en la práctica funcionaba —
pero dependía de que ese módulo cargara: si fallaba, el revisor encontraba un
404. Ahora el build lo quita **del HTML**, y el validador falla ante
cualquier `<a>` interno que apunte a algo que no está en el paquete.

### Persistencia del progreso (verificada)

`recordMatch()` → `localStorage` → sobrevive a recarga y a cambio de página:
comprobado en vivo (victoria 3-1 registrada, racha en 1, `isFirstEver()`
pasa a false, que es lo que hace aparecer el menú completo tras el primer
partido). El estado de prueba se limpió después.

Nota sobre el guardado: `Storage` degrada a memoria si `localStorage` lanza
—cosa que pasa de verdad dentro de un iframe de terceros con cookies
bloqueadas—. Apareció solo durante estas pruebas: el Chrome headless del
script de verificación deniega `localStorage`, y el juego siguió corriendo
sin errores. Exactamente el comportamiento que el portal necesita.

### Pipeline

- El build fallaba con `EBUSY` en Windows si `dist/` estaba abierta en el
  Explorador: `fs.rm(recursive)` no puede borrar un directorio que otro
  proceso tiene abierto. Ahora vacía el contenido y conserva la carpeta.
- El banner de consola estaba en español; pasó a inglés (quien abre la
  consola es un revisor del portal).
- `scripts/qa-browsers.mjs` (nuevo): QA automatizada en Chrome y Edge. No
  cuenta como "petición externa" los esquemas internos del navegador
  (`chrome-extension://` y similares): son extensiones de la máquina de QA,
  no del paquete, y daban falsos positivos que tapaban lo importante.
- `scripts/record-preview.mjs` (nuevo): graba los dos videos de preview.

---

## Material de submission (listo en `press/`)

### Portadas — `press/covers/`

| Archivo | Dimensiones | Ratio |
|---|---|---|
| `cover-landscape-1920x1080.jpg` | 1920×1080 | 16:9 |
| `cover-portrait-800x1200.jpg` | 800×1200 | 2:3 |
| `cover-square-800x800.jpg` | 800×800 | 1:1 |

Composición tipo key art (no screenshots), con la identidad del juego:
mago azul contra mago naranja, castillo nocturno con antorchas, orbes
cyan, pelota flamígera. Sin texto, sin bordes (verificado: los píxeles del
borde tienen 400–650 colores distintos, no un marco plano), sin logos de
stores. Las tres se generaron a resolución mayor y se **redujeron** con
LANCZOS, así que no hay upscaling ni pixelado.

El título no está incrustado: CrazyGames permite el nombre del juego, pero
sobreimprimirlo limita la reutilización y el portal ya lo muestra al lado.

### Videos preview — `press/video/`

| Archivo | Dimensiones | Duración | Peso |
|---|---|---|---|
| `preview-landscape-1920x1080.mp4` | 1920×1080 (16:9) | 18.07 s | 5.1 MB |
| `preview-portrait-1080x1620.mp4` | 1080×1620 (2:3) | 18.07 s | 4.9 MB |

Gameplay real capturado del build de `dist/`, no una animación. Sin pista
de audio, sin cursor, sin acelerar, sin fundido desde negro (la captura
arranca con el partido ya corriendo) y sin barras negras.

Dos detalles que costaron una segunda pasada:

1. **El portrait no se graba en una ventana 2:3.** El juego es landscape
   por diseño (la cancha es horizontal; en vertical muestra "girá el
   teléfono"), así que grabar en 2:3 producía dos franjas negras enormes —
   rechazo directo. Se graba en landscape y el vertical se obtiene
   **recortando** la franja central, que es donde ocurre la acción.
2. **Marca de agua de Windows.** Esta máquina corre un Windows sin
   activar y el "Activar Windows" del sistema se coló en la captura. No
   viene del juego (no existe en el HTML), pero igual habría quedado en el
   video: se recortan las últimas 46 filas antes de escalar.

---

## Metadata para el Developer Portal

**Game name**: `Broomball Blitz`

**Short description (EN)**
> Wizard football on physics-driven flying brooms. Charge your hit, dash,
> boost, and blast the ball through the rival portal — 1v1, 2v2 and a
> five-round tournament.

**Full description (EN)**
> Broomball Blitz is a flying-broom sport: two wizards (or two teams of
> two) hang from physics-driven brooms and fight to smash a ball through
> the rival's magic portal. Aim with the mouse — your broom follows the
> cursor — then hold and release for a charged hit: full charge plus a
> half-full energy jar turns your shot into a flaming cannonball. Collect
> energy orbs in the corners to fuel your magic boost, chase the golden
> runner for a few seconds of unlimited power, and use your dash to reach
> the play first. Ten heroes with distinct stats and passives, unlockable
> palettes, challenges, local records, and a five-round Road to the
> Championship. Learn as you play: the coach teaches every control during
> your first matches.

**Controls**
```
Mouse — Aim; the broom follows your cursor
Left Mouse Button — Hold and release: charged hit
Right Mouse Button — Air brake / hover
Space — Dash (2 charges)
Shift — Magic boost (drains energy)
Esc / P — Pause
R — Restart match
Touch — left-side joystick to aim, GAS and HIT buttons,
        double-tap joystick = dash, hold GAS = boost
```

---

## PEGI 12

Magos caricaturescos en escobas, golpes de pelota sin sangre ni gore, sin
sexualización, sin apuestas, sin lenguaje inapropiado en ninguno de los dos
idiomas (los 363 textos viven en `src/i18n/` y se revisaron al traducirlos).
Cumple sin reservas.

## Lo que queda para vos (no automatizable)

1. **Revisar los dos videos completos** antes de subirlos. La verificación
   automática cubre specs, primeros frames y muestreo — pero que los 18 s
   sean *interesantes* es criterio humano. Si un tramo aburre, volvé a
   correr `npm run preview:video` (cada corrida sale distinta: los bots
   juegan diferente).
2. **Subir**: Developer Portal → Submit a game → `dist/BroomballBlitz-CrazyGames.zip`
   → cargar las 3 covers y los 2 videos → completar descripción y
   controles (arriba) → correr su QA Tool → Submit como Basic Launch.
3. **Probar en un teléfono real** si vas a declarar soporte móvil. Los
   controles táctiles y las safe areas están implementados y verificados
   por medición, pero nadie los tocó con un dedo en un iPhone con notch.

## Known issues

- Safari/iOS y Chrome Android no se probaron en dispositivo real (la QA
  corrió en Chromium y Edge de escritorio con resoluciones emuladas).
  CrazyGames puede deshabilitar Safari si hiciera falta.
- La consola muestra 3 líneas informativas propias (banner del juego, en
  inglés). No son warnings ni errores; se dejaron a propósito.

## Qué NO se hizo (a propósito)

Sin ads, sin cuentas ni login, sin Cloud Data, sin leaderboards, sin IAP —
nada de eso corresponde a Basic Launch. El progreso es local. La
arquitectura (`Platform.*`, `Storage`, `BUILD_CONFIG`) deja cada
integración futura confinada a `src/platform/crazygames.js`.
