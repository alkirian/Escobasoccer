// Configuración central — todos los números de tuning viven acá.

// Escala del mapa. El mundo usa píxeles de la imagen, así que agrandar el
// mapa es estirar imagen Y límites por igual: el arte sigue calzando con la
// física, pero los magos quedan proporcionalmente más chicos y sobra cancha.
// Subirlo da más espacio para volar (necesario en 2v2); bajarlo aprieta todo.
const MAP = 1.28;

// Escala del mago y su escoba. Es independiente del mapa a propósito: agrandar
// la cancha (MAP) achica a los personajes en pantalla, y este número los
// devuelve a un tamaño legible sin tocar los límites del campo. Multiplica la
// escoba, las posturas del ragdoll, los radios de colisión y los grosores de
// dibujo por igual, así el personaje crece entero y no deformado.
const CHAR = 1.7;

export const CFG = {
  charScale: CHAR,
  // Arena — el mapa ES la imagen "mapa.webp" (2752x1536), escalada por MAP.
  // El mundo usa píxeles de esa imagen con el origen en su centro, así el
  // arte y la física comparten exactamente las mismas coordenadas y nada
  // queda desalineado. La cámara es fija: siempre se ve el mapa completo.
  arena: {
    // WebP q92: mismas dimensiones que el JPEG original, 262 KB en vez de
    // 1.99 MB (PSNR 43.9 dB — indistinguible a ojo) y sin el espacio en el
    // nombre, que obligaba a URL-encodearlo y era un riesgo con CDNs.
    src: 'mapa.webp',    // relativo: funciona igual servido desde raíz o subpath
    scale: MAP,
    imgW: 2752 * MAP,
    imgH: 1536 * MAP,
    L: -1238 * MAP,      // plano del arco rúnico izquierdo
    R: 1238 * MAP,       // plano del arco rúnico derecho
    T: -730 * MAP,       // techo invisible, al ras del cielo
    B: 405 * MAP,        // superficie del campo (césped), delante del parapeto
    portalY: 76 * MAP,   // centro de los arcos, medido sobre la imagen
    // Media altura del hueco del arco. Mueve la zona de gol Y el dibujo del
    // portal juntos, así lo que se ve es siempre lo que cuenta. Bajado de 115
    // para que meter gol pida más puntería: con el radio de la pelota
    // descontado, la banda efectiva pasa de ~135 a ~121 unidades.
    portalR: 104 * MAP,
    suction: 620,        // atracción mágica cerca de la boca del arco
  },

  // Escoba — cuerpo rígido dominante
  broom: {
    halfLen: 55 * CHAR,
    gravity: 0,          // sin gravedad: la escoba levita con ondulaciones mágicas
    thrust: 1150,        // aceleración con LMB
    dragLin: 0.6,        // resistencia del aire lineal
    dragQuad: 0.0009,    // resistencia cuadrática (limita vel. máxima ~830)
    brakeDrag: 6.0,      // freno aéreo RMB (drag extra)
    angK: 150,           // resorte angular hacia el cursor
    angD: 17,            // amortiguación angular
    angAccMax: 62,       // torque máximo (rad/s²)
    tuckAngMul: 1.65,    // recogido → rota más rápido
    overrideMul: 3.2,    // giro extra cuando el golpe dirigido toma el control
    // Inercia rotacional. Escala con CHAR² como una barra real (I ∝ L²): una
    // escoba más larga recibe más torque de un golpe en la punta, pero también
    // cuesta más girarla, así el balance de los choques no cambia al agrandar.
    // El apuntado con el mouse no pasa por acá (usa aceleración directa), así
    // que la respuesta del control queda idéntica.
    inertia: 2600 * CHAR * CHAR,
    bounce: 0.42,        // rebote contra muros
    tipR: 9 * CHAR,      // radio de colisión de las puntas
  },

  // Latigazo corporal — el "dodge" del juego.
  // Mantener Space carga (el cuerpo se recoge y se enrolla hacia atrás),
  // soltar lanza el cuerpo en un arco alrededor del AGARRE DE LAS MANOS.
  // Como el pivote son las manos y no el centro de la escoba, los pies
  // salen por fuera del alcance del palo sin tocar el ángulo de la escoba:
  // por eso se puede acelerar y apuntar durante todo el movimiento.
  whip: {
    minCharge: 0.12,      // un toque de Space no dispara nada (sigue sirviendo para girar)
    windAngle: 1.15,      // rad que el cuerpo se enrolla hacia atrás al cargar
    windSpeed: 9,         // velocidad de enrollado (1/s)
    releaseVel: 13,       // rad/s inicial del latigazo
    damping: 3.2,         // frenado del swing
    duration: 0.42,       // ventana comprometida: el mouse ya no lo cancela
    returnK: 26,          // resorte de vuelta a swing = 0
    returnD: 7,
    cooldown: 0.35,
    flickThreshold: 0.15, // rad de desfase mínimo para leer el sentido del mouse
    extendAt: 0.04,       // fracción del arco donde las piernas se estiran
    recoilMax: 1900,      // tope del empujón sobre la escoba durante el latigazo
                          // (medido: ~5° de desvío de vuelo, se siente sin robar el rumbo)

    // --- Golpe dirigido ---
    // Si al soltar la pelota está en rango, el latigazo se vuelve un golpe
    // apuntado: el personaje gira lo que haga falta (aunque esté de espaldas)
    // y la manda hacia el cursor. Fuera de rango sigue siendo un latigazo
    // libre, que puede fallar: el compromiso es el que da el riesgo.
    range: 300,           // radio real de captura
    // El círculo que se dibuja es más chico que el radio real: durante la
    // carga la pelota se mueve, así que el margen garantiza que todo lo que
    // el jugador VE adentro efectivamente conecte. Prometer de menos.
    shownRange: 0.85,
    aimAssist: 0.85,      // 0 = física pura, 1 = va exacto al cursor
    aimedPower: 1450,     // velocidad base de un golpe dirigido bien dado
    aimedMinPower: 620,   // piso, para que un roce dirigido igual sirva

    // --- Potencia del golpe ---
    // Se multiplica por cuánto se mantuvo Space y por cuánta energía de orbes
    // hay en la reserva. Exagerado a propósito: un golpe A FONDO con Space
    // tiene que sentirse como un cañonazo que cruza la cancha, no un pase
    // fuerte. Medido: carga completa sin energía ronda 3400-3800 u/s.
    chargeFull: 0.8,      // mantener Space hasta acá da la carga máxima
    chargeBonus: 1.7,     // +170% de potencia a carga completa
    energyBonus: 0.9,     // +90% adicional con la reserva llena
    energyCost: 30,       // lo que gasta un golpe (0 = que no gaste nada)

    // --- Tiro de fuego ---
    // Con media reserva o más, el golpe sale INFLAMADO: suma potencia encima
    // de todo lo anterior y prende la pelota. Es un umbral y no una rampa a
    // propósito: el jugador tiene que poder mirar el frasco y saber si le
    // toca el cañonazo, y guardar energía deja de ser algo abstracto.
    fireThreshold: 0.5,   // fracción del frasco necesaria
    fireBonus: 1.3,       // +130% adicional cuando sale inflamado
    // Piso garantizado del tiro de fuego. La velocidad normal depende de con
    // cuánta velocidad llegó el pie al contacto, así que un golpe inflamado
    // mal conectado podía salir flojo — y gastar media reserva para eso se
    // siente a robo. Con el piso, prender la pelota SIEMPRE es un misil que
    // cruza la cancha entera.
    fireMinPower: 3400,
    spinLead: 2.4,        // rad de arco antes del contacto: cuanto más, más vuelta
    // Estocada: al soltar, el personaje se lanza hacia la pelota lo justo para
    // llegar dentro de la ventana del latigazo. Sin esto el brazo de palanca
    // (~100) es mucho menor que el rango (300) y el pie nunca alcanza.
    lungeTime: 0.16,      // en cuánto tiempo quiere cubrir la distancia
    lungeMax: 950,        // tope del envión
    reachPad: 60,         // hasta dónde tiene que acercarse para conectar
    // Persecución: mientras el golpe dirigido no tocó la pelota, el cuerpo
    // SIGUE girando y la escoba sigue yendo hacia ella. Así, aunque los pies
    // no lleguen de una, el personaje da la vuelta y pega igual — que es lo
    // que evita la sensación de "apreté y no pasó nada".
    maxDuration: 0.85,    // tope de la persecución (≈2 vueltas)
    seekDamping: 0.5,     // casi no frena el giro mientras busca
    homingAcc: 3400,      // aceleración hacia la pelota mientras busca
  },

  // Jinete — active ragdoll (verlet)
  rider: {
    gravity: 0,   // sin gravedad: el jinete flota mágicamente con la escoba
    drag: 1.15,          // drag del aire sobre puntos
    iterations: 6,       // iteraciones de constraints por paso
    reactK: 150,         // fuerza de reacción de las manos sobre la escoba
    reactMax: 1500,      // tope de esa fuerza (cuerpo = influencia secundaria)
    tuckSpeed: 7,        // velocidad de transición a recogido (1/s)
    armStretch: 1.3,     // los brazos pueden estirarse hasta 30% (nunca soltarse)

    // --- Inercia del cuerpo: exagerada al acelerar/frenar, contenida al girar ---
    // Son dos diales opuestos a propósito. Acelerar y frenar SÍ tienen que
    // deformar fuerte (es lo que hace que la velocidad se sienta), pero girar
    // NO: en un giro rápido el cuerpo cruza los 360° y aflojar ahí es lo que
    // dejaba una pierna arriba de la cabeza. Por eso la correa se afloja con
    // la aceleración y se APRIETA con la velocidad angular.
    dragPose: 0.85,      // cuánto llega a estirarse hacia atrás acelerando (0..1)
    lurchPose: 0.70,     // cuánto se comprime hacia adelante frenando (0..1)
    accelLeash: 1.15,    // aflojado extra de la correa a full aceleración
    spinLeash: 0.72,     // apretado de la correa girando rápido (< 1 = más rígido)
    spinRef: 9,          // rad/s a partir de los cuales el giro se considera "rápido"
  },

  // Pelota
  ball: {
    r: 34,               // más grande: mejor lectura y contacto más generoso
    gravity: 380,
    dragLin: 0.2,        // más resistencia → más lenta, ventana de control mayor
    // El drag cuadrático es el verdadero techo de un cañonazo: a más
    // velocidad, más frena. Antes (0.0006) un tiro a 3600 se comía media
    // cancha en el primer instante y llegaba muerto al otro lado — subir
    // solo la velocidad de salida no alcanzaba. Bajado para que un golpe
    // cargado A FONDO cruce la cancha entera (~3169) todavía rápido.
    dragQuad: 0.00022,
    bounce: 0.68,        // restitución contra muros
    // Techo alto a propósito: el juego normal rara vez pasa de ~1200, así que
    // esto no acelera el partido — es el margen que necesita el golpe cargado
    // para poder ser realmente más fuerte en vez de recortarse contra el tope.
    maxSpeed: 6200,
    // Cuánto dura prendida la pelota tras un tiro de fuego
    fireTime: 2.4,

    // ── Contragolpes encadenados (golpes críticos) ──────────────────────
    // Devolver de volea una pelota que viene fuerte es un GOLPE CRÍTICO: sale
    // al doble de velocidad y envuelta en fuego. Si alguien la devuelve otra
    // vez dentro de la ventana, el siguiente sale más fuerte todavía y además
    // zigzagueando camino al arco. Premia el ida y vuelta rápido, que es el
    // momento más divertido del juego, y no el empujón acompañando.
    chain: {
      window:   1.6,   // segundos para encadenar el siguiente contragolpe
      maxLevel: 3,     // tope de eslabones (más sería incontrolable)
      speedMul: 1.0,   // nivel 1 = ×2, nivel 2 = ×3, nivel 3 = ×4
      capBonus: 0.55,  // cuánto sube el techo de velocidad por eslabón
      minIn:    620,   // la pelota tenía que venir rápido de verdad
      minOut:   700,   // y salir rápido: un roce no cuenta
      minDot:   0.35,  // cuán "de frente" hay que devolverla (0..1) — para el nivel 1
      // A partir del SEGUNDO eslabón (el que dispara el zigzag) ya no alcanza
      // con devolverla rápido: tiene que ser un jugador respondiéndole a otro,
      // más de frente y con más fuerza que el golpe recibido. Medido antes de
      // este cambio: el zigzag salía cada ~36 s de partido, mucho más seguido
      // de lo que "difícil de alcanzar" pide.
      minDotChain: 0.62, // devolución bastante más de frente para escalar a zigzag
      minOutMul:   1.15, // el golpe de vuelta tiene que salir ≥15% más fuerte que el que entró
      // El zigzag es un DESVÍO ANGULAR alrededor de la recta del disparo, con
      // tope. Así la pelota serpentea pero siempre avanza hacia donde la
      // mandaron: da sensación de fuerza, no de pelota descontrolada.
      //
      // Antes era una aceleración lateral (zigAmp) perpendicular a la
      // velocidad actual, y se realimentaba: medido, la pelota giraba 181° y
      // volvía hacia atrás. Con un tope angular eso es imposible por
      // construcción.
      zigMaxAng: 0.44, // desvío máximo en radianes (~25°) a cada lado
      zigAmp:    1,    // sólo marca que el zigzag está activo (ver nivel ≥ 2)
      zigFreq:   9.0,  // qué tan rápido serpentea (rad/s)
    },
    bodyKick: 0.85,      // transferencia de golpe del cuerpo (a máxima velocidad de contacto)
    feetKick: 1.3,       // los pies pegan más fuerte (brake kick / flick)
    broomKick: 0.7,      // la punta de la escoba: precisa pero no dominante
    // Solo la punta pega ("broom shot"). El resto del palo empuja la pelota
    // para que nunca lo atraviese, pero sin rebote — así deja de robarle
    // todos los contactos al cuerpo, que es el arma fuerte.
    tipZone: 0.72,       // fracción del palo a partir de la cual empieza la punta
    shaftKick: 0.12,
    // Respuesta de contacto dependiente de la velocidad del toque:
    // por debajo de softVn el contacto casi absorbe (control, "acompañar" la
    // pelota); por encima de hardVn se comporta como ahora (rebote enérgico).
    softVn: 90,
    hardVn: 480,
  },

  // Orbes de energía — recurso mágico repartido por la arena.
  // Las posiciones son fracciones del semi-ancho/alto jugable, así se
  // reacomodan solas si cambia el mapa. Editar `layout` para rebalancear.
  orbs: {
    r: 17,               // radio visual
    pickupR: 85,         // radio de recolección: generoso, roza y ya es tuyo
    // Un tanque entero por orbe. Con 4 orbes en las esquinas (en vez de 12
    // repartidos) la cancha producía 44 de energía por segundo contra 64 de
    // demanda entre 4 jugadores: todos jugaban SIEMPRE sin impulso — medido,
    // reserva vacía el 88% del partido. Ir hasta una esquina tiene que pagar
    // el viaje.
    energy: 100,         // tanque lleno: el viaje a la esquina vale la pena
    // Con sólo 4 orbes y hasta 4 jugadores, 7 s dejaba las esquinas vacías
    // casi siempre (medido: 1 de 4 vivo en pleno partido) y el turbo se volvía
    // inaccesible. 4.5 s mantiene las esquinas como un recurso que vale la
    // pena visitar sin regalarlo.
    respawn: 3.5,        // segundos hasta reaparecer
    fadeIn: 1.1,         // animación de regreso, para poder anticiparlo
    bobAmp: 9,           // amplitud del flotar
    bobSpeed: 1.6,
    // Al entrar en pickupR el orbe no desaparece: queda "enganchado" y
    // vuela hacia el jugador hasta alcanzarlo de verdad — recién ahí se
    // consume y suma la energía. catchSpeed es un piso; si el jugador va
    // más rápido, lo persigue más rápido todavía para no quedarse atrás.
    catchSpeed: 1300,
    catchDist: 40,        // qué tan cerca tiene que llegar para consumirse
    // Distribución: UNO POR ESQUINA. Antes eran 12 repartidos por todos lados,
    // y con eso la energía se juntaba sola volando en línea recta — el turbo
    // era gratis en la práctica. Con cuatro en las esquinas hay que salir de
    // la jugada a propósito para recargar: ir a buscar energía es abandonar la
    // pelota unos segundos, y esa es la decisión que hace interesante el
    // recurso. Cada uno da mucho más (60 vs 22) para compensar el viaje.
    layout: [
      { x: -0.86, y: -0.62 }, { x: 0.86, y: -0.62 },
      { x: -0.86, y: 0.55 }, { x: 0.86, y: 0.55 },
    ],
  },

  // Impulso mágico (boost): se gasta la energía de los orbes
  boost: {
    max: 100,
    thrustMul: 2.35,     // aceleración durante el boost
    // Bajado de 46 a 34: con 4 orbes en vez de 12, el turbo tiene que rendir.
    // Un tanque lleno = ~3 s continuos, y dos orbes lo llenan. Así el turbo es
    // combustible de verdad (se acaba, hay que ir a buscarlo) sin que quedarse
    // seco sea la norma.
    drain: 34,           // energía por segundo mientras se usa
    minToStart: 12,      // no se puede arrancar con la reserva casi vacía
    speedCapMul: 1.55,   // deja superar el techo normal de velocidad
  },

  // Orbe fugitivo — el premio gordo, y no se deja agarrar.
  // Aparece cada tanto, HUYE de todos, y atraparlo da energía ilimitada.
  // El balance vive en `speed`: más rápido que un vuelo normal (~823) pero
  // más lento que uno con impulso (~1663). Para alcanzarlo hay que gastar
  // energía, y lo que reparte es energía — apostás reserva para ganar
  // reserva infinita. Mientras tanto el partido sigue: perseguirlo es
  // soltar la pelota, y ahí está la decisión.
  runner: {
    r: 30,               // bien más grande que un orbe común: se ve de lejos
    pickupR: 86,         // generoso: la gracia es la persecución, no el píxel
    firstAt: 22,         // primera aparición tras el saque
    every: 40,           // cada cuánto vuelve
    everyJitter: 10,     // ± para que no sea un metrónomo predecible
    warn: 1.6,           // aviso antes de materializarse
    life: 20,            // si nadie lo alcanza, se desvanece y vuelve después

    // Escapa mejor que una escoba con impulso a fondo (~1663): de frente NO se
    // alcanza, hay que emboscarlo, acorralarlo contra un borde o cansarlo. Que
    // sea muy difícil es el punto — reparte energía ilimitada.
    speed: 1560,         // tope cuando lo están persiguiendo
    calmSpeed: 0.34,     // fracción del tope cuando nadie lo acosa (pasea)
    accel: 4200,         // arranca casi instantáneo: no se lo sorprende quieto
    fleeRange: 1000,     // se da cuenta desde MUY lejos y ya sale disparado
    panicGain: 2.6,      // llega a pánico máximo apenas te ve venir
    panicDecay: 0.28,    // tarda mucho en calmarse: no da respiros
    // Cansancio: sigue siendo la vía para atraparlo, pero mucho más exigente.
    // Aguanta ~13 s de esprint y se recupera lento, así que hay que insistir
    // de verdad — y mientras tanto el partido sigue sin vos.
    // Subido de 13 a ~15 s de esprint, y se recupera más rápido (6.2 → 4.5 s):
    // hay que acosarlo sin soltarlo, porque cualquier respiro que le des lo
    // devuelve entero. Sigue siendo LA vía para atraparlo — que exista una vía
    // es lo que lo mantiene "muy difícil" en vez de imposible.
    stamDrain: 0.066,    // ~15 s de esprint hasta quedar agotado
    stamRecover: 0.22,   // ~4.5 s tranquilo para recuperarse
    tiredSpeed: 0.76,    // agotado sigue siendo rápido
    tiredDodge: 0.48,    // y sigue esquivando bastante
    // El zigzag es lo que más lo hace inalcanzable: una escoba tiene mucha
    // inercia para girar, así que un orbe que corta en diagonal no se agarra
    // aunque vayas más rápido. Subido fuerte — es el corazón de la dificultad.
    dodge: 1.25,         // componente lateral: escapa en diagonal cerrada
    // Además esquiva con un ritmo propio: sin esto el zigzag es una constante
    // y el jugador aprende a "cortarle" el ángulo siempre igual.
    dodgeWave: 2.6,      // velocidad del vaivén lateral (rad/s)
    dodgeWaveAmt: 0.75,  // cuánto del zigzag es oscilante vs fijo
    wallMargin: 320,     // dobla mucho antes: acorralarlo es difícil
    wallWeight: 3.4,     // y se despega del borde con más fuerza
    wander: 0.35,        // deambular cuando está tranquilo

    // AURA DE FUEGO: atraparlo ya no da solo energía infinita — envuelve al
    // mago en llamas y lo vuelve una amenaza por unos segundos. Es corta a
    // propósito: siendo tan difícil de alcanzar, la recompensa tiene que ser
    // desequilibrante mientras dura, no cómoda y larga.
    buff: 8,             // segundos de aura (energía ilimitada incluida)
    auraThrust: 1.30,    // +30% de aceleración: se mueve claramente distinto
    auraShot: 1.55,      // los latigazos salen demoledores
    auraRam: 2.60,       // embestir manda al rival MUY lejos — es lo que más se ve
    chaseRange: 1500,    // hasta dónde un bot considera que vale la pena ir
  },

  // Embestidas: empujar y desestabilizar al rival.
  // La fuerza sale de la velocidad de ACERCAMIENTO entre las dos escobas, así
  // que embestir a fondo mueve de verdad y rozarse no hace nada. Sirve como
  // jugada: sacar al rival de posición antes de que llegue a la pelota.
  ram: {
    minSpeed: 240,      // por debajo de esto no empuja: rozarse no es embestir
    push: 1.25,         // fracción de la velocidad de acercamiento que se transfiere
    maxPush: 1250,      // tope del empujón
    spin: 7,            // desestabilización: giro que le arruina el apuntado
    bodyKnock: 0.0032,  // cuánto sale despedido el ragdoll de la víctima
    recoil: 0.3,        // lo que le cuesta al que embiste (riesgo/recompensa)
    allyMul: 0.22,      // a un compañero apenas se lo mueve
    cooldown: 0.22,     // no se puede empujar en ráfaga
    // Un empujón de al menos esta fuerza saca del aturdimiento a quien acaba
    // de golpearse contra una pared (antes: lo despegaba de la clavada, que
    // ya no existe). Recibir un choque encima de otro no debería dejar a
    // nadie indefenso.
    breakSlam: 520,
  },

  // Golpazo contra una pared o el suelo. Antes esto CLAVABA la escoba y había
  // que forcejear con el mouse para salir; se sacó porque quedarse pegado
  // cortaba el ritmo del partido. Ahora el choque fuerte se nota —rebota seco,
  // queda girando, el cuerpo se desarma— pero se recupera solo enseguida.
  stuck: {
    // Medido: el drag come velocidad en la aproximación, así que un choque
    // a fondo llega a la pared con ~600. Por debajo de esto es un roce normal.
    minSpeed: 520,
    minAlign: 0.82,      // cuán de frente tiene que ser (1 = perpendicular)
    slamTime: 0.42,      // cuánto dura el descontrol (corto: es un tropiezo)
    slamControl: 0.12,   // fracción de control que le queda mientras dura
    slamSpin: 9,         // giro descontrolado que le imprime el golpe
    slamPush: 240,       // envión de rebote hacia afuera de la superficie
    cooldown: 0.5,       // no se puede encadenar dos golpazos seguidos
  },

  // Presentación de inicio y explosión de gol
  intro: {
    time: 3.2,           // termina justo antes del GO (countdown 3.6)
    startZoom: 2.6,      // arranca cerca del mago para ver su skin
    holdFrac: 0.34,      // fracción inicial en la que se queda cerca
  },
  // Explosión de gol: nadie se queda parado mirando. La onda cubre casi toda
  // la cancha y manda a los magos por el aire dando vueltas — el gol se siente
  // aunque estuvieras del otro lado del campo.
  goalBlast: {
    charge: 0.32,        // el portal acumula energía antes de reventar
    // Alcance mayor que la diagonal de la cancha (≈3490): NADIE se salva.
    // Medido: con 1700 el jugador del arco opuesto no se enteraba del gol, y
    // ver a uno volar mientras el otro sigue como si nada mata el momento.
    radius: 3600,
    force: 4200,         // empuje sobre los jugadores
    minPush: 0.28,       // piso del falloff: hasta el más lejano se lleva un tirón
    slam: 0.5,           // sesgo hacia abajo → los estampa contra el campo
    spin: 30,            // giro que le imprime a las escobas
    bodyKick: 0.012,     // cuánto se despega el ragdoll de su propia escoba
    shake: 46,
    flash: 0.5,          // destello blanco de pantalla (segundos)
    slowmo: 0.22,
    slowmoTime: 1.25,
  },

  // Cámara de gameplay: sigue el PROMEDIO entre el jugador y la pelota, y
  // se acerca cuando el jugador tiene la pelota cerca (jugada en marcha) y
  // se aleja cuando está lejos. Los arcos quedan fuera de cuadro seguido a
  // propósito — para eso existen los indicadores de "arco fuera de cámara".
  camera: {
    closeDist: 260,    // por debajo de esto, "tiene la pelota": zoom cerrado
    farDist: 950,      // por encima de esto, zoom abierto del todo
    zoomClose: 1.7,    // × baseZoom (el que muestra el mapa completo)
    zoomFar: 1.25,     // × baseZoom
    followSpeed: 4.5,  // suavizado del paneo (1/s, más alto = más ágil)
    zoomSpeed: 3.2,    // suavizado del zoom (1/s)
  },

  // Partido
  match: {
    duration: 150,       // 2.5 minutos
    countdown: 3.6,      // 3‑2‑1‑¡YA!
    quickCountdown: 1.6, // reset tras gol
    goalPause: 2.6,      // celebración
    goalSlowmo: 0.32,
    // Sin dash en el arranque de cada punto. Se cuenta desde el "¡YA!", no
    // desde el countdown, así son 5 s de juego real: los dos salen a buscar la
    // pelota volando y nadie la roba de entrada con un dash instantáneo.
    dashLockout: 5.0,
    // Arcos cerrados al arranque de cada punto: durante estos segundos los
    // portales rebotan como pared. Evita el gol de rebote en los primeros
    // toques, cuando los cuatro salen del centro amontonados y la pelota
    // sale disparada para cualquier lado. Se cuenta desde el "¡YA!".
    goalSeal: 5.0,
  },

  // Dash (Space / doble toque). Vivía como const suelta en main.js, atada
  // sólo al humano — por eso los bots nunca lo usaban. Ahora es la fuente
  // única para humano Y bots.
  dash: {
    power:      1600,
    duration:   0.07,
    maxCharges: 2,
    recharge:   4.0,
  },

  // Colores de equipos y mundo
  colors: {
    p1: '#3fc0ff', p1Dark: '#155f92', p1Glow: 'rgba(63,192,255,0.55)',
    p2: '#ff8a3c', p2Dark: '#a34410', p2Glow: 'rgba(255,138,60,0.55)',
    skin: '#e8c39a',
    wood: '#8a5a2b', woodDark: '#5d3a17',
    straw: '#c9a04e',
    ball: '#e8dfc8', ballGlow: 'rgba(255,240,190,0.5)',
  },
};

export const FIXED_DT = 1 / 120;
