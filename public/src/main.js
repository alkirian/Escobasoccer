// Escoba Voladora — MVP
// Deporte 2.5D: magos agarrados a escobas físicas pelean por meter
// una pelota en el portal rival.
// Controles: Mouse=apuntar/mover · LMB=giro+golpe · Space=dash · Shift=boost · RMB=flotar
import { CFG, FIXED_DT } from './config.js';
import { clamp, wrapAngle, closestOnSegment } from './utils.js';
import { Input } from './input.js';
import { TouchControls } from './touch.js';
import { Player } from './player.js';
import { Ball } from './ball.js';
import { Bot } from './bot.js';
import { Camera } from './camera.js';
import { Particles } from './particles.js';
import { Sound } from './sound.js';
import { Match } from './match.js';
import { Renderer } from './render.js';
import { OrbField, RunnerOrb } from './orbs.js';
import { ReplayRecorder, ReplayPlayer } from './replay.js';
import { Coach } from './coach.js';
import { Hud } from './hud.js';
import { recordMatch, recordRunnerCatch, isFirstEver, loadStats } from './stats.js';
import { completeChallenge, selectedPalettes } from './challenges.js';
import { isUnlocked, matchReward } from './roster.js';
import { rondaActual, torneoWin, torneoLose, RONDAS } from './torneo.js';
import { collideBallArena, collideBroomArena, applyPortalSuction } from './arena.js';
import { interactPlayerBall, interactPlayers, clampRiderArena } from './collisions.js';
import { emitTrail } from './characters.js';

// ── Tuning dash + giro ────────────────────────────────────────────────────
// El dash ahora vive en CFG.dash (config.js): así los bots lo comparten en
// vez de tener su propia copia de los números.
const DASH = CFG.dash;

const SPIN = {
  dur:       0.40,
  cooldown:  0.30,
  range:     300,
  homingAcc: 2800,
  lunge:     750,
  lungeTime: 0.16,
  reachPad:  70,
  catchR:    28,
  aimAssist: 0.82,
  holdAim:   0.13,
  chargeTime: 0.7,
  minPower:   900,
  maxPower:   3200,
};

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Flags de URL
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const BOTS = params.has('bots');   // IA vs IA (para observar/testear)
const FAST = params.has('fast');   // partido de 30s
// Práctica: cancha libre, sin reloj ni marcador. Llega desde el menú.
const PRACTICE = params.get('mode') === 'practica';

// ── Opciones que llegan del menú ──────────────────────────────────────────
// Antes el menú las guardaba y las mandaba por URL, pero acá nadie las leía:
// cambiar la duración o silenciar el sonido no hacía nada.
const MUTE  = params.has('mute');
const NOORBS = params.has('noorbs');
// ── Primer partido de la vida: corto y en fácil ───────────────────────────
// En la web la primera sesión dura 3-5 minutos: si el primer partido son
// 120 s contra un bot normal y termina 0-2, ese jugador no vuelve. La
// primera experiencia tiene que ser GANAR — después elige lo que quiera.
// Pisa incluso lo que venga del menú: un jugador nuevo todavía no formó
// preferencias, solo apretó "Jugar" con los valores por defecto.
// ── Torneo (Camino al Campeonato) ─────────────────────────────────────────
// La ronda vigente vive en localStorage (torneo.js); la URL solo dice "es
// torneo". Así la página del partido y la de preparación nunca discrepan.
const TORNEO = params.get('mode') === 'torneo';
const T_RONDA = TORNEO ? rondaActual() : null;

// ── Partido por goles ─────────────────────────────────────────────────────
// `?goals=N`: gana el primero que llega a N (sin reloj, sin gol de oro).
const GOALS = TORNEO
  ? (T_RONDA.cfg.goles || 0)
  : Math.max(0, Math.min(50, Number(params.get('goals')) || 0));

const FIRST_EVER = !FAST && !BOTS && !PRACTICE && !TORNEO && !GOALS && isFirstEver();

// Duración: se acepta solo lo que manda el menú (60/120/180). `fast` sigue
// pisando todo para las pruebas rápidas. En torneo manda la ronda; por goles
// el reloj no corre (se pasa igual por prolijidad del HUD).
const DURATION = FAST ? 30
  : TORNEO ? (T_RONDA.cfg.duracion || CFG.match.duration)
  : FIRST_EVER ? 90
  : (Number(params.get('duration')) || CFG.match.duration);
// Dificultad de los bots: 'facil' | 'normal' | 'dificil'
const DIFFICULTY = TORNEO ? T_RONDA.cfg.dificultad
  : FIRST_EVER ? 'facil'
  : (params.get('difficulty') || 'normal');

// --- Canvas con devicePixelRatio ---
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

// --- Mundo ---
const input = new Input(canvas);
const touch = new TouchControls(canvas);
// Posiciones de salida sobre el campo pintado: a media altura del patio,
// cada uno delante de su propio arco.
const SPAWN_Y = (CFG.arena.T + CFG.arena.B) / 2;
const HALF_H = (CFG.arena.B - CFG.arena.T) / 2;

// Modo: 1v1 por defecto, 2v2 con ?2v2. En 2v2 los compañeros salen
// escalonados en altura para que no arranquen encimados.
const TEAM_SIZE = (params.has('2v2') || params.get('mode') === '2v2') ? 2 : 1;

function makeTeam(team, side) {
  const x = (side < 0 ? CFG.arena.L : CFG.arena.R) * 0.56;
  const angle = side < 0 ? 0 : Math.PI;
  const out = [];
  for (let i = 0; i < TEAM_SIZE; i++) {
    // 1 jugador: al medio. 2 jugadores: uno arriba y otro abajo.
    const off = TEAM_SIZE === 1 ? 0 : (i === 0 ? -0.26 : 0.26) * HALF_H;
    const pl = new Player(x, SPAWN_Y + off, angle, team);
    pl.side = side;              // qué portal defiende
    pl.index = i;
    out.push(pl);
  }
  return out;
}

// LADO DE SALIDA AL AZAR: cada partido podés arrancar defendiendo el portal
// izquierdo o el derecho. Sin esto la cancha se juega siempre en el mismo
// sentido y el partido se vuelve mecánico. `?side=` lo fuerza (útil para
// pruebas reproducibles).
const SIDE_PARAM = params.get('side');
const MY_SIDE = SIDE_PARAM === 'izq' ? -1
  : SIDE_PARAM === 'der' ? +1
  : (Math.random() < 0.5 ? -1 : +1);

