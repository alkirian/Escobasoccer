// PRUEBA — mecánica alternativa de golpe: http://localhost:PORT/wasd
//
// Movimiento igual que la versión principal (mouse apunta, LMB acelera).
// Lo que cambia es SPACE: en vez del latigazo corporal, la ESCOBA da un
// GIRO COMPLETO de 360°. Ese giro es el que le pega a la pelota si está
// dentro del rango. Siempre gira — hacia adelante o hacia atrás según de
// qué lado quede la pelota.
//
// Escena aislada: no toca la versión principal.
import { CFG, FIXED_DT } from './config.js';
import { clamp, wrapAngle, closestOnSegment } from './utils.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Ball } from './ball.js';
import { Camera } from './camera.js';
import { Particles } from './particles.js';
import { Sound } from './sound.js';
import { Renderer } from './render.js';
import { collideBroomArena } from './arena.js';
import { interactPlayerBall, clampRiderArena } from './collisions.js';
import { OrbField } from './orbs.js';

// Tuning propio de esta prueba
const SPIN = {
  // El giro sale al SOLTAR Space. Un toque rápido se suelta enseguida, así
  // que se siente inmediato; mantener carga y pega mucho más fuerte.
  chargeFull: 0.62,   // mantener hasta acá da la potencia máxima
  timeTap: 0.30,      // vuelta rápida (pase corto)
  timeFull: 0.46,     // vuelta amplia y pesada (tiro fuerte)
  turns: 1,
  cooldown: 0.22,

  // Potencia
  passPower: 560,     // toque rápido: pase corto y controlado
  fullPower: 1320,    // carga completa: cañonazo
  energyBonus: 0.7,   // la energía de orbes multiplica encima
  energyCost: 30,     // solo la gasta un golpe cargado

  // Enganche: el giro se acomoda hacia la pelota para favorecer al jugador.
  // La idea es que uno sienta que TIENE la pelota, no que la persigue.
  range: 290,         // dentro de esto el giro engancha
  homingAcc: 3000,    // acompaña hacia la pelota mientras gira
  lunge: 780,
  lungeTime: 0.16,
  reachPad: 70,
  catchR: 26,         // margen extra de contacto durante el giro
  aimAssist: 0.85,    // 0 = física pura, 1 = exacto al cursor
  holdAim: 0.16,      // tiempo en que el rumbo pedido sigue mandando
};

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);
resize();

const CENTER_Y = (CFG.arena.T + CFG.arena.B) / 2;

const input = new Input(canvas);
const player = new Player(-300, CENTER_Y, 0, 'p1');
const ball = new Ball(120, CENTER_Y);
const camera = new Camera(canvas);
const particles = new Particles();
const sound = new Sound();
const orbs = new OrbField();
input.firstGesture = () => sound.init();

const stubMatch = {
  score: { p1: 0, p2: 0 }, timeLeft: 0, duration: 0, golden: false,
  state: 'play', countT: 0, goalScorer: null, winner: null, timeScale: 1,
};

// Estado del giro y de la carga
const spin = {
  active: false, t: 0, dir: 1, from: 0, cd: 0, dur: 0.4,
  aimed: false, aimX: 0, aimY: 0, hit: false, mul: 1, holdT: 0,
  chargeF: 0,
};
const charge = { active: false, t: 0 };

const world = {
  playerA: player, playerB: null, ball, camera, particles, sound, input, orbs,
  match: stubMatch, practice: true, botsMode: false, paused: false,
  debug: params.has('debug'), spin,
  stats: { lastHit: 0, lastHitAt: 0, lastAimed: false },
  hintText: 'Mouse: apuntar · LMB: acelerar · ESPACIO: GIRO completo de escoba · SHIFT: impulso · R: pelota',
  titleText: 'PRUEBA — el giro de la escoba es el golpe',
};

