# Escoba Voladora — Análisis de lanzamiento

Análisis del juego completo tal como está hoy, con propuesta de cambios
finales para subirlo a la web. Sin código: esto es el plan, no la obra.

---

## Veredicto general

**El juego ya es un juego.** Tiene un core loop distintivo (física de ragdoll
+ golpe dirigido + explosión de gol), 5 personajes con identidad, 3 modos,
opciones que funcionan, IA con dificultades, móvil jugable, replays, 60 FPS
sólidos y dos editores de personajes. Eso es más de lo que tiene la mayoría
de los juegos web que se publican.

Lo que le falta NO es contenido: le falta **envoltorio de producción**
(cómo se ve el link cuando lo compartís, qué pasa el primer segundo, qué
navegadores lo aguantan) y **razones para volver mañana** (hoy no persiste
nada: ni récords, ni objetivos, ni progreso). Ahí está el trabajo.

---

## Lo que ya está fuerte — no tocar

- **El momento del gol**: succión + carga + explosión + slowmo + replay.
  Es el "wow" del juego y funciona. Es lo que alguien le muestra a un amigo.
- **El plantel**: 5 personajes con silueta y personalidad, galería con bios,
  selección persistente. Identidad de producto real.
- **Los editores** (PNG + vectorial): nadie espera UGC en un juego así.
  Es un diferenciador enorme si se le da salida (ver Rejugabilidad).
- **Onboarding**: pantalla de controles la primera vez + hints contextuales
  en el HUD. Correcto y suficiente.
- **Rendimiento**: 0.4–2 ms por frame con todo en pantalla. Margen de sobra.

---

## 🔴 Bloqueantes de lanzamiento

Cosas que romperían la primera impresión de un jugador que llega por un link.

### 1. La página de entrada es el partido, no el menú
Hoy `index.html` ES el juego: quien entra al dominio cae en un partido con
opciones por defecto, sin pasar por el menú. Para web, `index` debe ser el
menú (o redirigir a él), y el partido vivir en otra página (`play.html` o
similar). GitHub Pages/itch sirven `index.html` — es la puerta de entrada.

### 2. Cero metadatos: el link compartido se ve vacío
- `<title>` plano, sin descripción, favicon literalmente vacío (`data:,`).
- Sin Open Graph / Twitter Card: al pegar el link en WhatsApp/Discord/X no
  aparece ni imagen ni texto. Para un juego que se difunde por link, esto es
  el 50% del marketing.
- **Propuesta**: favicon 🧹 (o el escudo de Valka), title "Escoba Voladora —
  fútbol de magos en escobas", meta description, OG image (una captura del
  goal blast — ya hay capturas en `capturas/`).

### 3. 404s en consola
Hay recursos que se piden y no existen (se ven ~17 404s repetidos al cargar).
En producción es ruido, posible asset faltante real, y ensucia cualquier
debugging futuro. Hay que encontrar qué los pide y matarlos.

### 4. Sin pantalla de carga
El mapa es un JPEG de 2752px. Con conexión lenta, el primer contacto es un
canvas negro varios segundos. Mínimo viable: fondo con el logo + "cargando…"
hasta que el mapa esté listo. Ideal: precargar mapa + un frame del menú.

### 5. Compatibilidad de navegadores sin verificar
Todo se probó en Chrome. Riesgos concretos conocidos:
- `roundRect` (usado en HUD y editor) requiere Safari 16+/Firefox 112+.
- Audio WebAudio necesita gesto del usuario (ya resuelto con firstGesture).
- **Propuesta**: una pasada de prueba en Firefox y Safari (o al menos un
  polyfill de roundRect, que son 10 líneas) antes de publicar.

### 6. Páginas de desarrollo expuestas
`dash.html`, `wasd.html`, `test.html`, `heroes.html` son escenas de prueba.
Publicadas confunden (alguien las va a encontrar). Excluirlas del deploy o
moverlas a una carpeta `/dev/`.

---

## 🟡 Análisis por área

### Visual

**Estado**: sólido. El estilo vectorial con contorno de tinta es coherente,
el mapa es lindo, los personajes se leen a distancia de juego.