const teamA = makeTeam('p1', MY_SIDE);
// En práctica no hay rivales: la cancha queda libre para probar sin que nadie
// te dispute la pelota. El equipo rival simplemente no se crea.
const teamB = PRACTICE ? [] : makeTeam('p2', -MY_SIDE);
const players = [...teamA, ...teamB];
const playerA = teamA[0];           // el humano
const playerB = teamB[0] ?? null;   // rival principal (null en práctica)

// ── Personaje elegido ──────────────────────────────────────────────────────
// El humano trae su héroe de la galería (/personajes.html), de ?char= o del
// guardado. Los rivales varían al azar para que el partido no sea un espejo
// (?charbot= los fuerza, útil para probar).
const CHAR_KEY = 'escoba.character.v1';
const CHAR_POOL = ['mago', 'valka', 'mordrak', 'izar', 'zefir',
                   'petra', 'hilaria', 'vendaval', 'silvano', 'fogon'];
{
  let pick = params.get('char');
  if (!pick) { try { pick = localStorage.getItem(CHAR_KEY); } catch { /* sin storage */ } }
  // El humano solo puede jugar personajes DESBLOQUEADOS: ni la URL ni un
  // guardado viejo saltean el candado. Los bots sí usan el plantel entero —
  // ver rivales que no tenés es la mejor publicidad del desbloqueo.
  playerA.characterId = (CHAR_POOL.includes(pick) && isUnlocked(pick)) ? pick : 'mago';
  // Paleta alternativa elegida en la galería (recompensa de desafíos)
  playerA.paletteId = selectedPalettes()[playerA.characterId] ?? null;
  // En torneo el rival lo dicta la ronda, no el azar.
  const forced = TORNEO ? T_RONDA.cfg.rival : params.get('charbot');
  // Los bots nunca copian al humano: un partido espejo confunde, sobre todo
  // con Mordrak, cuyos dos bandos son casi iguales salvo por el brillo.
  const botPool = CHAR_POOL.filter((c) => c !== playerA.characterId);
  for (const pl of players) {
    if (pl === playerA) continue;
    pl.characterId = CHAR_POOL.includes(forced)
      ? forced
      : botPool[(Math.random() * botPool.length) | 0];
  }
}
const ball = new Ball(0, SPAWN_Y - 120);
const camera = new Camera(canvas);
const particles = new Particles();
const sound = new Sound();
sound.muted = MUTE;              // opción "Sonido" del menú
input.firstGesture = () => sound.init();
touch.onFirstTouch = () => sound.init();

// Con los orbes desactivados no se crean los campos: no aparecen, no se
// recogen y no hay energía de boost que juntar.
const orbs = NOORBS ? null : new OrbField();
const runner = NOORBS ? null : new RunnerOrb();

// Estado del dash del jugador humano (2 cargas independientes).
// PASIVA de Zefir — "Tercer impulso": si el humano juega con Zefir, lleva 3.
// El HUD lee maxCharges de acá, así que el tercer rayo aparece solo.
const HUMAN_DASH_MAX = playerA.characterId === 'zefir'
  ? DASH.maxCharges + 1 : DASH.maxCharges;
const dashState = {
  charges:   HUMAN_DASH_MAX,
  rechargeT: 0,
  active:    false,
  t:         0,
  // El tuning viaja con el estado para que el HUD lo lea de acá en vez de
  // repetir los números a mano. Antes render.js tenía su propia copia
  // (DASH_RECHARGE = 4.0, DASH_MAX = 2) y cambiar el tuning dejaba el HUD
  // mostrando un contador de recarga falso, sin ningún error que lo delatara.
  maxCharges: HUMAN_DASH_MAX,
  recharge:   DASH.recharge,
};

// Estado del giro de escoba (LMB)
const spin = {
  active: false,
  t:      0,
  from:   0,
  dir:    1,
  cd:     0,
  aimed:  false,
  aimX:   0, aimY: 0,
  hit:    false,
  holdT:  0,
  chargeF: 0,
};

// Carga en curso mientras se mantiene LMB
const charge = { active: false, t: 0 };

// Flag puntual para dash (se setea antes de endFrame())
let _dashPending = false;

// Temporizador anti-esquina de la pelota (ver el empujón en step())
let _cornerT = 0;

// ── Hit-stop ───────────────────────────────────────────────────────────────
// Congelar el mundo 45-70 ms en el instante de un cañonazo hace que el golpe
// se SIENTA (la técnica de game feel más vieja y rentable que existe). Se
// detecta por el salto de velocidad de la pelota: cualquier golpe que la
// dispare fuerte lo gatilla, venga del giro, del latigazo o de un choque.
let _hitstopT = 0;
let _prevBallSpd = 0;

// ── Estela fantasma del dash ───────────────────────────────────────────────
// Siluetas desvanecidas del mago en sus posiciones de hace unos frames.
// Vende la velocidad del dash sin partículas nuevas.
const _ghosts = [];
let _ghostEmitT = 0;
let _ghostSkip = 0;
function _snapGhost() {
  const pts = {};
  const P = playerA.rider.points;
  for (const k in P) pts[k] = { x: P[k].x, y: P[k].y };
  _ghosts.push({ pts, life: 0.26, max: 0.26 });
  if (_ghosts.length > 10) _ghosts.shift();
}

// ── Repetición del gol ────────────────────────────────────────────────────
// Solo en partida de a uno: en modo espectador (?bots) no hay a quién
// mostrarle la jugada, y en práctica no hay goles que celebrar.
const REPLAY_ON = !BOTS && !PRACTICE;
const replayRec = new ReplayRecorder();
const replay = new ReplayPlayer();
replayRec.enabled = REPLAY_ON;
// Clip capturado en el instante del gol, esperando a que termine el festejo
// para reproducirse.
let _pendingClip = null;

// ── Coach ─────────────────────────────────────────────────────────────────
// Los controles se enseñan JUGANDO: lecciones contextuales que aparecen al
// lado de lo que explican, en el momento en que ese control sirve (ver
// coach.js). La pantalla estática de controles ya no se abre sola — quedó
// como referencia en el menú de pausa. No hay puerta: el partido arranca
// directo y el coach acompaña.
const coach = new Coach();

