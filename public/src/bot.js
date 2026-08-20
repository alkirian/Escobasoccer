// Bot: entiende pelota, arcos, trayectoria y rival. Comete errores humanos
// (cursor con velocidad limitada, decisiones a 8Hz, ruido) pero nunca es aleatorio.
import { CFG } from './config.js';
import { portalCenter } from './arena.js';
import { clamp, rand } from './utils.js';

// Dificultad: dos palancas sobre el comportamiento que ya existía.
//   think → cada cuánto replantea la jugada (más alto = más lento de reflejos)
//   aim   → cuánto se equivoca al apuntar (más alto = falla más)
// En 'normal' ambos valen 1, así que el bot queda exactamente como estaba.
const DIFFICULTY = {
  facil:   { think: 2.2, aim: 2.4 },
  normal:  { think: 1.0, aim: 1.0 },
  dificil: { think: 0.6, aim: 0.45 },
};

// Personalidad por héroe: sesgos LEVES sobre el comportamiento base, para
// que el rival se sienta distinto según quién sea sin romper el balance
// (la dificultad sigue mandando por encima). Se lee del characterId del
// jugador que controla este bot; sin personaje → bot clásico.
const PERSONAS = {
  // Valka embiste: patea con el freno más seguido y no se queda trabada.
  valka:   { brakeKick: 0.75, impaciente: true, boostCerca: true },
  // Zefir caza: obsesionado con el fugitivo, decide más rápido, vuela a fondo.
  zefir:   { chaseMul: 1.6, thinkMul: 0.85, boostCerca: true },
  // Mordrak se atrinchera: con la pelota en campo rival, espera y contragolpea.
  mordrak: { defensor: true },
  // Ízar bombardea: carga el golpe MUCHO antes — llega con el latigazo a tope.
  izar:    { francotirador: true, brakeKick: 0.3 },
  // Petra piensa lento y pega con el cuerpo: una montaña no se apura.
  petra:   { thinkMul: 1.15, brakeKick: 0.8 },
  // Hilaria teje fino: paciente y con la mejor puntería del plantel.
  hilaria: { aimMul: 0.7, brakeKick: 0.35 },
  // Vendaval ve botín: el fugitivo es SU tesoro, y vuela a todo trapo.
  vendaval: { chaseMul: 1.5, boostCerca: true },
  // Silvano fluye: sereno para decidir, certero para ejecutar.
  silvano: { thinkMul: 1.05, aimMul: 0.8 },
  // Fogón condimenta de más: impaciente, agresivo y algo desprolijo.
  fogon:   { impaciente: true, brakeKick: 0.65, aimMul: 1.15 },
};

export class Bot {
  constructor(player, ownSide, difficulty = 'normal') {
    this.player = player;
    this.ownSide = ownSide;               // +1 defiende portal derecho
    this.targetSide = -ownSide;           // anota en el portal contrario
    this.aim = { x: player.broom.pos.x + this.targetSide * 200, y: player.broom.pos.y };
    this.diff = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
    // Cuando está por golpear, adónde debe APUNTAR el tiro (null = el cursor
    // sigue dirigiendo la escoba normalmente).
    this.shotAim = null;
    this.decideT = 0;
    this.desired = { x: 0, y: 0 };
    this.thrust = false;
    this.brake = false;
    this.tuck = false;
    this.mode = 'attack';
    this.noise = { x: 0, y: 0 };
    this.stuckT = 0;    // detector de scrum trabado
    this.backoffT = 0;  // maniobra: retroceder y volver a embestir
    this.wantsBoost = false;
  }