const fx = {
  onImpact(x, y, strength) {
    if (strength > 130) {
      particles.impact(x, y, strength);
      sound.impact(strength);
      if (strength > 500) camera.shake(Math.min(strength / 90, 14));
    }
  },
};

function bounceBallInArena() {
  const { L, R, T, B } = CFG.arena;
  const b = CFG.ball.bounce, r = ball.r;
  if (ball.pos.x - r < L) { ball.pos.x = L + r; if (ball.vel.x < 0) ball.vel.x *= -b; }
  else if (ball.pos.x + r > R) { ball.pos.x = R - r; if (ball.vel.x > 0) ball.vel.x *= -b; }
  if (ball.pos.y - r < T) { ball.pos.y = T + r; if (ball.vel.y < 0) ball.vel.y *= -b; }
  else if (ball.pos.y + r > B) { ball.pos.y = B - r; if (ball.vel.y > 0) { ball.vel.y *= -b; ball.vel.x *= 0.985; } }
}

function placeBall() {
  ball.reset(player.broom.pos.x + 200, player.broom.pos.y - 50);
}

// Arranca el giro. SIEMPRE gira, se haya cargado o no: si la pelota está en
// rango elige el sentido que barre hacia ella; si no, gira hacia adelante.
// chargeF (0..1) decide si es un pase corto o un cañonazo.
function startSpin(chargeF = 0) {
  const b = player.broom;
  spin.active = true;
  spin.t = 0;
  spin.from = b.angle;
  spin.hit = false;
  spin.holdT = 0;
  spin.chargeF = clamp(chargeF, 0, 1);
  // Cargado = vuelta más amplia y pesada; toque = vuelta corta y viva
  spin.dur = SPIN.timeTap + (SPIN.timeFull - SPIN.timeTap) * spin.chargeF;
  spin.cd = SPIN.cooldown;

  const dx = ball.pos.x - b.pos.x, dy = ball.pos.y - b.pos.y;
  const dist = Math.hypot(dx, dy);
  spin.aimed = dist <= SPIN.range;

  if (spin.aimed) {
    // El cursor se lee ACÁ, no desde control.aim: el giro se dispara en el
    // loop, antes de que el paso de física refresque el apuntado, y usar el
    // valor viejo mandaba la pelota a cualquier lado.
    const aimNow = camera.screenToWorld(input.cursor.x, input.cursor.y);
    let hx = aimNow.x - ball.pos.x, hy = aimNow.y - ball.pos.y;
    const hl = Math.hypot(hx, hy) || 1;
    spin.aimX = hx / hl; spin.aimY = hy / hl;

    // Sentido: el que lleva la punta hacia la pelota por el camino corto.
    // Ese es el "adelante o atrás" — depende de dónde quedó la pelota.
    const toBall = Math.atan2(dy, dx);
    spin.dir = wrapAngle(toBall - b.angle) >= 0 ? 1 : -1;
    spin.hitAngle = toBall;   // dónde en el arco se espera el contacto

    // Potencia: pase corto ↔ cañonazo según la carga, y la energía multiplica.
    // Solo un golpe cargado gasta energía: los pases cortos salen gratis.
    const eFrac = clamp(player.energy / CFG.boost.max, 0, 1);
    spin.mul = 1 + SPIN.energyBonus * eFrac * spin.chargeF;
    if (eFrac > 0 && SPIN.energyCost > 0 && spin.chargeF > 0.35) {
      player.energy = Math.max(0, player.energy - SPIN.energyCost * spin.chargeF);
    }

    // Envión para que el giro alcance la pelota
    const need = (dist - SPIN.reachPad) / SPIN.lungeTime;
    const ux = dx / (dist || 1), uy = dy / (dist || 1);
    const closing = b.vel.x * ux + b.vel.y * uy;
    if (need > closing) {
      const add = Math.min(need - closing, SPIN.lunge);
      b.vel.x += ux * add; b.vel.y += uy * add;
    }
  } else {
    spin.dir = 1;     // sin blanco: giro hacia adelante
    spin.mul = 1;
  }
  sound.pop();
}