const world = {
  playerA, playerB, players, teamA, teamB, teamSize: TEAM_SIZE,
  ball, camera, particles, sound, input, touch, orbs, runner,
  debug: DEBUG, botsMode: BOTS, paused: false,
  practice: PRACTICE,        // cancha libre: el HUD cambia a modo práctica
  match: null,
  dashState, spin, charge,   // expuestos para el HUD del renderer
  // Desafíos completados esperando su aviso en pantalla (los saca el render)
  challengeQueue: [],
  // Estela fantasma del dash (siluetas que dibuja el render)
  ghosts: _ghosts,
  // La pausa, el fin de partido y la pantalla de controles ahora son DOM
  // (ver hud.js + play.html): botones de verdad, sin hit-testing manual.
  // Acá queda solo el ESTADO que el HUD lee.
  pauseMenu: { closeBlockedT: 0 },
  controlsScreen: { open: false },
  coach,                     // lecciones contextuales (el renderer las dibuja)
  replay,                    // reproductor: el renderer lo consulta para dibujar
  // Lo llama Match._resetPositions(). El estado de dash/giro vive acá y no en
  // Player, así que sin este hook sobrevivía al saque: un gol entrado a mitad
  // de un giro dejaba `spin.active` en true y el mago arrancaba el punto
  // girando solo, fuera de posición.
  onReset() {
    _dashPending = false;
    // El buffer arrastra el punto anterior: si no se limpia, la repetición
    // del próximo gol empezaría mostrando el saque viejo.
    replayRec.clear();
    dashState.charges = dashState.maxCharges;
    dashState.rechargeT = 0;
    dashState.active = false;
    dashState.t = 0;
    spin.active = false;
    spin.t = 0; spin.cd = 0; spin.holdT = 0; spin.chargeF = 0;
    spin.aimed = false; spin.hit = false;
    charge.active = false;
    charge.t = 0;
  },
};
const match = new Match(world, {
  duration: DURATION,      // opción "Duración del partido" del menú
  practice: PRACTICE,
  goalTarget: GOALS,       // partido por goles: primero a N gana
});
world.match = match;
// El HUD y la pantalla de fin leen de acá qué ronda del torneo se juega.
world.torneo = TORNEO ? { indice: T_RONDA.indice, cfg: T_RONDA.cfg, total: RONDAS.length } : null;

// Un bot por jugador, menos el humano (salvo en modo ?bots, donde juegan todos).
// En 2v2 los compañeros reciben roles distintos para que no se amontonen:
// el índice 0 ataca y el 1 se queda más atrás cubriendo.
const bots = players
  .filter((pl) => BOTS || pl !== playerA)
  .map((pl) => {
    const bot = new Bot(pl, pl.side, DIFFICULTY);
    bot.role = TEAM_SIZE > 1 && pl.index === 1 ? 'support' : 'striker';
    return bot;
  });