  update(dt, world) {
    // Anti-atasco: pelota lenta + bot encima durante mucho tiempo
    const ball = world.ball;
    const me = this.player.broom;
    const ballSpeed = Math.hypot(ball.vel.x, ball.vel.y);
    const dBall = Math.hypot(ball.pos.x - me.pos.x, ball.pos.y - me.pos.y);
    if (ballSpeed < 140 && dBall < 260 && this.backoffT <= 0) {
      this.stuckT += dt;
      const lim = (PERSONAS[this.player.characterId] ?? {}).impaciente ? 1.2 : 1.7;
      if (this.stuckT > lim) { this.backoffT = 1.1; this.stuckT = 0; }
    } else {
      this.stuckT = Math.max(this.stuckT - dt * 2, 0);
    }
    if (this.backoffT > 0) this.backoffT -= dt;

    this.decideT -= dt;
    if (this.decideT <= 0) {
      // ~11 Hz en normal. Replantear más seguido es lo que más se nota contra
      // un humano: el bot deja de "comprometerse" con una decisión vieja
      // mientras la jugada ya cambió. La dificultad estira o acorta esta
      // ventana — un bot fácil reacciona tarde a lo que acaba de pasar.
      const pThink = (PERSONAS[this.player.characterId] ?? {}).thinkMul ?? 1;
      this.decideT = 0.09 * this.diff.think * pThink;
      this._decide(world);
    }

    // El cursor cumple DOS funciones a la vez: dirige la escoba (persigue
    // `desired`) y apunta el latigazo (rider dispara la pelota de la pelota
    // hacia el cursor). Cuando el bot está por golpear manda la segunda: si no,
    // en modo 'flank' el cursor apunta detrás de la pelota —del lado del arco
    // propio— y el golpe salía derecho al propio arco. Ese era el autogol del
    // saque. `shotAim` lo fija `_decide` en el instante del golpe.
    const goal = this.shotAim ?? this.desired;
    const dx = goal.x + this.noise.x - this.aim.x;
    const dy = goal.y + this.noise.y - this.aim.y;
    const d = Math.hypot(dx, dy);
    const maxMove = 3000 * dt;
    if (d > maxMove) {
      this.aim.x += dx / d * maxMove;
      this.aim.y += dy / d * maxMove;
    } else {
      this.aim.x += dx;
      this.aim.y += dy;
    }

    const c = this.player.control;
    c.aim.x = this.aim.x;
    c.aim.y = this.aim.y;
    c.thrust = this.thrust;
    c.brake = this.brake;
    c.tuck = this.tuck;
  }

