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
const CHAR = 1.4;

export const CFG = {
  charScale: CHAR,
  // Arena — el mapa ES la imagen "1 mapa.jpeg" (2752x1536), escalada por MAP.
  // El mundo usa píxeles de esa imagen con el origen en su centro, así el
  // arte y la física comparten exactamente las mismas coordenadas y nada
  // queda desalineado. La cámara es fija: siempre se ve el mapa completo.
  arena: {
    src: '1%20mapa.jpeg', // relativo: funciona igual en localhost y en un subpath (GitHub Pages)
    scale: MAP,
    imgW: 2752 * MAP,
    imgH: 1536 * MAP,
    L: -1238 * MAP,      // plano del arco rúnico izquierdo
    R: 1238 * MAP,       // plano del arco rúnico derecho
    T: -730 * MAP,       // techo invisible, al ras del cielo
    B: 405 * MAP,        // superficie del campo (césped), delante del parapeto
    portalY: 76 * MAP,   // centro de los arcos, medido sobre la imagen
    portalR: 185 * MAP,  // media altura del hueco del arco
    suction: 620,        // atracción mágica cerca de la boca del arco
  },

  // Escoba — cuerpo rígido dominante
  broom: {
    halfLen: 55 * CHAR,
    gravity: 130,        // la escoba flota mágicamente: desciende suave sin gas
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
    aimedPower: 1250,     // velocidad base de un golpe dirigido bien dado
    aimedMinPower: 620,   // piso, para que un roce dirigido igual sirva

    // --- Potencia del golpe ---
    // Se multiplica por cuánto se mantuvo Space y por cuánta energía de orbes
    // hay en la reserva. Un toque sin energía sale a ~1250; un cañonazo a
    // fondo con el frasco lleno pasa de 3000.
    chargeFull: 0.8,      // mantener Space hasta acá da la carga máxima
    chargeBonus: 0.85,    // +85% de potencia a carga completa
    energyBonus: 0.7,     // +70% adicional con la reserva llena
    energyCost: 30,       // lo que gasta un golpe (0 = que no gaste nada)

    // --- Tiro de fuego ---
    // Con media reserva o más, el golpe sale INFLAMADO: suma potencia encima
    // de todo lo anterior y prende la pelota. Es un umbral y no una rampa a
    // propósito: el jugador tiene que poder mirar el frasco y saber si le
    // toca el cañonazo, y guardar energía deja de ser algo abstracto.
    fireThreshold: 0.5,   // fracción del frasco necesaria
    fireBonus: 0.7,       // +70% adicional cuando sale inflamado
    // Piso garantizado del tiro de fuego. La velocidad normal depende de con
    // cuánta velocidad llegó el pie al contacto, así que un golpe inflamado
    // mal conectado podía salir flojo — y gastar media reserva para eso se
    // siente a robo. Con el piso, prender la pelota SIEMPRE es un cañonazo.
    fireMinPower: 2000,
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
    gravity: 330,
    drag: 1.15,          // drag del aire sobre puntos
    iterations: 6,       // iteraciones de constraints por paso
    reactK: 150,         // fuerza de reacción de las manos sobre la escoba
    reactMax: 1500,      // tope de esa fuerza (cuerpo = influencia secundaria)
    tuckSpeed: 7,        // velocidad de transición a recogido (1/s)
    armStretch: 1.3,     // los brazos pueden estirarse hasta 30% (nunca soltarse)
  },

  // Pelota
  ball: {
    r: 34,               // más grande: mejor lectura y contacto más generoso
    gravity: 380,
    dragLin: 0.2,        // más resistencia → más lenta, ventana de control mayor
    dragQuad: 0.0006,
    bounce: 0.68,        // restitución contra muros
    // Techo alto a propósito: el juego normal rara vez pasa de ~1200, así que
    // esto no acelera el partido — es el margen que necesita el golpe cargado
    // para poder ser realmente más fuerte en vez de recortarse contra el tope.
    // El drag cuadrático frena el cañonazo enseguida, así que un tiro a 3600
    // recorre ~1500 (media cancha) a toda velocidad y después se normaliza:
    // llega al arco desde el medio sin volverse imposible de defender.
    maxSpeed: 3600,
    // Cuánto dura prendida la pelota tras un tiro de fuego
    fireTime: 2.4,
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
    pickupR: 46,         // radio de recolección (generoso: no debe frustrar)
    energy: 22,          // energía que da cada orbe
    respawn: 7,          // segundos hasta reaparecer
    fadeIn: 1.1,         // animación de regreso, para poder anticiparlo
    bobAmp: 9,           // amplitud del flotar
    bobSpeed: 1.6,
    // Distribución: los del centro están sobre la ruta directa a la pelota,
    // los de los costados obligan a desviarse. Ahí está la decisión.
    layout: [
      { x: 0.00, y: -0.62 }, { x: 0.00, y: 0.55 },
      { x: -0.30, y: -0.24 }, { x: 0.30, y: -0.24 },
      { x: -0.30, y: 0.30 }, { x: 0.30, y: 0.30 },
      { x: -0.62, y: -0.55 }, { x: 0.62, y: -0.55 },
      { x: -0.62, y: 0.42 }, { x: 0.62, y: 0.42 },
      { x: -0.86, y: -0.10 }, { x: 0.86, y: -0.10 },
    ],
  },

  // Impulso mágico (boost): se gasta la energía de los orbes
  boost: {
    max: 100,
    thrustMul: 2.35,     // aceleración durante el boost
    drain: 46,           // energía por segundo mientras se usa
    minToStart: 12,      // no se puede arrancar con la reserva casi vacía
    speedCapMul: 1.55,   // deja superar el techo normal de velocidad
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
    freeStuck: 520,     // un empujón fuerte despega al que estaba clavado
  },

  // Escoba clavada: solo en choques frontales fuertes
  stuck: {
    // Medido: el drag come velocidad en la aproximación, así que un choque
    // a fondo llega a la pared con ~600. Por debajo de esto no se clava.
    minSpeed: 520,
    minAlign: 0.82,      // cuán de frente tiene que ser (1 = perpendicular)
    maxTime: 2.0,        // tope duro: nunca es un castigo largo
    escapeWork: 1.0,     // esfuerzo acumulado necesario para salir antes
    escapeGain: 1.55,    // cuánto suma forcejear (mouse + acelerador)
    popSpeed: 640,       // envión al desprenderse
    cooldown: 1.2,       // no se puede volver a clavar de inmediato
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

  // Partido
  match: {
    duration: 150,       // 2.5 minutos
    countdown: 3.6,      // 3‑2‑1‑¡YA!
    quickCountdown: 1.6, // reset tras gol
    goalPause: 2.6,      // celebración
    goalSlowmo: 0.32,
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
