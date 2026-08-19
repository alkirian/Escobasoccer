// PRUEBA — habilidades por personaje: http://localhost:PORT/heroes
// Base de movimiento igual a /dash (mouse + SHIFT + LMB giro + SPACE dash),
// más una habilidad característica por personaje en la tecla E.
import { CFG, FIXED_DT } from './config.js';
import { clamp, wrapAngle, closestOnSegment } from './utils.js';
import { Input } from './input.js';
import { Camera } from './camera.js';
import { Particles } from './particles.js';
import { Sound } from './sound.js';
import { Renderer } from './render.js';
import { Player } from './player.js';
import { Ball } from './ball.js';
import { OrbField } from './orbs.js';
import { collideBroomArena, collideBallArena } from './arena.js';
import { interactPlayerBall, clampRiderArena } from './collisions.js';
import { HEROES } from './abilities.js';

// ── Tuning (igual que /dash) ───────────────────────────────────────────────
const DASH = { power: 1600, duration: 0.07, maxCharges: 2, recharge: 4.0 };

const SPIN = {
  dur: 0.40, cooldown: 0.30, range: 300, homingAcc: 2800,
  lunge: 750, lungeTime: 0.16, reachPad: 70, catchR: 28,
  aimAssist: 0.82, holdAim: 0.13,
  chargeTime: 0.7, minPower: 900, maxPower: 3200,
};

// ── Setup ──────────────────────────────────────────────────────────────────
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width  = innerWidth  * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);
resize();

const CENTER_Y = (CFG.arena.T + CFG.arena.B) / 2;

const input     = new Input(canvas);
const player    = new Player(-400, CENTER_Y, 0, 'p1');
const ball      = new Ball(200, CENTER_Y - 80);
const camera    = new Camera(canvas);
const particles = new Particles();
const sound     = new Sound();
const orbs      = new OrbField();
input.firstGesture = () => sound.init();

// ── Personaje activo ───────────────────────────────────────────────────────
let heroIdx  = 0;
let hero     = HEROES[heroIdx];
let heroState = hero.init();
let heroCd   = 0;

function selectHero(i) {
  heroIdx   = (i + HEROES.length) % HEROES.length;
  hero      = HEROES[heroIdx];
  heroState = hero.init();
  heroCd    = 0;
  sound.orb();
}

// ── Muñecos de prueba: blancos para el aturdidor y el soplador ────────────
// No son bots: flotan en su sitio con una deriva suave. Alcanza para ver el
// efecto de las habilidades sin meter IA en una escena de prueba.
function makeDummy(x, y) {
  return { x, y, hx: x, hy: y, vel: { x: 0, y: 0 }, stunT: 0, bob: Math.random() * 6 };
}
const dummies = [
  makeDummy(420, CENTER_Y - 120),
  makeDummy(650, CENTER_Y + 90),
];

function updateDummies(dt) {
  const A = CFG.arena;
  for (const d of dummies) {
    d.bob += dt;
    if (d.stunT > 0) {
      d.stunT -= dt;
      // Aturdido: no se resiste, solo se deja llevar y frena de a poco
      d.vel.x *= Math.exp(-1.6 * dt);
      d.vel.y *= Math.exp(-1.6 * dt);
    } else {
      // Vuelve flotando a su sitio, con un vaivén de flotación
      const tx = d.hx + Math.cos(d.bob * 0.8) * 26;
      const ty = d.hy + Math.sin(d.bob * 1.3) * 20;
      d.vel.x += (tx - d.x) * 2.4 * dt;
      d.vel.y += (ty - d.y) * 2.4 * dt;
      d.vel.x *= Math.exp(-2.2 * dt);
      d.vel.y *= Math.exp(-2.2 * dt);
    }
    d.x += d.vel.x * dt;
    d.y += d.vel.y * dt;
    d.x = clamp(d.x, A.L + 40, A.R - 40);
    d.y = clamp(d.y, A.T + 40, A.B - 40);
  }
}