// ── Giro de escoba (LMB) ──────────────────────────────────────────────────
function startSpin(chargeF = 0) {
  const b = playerA.broom;
  spin.active  = true;
  spin.t       = 0;
  spin.from    = b.angle;
  spin.hit     = false;
  spin.holdT   = 0;
  spin.cd      = SPIN.cooldown;
  spin.chargeF = clamp(chargeF, 0, 1);

  // Congelar el lado del cuerpo (izq/der) durante todo el giro: si no, el
  // ragdoll cruzaría 90°/270° varias veces por segundo mientras la escoba
  // da la vuelta entera, y el cuerpo quedaría en poses imposibles.
  playerA.rider.freezeFlip = Math.cos(b.angle) >= 0 ? 1 : -1;

  const dx = ball.pos.x - b.pos.x, dy = ball.pos.y - b.pos.y;
  const dist = Math.hypot(dx, dy);
  spin.aimed = dist <= SPIN.range;

  if (spin.aimed) {
    const aimNow = camera.screenToWorld(input.cursor.x, input.cursor.y);
    let hx = aimNow.x - ball.pos.x, hy = aimNow.y - ball.pos.y;
    const hl = Math.hypot(hx, hy) || 1;
    spin.aimX = hx / hl;
    spin.aimY = hy / hl;

    // Elegir sentido del giro: la tangente que apunte hacia el cursor
    const rl = dist || 1;
    const rx = dx / rl, ry = dy / rl;
    const dotCCW = (-ry) * spin.aimX + rx * spin.aimY;
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
  // FUERZA (stat) multiplica la potencia del giro-golpe
  const power = (SPIN.minPower + (SPIN.maxPower - SPIN.minPower) * spin.chargeF)
    * playerA.mods.shot;
  const speed = Math.min(power, CFG.ball.maxSpeed);
  ball.vel.x = ux * speed;
  ball.vel.y = uy * speed;
  spin.hit = true;
}

// FX hooks para colisiones
const fx = {
  onImpact(x, y, strength, kind) {
    if (strength > 130) {
      particles.impact(x, y, strength);
      sound.impact(strength);
      // Anillo de choque: solo en impactos fuertes de verdad. Es lo que
      // separa "la pelota tocó algo" de "la pelota REVENTÓ contra algo".
      if (strength > 420) renderer?.addShockRing(x, y, strength);
      // El temblor de cámara quedó reservado para la explosión de gol:
      // sacudir la pantalla en cada golpe suelto se sentía excesivo.
    }
  },

  // Contragolpe encadenado: acá SÍ se sacude la pantalla, porque es un
  // momento puntual y espectacular, no un golpe cualquiera. La intensidad
  // sube con el nivel de la cadena.
  onChainHit(x, y, nivel) {
    _hitstopT = Math.max(_hitstopT, 0.05 + 0.02 * nivel);
    camera.shake(6 + 4 * nivel, 20);
    camera.setSpeedPunch(0.5);
    renderer?.addShockRing(x, y, 700 + 260 * nivel);
    particles.impact(x, y, 520 + 180 * nivel);
    sound.impact(900);
    // Aviso en pantalla: "¡CRÍTICO!" y, del segundo eslabón en adelante,
    // "¡ZIGZAG!" — el jugador tiene que entender POR QUÉ la pelota se volvió
    // loca, si no parece un bug.
    renderer?.chainToast(nivel);
  },
};

let debugOn = DEBUG;

// --- Paso de física (120 Hz) ---
function step(dt) {
  const frozen = match.playersFrozen();

  // Control del jugador humano (en modo ?bots lo maneja su propio bot).
  //
  // Las dos formas de jugar —mouse/teclado y táctil— comparten TODO el
  // sistema de habilidades: propulsión, boost, dash y giro. Solo cambia de
  // dónde salen las entradas. Antes el táctil tenía su propia rama corta y se
  // quedaba sin dash (nunca recargaba), sin giro (usaba el latigazo viejo) y
  // sin boost: eran dos juegos distintos según el dispositivo. Unificarlo acá
  // es lo que impide que vuelvan a divergir.
  if (!BOTS) {
    const b = playerA.broom;
    const tch = touch.active;

    // ── Entradas, normalizadas para que abajo dé igual el dispositivo ──────
    let aimX, aimY;
    if (tch) {
      const dir = touch.aimDir();
      aimX = dir ? b.pos.x + dir.x * 1000 : playerA.control.aim.x;
      aimY = dir ? b.pos.y + dir.y * 1000 : playerA.control.aim.y;
    } else {
      const aim = camera.screenToWorld(input.cursor.x, input.cursor.y);
      aimX = aim.x; aimY = aim.y;
    }
    // Táctil: el botón GAS acelera; sin él la escoba flota (equivale al RMB).
    const hovering = (tch ? !touch.thrust : input.rmb) && !frozen;
    // Táctil: el boost se activa manteniendo GAS a fondo mientras haya
    // reserva. No hay tecla Shift en el teléfono y sumar un cuarto botón con
    // dos pulgares era injugable.
    const boosting = (tch ? (touch.thrust && touch.thrustTime > 0.55) : input.boost) && !frozen;
    // Táctil: el botón GOLPE carga el giro igual que el LMB.
    const hitDown  = (tch ? touch.hit : input.lmb) && !frozen;

    playerA.control.aim.x         = aimX;
    playerA.control.aim.y         = aimY;
    playerA.control.thrust        = !hovering && !frozen;
    playerA.control.noThrustForce = true;   // propulsión manual abajo
    playerA.control.brake         = false;
    playerA.control.tuck          = false;  // el spin es el golpe
    playerA.control.boost         = false;

    // Propulsión con multiplicadores
    if (!hovering && !frozen) {
      // VELOCIDAD (stat) multiplica la propulsión manual del jugador, y el
      // aura de fuego encima: con el orbe fugitivo atrapado se vuela distinto.
      const mul = (boosting ? 1.4 : 0.65) * playerA.mods.thrust
        * (playerA.unlimited ? CFG.runner.auraThrust : 1);
      const d = b.dir();
      b.vel.x += d.x * CFG.broom.thrust * mul * dt;
      b.vel.y += d.y * CFG.broom.thrust * mul * dt;
    }
    // Flotar quieto (RMB / soltar GAS)
    if (hovering) {
      b.vel.x *= Math.exp(-12 * dt);
      b.vel.y *= Math.exp(-12 * dt);
    }

    playerA.updateEnergy(dt, boosting);

    // ── Recarga del dash ──────────────────────────────────────────────────
    if (dashState.charges < dashState.maxCharges) {
      // MAGIA (stat): el mod viene invertido, así que más magia = el
      // contador avanza más rápido = recarga antes.
      dashState.rechargeT += dt / playerA.mods.dashRecharge;
      if (dashState.rechargeT >= DASH.recharge) {
        dashState.charges++;
        dashState.rechargeT = dashState.charges < dashState.maxCharges
          ? dashState.rechargeT - DASH.recharge : 0;
      }
    }

    // ── Dash (Space / doble toque en el joystick) ─────────────────────────
    if (_dashPending && (dashState.charges === 0 || dashState.active)) _dashPending = false;
    // Segunda barrera del bloqueo inicial: el registro ya filtra, pero el flag
    // puede venir de un frame anterior al gol. Descartarlo en vez de dejarlo
    // esperando — un dash guardado que sale solo es justo lo que no queremos.
    if (_dashPending && !match.dashAllowed()) _dashPending = false;
    if (_dashPending && dashState.charges > 0 && !dashState.active && !frozen) {
      _dashPending = false;
      dashState.charges--;
      dashState.active = true;
      dashState.t = 0;
      _ghostEmitT = 0.16;   // ventana de emisión de la estela fantasma
      const d = b.dir();
      // MAGIA (stat): dash más potente
      const dashP = DASH.power * playerA.mods.dashPower;
      b.vel.x += d.x * dashP;
      b.vel.y += d.y * dashP;
      particles.impact(b.pos.x, b.pos.y, 320);
      sound.pop();
    }
    if (dashState.active) {
      dashState.t += dt;
      if (dashState.t >= DASH.duration) dashState.active = false;
    }

    // ── Cooldown del giro ─────────────────────────────────────────────────
    if (spin.cd > 0) spin.cd -= dt;

    // ── Carga del giro: mantener carga, soltar dispara ────────────────────
    if (hitDown && !charge.active && !spin.active && spin.cd <= 0) {
      charge.active = true;
      charge.t = 0;
    }
    if (charge.active) {
      if (hitDown) {
        charge.t += dt;
      } else {
        startSpin(charge.t / SPIN.chargeTime);
        charge.active = false;
      }
    }

    if (tch) touch.tick(dt); else input.tick(dt);
  }

  for (const bot of bots) bot.update(dt, world);
  if (frozen) {
    for (const p of players) {
      p.control.thrust = false;
      p.control.brake = false;
    }
  }

  // Física de jugadores. El "target" es lo que convierte el latigazo en un
  // golpe dirigido: dónde está la pelota y hacia dónde quiere mandarla.
  const mkTarget = (pl) => ({
    ball: ball.pos,
    aim: pl.control.aim,
    energyFrac: pl.energy / CFG.boost.max,
    spendEnergy: (c) => pl.spendEnergy(c),
  });
  for (const pl of players) pl.update(dt, frozen, mkTarget(pl));

  // ── Giro de escoba del jugador (DESPUÉS de player.update) ─────────────────
  // Corre también en táctil: el botón GOLPE dispara el mismo giro que el LMB.
  if (!BOTS) {
    const b = playerA.broom;
    // Si la escoba se pega un golpazo a mitad de giro, se corta acá: liberar
    // el freeze para que el cuerpo no quede pegado a un lado para siempre.
    if (spin.active && b.slamT > 0) {
      spin.active = false;
      playerA.rider.freezeFlip = null;
    }
    if (spin.active) {
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
      particles.magicTrail(tip.x, tip.y, -b.dir().x, -b.dir().y, 0.9, 0.5, CFG.colors.p1);

      if (k >= 1) {
        spin.active = false;
        b.angVel = 0;
        playerA.rider.freezeFlip = null; // el próximo frame recalcula del ángulo final
      }
    }

    // Detección de contacto escoba→pelota durante el giro
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
    // Ventana post-contacto
    if (!spin.active && spin.holdT > 0) {
      spin.holdT -= dt;
      const sp = Math.hypot(ball.vel.x, ball.vel.y);
      if (sp > 1) { ball.vel.x = spin.aimX * sp; ball.vel.y = spin.aimY * sp; }
    }
  }

  for (const pl of players) {
    collideBroomArena(
      pl.broom,
      (x, y, s) => fx.onImpact(x, y, s, 'wall'),
      // Golpazo contra pared/suelo: se ve y se oye fuerte, pero se recupera
      // solo. Antes acá empezaba el forcejeo para desclavarse.
      (x, y, nx, ny, s) => {
        sound.thunk();
        particles.impact(x, y, s * 0.9);
        camera.shake(6, 14);
      },
    );
  }
  for (const pl of players) clampRiderArena(pl);

  // Jugador vs jugador: TODOS los pares, también entre compañeros — chocarse
  // con el propio compañero es parte del caos y del humor del deporte.
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      interactPlayers(players[i], players[j], dt, fx);
    }
  }

  // Pelota
  if (!ball.frozen) {
    applyPortalSuction(ball, dt);
    ball.update(dt);

    // ── Anti-esquina ──────────────────────────────────────────────────────
    // Si la pelota queda casi quieta arrinconada más de 5 s, un empujón suave
    // hacia el centro la devuelve al juego. Es el único estado aburrido que
    // puede producir la física: dos jugadores lejos y la pelota muerta en un
    // rincón donde nadie la ve.
    {
      const nearX = Math.min(ball.pos.x - CFG.arena.L, CFG.arena.R - ball.pos.x) < 160;
      const nearY = Math.min(ball.pos.y - CFG.arena.T, CFG.arena.B - ball.pos.y) < 160;
      const slow = Math.hypot(ball.vel.x, ball.vel.y) < 45;
      if (nearX && nearY && slow && match.state === 'play') {
        _cornerT += dt;
        if (_cornerT > 5) {
          _cornerT = 0;
          const d = Math.hypot(ball.pos.x, ball.pos.y) || 1;
          ball.vel.x += (-ball.pos.x / d) * 340;
          ball.vel.y += (-ball.pos.y / d) * 340 - 120;
          particles.impact(ball.pos.x, ball.pos.y, 260);
        }
      } else {
        _cornerT = 0;
      }
    }
    if (ball.fire > 0) particles.fireTrail(ball.pos.x, ball.pos.y, ball.vel.x, ball.vel.y, ball.fire);
    else {
      // Polvo mágico del orbe. Solo cuando NO está en llamas: con fuego ya
      // emite ascuas, y superponer las dos cosas sería ruido.
      const bs = Math.hypot(ball.vel.x, ball.vel.y);
      particles.ballSparkle(ball.pos.x, ball.pos.y, ball.vel.x, ball.vel.y,
        Math.min(bs / 900, 1));
    }
    // Durante el giro del jugador, la colisión escoba→pelota la maneja el spin
    for (const pl of players) {
      if (pl === playerA && spin.active) continue;
      interactPlayerBall(pl, ball, dt, fx);
    }
    // Arcos sellados los primeros segundos del punto: la pelota rebota en el
    // portal en vez de entrar. `playT` lo lleva match.js desde el "¡YA!".
    const sealed = match.state === 'play'
      && (match.playT ?? 99) < CFG.match.goalSeal;
    const goal = collideBallArena(
      ball,
      (x, y, s) => { if (s > 180) fx.onImpact(x, y, s, 'wall'); },
      sealed,
    );
    if (goal && match.state === 'play') {
      if (REPLAY_ON) {
        // Un último snapshot FORZADO con la pelota ya cruzando la línea. El
        // grabado periódico va a 30 Hz, así que su última muestra puede ser de
        // hasta 33 ms antes — sin este frame la repetición cortaba con la
        // pelota todavía en el aire y el gol no se llegaba a ver.
        replayRec.push(world);
        _pendingClip = replayRec.toClip();
      }
      // Se congela ACÁ: un frame más tarde la succión del portal ya arrastra
      // la pelota y la explosión vuela a los magos, y la repetición terminaría
      // mostrando el festejo en vez de la jugada.
      match.onGoal(goal);
    }
  }

  // Orbes: energía repartida por la arena. Con la opción desactivada no
  // existen (orbs/runner son null), así que se saltea el bloque entero.
  if (orbs) {
    orbs.update(dt);
    orbs.collect(players, (orb, pl, oy) => {
      pl.addEnergy(CFG.orbs.energy);
      const color = pl.team === 'p1' ? CFG.colors.p1 : CFG.colors.p2;
      particles.orbAbsorb(orb.fx, oy, pl.broom.pos, color);
      sound.orb();
    }, dt);
  }

  // Orbe fugitivo: solo corre con el partido en juego
  if (runner) {
    runner.update(dt, players, match.state === 'play', {
      onAppear: (x, y) => { particles.runnerBurst(x, y); sound.runnerAppear(); },
      onEscape: (x, y) => { particles.runnerBurst(x, y); },
    });
    const caught = runner.collect(players);
    if (caught) {
      caught.grantUnlimited(CFG.runner.buff);
      particles.runnerCatch(runner.x, runner.y, caught.broom.pos);
      sound.runnerCatch();
      // Récord histórico de fugitivos atrapados (solo los del humano)
      if (caught === playerA && !BOTS && !PRACTICE) {
        recordRunnerCatch();
        if (loadStats().runners >= 3) {
          const c = completeChallenge('cazador');
          if (c) { world.challengeQueue.push(c); sound.stingChallenge(); }
        }
      }
    }
  }
  // Chispas doradas mientras dura la energía ilimitada
  for (const pl of players) {
    if (pl.unlimited) particles.unlimitedAura(pl.broom.pos.x, pl.broom.pos.y);
  }

  // Bots: usan el boost cuando persiguen de lejos
  for (const bot of bots) bot.player.updateEnergy(dt, bot.wantsBoost);

  // FX continuos: la estela escala con velocidad y boost — de chispitas a
  // estela energética — para que la velocidad se lea sin tapar el partido.
  for (const pl of players) {
    const b = pl.broom;
    const tail = b.tail(), d = b.dir();
    const color = pl.team === 'p1' ? CFG.colors.p1 : CFG.colors.p2;
    const speedF = Math.min(Math.hypot(b.vel.x, b.vel.y) / 900, 1.4);
    // Cada personaje deja SU estela: es lo que lo hace reconocible de lejos,
    // incluso cuando el cuerpo es un puñado de píxeles cruzando la cancha.
    emitTrail(pl.characterId, particles, tail.x, tail.y, d.x, d.y,
      Math.max(b.thrustPower, speedF * 0.55), b.boostPower, color);
    if (b.brakePower > 0.3) particles.brake(b.pos.x, b.pos.y, b.vel.x, b.vel.y);
  }
  particles.update(dt);

  // ── Estela fantasma: emitir durante el dash, desvanecer siempre ──────────
  if (_ghostEmitT > 0) {
    _ghostEmitT -= dt;
    _ghostSkip = (_ghostSkip + 1) % 3;
    if (_ghostSkip === 0) _snapGhost();
  }
  for (let i = _ghosts.length - 1; i >= 0; i--) {
    _ghosts[i].life -= dt;
    if (_ghosts[i].life <= 0) _ghosts.splice(i, 1);
  }

  // ── Cañonazo → hit-stop ──────────────────────────────────────────────────
  // Un salto brusco de velocidad de la pelota = alguien la reventó. El
  // congelado escala apenas con la potencia (45→70 ms, nunca más).
  const _bs = Math.hypot(ball.vel.x, ball.vel.y);
  if (match.state === 'play' && !ball.frozen && _bs - _prevBallSpd > 1500 && _bs > 1800) {
    _hitstopT = Math.min(0.07, 0.045 + (_bs - 1800) / 45000);
    camera.setSpeedPunch(0.6);   // micro-zoom que decae solo
    camera.shake(5, 12);
  }
  _prevBallSpd = _bs;
}

