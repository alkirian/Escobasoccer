# CrazyGames Release Report — Escoba Voladora (Basic Launch)

```
Commit:   a47d0e7 (rama feat/crazygames-release)
Version:  0.1.0
Fecha:    2026-08-20

Tamaño ZIP:        0.77 MB (comprimido)
Tamaño extraído:   2.64 MB
Cantidad archivos: 49
Archivo más pesado: 1 mapa.jpeg (1.94 MB)

English:            PASS  (259/259 claves; navigator.language no-es → inglés)
Relative paths:     PASS  (validador: cero absolutas, cero localhost, cero C:\)
Casing:             PASS  (verificado segmento a segmento contra el árbol real)
Chrome:             PASS  (partido completo hasta VICTORIA + revancha)
Edge:               PASS  (smoke headless: main.js ejecutó, HUD sincronizado)
Iframe QA:          PASS  (input protegido, blur suelta teclas y pausa)
DPR1:               PASS  (toda la QA de resoluciones corrió con devicePixelRatio 1)
60Hz:               PASS  (1200 pasos de física por 10 s)
120Hz:              PASS  (1200)
144Hz:              PASS  (1199 — residuo de acumulador, no drift)
165Hz:              PASS  (1199)
Console errors:     0
404s:               0
External requests:  0
External ads:       NONE
Custom fullscreen:  NONE  (el juego nunca tuvo; el validador lo vigila)
Service Worker:     DISABLED  (BUILD_CONFIG.pwa=false; sw.js no viaja en el ZIP)
SDK:                NOT REQUIRED FOR BASIC LAUNCH  (Platform.* es fallback local;
                    la integración futura vive solo en src/platform/crazygames.js)
```

## Cómo se genera y valida

```bash
npm run build:crazygames      # → dist/crazygames/ + los dos ZIP
npm run validate:crazygames   # → "CRAZYGAMES BASIC LAUNCH READY" o exit 1
```

ZIP resultante (index.html en la raíz, sin carpeta envolvente):
- `dist/EscobaVoladora-CrazyGames.zip`
- `dist/crazygames/EscobaVoladora-CrazyGames.zip` (copia)

El build camina el grafo real de dependencias desde las 6 páginas del
jugador; editores, escenas de dev, tools/, docs, sw.js, manifest y los
exports personales de assets/ quedan fuera solos. Verificado post-build:
el ZIP extraído se sirvió aparte del repo y todas las peticiones dieron
200 — es autosuficiente.

## Qué se probó (evidencia)

- **Entrada rápida (Fase 4)**: primera visita en modo portal muestra UN
  botón PLAY → `play.html?mode=1v1` → partido corriendo (90 s, fácil,
  coach y orbes activos — reusa el sistema FIRST_EVER que ya existía).
  Un clic desde el portal hasta gameplay. Tras el primer partido aparece
  el menú completo (isFirstEver() sobre las stats).
- **Idiomas (Fase 2)**: barrido automático de las 5 páginas + partido en
  inglés sin detectar texto español; ídem en español. El idioma se
  resuelve manual → Platform.getLocale() → navigator.language → inglés.
  Selector manual en Opciones (Auto / English / Español).
- **Resoluciones (Fase 18)**: 907×510, 1216×684, 1077×606, 821×462,
  1366×768, 1920×1080, 1536×864, 1280×720, 800×450, 1080×607 — las 5
  páginas de menú sin scroll y el partido llenando el viewport con HUD
  presente, en las 10. Inglés entra en la más chica sin scroll.
- **Ciclo de vida (Fase 15)**: blur → suelta lmb/rmb/tuck/boost y held,
  pausa el partido, silencia el audio, Platform.pause(). focus → audio
  vuelve; la pausa la levanta el jugador. Verificado disparando los
  eventos en vivo.
