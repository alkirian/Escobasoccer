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
      if (this.stuckT > 1.7) { this.backoffT = 1.1; this.stuckT = 0; }
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
      this.decideT = 0.09 * this.diff.think;
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
    // El que está más cerca va a buscarla; el otro cubre, salvo que sea el
    // 'support' y la pelota esté claramente lejos de su zona.
    let hangBack = false;
    if (world.players && world.players.length > 2) {
      const mates = world.players.filter(
        (p) => p !== this.player && p.team === this.player.team);
      const closest = mates.every(
        (p) => Math.hypot(ball.pos.x - p.broom.pos.x, ball.pos.y - p.broom.pos.y) > distToBall);
      // El apoyo cede la pelota al compañero y se queda cubriendo el arco
      hangBack = this.role === 'support' && !closest;
    }

    if (hangBack) {
      // CUBRIR: quedarse entre la pelota y el arco propio, sin encimar
      this.mode = 'cover';
      this.shotAim = null;
      // Interpolar hacia el arco propio en LOS DOS ejes. La Y iba hacia 0
      // absoluto en vez de hacia `ownPortal.y` (portalY = 97.28), así que el
      // cubridor se paraba ~97 unidades por encima del arco que defendía —
      // un error sistemático, siempre en la misma dirección.
      this.desired.x = ownPortal.x * 0.55 + bp.x * 0.45;
      this.desired.y = ownPortal.y * 0.55 + bp.y * 0.45;
      const toT = Math.hypot(this.desired.x - me.pos.x, this.desired.y - me.pos.y);
      this.thrust = toT > 130;
      this.brake = toT < 90 && speed > 380;
      this.tuck = false;
      this.wantsBoost = false;
      const n = 45 * this.diff.aim;
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
      if (bestOfTeam && !emergency && dRun < CFG.runner.chaseRange) {
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
      // Brake kick: cerca y rápido → frenar para que el cuerpo golpee
      this.brake = distToBall < 150 && speed > 480 && Math.random() < 0.5;

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
      const aboutToHit = tToBall < 0.34;

      if (aboutToHit) {
        // Al entrar en la ventana de golpe el cursor deja de dirigir la escoba
        // y pasa a APUNTAR EL TIRO: al arco rival, no al punto de rodeo. Sin
        // esto, en 'flank' el cursor está detrás de la pelota (del lado propio)
        // y el latigazo salía derecho al arco de uno — el autogol del saque.
        // Se apunta un poco por dentro del arco para que el tiro converja.
        this.shotAim = { x: scorePortal.x - this.targetSide * 40, y: scorePortal.y };
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

      if (safeToHit && tToBall < 0.34 && tToBall > 0.06) this.tuck = true;
      else if (tToBall <= 0.06) this.tuck = false;             // soltar → latigazo
      else if (!safeToHit) { this.tuck = false; this.shotAim = null; }
    } else {
      this.shotAim = null;
    }

    // Boost: antes solo lo usaba lejos y atacando, así que en defensa llegaba
    // caminando a tapar. Ahora también cubre la carrera defensiva, que es
    // donde un humano hacía la diferencia yendo con impulso.
    const boostWorthIt = distToBall > 320 || this.mode === 'defend';
    this.wantsBoost = this.thrust && boostWorthIt && Math.abs(diff) < 0.6;

    // Error humano (menos cuando está encima de la pelota)
    const n = (distToBall < 220 ? 9 : 30) * this.diff.aim;
    this.noise.x = rand(-n, n);
    this.noise.y = rand(-n, n);
  }
}
