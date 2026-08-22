// Escena de práctica — http://localhost:5680/test
// Sin rivales, sin arcos, sin reloj: solo el jugador y una pelota, para
// sentir el vuelo y afinar el golpe dirigido. Los muros del patio siguen
// activos (la pelota nunca se escapa) pero los portales son pared.
import { CFG, FIXED_DT } from './config.js';
import { Input } from './input.js';
import { TouchControls } from './touch.js';
import { Player } from './player.js';
import { Ball } from './ball.js';
import { Camera } from './camera.js';
import { Particles } from './particles.js';
import { Sound } from './sound.js';
import { Renderer } from './render.js';
import { collideBroomArena } from './arena.js';
import { interactPlayerBall, clampRiderArena } from './collisions.js';
import { OrbField, RunnerOrb } from './orbs.js';

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
addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

const CENTER_Y = (CFG.arena.T + CFG.arena.B) / 2;

const input = new Input(canvas);
const touch = new TouchControls(canvas);
const player = new Player(-300, CENTER_Y, 0, 'p1');
const ball = new Ball(120, CENTER_Y);
const camera = new Camera(canvas);
const particles = new Particles();
const sound = new Sound();
input.firstGesture = () => sound.init();
touch.onFirstTouch = () => sound.init();

// Match de utilería: el renderer espera uno, pero en práctica no se usa.
const stubMatch = {
  score: { p1: 0, p2: 0 }, timeLeft: 0, duration: 0, golden: false,
  state: 'play', countT: 0, goalScorer: null, winner: null, timeScale: 1,
};

const orbs = new OrbField();
// En práctica aparece enseguida y no se va nunca: la idea es poder probar la
// persecución cuantas veces haga falta sin esperar el ciclo del partido.
const runner = new RunnerOrb();
runner.timer = 1.5;

const world = {
  playerA: player, playerB: null, ball, camera, particles, sound, input, touch, orbs, runner,
  match: stubMatch, practice: true, botsMode: false, paused: false,
  debug: params.has('debug'),
  stats: { lastHit: 0, lastHitAt: 0, lastAimed: false },
};

const fx = {
  onImpact(x, y, strength) {
    if (strength > 130) {
      particles.impact(x, y, strength);
      sound.impact(strength);
      // sin temblor por golpe suelto (queda reservado para eventos grandes)
    }
  },
};

// La pelota rebota en todo el perímetro: en práctica los arcos son pared,
// así nunca hay que ir a buscarla.
function bounceBallInArena() {
  const { L, R, T, B } = CFG.arena;
  const b = CFG.ball.bounce, r = ball.r;
  if (ball.pos.x - r < L) { ball.pos.x = L + r; if (ball.vel.x < 0) ball.vel.x *= -b; }
  else if (ball.pos.x + r > R) { ball.pos.x = R - r; if (ball.vel.x > 0) ball.vel.x *= -b; }
  if (ball.pos.y - r < T) { ball.pos.y = T + r; if (ball.vel.y < 0) ball.vel.y *= -b; }
  else if (ball.pos.y + r > B) { ball.pos.y = B - r; if (ball.vel.y > 0) { ball.vel.y *= -b; ball.vel.x *= 0.985; } }
}

function placeBall() {
  // delante del jugador, a distancia de golpe
  const d = player.broom.dir();
  ball.reset(player.broom.pos.x + d.x * 200, player.broom.pos.y + d.y * 200 - 60);
}

let lastBallSpeed = 0;