// El torneo no repite el mismo partido: navega a lo que sigue — próxima ronda
// (o la misma si perdió) o, de campeón, a los trofeos. Recargar la página
// además vuelve a leer la ronda desde el storage.
function _torneoContinue() {
  if (world.torneoResult.campeon) {
    location.href = 'trofeos.html?campeon=1';
  } else {
    const q = new URLSearchParams();
    q.set('mode', 'torneo');
    if (MUTE) q.set('mute', '1');
    if (NOORBS) q.set('noorbs', '1');
    location.href = `play.html?${q}`;
  }
}

// Acciones del overlay de pausa (botones del HUD DOM, ver hud.js).
function _pauseAction(id) {
  if (id === 'continuar') { world.paused = false; return; }
  if (id === 'controles') { world.controlsScreen.open = true; return; }
  if (id === 'menu') { location.href = 'index.html'; return; }
  if (id === 'salir') {
    // window.close() solo funciona si la pestaña la abrió un script (o el
    // usuario dio permiso explícito). Si el navegador la ignora, seguimos en
    // la misma página — no hay forma de forzar el cierre desde acá, así que
    // avisamos en vez de fallar en silencio.
    window.close();
    world.pauseMenu.closeBlockedT = 4;
  }
}

// --- Loop principal ---
let last = performance.now();
let acc = 0;
let prevMatchState = null;
// Tiempo de partido pendiente de aplicar. Existe porque la física avanza en
// pasos discretos y el reloj del partido tiene que seguirla sin perder ni
// inventar tiempo (ver el cálculo más abajo).
let matchTimeDebt = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dtReal = Math.min((now - last) / 1000, 0.1);
  last = now;

  // ── Pantalla de controles ───────────────────────────────────────────────
  // Se traga toda la entrada mientras está abierta: es una puerta al partido,
  // así que ni las teclas globales ni el juego reciben nada hasta cerrarla.
  const cs = world.controlsScreen;
  if (cs.open) {
    // El click lo maneja el botón del HUD; por teclado se cierra igual.
    const cerrar = input.pressed('Enter') || input.pressed('Space')
      || input.pressed('Escape') || touch.consumeTap();
    if (cerrar) {
      cs.open = false;
      // Si se abrió durante la cuenta regresiva, que arranque de cero para
      // no perder los primeros segundos leyendo.
      if (match.state === 'countdown') match.reset(false);
    }
    input.endFrame();
    renderer.draw(world, dtReal);
    hud.sync(world, dtReal);
    return;
  }

  // ── Repetición del gol ──────────────────────────────────────────────────
  // Mientras corre, el partido queda congelado: no avanza física ni reloj.
  // Cualquier tecla de acción la saltea — la idea es que nunca estorbe a
  // quien ya vio lo que pasó y quiere seguir jugando.
  if (replay.active) {
    const saltear = input.pressed('Space') || input.pressed('lmb')
      || input.pressed('Enter') || input.pressed('Escape') || touch.consumeTap();
    if (saltear) replay.stop();
    else replay.update(dtReal, camera.baseZoom(),
      { w: canvas.clientWidth, h: canvas.clientHeight });
    input.endFrame();
    renderer.draw(world, dtReal);
    hud.sync(world, dtReal);
    return;
  }

  // Teclas globales
  if (input.pressed('KeyP') || input.pressed('Escape') || touch.consumePauseTap()) {
    world.paused = !world.paused;
  }
  if (input.pressed('F3')) { debugOn = !debugOn; world.debug = debugOn; }
  if (input.pressed('KeyR')) match.reset(true);
  // Al entrar a la pantalla de fin, se descarta cualquier toque que haya
  // quedado de un botón presionado justo antes del gol — si no, el primer
  // frame reiniciaría solo.
  if (match.state === 'end' && prevMatchState !== 'end') {
    touch.consumeTap();
    // Registrar el partido UNA vez, en la transición a 'end'. La pantalla de
    // fin lee world.lastStats para mostrar la racha y los récords nuevos.
    if (!BOTS && !PRACTICE) {
      world.lastStats = recordMatch({
        winner: match.winner,
        scoreFor: match.score.p1,
        scoreAgainst: match.score.p2,
      });

      // Sting de cierre: la victoria se celebra, la derrota se reconoce corto
      if (match.winner === 'p1') sound.stingWin();
      else if (match.winner === 'p2') sound.stingLose();

      // Desafíos que se resuelven con el resultado del partido
      if (match.winner === 'p1') {
        const done = [
          completeChallenge('primera'),
          match.score.p2 === 0 ? completeChallenge('muralla') : null,
          match.score.p1 - match.score.p2 >= 3 ? completeChallenge('goleada') : null,
          DIFFICULTY === 'dificil' ? completeChallenge('leyenda') : null,
          world.lastStats.streak >= 3 ? completeChallenge('imparable') : null,
        ].filter(Boolean);
        if (done.length) {
          world.challengeQueue.push(...done);
          sound.stingChallenge();
        }
      }

      // Torneo: avanzar o quedarse en la ronda, UNA sola vez.
      if (TORNEO) {
        if (match.winner === 'p1') {
          const r = torneoWin();
          world.torneoResult = { win: true, campeon: r.campeon, proxima: r.proximaRonda };
        } else {
          torneoLose();
          world.torneoResult = { win: false };
        }
      }

      // Monedas del partido: la economía que desbloquea personajes. Va al
      // final de la transición porque el bono de campeón necesita que el
      // torneo ya haya resuelto su resultado.
      world.coinsEarned = matchReward({
        win: match.winner === 'p1',
        golesFavor: match.score.p1,
        campeon: !!world.torneoResult?.campeon,
      });
    }
  }

  // Los clicks de pausa y fin de partido ahora los resuelven los botones del
  // HUD DOM (hud.js). Por teclado queda lo puntual:
  if (!world.paused && match.state === 'end') {
    if (!TORNEO && !world.torneoResult) {
      // ENTER = revancha, con los mismos parámetros del partido.
      if (input.pressed('Enter')) location.href = `jugar.html${location.search}`;
    } else if (TORNEO && world.torneoResult
      && (input.pressed('Enter') || input.pressed('Space') || touch.consumeTap())) {
      _torneoContinue();
    }
  }

  // La repetición arranca cuando el festejo del gol termina y el partido pasa
  // al saque. Así el orden es: gol → explosión y "¡GOOOL!" → repetición →
  // cuenta regresiva. Mostrarla en el instante del gol pisaría la celebración,
  // que es justo el momento que da la satisfacción.
  if (_pendingClip && prevMatchState === 'goal' && match.state !== 'goal') {
    if (match.state !== 'end' && replay.start(_pendingClip, match.goalScorer)) {
      // Arrancó: el buffer se limpia para que el próximo gol no arrastre
      // frames de este punto.
      replayRec.clear();
    }
    _pendingClip = null;
  }
  // Piromanía: gol del humano con la pelota EN LLAMAS en el momento de entrar
  if (match.state === 'goal' && prevMatchState !== 'goal'
      && match.goalScorer === 'p1' && ball.fire > 0 && !BOTS && !PRACTICE) {
    const c = completeChallenge('piromania');
    if (c) { world.challengeQueue.push(c); sound.stingChallenge(); }
  }

  // Hit-stop del gol: un latido congelado justo cuando la pelota cruza,
  // antes de que arranque la succión y la carga del portal.
  if (match.state === 'goal' && prevMatchState !== 'goal') _hitstopT = 0.07;

  prevMatchState = match.state;

  // Dash: solo registrar si el juego está corriendo (no pausado, no fin) y ya
  // pasó el bloqueo del arranque. Se filtra acá, en el registro, y no solo al
  // consumirlo: si no, apretar Space durante el bloqueo dejaría el comando
  // guardado y saldría solo al cumplirse los 5 s — el mismo bug de buffer que
  // ya se arregló para la carga inicial.
  const dashInput = input.pressed('Space') || touch.consumeDashTap();
  if (dashInput && !world.paused && match.dashAllowed()) _dashPending = true;

  input.endFrame();

  if (world.paused && world.pauseMenu.closeBlockedT > 0) {
    world.pauseMenu.closeBlockedT = Math.max(0, world.pauseMenu.closeBlockedT - dtReal);
  }

  if (!world.paused) {
    // Física con slowmo del gol.
    //
    // El paso fijo de 120 Hz y la cámara lenta se llevan mal: con timeScale
    // 0.22 el acumulador recibe ~3.7 ms por frame pero un paso cuesta 8.3 ms,
    // así que la MAYORÍA de los frames no ejecutaban ningún paso — medido:
    // 56% de frames con la física congelada. El mundo avanzaba a tirones (se
    // congela dos frames, salta uno) y eso se ve exactamente como si el juego
    // perdiera FPS, aunque el render siguiera a 60 clavados. Bajar el costo
    // por frame no lo arreglaba porque el problema nunca fue el costo.
    //
    // La solución es achicar el paso mientras dura el slowmo: si el mundo
    // avanza al 22%, el paso también. Así cada frame ejecuta al menos un paso
    // y el movimiento se ve continuo. El paso más chico es además más preciso,
    // y como el mundo avanza menos tiempo real por frame, el costo total no
    // sube: son los mismos ~2 pasos por frame que en juego normal.
    const slowing = match.timeScale < 0.95;
    const stepDt = slowing
      ? Math.max(FIXED_DT * match.timeScale, FIXED_DT / 8)
      : FIXED_DT;
    // Hit-stop: mientras dura, el mundo NO recibe tiempo (ni física ni
    // partido). El render sigue — el congelado ES la imagen quieta.
    if (_hitstopT > 0) {
      _hitstopT -= dtReal;
    } else {
      acc += dtReal * match.timeScale;
    }
    const maxSteps = 6;
    let steps = 0;
    while (acc >= stepDt && steps < maxSteps) {
      step(stepDt);
      acc -= stepDt;
      steps++;
    }
    if (steps === maxSteps) acc = 0; // evitar espiral de la muerte

    // El partido avanza con el tiempo que la física REALMENTE simuló, no con
    // el del reloj de pared. Cuando un frame se pasa de `maxSteps` (lag, tab
    // en segundo plano) el sobrante se descarta: si el reloj siguiera usando
    // dtReal, correría más rápido que el mundo — medido: con frames de 100 ms
    // se simulaba el 50% de la física mientras el cronómetro avanzaba entero,
    // y el partido terminaba antes de haberse jugado.
    //
    // Se ACUMULA en vez de aplicarse frame a frame porque a más de 120 FPS
    // hay frames que no ejecutan ningún paso (a 240 Hz, la mitad): pasarle 0
    // al partido esos frames dejaba la cuenta regresiva y sus beeps con
    // hipo. Acumulando, el tiempo llega completo aunque venga a tirones.
    // `stepDt` ya viene escalado por timeScale, así que se divide para
    // volver a tiempo real.
    matchTimeDebt += slowing
      ? (steps * stepDt) / match.timeScale
      : steps * stepDt;
    if (matchTimeDebt > 0) {
      // El tope evita que una pausa larga se descargue de golpe en un frame.
      const give = Math.min(matchTimeDebt, dtReal);
      matchTimeDebt -= give;
      match.update(give, world);
    }

    // La cámara acompaña la jugada (medio entre jugador y pelota, con paneo
    // acotado). Antes iba fija en el centro y el micro-zoom de los cañonazos
    // cerraba sobre el medio de la cancha mientras el remate pasaba en el arco.
    camera.update(dtReal, playerA.broom.pos, ball.pos);

    // Grabar para la repetición. Solo con el punto en juego: durante la cuenta
    // regresiva y el festejo no pasa nada que valga la pena volver a ver, y
    // grabarlo solo gastaría los segundos útiles del buffer.
    if (match.state === 'play') replayRec.record(dtReal, world);

    // El coach mira el partido y decide si es momento de enseñar algo.
    // Solo con teclado/mouse: en táctil los controles son otros y los
    // hints de touch ya los cubre el renderer.
    if (match.state === 'play' && !BOTS && !touch.active) coach.update(dtReal, world);

    // Ambiente: suena mientras hay partido (juego y festejo), calla en la
    // pantalla de fin — ahí mandan los stings.
    sound.setAmbient(match.state === 'play' || match.state === 'goal' || match.state === 'countdown');

    // Sonido continuo
    const spA = Math.hypot(playerA.broom.vel.x, playerA.broom.vel.y);
    sound.setThrust(playerA.broom.thrustPower);
    sound.setBoost(playerA.broom.boostPower);
    sound.setWind(spA);
  }

  renderer.draw(world, dtReal);
  hud.sync(world, dtReal);
}