function drawDummies() {
  for (const d of dummies) {
    const stunned = d.stunT > 0;
    ctx.save();
    ctx.translate(d.x, d.y);

    // Cuerpo: un espectro simple, suficiente para leer posición y estado
    ctx.fillStyle = stunned ? 'rgba(92,225,230,0.35)' : 'rgba(255,120,140,0.30)';
    ctx.strokeStyle = stunned ? '#5ce1e6' : '#ff7a8c';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -34, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    if (stunned) {
      // Estrellitas girando alrededor de la cabeza
      const t = performance.now() / 1000;
      ctx.fillStyle = '#eaffff';
      ctx.shadowColor = '#5ce1e6'; ctx.shadowBlur = 12;
      for (let i = 0; i < 3; i++) {
        const a = t * 5 + i * (Math.PI * 2 / 3);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 32, -46 + Math.sin(a) * 10, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      // Barra de aturdimiento
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(-26, 44, 52, 6);
      ctx.fillStyle = '#5ce1e6';
      ctx.fillRect(-26, 44, 52 * clamp(d.stunT / 1.6, 0, 1), 6);
    }
    ctx.restore();
  }
}

// ── Estado (igual que /dash) ───────────────────────────────────────────────
const dashState = { charges: DASH.maxCharges, rechargeT: 0, active: false, t: 0 };

const spin = {
  active: false, t: 0, from: 0, dir: 1, cd: 0,
  aimed: false, aimX: 0, aimY: 0, hit: false, holdT: 0, chargeF: 0,
};

const charge = { active: false, t: 0 };

const stubMatch = {
  score: { p1: 0, p2: 0 }, timeLeft: 0, duration: 0, golden: false,
  state: 'play', countT: 0, goalScorer: null, winner: null, timeScale: 1,
};

const world = {
  playerA: player, playerB: null, ball, camera, particles, sound, input, orbs,
  match: stubMatch, practice: true, botsMode: false, paused: false,
  debug: params.has('debug'),
  hintText: 'Mouse: mover · SHIFT: propulsión · LMB: golpe · SPACE: dash · E: habilidad · 1-4: personaje · R: pelota',
  titleText: 'PRUEBA — habilidades por personaje',
  dashState, spin,
};

const fx = {
  onImpact(x, y, strength) {
    if (strength > 130) { particles.impact(x, y, strength); sound.impact(strength); }
  },
};

function placeBall() {
  ball.reset(player.broom.pos.x + 220, player.broom.pos.y - 60);
}

// Entorno que ve la habilidad. Se rearma cada subpaso: `aim` cambia siempre.
function heroEnv(aim) {
  return { player, broom: player.broom, ball, aim, particles, sound, dummies };
}

let _dashPending = false;
let _castPending = false;

// ── Golpe con giro (igual que /dash) ───────────────────────────────────────
function startSpin(chargeF = 0) {
  const b = player.broom;
  spin.active = true; spin.t = 0; spin.from = b.angle;
  spin.hit = false; spin.holdT = 0; spin.cd = SPIN.cooldown;
  spin.chargeF = clamp(chargeF, 0, 1);

  const dx = ball.pos.x - b.pos.x, dy = ball.pos.y - b.pos.y;
  const dist = Math.hypot(dx, dy);
  spin.aimed = dist <= SPIN.range;

  if (spin.aimed) {
    const aimNow = camera.screenToWorld(input.cursor.x, input.cursor.y);
    let hx = aimNow.x - ball.pos.x, hy = aimNow.y - ball.pos.y;
    const hl = Math.hypot(hx, hy) || 1;
    spin.aimX = hx / hl; spin.aimY = hy / hl;

    const rl = dist || 1;
    const rx = dx / rl, ry = dy / rl;
    const dotCCW = (-ry) * spin.aimX + rx * spin.aimY;
    spin.dir = dotCCW >= 0 ? 1 : -1;

    const ux = dx / rl, uy = dy / rl;
    const need    = (dist - SPIN.reachPad) / SPIN.lungeTime;
    const closing = b.vel.x * ux + b.vel.y * uy;
    if (need > closing) {
      const add = Math.min(need - closing, SPIN.lunge);
      b.vel.x += ux * add; b.vel.y += uy * add;
    }
  } else {
    spin.dir = 1;
  }
  sound.pop();
}

function applySpinHit() {
  const cur = Math.hypot(ball.vel.x, ball.vel.y);
  let ux = spin.aimX, uy = spin.aimY;
  if (cur > 1) {
    ux = ball.vel.x / cur + (spin.aimX - ball.vel.x / cur) * SPIN.aimAssist;
    uy = ball.vel.y / cur + (spin.aimY - ball.vel.y / cur) * SPIN.aimAssist;
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul; uy /= ul;
  }
  const power = SPIN.minPower + (SPIN.maxPower - SPIN.minPower) * spin.chargeF;
  const speed = Math.min(power, CFG.ball.maxSpeed);
  ball.vel.x = ux * speed;
  ball.vel.y = uy * speed;
  spin.hit = true;

  // El Girante convierte el tiro en serpenteo. Es lo único que lo distingue,
  // así que se engancha justo acá, en el instante del contacto.
  if (hero.onHit) hero.onHit(heroState, ux, uy);
}

// ── Paso de física ─────────────────────────────────────────────────────────
function step(dt) {
  const b = player.broom;

  if (dashState.charges < DASH.maxCharges) {
    dashState.rechargeT += dt;
    if (dashState.rechargeT >= DASH.recharge) {
      dashState.charges++;
      dashState.rechargeT = dashState.charges < DASH.maxCharges
        ? dashState.rechargeT - DASH.recharge : 0;
    }
  }

  if (_dashPending && (dashState.charges === 0 || dashState.active)) _dashPending = false;
  if (_dashPending && dashState.charges > 0 && !dashState.active) {
    _dashPending = false;
    dashState.charges--;
    dashState.active = true;
    dashState.t = 0;
    const d = b.dir();
    b.vel.x += d.x * DASH.power;
    b.vel.y += d.y * DASH.power;
    particles.impact(b.pos.x, b.pos.y, 320);
    sound.pop();
  }
  if (dashState.active) {
    dashState.t += dt;
    if (dashState.t >= DASH.duration) dashState.active = false;
  }

  if (spin.cd > 0) spin.cd -= dt;

  const lmbDown = input.lmb;
  if (lmbDown && !charge.active && !spin.active && spin.cd <= 0) {
    charge.active = true; charge.t = 0;
  }
  if (charge.active) {
    if (lmbDown) charge.t += dt;
    else { startSpin(charge.t / SPIN.chargeTime); charge.active = false; }
  }

  // ── Control de movimiento ─────────────────────────────────────────────────
  const aim      = camera.screenToWorld(input.cursor.x, input.cursor.y);
  const hovering = input.rmb;
  const boosting = input.boost;

  player.control.aim.x = aim.x;
  player.control.aim.y = aim.y;
  player.control.thrust        = !hovering;
  player.control.noThrustForce = true;
  player.control.brake         = false;
  player.control.tuck          = false;
  player.control.boost         = false;

  if (!hovering) {
    const mul = boosting ? 1.4 : 0.65;
    const d = b.dir();
    b.vel.x += d.x * CFG.broom.thrust * mul * dt;
    b.vel.y += d.y * CFG.broom.thrust * mul * dt;
  }
  if (hovering) {
    b.vel.x *= Math.exp(-12 * dt);
    b.vel.y *= Math.exp(-12 * dt);
  }

  player.updateEnergy(dt, false);
  input.tick(dt);

  // ── Habilidad (E) ─────────────────────────────────────────────────────────
  if (heroCd > 0) heroCd -= dt;
  const env = heroEnv(aim);
  if (_castPending) {
    _castPending = false;
    if (!hero.passive && heroCd <= 0 && hero.cast?.(heroState, env)) {
      heroCd = hero.cooldown;
    }
  }
  hero.update?.(heroState, env, dt);

  // ── Giro de la escoba ─────────────────────────────────────────────────────
  player.update(dt, false, null);

  if (spin.active && !b.stuck) {
    spin.t += dt;
    const k = clamp(spin.t / SPIN.dur, 0, 1);
    const eased = 1 - Math.pow(1 - k, 2.4);
    b.angle  = wrapAngle(spin.from + spin.dir * Math.PI * 2 * eased);
    b.angVel = spin.dir * (Math.PI * 2 / SPIN.dur) * (1 - k) * 2.4;

    if (spin.aimed && !spin.hit) {
      const dx = ball.pos.x - b.pos.x, dy = ball.pos.y - b.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > SPIN.reachPad * 0.5) {
        b.vel.x += (dx / d) * SPIN.homingAcc * dt;
        b.vel.y += (dy / d) * SPIN.homingAcc * dt;
      }
    }

    const tip = b.tip();
    particles.magicTrail(tip.x, tip.y, -b.dir().x, -b.dir().y, 0.9, 0.5, hero.color);

    if (k >= 1) { spin.active = false; b.angVel = 0; }
  }

  if (spin.active && spin.aimed) {
    const tip = b.tip(), tail = b.tail();
    const c = closestOnSegment(ball.pos.x, ball.pos.y, tail.x, tail.y, tip.x, tip.y);
    const d = Math.hypot(ball.pos.x - c.x, ball.pos.y - c.y);
    if (d < ball.r + SPIN.catchR) {
      const first = !spin.hit;
      applySpinHit();
      spin.holdT = SPIN.holdAim;
      if (first) { particles.impact(c.x, c.y, 480); sound.impact(700); }
    }
  }
  // El serpenteo del Girante manda sobre la ventana post-contacto: si los dos
  // corrigen la dirección se pelean y la curva se aplana.
  const weaving = heroState.active && hero.id === 'girante';
  if (!spin.active && spin.holdT > 0) {
    spin.holdT -= dt;
    if (!weaving) {
      const sp = Math.hypot(ball.vel.x, ball.vel.y);
      if (sp > 1) { ball.vel.x = spin.aimX * sp; ball.vel.y = spin.aimY * sp; }
    }
  }

  // ── Física estándar ───────────────────────────────────────────────────────
  collideBroomArena(b,
    (x, y, s) => fx.onImpact(x, y, s, 'wall'),
    (x, y, nx, ny, s) => { sound.thunk(); particles.impact(x, y, s * 0.6); spin.active = false; },
  );
  clampRiderArena(player);

  orbs.update(dt);
  orbs.collect([player], (orb, pl, oy) => {
    pl.addEnergy(CFG.orbs.energy);
    particles.orbAbsorb(orb.fx, oy, pl.broom.pos, hero.color);
    sound.orb();
  }, dt);

  updateDummies(dt);

  ball.update(dt);
  if (!spin.active) interactPlayerBall(player, ball, dt, fx);
  collideBallArena(ball, (x, y, s) => { if (s > 180) fx.onImpact(x, y, s, 'wall'); });

  const tail = b.tail(), dir = b.dir();
  const speedF = Math.min(Math.hypot(b.vel.x, b.vel.y) / 900, 1.4);
  particles.magicTrail(tail.x, tail.y, dir.x, dir.y,
    Math.max(b.thrustPower, speedF * 0.55),
    dashState.active ? 1 : 0, hero.color);
  if (b.brakePower > 0.3) particles.brake(b.pos.x, b.pos.y, b.vel.x, b.vel.y);
  particles.update(dt);
}