// Impulso dirigido: si el giro conectó, la pelota sale hacia el cursor.
function applySpinHit(contactSpeed) {
  const cur = Math.hypot(ball.vel.x, ball.vel.y);
  let ux = spin.aimX, uy = spin.aimY;
  if (cur > 1) {
    ux = ball.vel.x / cur + (spin.aimX - ball.vel.x / cur) * SPIN.aimAssist;
    uy = ball.vel.y / cur + (spin.aimY - ball.vel.y / cur) * SPIN.aimAssist;
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul; uy /= ul;
  }
  // La potencia la decide la carga, no la velocidad cruda del contacto: así
  // un toque rápido es SIEMPRE un pase corto y controlable, y mantener
  // SIEMPRE pega fuerte. Eso es lo que da sensación de control.
  const base = SPIN.passPower + (SPIN.fullPower - SPIN.passPower) * spin.chargeF;
  let speed = Math.min(base * spin.mul, CFG.ball.maxSpeed);
  ball.vel.x = ux * speed;
  ball.vel.y = uy * speed;
  spin.hit = true;
  camera.shake(7);
}

let lastBallSpeed = 0;

function step(dt) {
  const aim = camera.screenToWorld(input.cursor.x, input.cursor.y);
  const b = player.broom;

  // Movimiento igual que la versión principal
  player.control.aim.x = aim.x;
  player.control.aim.y = aim.y;
  player.control.thrust = input.lmb;
  player.control.brake = input.rmb;
  player.control.tuck = false;   // Space ya no es el latigazo corporal
  player.updateEnergy(dt, input.boost);
  input.tick(dt);

  if (spin.cd > 0) spin.cd -= dt;

  // --- Carga de Space ---
  // Se mide mientras se mantiene y el giro sale AL SOLTAR. Un toque rápido se
  // suelta enseguida, así que se siente inmediato y da un pase corto.
  const spaceDown = input.tuck;
  if (spaceDown && !charge.active && !spin.active && spin.cd <= 0) {
    charge.active = true; charge.t = 0;
  }
  if (charge.active) {
    if (spaceDown) {
      charge.t += dt;
    } else {
      startSpin(charge.t / SPIN.chargeFull);
      charge.active = false;
    }
  }

  player.update(dt, false, null);

  // --- GIRO COMPLETO ---
  // Se pisa el ángulo después de la física: la escoba da la vuelta entera
  // sin importar dónde esté el cursor, y el cuerpo la sigue con un frame de
  // retraso, que es justo lo que hace que se vea como un latigazo.
  if (spin.active && !b.stuck) {
    spin.t += dt;
    const k = clamp(spin.t / spin.dur, 0, 1);
    const eased = 1 - Math.pow(1 - k, 2.2);      // arranca fuerte, afloja al final
    b.angle = wrapAngle(spin.from + spin.dir * Math.PI * 2 * SPIN.turns * eased);
    // angVel real, para que el contacto transfiera velocidad de verdad
    b.angVel = spin.dir * (Math.PI * 2 * SPIN.turns / spin.dur) * (1 - k) * 2.2;

    // Enganche: mientras no tocó, la escoba se acomoda hacia la pelota. Es lo
    // que hace sentir que el jugador TIENE la pelota en vez de perseguirla.
    if (spin.aimed && !spin.hit) {
      const dx = ball.pos.x - b.pos.x, dy = ball.pos.y - b.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > SPIN.reachPad * 0.5) {
        b.vel.x += (dx / d) * SPIN.homingAcc * dt;
        b.vel.y += (dy / d) * SPIN.homingAcc * dt;
      }
    }

    // chispas siguiendo la punta (más con carga alta)
    const tip = b.tip();
    particles.magicTrail(tip.x, tip.y, -b.dir().x, -b.dir().y,
      0.6 + spin.chargeF * 0.6, spin.chargeF * 0.8, CFG.colors.p1);
    if (k >= 1) { spin.active = false; b.angVel = 0; }
  }

  collideBroomArena(
    b,
    (x, y, s) => fx.onImpact(x, y, s, 'wall'),
    (x, y, nx, ny, s) => {
      sound.thunk(); camera.shake(9); particles.impact(x, y, s * 0.6);
      player.stuckAt = { x, y, nx, ny };
      spin.active = false;
    },
  );
  if (b.stuck && player.stuckAt) {
    particles.scrape(player.stuckAt.x, player.stuckAt.y, player.stuckAt.nx, player.stuckAt.ny, b.strain);
  } else if (player.stuckAt && !b.stuck) {
    particles.impact(player.stuckAt.x, player.stuckAt.y, 320);
    sound.pop();
    player.stuckAt = null;
  }
  clampRiderArena(player);

  orbs.update(dt);
  orbs.collect([player], (orb, pl, oy) => {
    pl.addEnergy(CFG.orbs.energy);
    particles.orbAbsorb(orb.fx, oy, pl.broom.pos, CFG.colors.p1);
    sound.orb();
  });

  ball.update(dt);
  interactPlayerBall(player, ball, dt, fx);

  // ¿La escoba tocó la pelota durante el giro? Entonces sale hacia el cursor.
  // Se sigue aplicando mientras dure el contacto y un instante después: la
  // escoba sigue girando y volvería a pegarle con física normal, arruinando
  // la dirección que el jugador pidió.
  if (spin.active && spin.aimed) {
    const tip = b.tip(), tail = b.tail();
    const c = closestOnSegment(ball.pos.x, ball.pos.y, tail.x, tail.y, tip.x, tip.y);
    const d = Math.hypot(ball.pos.x - c.x, ball.pos.y - c.y);
    const touching = d < ball.r + SPIN.catchR;
    if (touching) {
      const bv = b.velAt(c.x, c.y);
      const first = !spin.hit;
      applySpinHit(Math.hypot(bv.x, bv.y));
      spin.holdT = SPIN.holdAim;   // ventana en la que la dirección sigue mandando
      if (first) {
        particles.impact(c.x, c.y, 420);
        sound.impact(700);
      }
    } else if (spin.holdT > 0) {
      // Rebote del cuerpo o segundo toque del palo: se reimpone el rumbo
      spin.holdT -= dt;
      const sp2 = Math.hypot(ball.vel.x, ball.vel.y);
      if (sp2 > 1) {
        ball.vel.x = spin.aimX * sp2;
        ball.vel.y = spin.aimY * sp2;
      }
    }
  }

  bounceBallInArena();

  const sp = Math.hypot(ball.vel.x, ball.vel.y);
  if (sp > lastBallSpeed + 60) {
    world.stats.lastHit = sp;
    world.stats.lastHitAt = performance.now();
    world.stats.lastAimed = spin.hit;
  }
  lastBallSpeed = sp;

  const tail = b.tail(), d = b.dir();
  const speedF = Math.min(Math.hypot(b.vel.x, b.vel.y) / 900, 1.4);
  particles.magicTrail(tail.x, tail.y, d.x, d.y,
    Math.max(b.thrustPower, speedF * 0.55), b.boostPower, CFG.colors.p1);
  if (b.brakePower > 0.3) particles.brake(b.pos.x, b.pos.y, b.vel.x, b.vel.y);
  particles.update(dt);
}

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (input.pressed('KeyP') || input.pressed('Escape')) world.paused = !world.paused;
  if (input.pressed('F3')) world.debug = !world.debug;
  if (input.pressed('KeyR')) placeBall();
  input.endFrame();  // la carga de Space se maneja en step(), con dt exacto

  if (!world.paused) {
    acc += dtReal;
    let steps = 0;
    while (acc >= FIXED_DT && steps < 6) { step(FIXED_DT); acc -= FIXED_DT; steps++; }
    if (steps === 6) acc = 0;

    const spA = Math.hypot(player.broom.vel.x, player.broom.vel.y);
    camera.setSpeedPunch(clamp((spA - 900) / 700, 0, 1));
    camera.update(dtReal);
    sound.setThrust(player.broom.thrustPower);
    sound.setBoost(player.broom.boostPower);
    sound.setWind(spA);
  }

  renderer.draw(world, dtReal);
  drawSpinRange();
}

