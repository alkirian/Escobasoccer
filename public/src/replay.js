// Repetición del gol: buffer circular de los últimos segundos de juego.
//
// No re-simula física — graba el ESTADO VISUAL de cada frame (posiciones,
// ángulos, puntos del ragdoll) y después lo vuelve a pintar. Re-simular sería
// frágil (cualquier diferencia de dt cambia el resultado) y no aportaría nada:
// lo que el jugador quiere ver es exactamente lo que pasó, no una variante.
//
// El costo es memoria, y es acotado: a 30 fps durante 5 s son 150 snapshots,
// cada uno con ~11 puntos por jugador. Se graba en un anillo de tamaño fijo,
// así que la memoria no crece con la duración del partido.
import { CFG } from './config.js';
import { clamp, damp } from './utils.js';

const REPLAY = {
  seconds:   4.5,    // cuánto se GUARDA hacia atrás (margen del buffer)
  // Cuánto se MUESTRA de eso. El buffer guarda de más para tener margen, pero
  // la repetición arranca cerca del gol: 4.5 s incluían el saque anterior y
  // medio campo de vuelo sin nada, y la jugada que importa se perdía al final.
  showSeconds: 2.2,
  fps:       30,     // resolución temporal del buffer
  speed:     0.55,   // velocidad de reproducción (cámara lenta suave)
  // Acercamiento respecto del zoom normal. Bajado de 1.55: con ese valor la
  // boca del arco no entraba entera en cuadro y el gol —lo único que la
  // repetición tiene que mostrar— quedaba fuera de pantalla.
  zoom:      1.18,
  camLerp:   6.5,    // suavizado del seguimiento de cámara
  // Cuánto se puede adelantar la cámara respecto del foco cuando la pelota va
  // rápido. Sin esto, en un tiro fuerte la cámara persigue por detrás y el gol
  // entra fuera de cuadro — medido: 1200 unidades de atraso con 853 de medio
  // ancho visible.
  leadTime:  0.22,
  // 0 = mira al jugador, 1 = mira a la pelota. Casi todo a la pelota: la
  // jugada ES la pelota, y promediar con el jugador dejaba la cámara a mitad
  // de camino entre los dos justo cuando el tiro salía disparado al arco.
  ballBias:  0.88,
  introHold: 0.25,   // pausa al arrancar, antes de que corra la acción
  outroHold: 0.9,    // pausa al final, congelado sobre el gol
};

const MAX_FRAMES = Math.ceil(REPLAY.seconds * REPLAY.fps);
const FRAME_DT   = 1 / REPLAY.fps;

// Nombres de los puntos del ragdoll que hay que guardar para poder redibujar
// al jinete. Es el mismo conjunto que usa render.js.
const RIDER_POINTS = [
  'head', 'chest', 'pelvis',
  'kneeF', 'footF', 'kneeB', 'footB',
  'handF', 'handB',
];

export class ReplayRecorder {
  constructor() {
    this.frames = new Array(MAX_FRAMES);
    this.count = 0;      // cuántos slots válidos hay
    this.head = 0;       // dónde se escribe el próximo
    this.acc = 0;        // acumulador para grabar a `fps` fijos
    this.enabled = true;
  }

  clear() {
    this.count = 0;
    this.head = 0;
    this.acc = 0;
  }

  // Se llama una vez por frame con el dt REAL. Graba a ritmo fijo aunque el
  // juego corra a 60 o 144 fps, así la repetición dura lo mismo en cualquier
  // máquina.
  record(dt, world) {
    if (!this.enabled) return;
    this.acc += dt;
    if (this.acc < FRAME_DT) return;
    this.acc = 0;
    this.push(world);
  }

  // Graba un snapshot YA, sin esperar al próximo tick del acumulador. Lo usa
  // el gol: entre el último snapshot periódico y el momento en que la pelota
  // cruza la línea pueden pasar hasta 33 ms, y sin este frame forzado la
  // repetición cortaba con la pelota todavía en el aire, justo antes de entrar.
  push(world) {
    if (!this.enabled) return;
    this.frames[this.head] = this._snapshot(world);
    this.head = (this.head + 1) % MAX_FRAMES;
    if (this.count < MAX_FRAMES) this.count++;
  }