// ── Loop principal ─────────────────────────────────────────────────────────
let last = performance.now();
let acc  = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (input.pressed('KeyP') || input.pressed('Escape')) world.paused = !world.paused;
  if (input.pressed('F3'))   world.debug = !world.debug;
  if (input.pressed('KeyR')) placeBall();

  // Selección de personaje: 1-4, o Q/E-cycle con Tab
  for (let i = 0; i < HEROES.length; i++) {
    if (input.pressed('Digit' + (i + 1))) selectHero(i);
  }
  if (input.pressed('Tab')) selectHero(heroIdx + 1);

  if (!world.paused) {
    if (input.pressed('Space')) _dashPending = true;
    if (input.pressed('KeyE'))  _castPending = true;
  } else {
    input.pressed('Space'); input.pressed('KeyE');  // descartar
  }
  input.endFrame();

  if (!world.paused) {
    acc += dtReal;
    let steps = 0;
    while (acc >= FIXED_DT && steps < 6) { step(FIXED_DT); acc -= FIXED_DT; steps++; }
    if (steps === 6) acc = 0;

    camera.update(dtReal, null, null);
    const spA = Math.hypot(player.broom.vel.x, player.broom.vel.y);
    sound.setThrust(player.broom.thrustPower);
    sound.setBoost(player.broom.boostPower);
    sound.setWind(spA);
  }

  renderer.draw(world, dtReal);
  drawWorldLayer();
  drawHUD();
}

