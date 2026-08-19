// PRUEBA — mecánica dash: http://localhost:PORT/dash
// Mouse mueve · LMB: giro 360° de escoba (golpe) · SPACE: dash · SHIFT: propulsión · RMB: flotar
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

// ── Tuning ─────────────────────────────────────────────────────────────────
const DASH = {
  power:      1600,
  duration:   0.07,
  maxCharges: 2,
  recharge:   4.0,
};

const SPIN = {
  dur:       0.40,   // duración del giro completo
  cooldown:  0.30,
  range:     300,    // rango de enganche a la pelota
  homingAcc: 2800,   // aceleración hacia la pelota mientras gira
  lunge:     750,    // envión inicial para alcanzarla
  lungeTime: 0.16,
  reachPad:  70,
  catchR:    28,     // margen extra de contacto durante el giro
  aimAssist: 0.82,
  holdAim:   0.13,   // ventana post-contacto donde se mantiene la dirección

  // Carga: mantener LMB acumula potencia, soltar dispara.
  chargeTime: 0.7,   // segundos hasta la carga máxima
  minPower:   900,   // velocidad de salida con un toque (sin cargar)
  maxPower:   3200,  // velocidad de salida a carga completa (cañonazo)
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

const input    = new Input(canvas);
const player   = new Player(-400, CENTER_Y, 0, 'p1');
const ball     = new Ball(200, CENTER_Y - 80);
const camera   = new Camera(canvas);
const particles = new Particles();
const sound    = new Sound();
const orbs     = new OrbField();
input.firstGesture = () => sound.init();

// Estado del dash (2 cargas independientes)
const dashState = {
  charges:   DASH.maxCharges,
  rechargeT: 0,
  active:    false,
  t:         0,
};

// Estado del giro de escoba (LMB)
const spin = {
  active: false,
  t:      0,
  from:   0,       // ángulo al arrancar
  dir:    1,       // sentido (+1 / -1)
  cd:     0,
  aimed:  false,   // ¿hay pelota en rango?
  aimX:   0, aimY: 0,   // dirección hacia el cursor
  hit:    false,   // ¿ya tocó la pelota?
  holdT:  0,       // ventana post-contacto
  chargeF: 0,      // 0..1, cuánto se cargó este golpe (potencia)
};

// Carga en curso mientras se mantiene LMB
const charge = { active: false, t: 0 };

const stubMatch = {
  score: { p1: 0, p2: 0 }, timeLeft: 0, duration: 0, golden: false,
  state: 'play', countT: 0, goalScorer: null, winner: null, timeScale: 1,
};

const world = {
  playerA: player, playerB: null, ball, camera, particles, sound, input, orbs,
  match: stubMatch, practice: true, botsMode: false, paused: false,
  debug: params.has('debug'),
  hintText: 'Mouse: mover · SHIFT: propulsión · LMB: giro+golpe · SPACE: dash · RMB: flotar · R: pelota',
  titleText: 'PRUEBA — movimiento libre + dash',
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

// ── Eventos leídos antes de endFrame() ────────────────────────────────────
let _dashPending = false;

// Arranca el giro de escoba hacia la pelota (o libre si está lejos).
// chargeF (0..1) fija la potencia del golpe.
function startSpin(chargeF = 0) {
  const b = player.broom;
  spin.active  = true;
  spin.t       = 0;
  spin.from    = b.angle;
  spin.hit     = false;
  spin.holdT   = 0;
  spin.cd      = SPIN.cooldown;
  spin.chargeF = clamp(chargeF, 0, 1);

  const dx = ball.pos.x - b.pos.x, dy = ball.pos.y - b.pos.y;
  const dist = Math.hypot(dx, dy);
  spin.aimed = dist <= SPIN.range;

  if (spin.aimed) {
    // Dirección deseada del golpe: de la pelota hacia el cursor.
    const aimNow = camera.screenToWorld(input.cursor.x, input.cursor.y);
    let hx = aimNow.x - ball.pos.x, hy = aimNow.y - ball.pos.y;
    const hl = Math.hypot(hx, hy) || 1;
    spin.aimX = hx / hl;
    spin.aimY = hy / hl;

    // Elegir el SENTIDO del giro coherente con el golpe: cuando la escoba
    // gira, la punta que pasa por la pelota lleva una velocidad tangencial.
    // Ese vector tangente es hacia dónde saldría la pelota de verdad. Elegimos
    // el sentido cuyo tangente apunte más hacia el cursor — así el barrido
    // visible y la dirección del disparo coinciden.
    //   radio = de la escoba a la pelota (rx, ry)
    //   tangente CCW (dir=+1) = (-ry, rx);  CW (dir=-1) = (ry, -rx)
    const rl = dist || 1;
    const rx = dx / rl, ry = dy / rl;
    const dotCCW = (-ry) * spin.aimX + rx * spin.aimY; // proyección del tangente CCW sobre el golpe
    spin.dir = dotCCW >= 0 ? 1 : -1;

    // Envión para alcanzar la pelota
    const ux = dx / rl, uy = dy / rl;
    const need    = (dist - SPIN.reachPad) / SPIN.lungeTime;
    const closing = b.vel.x * ux + b.vel.y * uy;
    if (need > closing) {
      const add = Math.min(need - closing, SPIN.lunge);
      b.vel.x += ux * add;
      b.vel.y += uy * add;
    }
  } else {
    spin.dir = 1; // sin pelota: gira hacia adelante
  }
  sound.pop();
}

// Aplica la velocidad a la pelota al contacto
function applySpinHit() {
  const cur = Math.hypot(ball.vel.x, ball.vel.y);
  let ux = spin.aimX, uy = spin.aimY;
  if (cur > 1) {
    ux = ball.vel.x / cur + (spin.aimX - ball.vel.x / cur) * SPIN.aimAssist;
    uy = ball.vel.y / cur + (spin.aimY - ball.vel.y / cur) * SPIN.aimAssist;
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul; uy /= ul;
  }
  // Potencia según la carga: de minPower (toque) a maxPower (a fondo).
  const power = SPIN.minPower + (SPIN.maxPower - SPIN.minPower) * spin.chargeF;
  const speed = Math.min(power, CFG.ball.maxSpeed);
  ball.vel.x = ux * speed;
  ball.vel.y = uy * speed;
  spin.hit = true;
}

// ── Paso de física ─────────────────────────────────────────────────────────
function step(dt) {
  const b = player.broom;

  // ── Recarga del dash ──────────────────────────────────────────────────────
  if (dashState.charges < DASH.maxCharges) {
    dashState.rechargeT += dt;
    if (dashState.rechargeT >= DASH.recharge) {
      dashState.charges++;
      dashState.rechargeT = dashState.charges < DASH.maxCharges
        ? dashState.rechargeT - DASH.recharge : 0;
    }
  }

  // ── Dash (Space) ──────────────────────────────────────────────────────────
  // Si no hay cargas o ya está activo, descartamos el pending para que no
  // quede "guardado" esperando a que se recargue.
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

  // ── Cooldown del giro ─────────────────────────────────────────────────────
  if (spin.cd > 0) spin.cd -= dt;

  // ── Carga del giro (LMB): mantener carga, soltar dispara ──────────────────
  // Mantener LMB acumula potencia; al soltar se lanza el giro con esa carga.
  // Un toque rápido carga poco (pase suave); aguantar pega un cañonazo.
  const lmbDown = input.lmb;
  if (lmbDown && !charge.active && !spin.active && spin.cd <= 0) {
    charge.active = true;
    charge.t = 0;
  }
  if (charge.active) {
    if (lmbDown) {
      charge.t += dt;                        // sigue cargando
    } else {
      startSpin(charge.t / SPIN.chargeTime); // soltó: dispara con la carga
      charge.active = false;
    }
  }

  // ── Control de movimiento ─────────────────────────────────────────────────
  const aim      = camera.screenToWorld(input.cursor.x, input.cursor.y);
  const hovering = input.rmb;
  const boosting = input.boost; // Shift

  player.control.aim.x = aim.x;
  player.control.aim.y = aim.y;
  // Durante el giro la escoba deja de seguir al cursor (lo pisamos abajo)
  player.control.thrust        = !hovering;
  player.control.noThrustForce = true;   // fuerza manual abajo
  player.control.brake         = false;
  player.control.tuck          = false;  // sin latigazo corporal — el spin es el golpe
  player.control.boost         = false;

  // Propulsión con multiplicadores
  if (!hovering) {
    const mul = boosting ? 1.4 : 0.65;
    const d = b.dir();
    b.vel.x += d.x * CFG.broom.thrust * mul * dt;
    b.vel.y += d.y * CFG.broom.thrust * mul * dt;
  }
  // Flotar quieto
  if (hovering) {
    b.vel.x *= Math.exp(-12 * dt);
    b.vel.y *= Math.exp(-12 * dt);
  }

  player.updateEnergy(dt, false);
  input.tick(dt);

  // ── Giro de la escoba ─────────────────────────────────────────────────────
  // DESPUÉS de player.update() pisamos el ángulo: así la escoba da la vuelta
  // entera independientemente de donde esté el cursor, y el ragdoll la sigue
  // con un frame de retraso (eso es lo que da el aspecto de giro real).
  player.update(dt, false, null);

  if (spin.active && !b.stuck) {
    spin.t += dt;
    const k = clamp(spin.t / SPIN.dur, 0, 1);
    // Ease-out: arranca rápido y frena suave al final
    const eased = 1 - Math.pow(1 - k, 2.4);
    b.angle  = wrapAngle(spin.from + spin.dir * Math.PI * 2 * eased);
    // angVel real para que el contacto transfiera velocidad
    b.angVel = spin.dir * (Math.PI * 2 / SPIN.dur) * (1 - k) * 2.4;

    // Homing: mientras no tocó, la escoba se acerca a la pelota
    if (spin.aimed && !spin.hit) {
      const dx = ball.pos.x - b.pos.x, dy = ball.pos.y - b.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > SPIN.reachPad * 0.5) {
        b.vel.x += (dx / d) * SPIN.homingAcc * dt;
        b.vel.y += (dy / d) * SPIN.homingAcc * dt;
      }
    }

    // Chispas en la punta durante el giro
    const tip = b.tip();
    particles.magicTrail(tip.x, tip.y, -b.dir().x, -b.dir().y, 0.9, 0.5, CFG.colors.p1);

    if (k >= 1) {
      spin.active = false;
      b.angVel = 0;
    }
  }

  // ── Detección de contacto escoba→pelota durante el giro ──────────────────
  if (spin.active && spin.aimed) {
    const tip = b.tip(), tail = b.tail();
    const c = closestOnSegment(ball.pos.x, ball.pos.y, tail.x, tail.y, tip.x, tip.y);
    const d = Math.hypot(ball.pos.x - c.x, ball.pos.y - c.y);
    if (d < ball.r + SPIN.catchR) {
      const first = !spin.hit;
      applySpinHit();
      spin.holdT = SPIN.holdAim;
      if (first) {
        particles.impact(c.x, c.y, 480);
        sound.impact(700);
      }
    }
  }
  // Ventana post-contacto: se reimpone la dirección si la pelota rebota de vuelta
  if (!spin.active && spin.holdT > 0) {
    spin.holdT -= dt;
    const sp = Math.hypot(ball.vel.x, ball.vel.y);
    if (sp > 1) { ball.vel.x = spin.aimX * sp; ball.vel.y = spin.aimY * sp; }
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
    particles.orbAbsorb(orb.fx, oy, pl.broom.pos, CFG.colors.p1);
    sound.orb();
  }, dt);

  ball.update(dt);
  // Solo colisión normal fuera del giro (durante el giro lo manejamos arriba)
  if (!spin.active) interactPlayerBall(player, ball, dt, fx);
  collideBallArena(ball, (x, y, s) => { if (s > 180) fx.onImpact(x, y, s, 'wall'); });

  // Estela de la escoba
  const tail = b.tail(), dir = b.dir();
  const speedF = Math.min(Math.hypot(b.vel.x, b.vel.y) / 900, 1.4);
  particles.magicTrail(tail.x, tail.y, dir.x, dir.y,
    Math.max(b.thrustPower, speedF * 0.55),
    dashState.active ? 1 : 0,
    CFG.colors.p1);
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

  // Space es puntual (dash). LMB se lee como estado continuo en step() (carga).
  // Solo registramos el dash si el juego ya está corriendo (no pausado).
  // Si el juego está pausado en este frame, descartamos el Space para que no
  // quede "guardado" y se gaste al reanudar.
  if (input.pressed('Space') && !world.paused) _dashPending = true;
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
  drawHUD();
}