  // Copia plana de lo que hace falta para redibujar la escena. Todo son
  // números sueltos: nada de referencias a objetos vivos, que seguirían
  // mutando después de guardarlos.
  _snapshot(world) {
    const players = world.players.map((pl) => {
      const b = pl.broom;
      const pts = {};
      for (const n of RIDER_POINTS) {
        const p = pl.rider.points[n];
        if (p) pts[n] = { x: p.x, y: p.y };
      }
      return {
        team: pl.team,
        index: pl.index,
        isHuman: pl === world.playerA,
        // Sin esto la repetición dibujaba a TODOS con el mago por defecto:
        // el stub que arma render._replayPlayer no tenía characterId, así que
        // el buscador de personaje caía al fallback. Se ve raro justo en el
        // momento que más se mira.
        characterId: pl.characterId,
        broom: {
          x: b.pos.x, y: b.pos.y, angle: b.angle,
          thrustPower: b.thrustPower, boostPower: b.boostPower,
          brakePower: b.brakePower, strain: b.strain,
          velX: b.vel.x, velY: b.vel.y,
        },
        points: pts,
        cape: pl.rider.cape.map((c) => ({ x: c.x, y: c.y })),
      };
    });

    const ball = world.ball;
    return {
      players,
      ball: {
        x: ball.pos.x, y: ball.pos.y, r: ball.r,
        // La velocidad la usa la cámara para adelantarse al vuelo
        vx: ball.vel.x, vy: ball.vel.y,
        rot: ball.rot, scale: ball.scale, fire: ball.fire,
        // vx/vy de cada muestra: la estela se dibuja como cinta y necesita la
        // dirección de vuelo en cada punto para saber hacia dónde ensancharse.
        trail: ball.trail.map((t) => ({
          x: t.x, y: t.y, sp: t.sp, fire: t.fire, vx: t.vx, vy: t.vy,
        })),
      },
    };
  }

  // Devuelve los frames en orden cronológico. El buffer es circular, así que
  // el más viejo no está siempre en el índice 0.
  //
  // Se recorta a los últimos `showSeconds`: el buffer guarda de más para tener
  // margen, pero la repetición tiene que arrancar cerca del gol, no en el
  // saque anterior.
  toClip() {
    if (this.count === 0) return null;
    const want = Math.min(this.count, Math.ceil(REPLAY.showSeconds * REPLAY.fps));
    // Índice del frame más viejo que entra en el recorte
    const first = this.count < MAX_FRAMES
      ? this.count - want
      : (this.head + (this.count - want)) % MAX_FRAMES;
    const out = new Array(want);
    for (let i = 0; i < want; i++) {
      out[i] = this.frames[(first + i) % MAX_FRAMES];
    }
    return out;
  }
}

// ── Reproductor ────────────────────────────────────────────────────────────
// Vive aparte del grabador: mientras uno reproduce, el otro puede seguir
// grabando el próximo punto sin pisarse.
export class ReplayPlayer {
  constructor() {
    this.clip = null;
    this.t = 0;          // segundos dentro del clip
    this.active = false;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.introT = 0;
    this.outroT = 0;
    this.scorer = null;  // 'p1' | 'p2', para el cartel
  }

  start(clip, scorer) {
    if (!clip || clip.length < 4) return false;   // muy corto: no vale la pena
    this.clip = clip;
    this.t = 0;
    this.active = true;
    this.introT = REPLAY.introHold;
    this.outroT = 0;
    this.scorer = scorer;
    // La cámara arranca ya encuadrada, sin barrido desde la posición anterior
    const f = clip[0];
    const focus = this._focusOf(f);
    this.cam.x = focus.x;
    this.cam.y = focus.y;
    this.cam.zoom = 0;   // 0 = "todavía no inicializada", se fija en el primer update
    return true;
  }

  stop() {
    this.active = false;
    this.clip = null;
  }

  get duration() { return this.clip ? (this.clip.length - 1) * FRAME_DT : 0; }

  // Punto que la cámara sigue: entre el jugador humano y la pelota. Seguir
  // solo a la pelota marea (rebota mucho); seguir solo al jugador deja el gol
  // fuera de cuadro. El promedio pesado muestra la jugada.
  _focusOf(frame) {
    const human = frame.players.find((p) => p.isHuman) || frame.players[0];
    const b = frame.ball;
    const k = REPLAY.ballBias;
    // Adelanto: se mira hacia donde la pelota VA a estar, no donde está. En un
    // tiro fuerte la cámara suavizada llega siempre tarde y el gol entra fuera
    // de cuadro; anticipando unas décimas, el arco ya está encuadrado cuando
    // la pelota llega.
    const lead = REPLAY.leadTime;
    const bx = b.x + (b.vx || 0) * lead;
    const by = b.y + (b.vy || 0) * lead;
    return {
      x: human.broom.x * (1 - k) + bx * k,
      y: human.broom.y * (1 - k) + by * k,
    };
  }

