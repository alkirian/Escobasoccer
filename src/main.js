// Escoba Voladora — MVP
// Deporte 2.5D: magos agarrados a escobas físicas pelean por meter
// una pelota en el portal rival. Control = mouse (apuntar) + LMB (gas)
// + RMB (freno) + Space (recogerse).
import { CFG, FIXED_DT } from './config.js';
import { clamp } from './utils.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Ball } from './ball.js';
import { Bot } from './bot.js';
import { Camera } from './camera.js';
import { Particles } from './particles.js';
import { Sound } from './sound.js';
import { Match } from './match.js';
import { Renderer } from './render.js';
import { OrbField } from './orbs.js';
import { collideBallArena, collideBroomArena, applyPortalSuction } from './arena.js';
import { interactPlayerBall, interactPlayers, clampRiderArena } from './collisions.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Flags de URL
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const BOTS = params.has('bots');   // IA vs IA (para observar/testear)
const FAST = params.has('fast');   // partido de 30s

// --- Canvas con devicePixelRatio ---
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);
resize();

// --- Mundo ---
const input = new Input(canvas);
// Posiciones de salida sobre el campo pintado: a media altura del patio,
// cada uno delante de su propio arco.
const SPAWN_Y = (CFG.arena.T + CFG.arena.B) / 2;
const playerA = new Player(CFG.arena.L * 0.56, SPAWN_Y, 0, 'p1');        // izquierda, mira al centro
const playerB = new Player(CFG.arena.R * 0.56, SPAWN_Y, Math.PI, 'p2');  // derecha, mira al centro
const ball = new Ball(0, SPAWN_Y - 120);
const camera = new Camera(canvas);
const particles = new Particles();
const sound = new Sound();
input.firstGesture = () => sound.init();

const orbs = new OrbField();

const world = {
  playerA, playerB, ball, camera, particles, sound, input, orbs,
  debug: DEBUG, botsMode: BOTS, paused: false,
  match: null,
};
const match = new Match(world, { duration: FAST ? 30 : CFG.match.duration });
world.match = match;

const botB = new Bot(playerB, +1);                        // defiende derecha
const botA = BOTS ? new Bot(playerA, -1) : null;          // en modo bots, también

// FX hooks para colisiones
const fx = {
  onImpact(x, y, strength, kind) {
    if (strength > 130) {
      particles.impact(x, y, strength);
      sound.impact(strength);
      if (strength > 500) camera.shake(Math.min(strength / 90, 14));
    }
  },
};

let debugOn = DEBUG;

// --- Paso de física (120 Hz) ---
function step(dt) {
  const frozen = match.playersFrozen();

  // Control del jugador humano (o bot A en modo bots)
  if (botA) {
    botA.update(dt, world);
  } else {
    const aim = camera.screenToWorld(input.cursor.x, input.cursor.y);
    playerA.control.aim.x = aim.x;
    playerA.control.aim.y = aim.y;
    playerA.control.thrust = input.lmb && !frozen;
    playerA.control.brake = input.rmb && !frozen;
    playerA.control.tuck = input.tuck;
    playerA.updateEnergy(dt, input.boost && !frozen);
    input.tick(dt);
  }
  botB.update(dt, world);
  if (frozen) {
    for (const p of [playerA, playerB]) {
      p.control.thrust = false;
      p.control.brake = false;
    }
  }

  // Física de jugadores. El "target" es lo que convierte el latigazo en un
  // golpe dirigido: dónde está la pelota y hacia dónde quiere mandarla.
  const targetA = { ball: ball.pos, aim: playerA.control.aim };
  const targetB = { ball: ball.pos, aim: playerB.control.aim };
  playerA.update(dt, frozen, targetA);
  playerB.update(dt, frozen, targetB);
  for (const pl of [playerA, playerB]) {
    collideBroomArena(
      pl.broom,
      (x, y, s) => fx.onImpact(x, y, s, 'wall'),
      (x, y, nx, ny, s) => {
        sound.thunk();
        camera.shake(9);
        particles.impact(x, y, s * 0.6);
        pl.stuckAt = { x, y, nx, ny };
      },
    );
    // Mientras forcejea: chispas en el punto de impacto y, al soltarse, pop
    const b = pl.broom;
    if (b.stuck && pl.stuckAt) {
      particles.scrape(pl.stuckAt.x, pl.stuckAt.y, pl.stuckAt.nx, pl.stuckAt.ny, b.strain);
    } else if (pl.stuckAt && !b.stuck) {
      particles.impact(pl.stuckAt.x, pl.stuckAt.y, 320);
      sound.pop();
      pl.stuckAt = null;
    }
  }
  clampRiderArena(playerA);
  clampRiderArena(playerB);

  // Jugador vs jugador (embestidas, empujones, enganches)
  interactPlayers(playerA, playerB, dt, fx);

  // Pelota
  if (!ball.frozen) {
    applyPortalSuction(ball, dt);
    ball.update(dt);
    interactPlayerBall(playerA, ball, dt, fx);
    interactPlayerBall(playerB, ball, dt, fx);
    const goal = collideBallArena(ball, (x, y, s) => { if (s > 180) fx.onImpact(x, y, s, 'wall'); });
    if (goal && match.state === 'play') match.onGoal(goal);
  }

  // Orbes: energía repartida por la arena
  orbs.update(dt);
  orbs.collect([playerA, playerB], (orb, pl, oy) => {
    pl.addEnergy(CFG.orbs.energy);
    const color = pl.team === 'p1' ? CFG.colors.p1 : CFG.colors.p2;
    particles.orbAbsorb(orb.fx, oy, pl.broom.pos, color);
    sound.orb();
  });

  // Bots: usan el boost cuando persiguen de lejos
  if (!botA) playerB.updateEnergy(dt, botB.wantsBoost);
  else {
    playerA.updateEnergy(dt, botA.wantsBoost);
    playerB.updateEnergy(dt, botB.wantsBoost);
  }

  // FX continuos: la estela escala con velocidad y boost — de chispitas a
  // estela energética — para que la velocidad se lea sin tapar el partido.
  for (const pl of [playerA, playerB]) {
    const b = pl.broom;
    const tail = b.tail(), d = b.dir();
    const color = pl.team === 'p1' ? CFG.colors.p1 : CFG.colors.p2;
    const speedF = Math.min(Math.hypot(b.vel.x, b.vel.y) / 900, 1.4);
    particles.magicTrail(tail.x, tail.y, d.x, d.y,
      Math.max(b.thrustPower, speedF * 0.55), b.boostPower, color);
    if (b.brakePower > 0.3) particles.brake(b.pos.x, b.pos.y, b.vel.x, b.vel.y);
  }
  particles.update(dt);
}