  _decide(world) {
    const ball = world.ball;
    const me = this.player.broom;
    const halfW = CFG.arena.R;
    const persona = PERSONAS[this.player.characterId] ?? {};
    const scorePortal = portalCenter(this.targetSide);
    const ownPortal = portalCenter(this.ownSide);

    // Predicción simple de la pelota. La ventana llega más lejos que antes
    // (0.55 → 0.75): con el tope corto el bot perseguía el lugar donde la
    // pelota YA estuvo en los tiros largos y siempre llegaba tarde.
    const distToBall = Math.hypot(ball.pos.x - me.pos.x, ball.pos.y - me.pos.y);
    const tPred = clamp(distToBall / 750, 0.08, 0.75);
    const bp = {
      x: ball.pos.x + ball.vel.x * tPred,
      y: ball.pos.y + ball.vel.y * tPred + 0.5 * CFG.ball.gravity * tPred * tPred * 0.6,
    };

    // Dirección pelota → portal rival (donde quiero empujarla)
    let sx = scorePortal.x - bp.x, sy = scorePortal.y - bp.y;
    const sl = Math.hypot(sx, sy) || 1;
    sx /= sl; sy /= sl;

    // ¿Peligro? La pelota va hacia mi portal. El umbral de velocidad bajó de
    // 220 a 90: una pelota lenta yendo al arco propio es igual de peligrosa y
    // antes no despertaba la defensa hasta que ya era tarde. Y si además está
    // MUY cerca del arco, es emergencia sin importar a qué velocidad vaya.
    const towardOwn = this.ownSide > 0 ? ball.vel.x > 90 : ball.vel.x < -90;
    const ballNearOwn = Math.abs(ball.pos.x - ownPortal.x) < halfW * 0.85;
    const ballOnDoorstep = Math.hypot(ball.pos.x - ownPortal.x, ball.pos.y - ownPortal.y) < 520;
    const meBehindBall = (me.pos.x - bp.x) * this.ownSide > 30; // entre pelota y mi arco

    // ¿Estoy del lado correcto para empujar la pelota al arco rival?
    const toMe = { x: me.pos.x - bp.x, y: me.pos.y - bp.y };
    const tml = Math.hypot(toMe.x, toMe.y) || 1;
    const alignment = (toMe.x / tml) * sx + (toMe.y / tml) * sy; // < 0 = bien posicionado

    const speed = Math.hypot(me.vel.x, me.vel.y);

    // --- Reparto de roles (2v2) ---
    // Sin esto los dos compañeros persiguen la misma pelota y se estorban.
    //
    // El reparto es DINÁMICO, no por etiqueta fija: el que está mejor parado
    // para la pelota ataca y el otro cubre, y los papeles se intercambian
    // solos durante el partido. Antes `role` era una etiqueta fija y el
    // 'striker' NUNCA cubría — si el 'support' se iba arriba, el arco quedaba
    // solo. Ahora siempre hay alguien atrás: es la queja principal.
    let hangBack = false;
    this.mate = null;
    // Mordrak defensor: con la pelota bien metida en campo rival no la
    // persigue — se queda cubriendo y espera el contragolpe. Sale de la
    // cueva apenas la pelota cruza al medio.
    if (persona.defensor && ball.pos.x * this.ownSide < -halfW * 0.2) {
      hangBack = true;
    }
    const mates = (world.players || []).filter(
      (p) => p !== this.player && p.team === this.player.team);
    if (mates.length) {
      this.mate = mates[0];
      // "Mejor parado" no es sólo distancia: pesa el estar del lado correcto
      // de la pelota. Un compañero pegado a la pelota pero del lado del arco
      // propio está PEOR parado que uno un poco más lejos pero bien ubicado,
      // porque el primero, si va, la empuja hacia adentro.
      const cost = (p) => {
        const d = Math.hypot(ball.pos.x - p.broom.pos.x, ball.pos.y - p.broom.pos.y);
        const behind = (p.broom.pos.x - ball.pos.x) * this.ownSide > 0;
        return d + (behind ? 0 : 420);   // penalización por estar mal parado
      };
      const myCost = distToBall + (meBehindBall ? 0 : 420);
      const iAmBest = mates.every((p) => cost(p) > myCost);
      // El que no va a la pelota cubre. Siempre uno de los dos: nunca los dos
      // arriba, nunca los dos atrás.
      hangBack = !iAmBest;
      this.attacking = iAmBest;

      // ...salvo emergencia: si la pelota está entrando al arco propio, van
      // los dos. Que el compañero "tenga el rol de atacante" no puede impedir
      // que ayude cuando se está por comer un gol.
      if (ballOnDoorstep) hangBack = false;

      // SAQUE: los primeros segundos el que no ataca se queda atrás sí o sí.
      // En el saque la pelota está en el centro, a igual distancia de todos, y
      // el desempate por costo puede dar vuelta entre frames — se veía como
      // los dos saliendo disparados al medio y chocándose entre ellos.
      if ((world.match?.playT ?? 99) < 2.2 && !iAmBest) hangBack = true;
    }

    if (hangBack) {
      // CUBRIR / ATAJAR. Dos comportamientos según dónde esté la pelota:
      //
      //  a) La pelota viene o está cerca → ARQUERO: pararse sobre la línea
      //     que une la pelota con el centro del arco, a media distancia. Ahí
      //     es donde hay que estar para tapar, y no "cerca del arco" a secas.
      //     Antes se interpolaba pelota↔arco sin mirar la trayectoria, así que
      //     la pelota le pasaba al lado y entraba igual.
      //  b) La pelota está lejos → esperar en posición adelantada, listo para
      //     recibir un pase o salir de contra.
      this.mode = 'cover';
      this.shotAim = null;

      const dBallOwn = Math.hypot(bp.x - ownPortal.x, bp.y - ownPortal.y);
      const amenaza = dBallOwn < halfW * 1.15 || towardOwn;

      if (amenaza) {
        // Colocarse EN LA LÍNEA de tiro, del lado del arco. Es lo que hace un
        // arquero: achicar el ángulo. Cuanto más cerca está la pelota, más
        // sale a achicar; de lejos se queda cerca de la línea.
        let lx = bp.x - ownPortal.x, ly = bp.y - ownPortal.y;
        const ll = Math.hypot(lx, ly) || 1;
        lx /= ll; ly /= ll;
        const salida = clamp(dBallOwn * 0.42, 150, 460);
        this.desired.x = ownPortal.x + lx * salida;
        this.desired.y = ownPortal.y + ly * salida;
        this.wantsBoost = dBallOwn < halfW * 0.7;   // apurarse si es urgente
      } else {
        // Posición de espera: adelantado respecto del arco, listo para recibir.
        this.desired.x = ownPortal.x * 0.62 + bp.x * 0.38;
        this.desired.y = ownPortal.y * 0.62 + bp.y * 0.38;
        this.wantsBoost = false;
      }

      const toT = Math.hypot(this.desired.x - me.pos.x, this.desired.y - me.pos.y);
      this.thrust = toT > 110;
      this.brake = toT < 90 && speed > 380;
      this.tuck = false;
      // Al arquero se le pide MENOS error que a un atacante: un arquero que
      // falla por ruido es un arquero que no ataja, y eso se lee como bot tonto.
      const n = (amenaza ? 22 : 45) * this.diff.aim;
      this.noise.x = rand(-n, n);
      this.noise.y = rand(-n, n);
      return;
    }

    // --- Orbe fugitivo ---
    // Va sólo el que está mejor parado del equipo, y sólo si no está apagando
    // un incendio en su propio arco. Si fueran todos, el partido se
    // transformaría en una cacería y nadie defendería.
    const runner = world.runner;
    if (runner?.active) {
      const dRun = Math.hypot(runner.x - me.pos.x, runner.y - me.pos.y);
      const mates = (world.players || []).filter(
        (p) => p !== this.player && p.team === this.player.team);
      const bestOfTeam = mates.every(
        (p) => Math.hypot(runner.x - p.broom.pos.x, runner.y - p.broom.pos.y) > dRun);
      const emergency = towardOwn && ballNearOwn && !meBehindBall;
      // NO abandonar una ocasión de gol por ir a buscar el orbe. Si tengo la
      // pelota cerca y estoy bien parado para empujarla al arco rival, eso
      // vale más que cualquier premio: un bot que sale corriendo detrás del
      // orbe teniendo el gol servido se ve directamente roto.
      const chanceDeGol = distToBall < 520 && alignment < -0.1
        && Math.hypot(bp.x - scorePortal.x, bp.y - scorePortal.y) < halfW * 1.25;
      if (bestOfTeam && !emergency && !chanceDeGol
          && dRun < CFG.runner.chaseRange * (persona.chaseMul ?? 1)) {
        this.mode = 'runner';
        this.shotAim = null;
        // Interceptar: apuntar adonde VA a estar, no donde está
        const lead = clamp(dRun / 900, 0.1, 0.55);
        this.desired.x = runner.x + runner.vx * lead;
        this.desired.y = runner.y + runner.vy * lead;
        this.thrust = true;
        this.brake = false;
        this.tuck = false;
        // Sin impulso no lo alcanza nunca: el fugitivo corre más que un
        // vuelo normal. Gastar la reserva para ganar reserva infinita.
        this.wantsBoost = true;
        const n = 30 * this.diff.aim;
        this.noise.x = rand(-n, n);
        this.noise.y = rand(-n, n);
        return;
      }
    }

    if (this.backoffT > 0) {
      // RETROCEDER para tomar carrera y volver a embestir la pelota
      this.mode = 'backoff';
      this.desired.x = bp.x - sx * 400;
      this.desired.y = bp.y - sy * 400 - 60;
      this.thrust = true;
      this.brake = false;
    } else if ((towardOwn && ballNearOwn && !meBehindBall) || ballOnDoorstep) {
      // DEFENSA: interponerse entre la pelota y mi portal
      this.mode = 'defend';
      if (distToBall < 180) {
        // Despeje. Antes esto era `bp.x - ownSide * 120`, un corrimiento
        // lateral fijo, y ahí estaba el gol en contra: si la pelota quedaba
        // ENTRE el bot y su propio arco, ese punto caía del lado del arco y el
        // bot aceleraba empujándola adentro. Medido: perdía 5-7 contra un
        // humano quieto, casi todo en contra.
        // Ahora se ataca desde el lado del arco propio hacia afuera: el punto
        // objetivo se coloca detrás de la pelota sobre la recta arco→pelota,
        // así el contacto siempre la manda lejos del portal, nunca adentro.
        let ax = bp.x - ownPortal.x, ay = bp.y - ownPortal.y;
        const al = Math.hypot(ax, ay) || 1;
        ax /= al; ay /= al;
        this.desired.x = bp.x - ax * 150;
        this.desired.y = bp.y - ay * 150;
      } else {
        this.desired.x = bp.x * 0.45 + ownPortal.x * 0.55;
        this.desired.y = bp.y * 0.6;
      }
      this.thrust = true;
      this.brake = false;
    } else if (alignment < -0.1) {
      // ATAQUE: estoy detrás de la pelota → empujarla a través hacia el portal
      this.mode = 'attack';
      this.desired.x = bp.x + sx * 60;
      this.desired.y = bp.y + sy * 60;
      this.thrust = true;
      // Brake kick: cerca y rápido → frenar para que el cuerpo golpee.
      // La personalidad mueve la probabilidad: Valka patea casi siempre,
      // Ízar casi nunca (prefiere llegar cargado).
      this.brake = distToBall < 150 && speed > 480 && Math.random() < (persona.brakeKick ?? 0.5);

      // Seguro anti-autogol: si además de atacar la pelota está pegada al
      // arco propio, empujar "hacia el portal rival" puede significar
      // atravesarla contra el arco de uno. En esa zona se despeja hacia
      // afuera y recién después se ataca.
      const dOwn = Math.hypot(bp.x - ownPortal.x, bp.y - ownPortal.y);
      if (dOwn < 420) {
        let ax = bp.x - ownPortal.x, ay = bp.y - ownPortal.y;
        const al = Math.hypot(ax, ay) || 1;
        this.desired.x = bp.x - (ax / al) * 150;
        this.desired.y = bp.y - (ay / al) * 150;
      }
    } else {
      // RODEAR: ir al punto detrás de la pelota (con arco para no empujarla mal)
      this.mode = 'flank';
      const behind = { x: bp.x - sx * 150, y: bp.y - sy * 150 };
      // desvío perpendicular para no atravesar la pelota
      const perpX = -sy, perpY = sx;
      const side = (me.pos.y - bp.y) * perpY + (me.pos.x - bp.x) * perpX > 0 ? 1 : -1;
      const detour = clamp(1 - Math.abs(alignment), 0, 1) * 120;
      this.desired.x = behind.x + perpX * side * detour;
      this.desired.y = behind.y + perpY * side * detour;
      const toT = Math.hypot(this.desired.x - me.pos.x, this.desired.y - me.pos.y);
      this.thrust = toT > 100;
      // frenar si me paso de largo
      const closing = (me.vel.x * (this.desired.x - me.pos.x) + me.vel.y * (this.desired.y - me.pos.y));
      this.brake = closing < 0 && speed > 420;
    }

    // Recogerse en giros bruscos
    const targetAngle = Math.atan2(this.desired.y - me.pos.y, this.desired.x - me.pos.x);
    let diff = targetAngle - me.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.tuck = Math.abs(diff) > 1.7;

    // Latigazo: cargar al acercarse a la pelota y soltar justo al llegar.
    // Sin esto el bot queda claramente débil contra un humano que sí lo usa.
    //
    // PERO sólo si el golpe saldría en la dirección correcta. El latigazo
    // manda la pelota hacia donde el bot está yendo, y disparar por tiempo sin
    // mirar la dirección era la causa del autogol del saque: los dos salen de
    // frente al centro, el bot llega a la pelota MIRANDO A SU PROPIO ARCO,
    // latiguea y la mete adentro. Ahora se exige que el rumbo actual del bot
    // aleje la pelota del arco propio antes de permitir el golpe.
    if (this.mode === 'attack' || this.mode === 'defend' || this.mode === 'flank') {
      const closingSpeed = Math.max(speed, 120);
      const tToBall = distToBall / closingSpeed;
      // Ízar francotirador: entra en ventana de golpe mucho antes → carga
      // el latigazo más tiempo → llega con el tiro a tope (y de fuego, si
      // tiene reserva). Es SU forma de jugar.
      const ventana = persona.francotirador ? 0.55 : 0.34;
      const aboutToHit = tToBall < ventana;

      if (aboutToHit) {
        // Al entrar en la ventana de golpe el cursor deja de dirigir la escoba
        // y pasa a APUNTAR EL TIRO: al arco rival, no al punto de rodeo. Sin
        // esto, en 'flank' el cursor está detrás de la pelota (del lado propio)
        // y el latigazo salía derecho al arco de uno — el autogol del saque.
        // Se apunta un poco por dentro del arco para que el tiro converja.
        this.shotAim = { x: scorePortal.x - this.targetSide * 40, y: scorePortal.y };

        // ── ¿Tiro o pase? ────────────────────────────────────────────────
        // La decisión que más "piensa" hace parecer al bot. Se pasa cuando el
        // compañero está MEJOR ubicado para convertir: más cerca del arco
        // rival, con línea despejada y no demasiado lejos (un pase de media
        // cancha lo intercepta cualquiera).
        if (this.mate) {
          const mp = this.mate.broom.pos;
          const dMate = Math.hypot(mp.x - bp.x, mp.y - bp.y);
          const miDistArco = Math.hypot(bp.x - scorePortal.x, bp.y - scorePortal.y);
          const suDistArco = Math.hypot(mp.x - scorePortal.x, mp.y - scorePortal.y);
          // Línea de pase despejada: que ningún rival esté cerca del segmento
          // pelota→compañero. Se aproxima mirando la distancia del rival a la
          // recta, que para esto alcanza y es barato.
          let despejada = true;
          for (const p of world.players || []) {
            if (p.team === this.player.team) continue;
            const ex = mp.x - bp.x, ey = mp.y - bp.y;
            const el = Math.hypot(ex, ey) || 1;
            const t = clamp(((p.broom.pos.x - bp.x) * ex + (p.broom.pos.y - bp.y) * ey) / (el * el), 0, 1);
            const px = bp.x + ex * t, py = bp.y + ey * t;
            if (Math.hypot(p.broom.pos.x - px, p.broom.pos.y - py) < 190) { despejada = false; break; }
          }
          // Y que el pase vaya hacia adelante: pasarla hacia atrás, al propio
          // campo, es justo lo que no queremos.
          const haciaAdelante = (mp.x - bp.x) * this.targetSide > -80;
          if (despejada && haciaAdelante && dMate > 260 && dMate < 1500
              && suDistArco < miDistArco - 200) {
            // Pase al PUNTO FUTURO del compañero, no a donde está: si no,
            // la pelota le llega siempre por detrás.
            const lead = clamp(dMate / 1200, 0.1, 0.5);
            this.shotAim = {
              x: mp.x + this.mate.broom.vel.x * lead,
              y: mp.y + this.mate.broom.vel.y * lead,
            };
            this.mode = 'pass';
          }
        }
      } else {
        this.shotAim = null;
      }

      // Además, si por la geometría el tiro igual saldría hacia el arco propio,
      // no se golpea: mejor acompañar la pelota que rematarla en contra.
      let hx = this.shotAim ? this.shotAim.x - bp.x : 0;
      let hy = this.shotAim ? this.shotAim.y - bp.y : 0;
      const hl = Math.hypot(hx, hy) || 1;
      hx /= hl; hy /= hl;
      let ax = bp.x - ownPortal.x, ay = bp.y - ownPortal.y;
      const al = Math.hypot(ax, ay) || 1;
      const awayFromOwn = (hx * ax + hy * ay) / al;
      const safeToHit = !this.shotAim || awayFromOwn > -0.35;

      if (safeToHit && tToBall < ventana && tToBall > 0.06) this.tuck = true;
      else if (tToBall <= 0.06) this.tuck = false;             // soltar → latigazo
      else if (!safeToHit) { this.tuck = false; this.shotAim = null; }
    } else {
      this.shotAim = null;
    }

    // Boost: antes solo lo usaba lejos y atacando, así que en defensa llegaba
    // caminando a tapar. Ahora también cubre la carrera defensiva, que es
    // donde un humano hacía la diferencia yendo con impulso.
    const boostWorthIt = distToBall > (persona.boostCerca ? 230 : 320) || this.mode === 'defend';
    this.wantsBoost = this.thrust && boostWorthIt && Math.abs(diff) < 0.6;

    // Error humano (menos cuando está encima de la pelota). La personalidad
    // afina o empeora la puntería: Hilaria teje fino, Fogón condimenta de más.
    const n = (distToBall < 220 ? 9 : 30) * this.diff.aim * (persona.aimMul ?? 1);
    this.noise.x = rand(-n, n);
    this.noise.y = rand(-n, n);
  }
}
