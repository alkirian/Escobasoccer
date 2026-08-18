// Bot: entiende pelota, arcos, trayectoria y rival. Comete errores humanos
// (cursor con velocidad limitada, decisiones a 8Hz, ruido) pero nunca es aleatorio.
import { CFG } from './config.js';
import { portalCenter } from './arena.js';
import { clamp, rand } from './utils.js';

export class Bot {
  constructor(player, ownSide) {
    this.player = player;
    this.ownSide = ownSide;               // +1 defiende portal derecho
    this.targetSide = -ownSide;           // anota en el portal contrario
    this.aim = { x: player.broom.pos.x + this.targetSide * 200, y: player.broom.pos.y };
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
      if (this.stuckT > 2.2) { this.backoffT = 1.1; this.stuckT = 0; }
    } else {
      this.stuckT = Math.max(this.stuckT - dt * 2, 0);
    }
    if (this.backoffT > 0) this.backoffT -= dt;

    this.decideT -= dt;
    if (this.decideT <= 0) {
      this.decideT = 0.12;
      this._decide(world);
    }

    // El cursor del bot se mueve con velocidad limitada (justo, no aimbot)
    const dx = this.desired.x + this.noise.x - this.aim.x;
    const dy = this.desired.y + this.noise.y - this.aim.y;
    const d = Math.hypot(dx, dy);
    const maxMove = 2400 * dt;
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

    // Predicción simple de la pelota
    const distToBall = Math.hypot(ball.pos.x - me.pos.x, ball.pos.y - me.pos.y);
    const tPred = clamp(distToBall / 750, 0.08, 0.55);
    const bp = {
      x: ball.pos.x + ball.vel.x * tPred,
      y: ball.pos.y + ball.vel.y * tPred + 0.5 * CFG.ball.gravity * tPred * tPred * 0.6,
    };

    // Dirección pelota → portal rival (donde quiero empujarla)
    let sx = scorePortal.x - bp.x, sy = scorePortal.y - bp.y;
    const sl = Math.hypot(sx, sy) || 1;
    sx /= sl; sy /= sl;

    // ¿Peligro? La pelota va hacia mi portal
    const towardOwn = this.ownSide > 0 ? ball.vel.x > 220 : ball.vel.x < -220;
    const ballNearOwn = Math.abs(ball.pos.x - ownPortal.x) < halfW * 0.85;
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
      this.desired.x = ownPortal.x * 0.55 + bp.x * 0.45;
      this.desired.y = bp.y * 0.55;
      const toT = Math.hypot(this.desired.x - me.pos.x, this.desired.y - me.pos.y);
      this.thrust = toT > 130;
      this.brake = toT < 90 && speed > 380;
      this.tuck = false;
      this.wantsBoost = false;
      const n = 45;
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
        const n = 30;
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
    } else if (towardOwn && ballNearOwn && !meBehindBall) {
      // DEFENSA: interponerse entre la pelota y mi portal
      this.mode = 'defend';
      if (distToBall < 180) {
        // despeje: atravesar la pelota hacia el centro de la arena
        this.desired.x = bp.x - this.ownSide * 120;
        this.desired.y = bp.y - 30;
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
    if (this.mode === 'attack' || this.mode === 'defend') {
      const closingSpeed = Math.max(speed, 120);
      const tToBall = distToBall / closingSpeed;
      if (tToBall < 0.3 && tToBall > 0.07) this.tuck = true;   // cargar
      else if (tToBall <= 0.07) this.tuck = false;             // soltar → latigazo
    }

    // Boost: solo vale la pena a distancia, yendo derecho hacia algo
    this.wantsBoost = this.thrust && distToBall > 420 && Math.abs(diff) < 0.6;

    // Error humano (menos cuando está encima de la pelota)
    const n = distToBall < 220 ? 15 : 45;
    this.noise.x = rand(-n, n);
    this.noise.y = rand(-n, n);
  }
}
