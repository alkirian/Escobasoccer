# Propuesta: menú real, preparación de partido y 5 mejoras

Solo diseño — nada de esto está implementado todavía.

---

## 1. El menú principal REAL

Hoy el menú ES la selección de modo (las cards de 1v1/2v2/práctica van
directo). Eso mezcla dos decisiones distintas: "qué quiero hacer" y "cómo
quiero jugar". La propuesta separa:

```
        🧹 ESCOBA VOLADORA
        ─────────────────────
            ▶  JUGAR
            🧙 PERSONAJES
            🏆 TROFEOS
            ⚙  OPCIONES
        ─────────────────────
   v1.0 · Crear mi héroe (editor) · Créditos
```

- **JUGAR** → pantalla de preparación de partido (sección 2).
- **PERSONAJES** → la galería que ya existe (elegir héroe, paletas
  desbloqueadas, acceso al editor vectorial).
- **TROFEOS** → una pantalla nueva que une lo que hoy está repartido:
  - Desafíos (los 7, con ✓ y su recompensa)
  - Récords (victorias, derrotas, mejor racha, mayor goleada, fugitivos)
  - Espacio reservado para los trofeos del futuro torneo
- **OPCIONES** → sonido, duración por defecto, dificultad por defecto,
  **gráficos (Altos/Medios/Bajos** — ver sección 4), y el botón
  **"Cómo se juega"** (la pantalla de controles que hoy solo aparece la
  primera vez o desde pausa — merece estar acá).

**¿Qué más hace falta? Mi respuesta: nada más arriba.** Cuatro botones es
el número correcto para un menú de juego — cada cosa extra le roba peso a
JUGAR. Lo que sí sumaría, pero abajo y chiquito:
- **Versión visible** (v1.0) — para saber qué build juega la gente.
- **Créditos** — tu nombre, un link. Es TU juego; firmalo.
- **Editor** como link de pie, no botón principal (ya se llega desde
  Personajes; dos caminos alcanzan).

Lo que NO pondría: botones de cosas que no existen (online, tienda),
selector de idioma (todo tu público inicial lee español), login.

---

## 2. Pantalla "Preparar partido" (al tocar JUGAR)

**Una sola pantalla, no un wizard.** Tres decisiones a la vista al mismo
tiempo — modo, héroe, reglas — y un botón gigante. Nada de "siguiente,
siguiente, siguiente".

```
┌──────────────────────────────────────────────────┐
│        [ 1 vs 1 ]  [ 2 vs 2 ]  [ Práctica ]      │   ← pestañas de modo
│                                                  │
│                    ‹   🧙   ›                     │   ← TU HÉROE, GRANDE,
│                  VALKA la Escudera               │     animado con el
│               ● Base   ○ Nocturna                │     ragdoll real
│                                                  │
│  PARTIDO A:                                      │
│  ┌─ Por tiempo ─────────┐ ┌─ Por goles ────────┐ │
│  │  90s · [120s] · 180s │ │   3 · 5 · 10       │ │   ← una tarjeta activa
│  └──────────────────────┘ └────────────────────┘ │     por vez
│                                                  │
│  RIVAL:   Fácil · [Normal] · Difícil             │
│                                                  │
│              ▶  ¡ A  V O L A R !                 │
└──────────────────────────────────────────────────┘
```

Detalles que hacen que se sienta bien:
- **El héroe es el protagonista de la pantalla**: grande, en el centro,
  volando con la física real (el código de la galería ya hace esto). Las
  flechas ‹ › lo cambian con una mini transición. Si tiene paletas
  desbloqueadas, los chips aparecen debajo.
- **Modo por goles — NUEVO**: "primero que llegue a N gana", sin reloj.
  Implica agregar la condición de victoria en match.js (hoy solo existe
  por tiempo + gol de oro). En modo goles no hay gol de oro: no hace falta.
- Las dos tarjetas de reglas son mutuamente exclusivas: tocás una y la
  otra se apaga (queda gris). El valor elegido queda como chip resaltado.
- **Todo se recuerda** (localStorage): la próxima vez la pantalla ya está
  como la dejaste, y ¡A VOLAR! es un solo toque.
- **Práctica** oculta las reglas y el rival (no aplican) — queda solo el
  héroe y el botón. La pantalla se adapta, no se bloquea.
- En 2v2, una tarjetita al lado del héroe: "Compañero: 🎲 aleatorio"
  (v1). A futuro, tocarla para elegirlo.

Estética: la misma que ya tienen la galería y el editor (paneles oscuros
`#141830`, acento dorado `#ffd54a`, chips redondeados) — el juego ya tiene
un lenguaje visual consistente; esta pantalla lo hereda, no inventa otro.

---

## 3. Reorganización de flujo (resumen)

```
index.html  =  MENÚ PRINCIPAL (4 botones)
                 │
                 ├── JUGAR → preparar partido → play.html?[params]
                 ├── PERSONAJES → personajes.html (ya existe)
                 ├── TROFEOS → pantalla nueva (desafíos + récords)
                 └── OPCIONES → pantalla nueva (sonido/gráficos/controles)
```

El menú actual de cards se convierte en la pestaña de modo dentro de
"Preparar partido". Nada se tira: se reubica.