const renderer = new Renderer(canvas, ctx);

// ── HUD en DOM ─────────────────────────────────────────────────────────────
// La interfaz del partido vive en play.html como HTML/CSS; hud.js la
// sincroniza por frame. Los botones llaman directo a las acciones del juego.
const hud = new Hud({
  onPause: (id) => _pauseAction(id),
  onEnd: (id) => {
    if (id === 'menu') location.href = 'index.html';
    else if (id === 'revancha') location.href = `jugar.html${location.search}`;
  },
  onCloseControls: () => {
    world.controlsScreen.open = false;
    // Si se abrió durante la cuenta regresiva, que arranque de cero para no
    // perder los primeros segundos leyendo.
    if (match.state === 'countdown') match.reset(false);
  },
});
// Torneo: el fin de partido no tiene botones — se sigue tocando en cualquier
// lado. El overlay DOM tapa el canvas, así que el toque se escucha acá.
document.getElementById('endScreen').addEventListener('click', () => {
  if (match.state === 'end' && TORNEO && world.torneoResult) _torneoContinue();
});

// ── Pantalla de carga ──────────────────────────────────────────────────────
// play.html muestra un overlay hasta que el mapa (el asset pesado) está
// listo. El timeout es la red de seguridad: si el mapa falla, el juego
// arranca igual con el fondo plano en vez de colgarse en "cargando".
{
  const loadingEl = document.getElementById('loading');
  if (loadingEl) {
    const t0 = performance.now();
    const tick = setInterval(() => {
      if (renderer.mapReady || performance.now() - t0 > 6000) {
        clearInterval(tick);
        loadingEl.classList.add('off');
        setTimeout(() => loadingEl.remove(), 500);
      }
    }, 80);
  }
}
requestAnimationFrame(frame);