// Capa de mundo: habilidad + muñecos, encima del render normal
function drawWorldLayer() {
  ctx.save();
  camera.applyTransform(ctx);
  drawDummies();
  hero.draw?.(heroState, ctx, heroEnv(camera.screenToWorld(input.cursor.x, input.cursor.y)));
  ctx.restore();
}

// ── HUD ────────────────────────────────────────────────────────────────────
function drawBolt(cx, cy, sz, lit, frac) {
  const pts = [
    [ 0.18, -0.50], [-0.04, -0.02], [ 0.22, -0.02],
    [-0.18,  0.50], [ 0.04,  0.02], [-0.22,  0.02],
  ];
  ctx.save();
  ctx.translate(cx, cy);

  if (!lit && frac > 0) {
    ctx.save();
    ctx.beginPath();
    const top = -sz * 0.5, bottom = sz * 0.5;
    const fillY = bottom - (bottom - top) * frac;
    ctx.rect(-sz, fillY, sz * 2, bottom - fillY);
    ctx.clip();
  }

  if (lit) { ctx.shadowColor = '#ffe040'; ctx.shadowBlur = sz * 0.7; }

  ctx.beginPath();
  ctx.moveTo(pts[0][0] * sz, pts[0][1] * sz);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * sz, pts[i][1] * sz);
  ctx.closePath();

  if (lit) {
    const g = ctx.createLinearGradient(0, -sz * 0.5, 0, sz * 0.5);
    g.addColorStop(0, '#fff066'); g.addColorStop(1, '#80e000');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = sz * 0.07; ctx.stroke();
  } else {
    ctx.fillStyle = frac > 0 ? 'rgba(120,200,60,0.45)' : 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = sz * 0.06; ctx.stroke();
  }

  if (!lit && frac > 0) ctx.restore();
  ctx.restore();
}