---

## 4. Rendimiento en 2v2 (lo sentiste con bajos FPS)

Diagnóstico probable, en orden de sospecha:

1. **`shadowBlur` en el camino caliente — el sospechoso #1.** Los héroes
   nuevos brillan: ojos de Mordrak, runas, frascos, orbes de Ízar, cresta
   de fuego, gemas de las puntas. Cada uno usa `shadowBlur`, que es LA
   operación más cara del canvas (desenfoque gaussiano por cada trazo).
   En 1v1 son 2 héroes; en 2v2 son 4 → el costo se duplica justo donde
   más se nota. Mis mediciones daban 0.4–2ms por frame, pero en mi entorno
   de prueba con ventana chica; tu navegador a pantalla completa con
   DPR 2 pinta 4× más píxeles.
2. **Canvas gigante**: `innerWidth × innerHeight × DPR(≤2)`. En un monitor
   2560px eso son ~11 millones de píxeles por frame.
3. **Gradientes recreados cada frame**: cada torso/cabeza/palo crea 2-4
   `createLinearGradient` por héroe por frame. Menor, pero suma.

**Plan de arreglo propuesto** (cuando toque implementarlo):

- **Hornear los brillos**: generar una vez, al cargar, un mini-atlas de
  "glows" (círculos difusos pre-renderizados en canvas offscreen, por
  color: cian, naranja, dorado, fuego, hielo) y reemplazar TODOS los
  `shadowBlur` del dibujo por `drawImage` de esos sprites. Es 10-50×
  más barato y visualmente idéntico. Solo esto probablemente resuelva
  el problema entero.
- **Opción "Gráficos" en Opciones** con 3 niveles + autodetección
  (medir el frame promedio los primeros 5 segundos y bajar solo):
  - *Altos*: como hoy.
  - *Medios*: glows horneados, menos partículas (tope 300).
  - *Bajos*: sin glows, DPR 1, partículas al mínimo.
- **Tope de píxeles totales** del canvas (~2.2 MP): en monitores enormes
  bajar el DPR antes que la fluidez.
- **Primero medir, después tocar**: un overlay `?perf` que muestre
  ms de simulación vs ms de dibujo por frame, para confirmar el
  diagnóstico en TU máquina antes de optimizar a ciegas.

---

## 5. Cinco mejoras más, de valor real

**1. Camino al Campeonato (torneo local)**
Cinco rivales seguidos, dificultad creciente, cada uno un héroe con nombre
("Ronda 1: Zefir el Vientoveloz"). Bracket visual, progreso guardado —
perdés, reintentás esa ronda. Al ganar: trofeo dorado permanente en
TROFEOS (uno por dificultad). Le da al juego lo que hoy no tiene: una
sesión con principio, tensión y final. Es la razón #1 para volver mañana,
y usa todo lo que ya existe (héroes, dificultades, stats).

**2. Hit-stop: que el cañonazo se SIENTA**
En golpes cargados a fondo y goles: congelar el juego 40-70 milisegundos
en el instante del contacto + un micro-zoom de cámara. Es la técnica de
game feel más rentable que existe (la usan desde Street Fighter hasta
Rocket League). Hoy el mejor golpe del juego "pasa de largo"; con
hit-stop se vuelve demoledor. Bonus del mismo paquete: estela fantasma
en el dash (2-3 siluetas desvanecidas del héroe).

**3. Órdenes al compañero en 2v2**
Una tecla (Q) rota entre tres órdenes al bot aliado: **¡Atacá! /
¡Defendé! / Equilibrado**, con un grito visual sobre tu mago y un
indicador junto al compañero. La IA ya tiene los roles striker/support
implementados — esto solo le da el volante al jugador. Convierte el 2v2
de "1v1 con gente alrededor" en un modo de equipo de verdad.

**4. Rivales con personalidad (IA por héroe)**
Que el héroe del bot determine su estilo usando las palancas que ya
existen: **Valka** embiste y despeja fuerte (más ram, más brake-kick),
**Zefir** caza orbes y al fugitivo (chaseRange alto, más boost),
**Mordrak** se planta atrás y contragolpea (más defend), **Ízar** tira
de lejos con carga llena. El rival deja de ser "el bot en normal" y pasa
a ser "ese maldito Zefir que me roba todos los orbes". Rejugabilidad
enorme por el costo de unos multiplicadores.

**5. 📸 Foto del golazo**
Al terminar el replay de un gol, un botón "Guardar jugada": exporta un
PNG del momento culminante con un marco, el marcador y el logo del juego
(`canvas.toBlob` → descarga, sin servidor). El goal blast es el momento
más compartible del juego — dale a la gente el botón para compartirlo y
tus jugadores se convierten en tu marketing. (La versión GIF/video
existe pero cuesta 10× más; el PNG es el 80% del valor.)

---

## Orden sugerido si aprobás todo

1. Rendimiento (sección 4) — primero, porque un juego que no fluye
   invalida todo lo demás.
2. Menú real + Preparar partido + modo por goles (secciones 1-3).
3. Hit-stop (rápido, mejora todo lo que sigue).
4. Torneo + IA con personalidad (se potencian entre sí).
5. Órdenes 2v2 y Foto del golazo.