// Alcance del giro y previsualización del tiro, sobre el mundo
function drawSpinRange() {
  if (world.paused) return;
  const b = player.broom;
  const inRange = Math.hypot(ball.pos.x - b.pos.x, ball.pos.y - b.pos.y) <= SPIN.range;
  const chargeF = charge.active ? clamp(charge.t / SPIN.chargeFull, 0, 1) : 0;
  ctx.save();
  camera.applyTransform(ctx);

  ctx.setLineDash([9, 12]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = inRange ? 'rgba(255,215,106,0.5)' : 'rgba(255,255,255,0.13)';
  ctx.beginPath();
  ctx.arc(b.pos.x, b.pos.y, SPIN.range, 0, 7);
  ctx.stroke();
  ctx.setLineDash([]);

  // Anillo de carga: crece de "pase corto" a "cañonazo" mientras mantenés
  if (charge.active) {
    const full = chargeF >= 0.999;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, 78, 0, 7); ctx.stroke();
    ctx.strokeStyle = full ? '#fff0b0' : '#ffd76a';
    ctx.globalAlpha = full ? 0.75 + 0.25 * Math.sin(performance.now() / 45) : 0.85;
    ctx.lineWidth = 4 + chargeF * 6;
    if (full) { ctx.shadowColor = '#ffd76a'; ctx.shadowBlur = 16; }
    ctx.beginPath();
    ctx.arc(b.pos.x, b.pos.y, 78, -Math.PI / 2, -Math.PI / 2 + chargeF * Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  if (inRange) {
    // Hacia dónde va a salir, y con cuánta fuerza: la flecha crece con la carga
    let dx = player.control.aim.x - ball.pos.x, dy = player.control.aim.y - ball.pos.y;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const len = 130 + chargeF * 210;
    ctx.strokeStyle = '#ffd76a';
    ctx.lineWidth = 3 + chargeF * 5;
    ctx.globalAlpha = 0.55 + chargeF * 0.35;
    ctx.beginPath();
    ctx.moveTo(ball.pos.x, ball.pos.y);
    ctx.lineTo(ball.pos.x + dx * len, ball.pos.y + dy * len);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ball.pos.x + dx * len, ball.pos.y + dy * len);
    ctx.lineTo(ball.pos.x + dx * (len - 26) - dy * 14, ball.pos.y + dy * (len - 26) + dx * 14);
    ctx.lineTo(ball.pos.x + dx * (len - 26) + dy * 14, ball.pos.y + dy * (len - 26) - dx * 14);
    ctx.closePath();
    ctx.fillStyle = '#ffd76a';
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

const renderer = new Renderer(canvas, ctx);
placeBall();
requestAnimationFrame(frame);

window.world = world;
window.renderer = renderer;
window.CFG = CFG;
window.SPIN = SPIN;
window.__spin = startSpin;
window.__sim = (seconds = 1) => {
  const n = Math.floor(seconds / FIXED_DT);
  for (let i = 0; i < n; i++) step(FIXED_DT);
  return {
    ball: { x: ball.pos.x | 0, y: ball.pos.y | 0, v: Math.hypot(ball.vel.x, ball.vel.y) | 0 },
    spin: spin.active,
  };
};

console.log('%c🧹 PRUEBA — el giro de la escoba es el golpe', 'font-size:16px;color:#ffd76a');
console.log('Mouse: apuntar · LMB: acelerar · ESPACIO: giro completo · SHIFT: impulso · R: pelota');