// ── HUD ───────────────────────────────────────────────────────────────────
// Dibuja el rayo ⚡ con path manual (más control que texto).
// cx,cy = centro; sz = tamaño; lit = cargado; frac = progreso recarga (0..1)
function drawBolt(cx, cy, sz, lit, frac) {
  // Puntos del zigzag del rayo (normalizados -0.5..0.5, escalados por sz)
  const pts = [
    [ 0.18, -0.50],
    [-0.04, -0.02],
    [ 0.22, -0.02],
    [-0.18,  0.50],
    [ 0.04,  0.02],
    [-0.22,  0.02],
  ];
  ctx.save();
  ctx.translate(cx, cy);

  // Recorte: el rayo se "llena" de abajo hacia arriba según frac
  if (!lit && frac > 0) {
    ctx.save();
    ctx.beginPath();
    const top    = -sz * 0.5;
    const bottom =  sz * 0.5;
    const fillY  = bottom - (bottom - top) * frac;
    ctx.rect(-sz, fillY, sz * 2, bottom - fillY);
    ctx.clip();
  }

  // Sombra/glow
  if (lit) {
    ctx.shadowColor = '#ffe040';
    ctx.shadowBlur  = sz * 0.7;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0][0] * sz, pts[0][1] * sz);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * sz, pts[i][1] * sz);
  ctx.closePath();

  if (lit) {
    // Relleno degradado amarillo-verde
    const g = ctx.createLinearGradient(0, -sz * 0.5, 0, sz * 0.5);
    g.addColorStop(0, '#fff066');
    g.addColorStop(1, '#80e000');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth   = sz * 0.07;
    ctx.stroke();
  } else {
    ctx.fillStyle   = frac > 0 ? 'rgba(120,200,60,0.45)' : 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth   = sz * 0.06;
    ctx.stroke();
  }

  if (!lit && frac > 0) ctx.restore(); // quita el clip de relleno
  ctx.restore();
}