Lo que falta:
1. **Identidad tipográfica**: el HUD mezcla Georgia (serif) y system-ui sin
   criterio. Elegir UNA fuente display para números/títulos (una webfont
   gratis tipo "Cinzel" o "Grenze Gotisch" pega con el tema) y system-ui
   para lo funcional. Es un cambio chico con efecto grande en "esto es un
   producto".
2. **El arte del portal quedó desalineado** con la zona de gol achicada
   (quedaste en adaptar la imagen del mapa — sigue pendiente).
3. **Micro-celebraciones**: al ganar, la pantalla de fin es texto. Un
   confetti del color del ganador + el personaje festejando (ya hay poses)
   cerraría el loop emocional. Barato, alto retorno.

### Jugable

**Estado**: el core está balanceado y verificado (IA con 3 dificultades,
autogoles corregidos, dash con bloqueo inicial, arco ajustado).

Lo que falta:
1. **Pausa en móvil**: `P` pausa en teclado, pero en móvil no hay botón de
   pausa visible. Un toque en el marcador debería abrir el menú de pausa.
2. **Pelota muerta en esquinas**: si la pelota queda casi quieta pegada a
   una esquina más de ~6 s, un empujoncito suave hacia el centro evita el
   único caso aburrido del juego. (El bot ya tiene anti-atasco; la pelota no.)
3. **Verificar la dificultad 'difícil'**: con think 0.6 / aim 0.45 puede ser
   frustrante para el jugador medio. Medir con `__sim` y jugar 3 partidos
   antes de publicar. 'Fácil' debería perder casi siempre contra un humano
   que ya jugó 2 partidos — verificar también.

### Engagement en los primeros 60 segundos

El embudo hoy: menú → modo → intro (3.2 s) → countdown (3.6 s) → juego.
Primer gol realista: entre 20 y 60 s. El goal blast como primer "wow" llega
a tiempo. **Esto está bien diseñado.**

Los tres agujeros:
1. **La duración por defecto (120 s) es larga para la web.** En portales web
   la primera sesión media dura 3–5 minutos: un partido de 2 minutos que
   sale mal = jugador que se va sin ganar nunca. **Propuesta**: primer
   partido de la vida (detectable: no vio controles) a 90 s y en fácil por
   defecto; después, lo que elija. Que la primera experiencia sea GANAR.
2. **La intro de cámara (3.2 s) + countdown (3.6 s) = 7 s de espera en cada
   revancha.** En el primer partido está bien (presenta el mundo); en la
   revancha ya se saltea la intro, bien — pero el countdown post-gol de 1.6 s
   más el festejo de 2.6 s está en el límite. No tocar aún; medir si la
   gente abandona entre goles.
3. **Nada explica el orbe fugitivo ni el tiro de fuego** hasta que pasan.
   Los hints del HUD ya cubren lo básico; agregar 2 hints más (la primera
   vez que aparece el fugitivo: "¡Atrapalo!"; la primera vez que se llena
   media barra: "golpe de FUEGO listo") completa el tutorial invisible.

### Rejugabilidad y ganas de volver — **el déficit más grande**

Hoy el juego no recuerda NADA entre sesiones (salvo skin y personaje). No
hay razón estructural para volver mañana. Propuesta en orden de retorno
por esfuerzo:

1. **Récords locales (esfuerzo: bajo · retorno: alto)**
   Persistir en localStorage: victorias/derrotas por dificultad, racha
   actual y mejor racha, goles totales, fugitivos atrapados, victoria más
   abultada. Mostrarlos en la pantalla de fin ("🏆 ¡Nueva mejor racha!") y
   un rinconcito del menú. La racha es EL mecanismo de "una más y me voy".

2. **Desafíos simples con recompensa cosmética (esfuerzo: medio · retorno: alto)**
   6–10 misiones locales: "Ganá con cada personaje", "Ganá sin recibir
   goles", "Meté un gol de fuego", "Atrapá al fugitivo 3 veces", "Ganale a
   difícil". Recompensa: **paletas alternativas por personaje** — con el
   sistema de tinte ya existente, una paleta nueva es un objeto de colores,
   no arte nuevo. Esto convierte el plantel en progresión.