- **Audio (Fase 16)**: el AudioContext solo se crea en el primer gesto
  (ya era así) y ahora cada gesto posterior lo reanuda si el navegador lo
  suspendió (resumeIfSuspended en input y touch).
- **Física y Hz (Fase 17)**: el acumulador real (FIXED_DT=1/120,
  maxSteps=6, clamp de dt a 100 ms) reproduce el mismo tiempo simulado a
  60/120/144/165 Hz. La física NO se tocó.
- **Partido completo**: sobre el ZIP extraído, un 1v1 corrió hasta la
  pantalla de VICTORIA (1-0) con botones Revancha/Menú; Revancha navega a
  jugar.html conservando modo y duración.

## Hardware modesto (Fase 20)

Medido en sesiones previas sobre este mismo código: paso de física
0.04–0.14 ms y frame de dibujo 0.6–2.6 ms contra un presupuesto de
16.7 ms — hay ~6–25× de margen. En una notebook económica (CPU ~5× más
lenta) el margen estimado sigue siendo holgado. No se optimizó nada
prematuramente; no se detectaron regresiones.

## PEGI 12 (Fase 25)

Revisado el contenido visible: magos caricaturescos en escobas, golpes de
pelota sin sangre ni gore, sin sexualización, sin apuestas, sin lenguaje
inapropiado en ninguno de los dos idiomas (los 259 textos viven en
`src/i18n/` y se revisaron al traducirlos). Cumple PEGI 12 sin reservas.

## Metadata para el Developer Portal

**Game name**: `Escoba Voladora`
(un nombre comercial en inglés queda para una decisión explícita aparte)

**Short description (EN)**
> Wizard football on physics-driven flying brooms. Charge your hit, dash,
> boost, and blast the ball through the rival portal — 1v1, 2v2 and a
> five-round tournament.

**Full description (EN)**
> Escoba Voladora is a flying-broom sport: two wizards (or two teams of
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

**Controls** (verificados contra el build actual, no contra docs viejas)
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

## Tareas manuales pendientes (no automatizables desde acá)

1. **Covers**: Landscape 1920×1080 (16:9), Portrait 800×1200 (2:3),
   Square 800×800 (1:1). Identidad consistente, sin bordes, sin "Play
   Now"/"New"/"Updated", sin logos de stores. El título puede aparecer.
2. **Video preview**: 15–20 s, ≤50 MB, sin audio, gameplay real, en
   Landscape 1080p 16:9 y Portrait 2:3. Sin pantalla negra inicial, sin
   logos, sin cursor, sin fast-forward. Primer frame acorde a la portada.
3. **Subida**: Developer Portal → Submit a game → subir
   `dist/EscobaVoladora-CrazyGames.zip` → QA Tool (partido completo,
   revancha, pausa, cambio de pestaña, inglés, español, 1v1, 2v2,
   torneo) → Submit como Basic Launch.

## Known issues

- Safari/iOS y Chrome Android no se probaron en dispositivo real (la QA
  corrió en Chromium de escritorio con emulación de resoluciones chicas y
  controles táctiles implementados). CrazyGames puede deshabilitar Safari
  si hiciera falta; Chrome y Edge están verificados.
- La consola muestra 3 líneas de log informativas propias (banner del
  juego). No son warnings ni errores; se dejaron a propósito.
- El nombre del archivo del mapa contiene un espacio ("1 mapa.jpeg",
  URL-encoded en config). Funciona en el hosting estático (verificado:
  200 sobre `1%20mapa.jpeg`); se documenta por si algún CDN futuro fuera
  quisquilloso.

## Qué NO se hizo (a propósito — Fases 23, 24, 30)

Sin SDK completo, sin ads (ni botones de rewarded), sin cuentas ni login,
sin Cloud Data, sin leaderboards, sin IAP. El progreso es local. La
arquitectura (Platform.*, Storage, BUILD_CONFIG) deja cada integración
futura confinada a `src/platform/crazygames.js` sin tocar el core.