function step(dt) {
  if (touch.active) {
    const dir = touch.aimDir();
    if (dir) {
      player.control.aim.x = player.broom.pos.x + dir.x * 1000;
      player.control.aim.y = player.broom.pos.y + dir.y * 1000;
    }
    player.control.thrust = touch.thrust;
    player.control.brake = false;
    player.control.tuck = touch.hit;
    touch.tick(dt);
  } else {
    const aim = camera.screenToWorld(input.cursor.x, input.cursor.y);
    player.control.aim.x = aim.x;
    player.control.aim.y = aim.y;
    player.control.thrust = input.lmb;
    player.control.brake = input.rmb;
    player.control.tuck = input.tuck;
    input.tick(dt);
  }

  const wasAimed = player.rider.aimed && player.rider.phase === 'whip';
  player.updateEnergy(dt, touch.active ? false : input.boost);
  player.update(dt, false, {
    ball: ball.pos,
    aim: player.control.aim,
    energyFrac: player.energy / CFG.boost.max,
    spendEnergy: (c) => { player.energy = Math.max(0, player.energy - c); },
  });
  collideBroomArena(
    player.broom,
    (x, y, s) => fx.onImpact(x, y, s, 'wall'),
    (x, y, nx, ny, s) => {
      sound.thunk(); particles.impact(x, y, s * 0.6);
      player.stuckAt = { x, y, nx, ny };
    },
  );
  const bm = player.broom;
  if (bm.stuck && player.stuckAt) {
    particles.scrape(player.stuckAt.x, player.stuckAt.y, player.stuckAt.nx, player.stuckAt.ny, bm.strain);
  } else if (player.stuckAt && !bm.stuck) {
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
  }, dt);

  runner.update(dt, [player], true, {
    onAppear: (x, y) => { particles.runnerBurst(x, y); sound.runnerAppear(); },
    onEscape: (x, y) => { particles.runnerBurst(x, y); },
  });
  const caught = runner.collect([player]);
  if (caught) {
    caught.grantUnlimited(CFG.runner.buff);
    particles.runnerCatch(runner.x, runner.y, caught.broom.pos);
    sound.runnerCatch();
  }
  if (player.unlimited) particles.unlimitedAura(player.broom.pos.x, player.broom.pos.y);

  ball.update(dt);
  if (ball.fire > 0) particles.fireTrail(ball.pos.x, ball.pos.y, ball.vel.x, ball.vel.y, ball.fire);
  interactPlayerBall(player, ball, dt, fx);
  bounceBallInArena();

  // Registrar el pico de velocidad del golpe, para leerlo en el HUD
  const sp = Math.hypot(ball.vel.x, ball.vel.y);
  if (sp > lastBallSpeed + 60) {
    world.stats.lastHit = sp;
    world.stats.lastHitAt = performance.now();
    world.stats.lastAimed = wasAimed;
  }
  lastBallSpeed = sp;

  const tail = player.broom.tail(), d = player.broom.dir();
  particles.thrust(tail.x, tail.y, d.x, d.y, player.broom.thrustPower);
  if (player.broom.brakePower > 0.3) {
    particles.brake(player.broom.pos.x, player.broom.pos.y, player.broom.vel.x, player.broom.vel.y);
  }
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
  input.endFrame();

  if (!world.paused) {
    acc += dtReal;
    let steps = 0;
    while (acc >= FIXED_DT && steps < 6) { step(FIXED_DT); acc -= FIXED_DT; steps++; }
    if (steps === 6) acc = 0;

    camera.update(dtReal, player.broom.pos, ball.pos);
    sound.setThrust(player.broom.thrustPower);
    sound.setWind(Math.hypot(player.broom.vel.x, player.broom.vel.y));
  }

  renderer.draw(world, dtReal);
}

const renderer = new Renderer(canvas, ctx);
placeBall();
requestAnimationFrame(frame);

window.world = world;
window.renderer = renderer;
window.CFG = CFG;
window.__sim = (seconds = 1) => {
  const n = Math.floor(seconds / FIXED_DT);
  for (let i = 0; i < n; i++) step(FIXED_DT);
  return {
    ball: { x: ball.pos.x | 0, y: ball.pos.y | 0, v: Math.hypot(ball.vel.x, ball.vel.y) | 0 },
    player: { x: player.broom.pos.x | 0, y: player.broom.pos.y | 0 },
    phase: player.rider.phase,
  };
};

console.log('%c🧹 Broomball Blitz — PRÁCTICA', 'font-size:16px;color:#ffd76a');
console.log('Mouse: apuntar · LMB: acelerar · RMB: frenar · ESPACIO: cargar y soltar para golpear');
console.log('R: reubicar pelota · P: pausa · F3: debug');