3. **Mutadores de partido (esfuerzo: medio · retorno: medio-alto)**
   En el menú, un modo "Caos" con 1 mutador aleatorio por partido: pelota
   rapidísima, gravedad lunar, dos pelotas, arcos gigantes, todos con
   energía infinita. Reutiliza 100% lo que existe (es tocar CFG por
   partido) y multiplica la variedad percibida.

4. **Compartir skins como código (esfuerzo: bajo · retorno: medio)**
   El editor vectorial ya exporta JSON. Agregarle "Copiar código" /
   "Pegar código" (JSON comprimido en base64 al portapapeles) convierte el
   editor en un loop social: "pasame tu personaje". Sin servidor, sin costo.

5. **Torneo local (esfuerzo: medio)**: "ganá 3 partidos seguidos con
   dificultad creciente" como modo campaña mínima con pantalla de campeón.

**Qué NO haría ahora**: multijugador online (meses de trabajo, otra liga),
cuentas de usuario, tienda. El juego puede vivir su primera versión pública
sin nada de eso.

### Sonido

**El agujero más audible: no hay música.** Los SFX sintetizados cumplen,
pero el silencio de fondo hace que el juego se sienta "demo". Propuesta:
- Un loop de ambiente para el partido (viento + antorchas + público lejano
  sintetizado, o un track CC0 de Kevin MacLeod/OpenGameArt).
- Un sting de 3 segundos para el gol y otro para la victoria.
- El toggle de sonido ya existe — solo falta qué sonar.

### Móvil

**Estado**: jugable de verdad (joystick, GAS/GOLPE, dash con doble toque,
boost sosteniendo GAS). Falta:
1. Botón de pausa táctil (ya mencionado).
2. Probar en un teléfono REAL de gama media — el DPR cap a 2 ayuda, pero
   el shadowBlur de los personajes nuevos (Mordrak/Ízar) es lo primero a
   recortar si un teléfono sufre. Dejar un modo "gráficos: bajos" que
   apague shadowBlur es un seguro barato.
3. PWA mínima: manifest + ícono + service worker de caché → "Agregar a
   pantalla de inicio". Para retención móvil es la diferencia entre
   "un link que perdí" y "un ícono en mi teléfono".

### Técnico para publicar

1. Hosting: GitHub Pages funciona ya (rutas relativas listas). Itch.io
   como segundo canal — el público de itch es exactamente este juego.
2. Versionado visible (v1.0 en el menú) para saber qué build juega la gente.
3. Un `?debug` que siga funcionando en producción no es problema; las
   páginas de test sí (ver bloqueante 6).
4. Analytics: opcional. Si querés saber dónde abandonan, un contador simple
   de eventos (partido iniciado/terminado/revancha) alcanza. Sin cookies.

---

## Plan propuesto

### Tanda 1 — antes de subir (1–2 días de trabajo)
1. `index` = menú; el partido a su propia página.
2. Favicon + title + meta description + OG image.
3. Pantalla de carga.
4. Matar los 404s.
5. Polyfill de `roundRect` + prueba en Firefox.
6. Excluir páginas de test del deploy.
7. Botón de pausa en móvil.
8. Récords locales + racha en pantalla de fin.
9. Primer partido: 90 s + fácil.
10. Verificación de dificultades (fácil ganable, difícil desafiante).

**Con esto ya lo subís.** Todo lo demás puede llegar con el juego en vivo.

### Tanda 2 — primera semana en vivo
1. Música/ambiente + stings de gol y victoria.
2. Desafíos + paletas desbloqueables.
3. Confetti/celebración de victoria.
4. Empujoncito anti-esquina de la pelota.
5. Hints del fugitivo y del tiro de fuego.
6. Compartir skins por código.
7. PWA (manifest + ícono).

### Tanda 3 — según respuesta de la gente
1. Mutadores / modo Caos.
2. Torneo local.
3. Modo gráficos bajos si el móvil lo pide.
4. Recién acá: pensar online, si los números lo justifican.

---

## En una frase

El juego ya divierte; lo que falta es que **parezca un producto al llegar**
(tanda 1) y que **recuerde al jugador que existe** (récords, desafíos,
racha — tanda 2). Ninguna de las dos tandas requiere contenido nuevo
grande: es pulido de bordes y memoria local.