function drawHUD() {
  if (world.paused) return;
  const b   = player.broom;
  const now = performance.now();

  // ── Barra de energía (Shift/boost) + rayos dash ───────────────────────────
  // Layout: [⚡] [════════════════] [⚡]
  //          bolt     barra          bolt
  {
    const BOLT_SZ = 34;           // tamaño de cada rayo (más gruesos)
    const BOLT_PAD = 6;           // espacio entre rayo y barra
    const BAR_W = 180, BAR_H = 24;
    const RADIUS = BAR_H / 2;
    // Posición: centrado horizontalmente desde margen izquierdo
    const TOTAL_W = BOLT_SZ + BOLT_PAD + BAR_W + BOLT_PAD + BOLT_SZ;
    const LEFT    = 20;
    const BAR_Y   = 18;
    const BAR_X   = LEFT + BOLT_SZ + BOLT_PAD;
    const boltY   = BAR_Y + BAR_H / 2;

    const energy = clamp(player.energy / CFG.boost.max, 0, 1);
    const boosting = input.boost && energy > 0;

    ctx.save();

    // ── Barra de energía ──────────────────────────────────────────────────
    // Fondo
    ctx.beginPath(); ctx.roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, RADIUS);
    ctx.fillStyle = 'rgba(0,0,20,0.65)'; ctx.fill();

    // Borde azul neón
    ctx.beginPath(); ctx.roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, RADIUS);
    ctx.strokeStyle = '#00bfff';
    ctx.lineWidth   = 2.2;
    ctx.shadowColor = '#00bfff';
    ctx.shadowBlur  = boosting ? 18 : 10;
    ctx.stroke();
    ctx.shadowBlur  = 0;

    // Relleno verde neón
    if (energy > 0) {
      ctx.save();
      ctx.beginPath(); ctx.roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, RADIUS); ctx.clip();

      const fillW = BAR_W * energy;
      // Pulso cuando está boosteando o casi llena
      const pulse = boosting ? 0.80 + 0.20 * Math.sin(now / 80)
                  : energy > 0.95 ? 0.88 + 0.12 * Math.sin(now / 150) : 1;

      const g = ctx.createLinearGradient(BAR_X, BAR_Y, BAR_X, BAR_Y + BAR_H);
      g.addColorStop(0,    `rgba(170,255,70,${pulse})`);
      g.addColorStop(0.45, `rgba(80,220,10,${pulse})`);
      g.addColorStop(1,    `rgba(35,150,0,${pulse})`);
      ctx.fillStyle = g;
      ctx.fillRect(BAR_X, BAR_Y, fillW, BAR_H);

      // Brillo especular
      const shine = ctx.createLinearGradient(BAR_X, BAR_Y, BAR_X, BAR_Y + BAR_H * 0.5);
      shine.addColorStop(0, 'rgba(255,255,255,0.30)');
      shine.addColorStop(1, 'rgba(255,255,255,0.00)');
      ctx.fillStyle = shine;
      ctx.fillRect(BAR_X, BAR_Y, fillW, BAR_H);

      // Glow en el frente del relleno
      if (energy < 0.99) {
        ctx.shadowColor = '#60ff10';
        ctx.shadowBlur  = 14;
        ctx.fillStyle   = 'rgba(130,255,50,0.65)';
        ctx.fillRect(BAR_X + fillW - 2, BAR_Y, 3, BAR_H);
        ctx.shadowBlur  = 0;
      }
      ctx.restore();
    }

    // ── Dos rayos ⚡ a los lados de la barra ─────────────────────────────
    for (let i = 0; i < DASH.maxCharges; i++) {
      // i=0 → izquierda, i=1 → derecha
      const bx  = i === 0
        ? LEFT + BOLT_SZ / 2                          // centro del rayo izq
        : LEFT + BOLT_SZ + BOLT_PAD + BAR_W + BOLT_PAD + BOLT_SZ / 2; // der
      const lit = i < dashState.charges;
      let frac  = 0;
      if (!lit && i === dashState.charges) frac = dashState.rechargeT / DASH.recharge;
      drawBolt(bx, boltY, BOLT_SZ, lit, frac);
    }

    // Countdown si algún dash está recargando
    if (dashState.charges < DASH.maxCharges) {
      const remaining = DASH.recharge - dashState.rechargeT;
      ctx.font      = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(remaining.toFixed(1) + 's', BAR_X + BAR_W / 2, BAR_Y + BAR_H + 15);
    }

    ctx.restore();
  }

  // ── Resto del HUD en coordenadas de mundo ─────────────────────────────────
  ctx.save();
  camera.applyTransform(ctx);

  // Indicador de rango del giro (círculo punteado)
  const inRange = Math.hypot(ball.pos.x - b.pos.x, ball.pos.y - b.pos.y) <= SPIN.range;
  ctx.setLineDash([7, 10]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = inRange ? 'rgba(255,215,80,0.45)' : 'rgba(255,255,255,0.10)';
  ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, SPIN.range, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  // Anillo de carga del golpe: crece de "pase suave" a "cañonazo" mientras
  // mantenés LMB. Blanco al llenarse.
  if (charge.active) {
    const cf = clamp(charge.t / SPIN.chargeTime, 0, 1);
    const full = cf >= 0.999;
    const R = 46;
    // Pista de fondo
    ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 3; ctx.stroke();
    // Arco cargado
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
window.DASH      = DASH;
window.SPIN      = SPIN;
window.dashState = dashState;
window.spin      = spin;

console.log('%c🧹 PRUEBA — movimiento libre + dash + giro', 'font-size:16px;color:#3fc0ff');
console.log('Mouse: mover · SHIFT: propulsión · LMB: giro+golpe · SPACE: dash · RMB: flotar · R: pelota');