  // Avanza el clip. Devuelve false cuando terminó.
  // `view` = { w, h } del canvas, para poder recortar la cámara contra el
  // borde del mapa sabiendo cuánto mundo entra realmente en pantalla.
  update(dt, baseZoom, view) {
    if (!this.active) return false;

    // Pausa inicial: da un instante para leer el cartel antes de que arranque
    if (this.introT > 0) {
      this.introT -= dt;
    } else if (this.t < this.duration) {
      this.t = Math.min(this.t + dt * REPLAY.speed, this.duration);
    } else {
      // Pausa final sobre el gol, y recién ahí termina
      this.outroT += dt;
      if (this.outroT >= REPLAY.outroHold) { this.stop(); return false; }
    }

    // Cámara: persigue el foco con suavizado. El zoom se fija de una la
    // primera vez (si no, se vería un zoom-in desde el encuadre normal que
    // no aporta nada y marea).
    const f = this.frameAt(this.t);
    if (f) {
      const focus = this._focusOf(f);
      const target = baseZoom * REPLAY.zoom;
      if (this.cam.zoom === 0) {
        this.cam.zoom = target;
        this.cam.x = focus.x;
        this.cam.y = focus.y;
      } else {
        this.cam.zoom = damp(this.cam.zoom, target, REPLAY.camLerp, dt);
        this.cam.x = damp(this.cam.x, focus.x, REPLAY.camLerp, dt);
        this.cam.y = damp(this.cam.y, focus.y, REPLAY.camLerp, dt);
      }
      this._clampCam(view);
    }
    return true;
  }

  // No dejar que el encuadre se asome al vacío de afuera del mapa pintado.
  // Necesita el tamaño real del canvas: cuánto mundo entra en pantalla es
  // (ancho / zoom), y con una estimación fija el recorte queda mal y arrastra
  // la cámara lejos de la jugada.
  _clampCam(view) {
    if (!view || !view.w || !view.h) return;
    const A = CFG.arena;
    const halfW = A.imgW / 2, halfH = A.imgH / 2;
    const z = this.cam.zoom || 1;
    const viewHW = view.w / 2 / z;
    const viewHH = view.h / 2 / z;
    const limX = Math.max(0, halfW - viewHW);
    const limY = Math.max(0, halfH - viewHH);
    this.cam.x = clamp(this.cam.x, -limX, limX);
    this.cam.y = clamp(this.cam.y, -limY, limY);
  }

  // Frame interpolado en el instante `t`. Interpolar entre snapshots es lo
  // que hace que 30 fps grabados se vean fluidos al reproducirlos en cámara
  // lenta — sin esto se notaría el salto entre muestras.
  frameAt(t) {
    if (!this.clip) return null;
    const raw = t / FRAME_DT;
    const i = Math.floor(raw);
    const a = this.clip[Math.min(i, this.clip.length - 1)];
    const b = this.clip[Math.min(i + 1, this.clip.length - 1)];
    if (a === b) return a;
    return lerpFrame(a, b, raw - i);
  }

  // Progreso 0..1, para la barra del cartel
  get progress() {
    const d = this.duration;
    return d > 0 ? clamp(this.t / d, 0, 1) : 1;
  }
}

// ── Interpolación ──────────────────────────────────────────────────────────
const mix = (a, b, k) => a + (b - a) * k;

function lerpFrame(a, b, k) {
  return {
    players: a.players.map((pa, i) => {
      const pb = b.players[i] || pa;
      const pts = {};
      for (const n of RIDER_POINTS) {
        const qa = pa.points[n], qb = pb.points[n];
        if (qa && qb) pts[n] = { x: mix(qa.x, qb.x, k), y: mix(qa.y, qb.y, k) };
        else if (qa) pts[n] = qa;
      }
      return {
        team: pa.team,
        index: pa.index,
        isHuman: pa.isHuman,
        broom: {
          x: mix(pa.broom.x, pb.broom.x, k),
          y: mix(pa.broom.y, pb.broom.y, k),
          // El ángulo se interpola por el camino corto: sin esto, cruzar
          // ±π (que pasa en cada giro del golpe) hacía girar la escoba al
          // revés una vuelta entera en un solo frame.
          angle: mixAngle(pa.broom.angle, pb.broom.angle, k),
          thrustPower: mix(pa.broom.thrustPower, pb.broom.thrustPower, k),
          boostPower: mix(pa.broom.boostPower, pb.broom.boostPower, k),
          brakePower: mix(pa.broom.brakePower, pb.broom.brakePower, k),
          strain: mix(pa.broom.strain, pb.broom.strain, k),
          velX: mix(pa.broom.velX, pb.broom.velX, k),
          velY: mix(pa.broom.velY, pb.broom.velY, k),
        },
        points: pts,
        cape: pa.cape.map((ca, j) => {
          const cb = pb.cape[j] || ca;
          return { x: mix(ca.x, cb.x, k), y: mix(ca.y, cb.y, k) };
        }),
      };
    }),
    ball: {
      x: mix(a.ball.x, b.ball.x, k),
      y: mix(a.ball.y, b.ball.y, k),
      vx: mix(a.ball.vx || 0, b.ball.vx || 0, k),
      vy: mix(a.ball.vy || 0, b.ball.vy || 0, k),
      r: a.ball.r,
      rot: mix(a.ball.rot, b.ball.rot, k),
      scale: mix(a.ball.scale, b.ball.scale, k),
      fire: mix(a.ball.fire, b.ball.fire, k),
      trail: a.ball.trail,
    },
  };
}

function mixAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export { REPLAY };