// --- Loop principal ---
let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dtReal = Math.min((now - last) / 1000, 0.1);
  last = now;

  // Teclas globales
  if (input.pressed('KeyP') || input.pressed('Escape')) world.paused = !world.paused;
  if (input.pressed('F3')) { debugOn = !debugOn; world.debug = debugOn; }
  if (input.pressed('KeyR')) match.reset(true);
  if (match.state === 'end' && (input.pressed('lmb') || input.pressed('Enter'))) {
    match.reset(true);
  }
  input.endFrame();

  if (!world.paused) {
    match.update(dtReal, world);

    // Física con slowmo del gol
    acc += dtReal * match.timeScale;
    const maxSteps = 6;
    let steps = 0;
    while (acc >= FIXED_DT && steps < maxSteps) {
      step(FIXED_DT);
      acc -= FIXED_DT;
      steps++;
    }
    if (steps === maxSteps) acc = 0; // evitar espiral de la muerte

    // Cámara: fija en gameplay, con un acento sutil a mucha velocidad
    const spA = Math.hypot(playerA.broom.vel.x, playerA.broom.vel.y);
    camera.setSpeedPunch(clamp((spA - 900) / 700, 0, 1));
    camera.update(dtReal);

    // Sonido continuo
    sound.setThrust(playerA.broom.thrustPower);
    sound.setBoost(playerA.broom.boostPower);
    sound.setWind(spA);
  }

  renderer.draw(world, dtReal);
}

const renderer = new Renderer(canvas, ctx);
requestAnimationFrame(frame);

// Hooks de debugging/testing por consola
window.world = world;
window.renderer = renderer;
window.CFG = CFG;
window.__sim = (seconds = 10) => {
  // Simula el partido sin render (validación de físicas y bots)
  const steps = Math.floor(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    match.update(FIXED_DT / match.timeScale, world);
    step(FIXED_DT);
  }
  return {
    score: { ...match.score },
    state: match.state,
    timeLeft: match.timeLeft.toFixed(1),
    ballPos: { x: ball.pos.x | 0, y: ball.pos.y | 0 },
    pA: { x: playerA.broom.pos.x | 0, y: playerA.broom.pos.y | 0 },
    pB: { x: playerB.broom.pos.x | 0, y: playerB.broom.pos.y | 0 },
  };
};

console.log('%c🧹 Escoba Voladora', 'font-size:16px;color:#3fc0ff');
console.log('Mouse: apuntar · LMB: acelerar · RMB: frenar · Space: recogerse');
console.log('P: pausa · R: reiniciar · F3: debug físicas');