// Hooks de debugging/testing por consola
window.world = world;
window.renderer = renderer;
window.CFG = CFG;
// Un solo paso de partido+física, para poder inspeccionar estados intermedios
// (ej. verificar que el saque queda clavado durante toda la cuenta regresiva).
// `dt` es TIEMPO REAL, igual que en frame(): match.update lo recibe tal cual y
// escala internamente lo que corresponda. Antes acá se dividía por timeScale,
// así que durante la cámara lenta el partido avanzaba 4.5× más rápido que en
// el juego de verdad — las mediciones del festejo salían todas mal.
window.__stepOnce = (dt = FIXED_DT) => {
  match.update(dt, world);
  step(dt);
};
// Solo el paso de física, sin tocar el estado del partido. Sirve para
// reproducir el loop real en un test: frame() llama a match.update una vez
// por FRAME y a step() varias veces por frame, y meter las dos cosas en el
// mismo hook hacía imposible medir duraciones reales.
window.__stepPhys = (dt = FIXED_DT) => step(dt);
// Los bots, para poder medir su comportamiento desde un test (qué modo eligen,
// si alguien cubre el arco, cuántos pases dan).
window.__bots = bots;
window.__sim = (seconds = 10) => {
  // Simula el partido sin render (validación de físicas y bots)
  const steps = Math.floor(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    match.update(FIXED_DT, world);
    step(FIXED_DT);
  }
  return {
    score: { ...match.score },
    state: match.state,
    timeLeft: match.timeLeft.toFixed(1),
    ballPos: { x: ball.pos.x | 0, y: ball.pos.y | 0 },
    pA: { x: playerA.broom.pos.x | 0, y: playerA.broom.pos.y | 0 },
    pB: playerB ? { x: playerB.broom.pos.x | 0, y: playerB.broom.pos.y | 0 } : null,
  };
};

console.log('%c🧹 Escoba Voladora', 'font-size:16px;color:#3fc0ff');
console.log('Mouse: apuntar · LMB: acelerar · RMB: frenar · Space: recogerse');
console.log('P: pausa · R: reiniciar · F3: debug físicas');