function drawHUD() {
  if (world.paused) return;
  const b   = player.broom;
  const now = performance.now();

  // ── Barra de energía + rayos del dash ──
  const BAR_X = 24, BAR_Y = 20, BAR_W = 200, BAR_H = 22;
  const RADIUS = BAR_H / 2;
  const energy = clamp(player.energy / CFG.boost.max, 0, 1);

  ctx.save();
  ctx.beginPath(); ctx.roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, RADIUS);
  ctx.fillStyle = 'rgba(0,0,20,0.65)'; ctx.fill();

  ctx.beginPath(); ctx.roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, RADIUS);
  ctx.strokeStyle = '#00bfff'; ctx.lineWidth = 2.2;
  ctx.shadowColor = '#00bfff'; ctx.shadowBlur = 10;
  ctx.stroke(); ctx.shadowBlur = 0;

  if (energy > 0) {
    ctx.save();
    ctx.beginPath(); ctx.roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, RADIUS); ctx.clip();
    const fillW = BAR_W * energy;
    const pulse = energy > 0.95 ? 0.88 + 0.12 * Math.sin(now / 120) : 1;
    const g = ctx.createLinearGradient(BAR_X, BAR_Y, BAR_X, BAR_Y + BAR_H);
    g.addColorStop(0, `rgba(160,255,60,${pulse})`);
    g.addColorStop(0.45, `rgba(80,220,10,${pulse})`);
    g.addColorStop(1, `rgba(40,160,0,${pulse})`);
    ctx.fillStyle = g; ctx.fillRect(BAR_X, BAR_Y, fillW, BAR_H);
    const shine = ctx.createLinearGradient(BAR_X, BAR_Y, BAR_X, BAR_Y + BAR_H * 0.55);
    shine.addColorStop(0, 'rgba(255,255,255,0.28)');
    shine.addColorStop(1, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = shine; ctx.fillRect(BAR_X, BAR_Y, fillW, BAR_H);
    ctx.restore();
  }

  const BOLT_SZ = 26, BOLT_GAP = 4;
  const boltX0 = BAR_X + BAR_W + 16;
  const boltY  = BAR_Y + BAR_H / 2;
  for (let i = 0; i < DASH.maxCharges; i++) {
    const bx  = boltX0 + i * (BOLT_SZ * 0.62 + BOLT_GAP) + BOLT_SZ * 0.31;
    const lit = i < dashState.charges;
    let frac = 0;
    if (!lit && i === dashState.charges) frac = dashState.rechargeT / DASH.recharge;
    drawBolt(bx, boltY, BOLT_SZ, lit, frac);
  }
  ctx.restore();

  // ── Selector de personajes ──
  const CW = 150, CH = 54, CGAP = 8;
  const cx0 = 24, cy0 = BAR_Y + BAR_H + 18;

  ctx.save();
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('PERSONAJE  (1-4 / Tab)', cx0, cy0 - 6);

  for (let i = 0; i < HEROES.length; i++) {
    const h = HEROES[i];
    const x = cx0, y = cy0 + 6 + i * (CH + CGAP);
    const sel = i === heroIdx;

    ctx.beginPath(); ctx.roundRect(x, y, CW, CH, 8);
    ctx.fillStyle = sel ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,20,0.5)';
    ctx.fill();
    ctx.strokeStyle = sel ? h.color : 'rgba(255,255,255,0.12)';
    ctx.lineWidth = sel ? 2.4 : 1.2;
    if (sel) { ctx.shadowColor = h.color; ctx.shadowBlur = 12; }
    ctx.stroke(); ctx.shadowBlur = 0;

    ctx.font = '20px sans-serif'; ctx.textAlign = 'left';
    ctx.fillStyle = sel ? '#fff' : 'rgba(255,255,255,0.45)';
    ctx.fillText(h.tag, x + 10, y + 30);

    ctx.font = sel ? 'bold 13px sans-serif' : '13px sans-serif';
    ctx.fillStyle = sel ? h.color : 'rgba(255,255,255,0.55)';
    ctx.fillText(h.name, x + 40, y + 22);

    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillText(h.passive ? 'pasiva' : `E · ${h.cooldown}s`, x + 40, y + 38);

    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.textAlign = 'right';
    ctx.fillText(String(i + 1), x + CW - 9, y + 16);
    ctx.textAlign = 'left';
  }
  ctx.restore();

  // ── Habilidad: nombre + recarga ──
  ctx.save();
  const hx = cx0, hy = cy0 + 6 + HEROES.length * (CH + CGAP) + 14;
  ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(hero.hint, hx, hy);

  if (!hero.passive) {
    const RW = 150, RH = 8;
    const ready = heroCd <= 0;
    ctx.beginPath(); ctx.roundRect(hx, hy + 8, RW, RH, RH / 2);
    ctx.fillStyle = 'rgba(0,0,20,0.6)'; ctx.fill();
    const f = ready ? 1 : 1 - heroCd / hero.cooldown;
    ctx.beginPath(); ctx.roundRect(hx, hy + 8, RW * f, RH, RH / 2);
    ctx.fillStyle = hero.color;
    if (ready) { ctx.shadowColor = hero.color; ctx.shadowBlur = 10; }
    ctx.fill(); ctx.shadowBlur = 0;

    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = ready ? hero.color : 'rgba(255,255,255,0.45)';
    ctx.fillText(ready ? 'E — LISTO' : `${heroCd.toFixed(1)}s`, hx + RW + 10, hy + 16);
  }
  ctx.restore();

  // ── Mundo: rango del golpe + anillo de carga ──
  ctx.save();
  camera.applyTransform(ctx);

  const inRange = Math.hypot(ball.pos.x - b.pos.x, ball.pos.y - b.pos.y) <= SPIN.range;
  ctx.setLineDash([7, 10]); ctx.lineWidth = 1.5;
  ctx.strokeStyle = inRange ? 'rgba(255,215,80,0.45)' : 'rgba(255,255,255,0.10)';
  ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, SPIN.range, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  if (charge.active) {
    const cf = clamp(charge.t / SPIN.chargeTime, 0, 1);
    const full = cf >= 0.999;
    const R = 46;
    ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = full ? '#fff0b0' : '#ffd76a';
    ctx.globalAlpha = full ? 0.7 + 0.3 * Math.sin(now / 45) : 0.9;
    ctx.lineWidth = 4 + cf * 6;
    if (full) { ctx.shadowColor = '#ffd76a'; ctx.shadowBlur = 16; }
    ctx.beginPath();
    ctx.arc(b.pos.x, b.pos.y, R, -Math.PI / 2, -Math.PI / 2 + cf * Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  ctx.restore();
}

const renderer = new Renderer(canvas, ctx);
placeBall();
requestAnimationFrame(frame);

window.world     = world;
window.CFG       = CFG;
window.HEROES    = HEROES;
window.heroState = () => ({ hero: hero.id, cd: heroCd, state: heroState });
window.dummies   = dummies;

console.log('%c🧹 PRUEBA — habilidades por personaje', 'font-size:16px;color:#3fc0ff');
console.log('1-4 / Tab: personaje · E: habilidad · LMB: golpe · SPACE: dash · SHIFT: propulsión');
