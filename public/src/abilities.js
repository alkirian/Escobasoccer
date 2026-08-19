// Habilidades características: una sola por personaje. Cada una define su
// propio estado, su lógica de física y cómo se dibuja — la escena solo llama
// a cast/update/draw y no sabe nada de los detalles.
//
// El contrato de cada personaje:
//   id, name, tag, color, cooldown, hint
//   cast(env)                 → dispara la habilidad (devuelve false si no pudo)
//   update(state, env, dt)    → física por subpaso
//   draw(state, ctx, env)     → dibujo en coordenadas de mundo
//
// `env` trae { player, broom, ball, aim, particles, sound, walls, dummies }.
import { CFG } from './config.js';
import { clamp } from './utils.js';

// ── 🌀 EL GIRANTE ──────────────────────────────────────────────────────────
// Su golpe no sale recto: la pelota serpentea en ondas suaves alrededor de la
// línea de tiro. Va hacia donde apuntaste, pero por un camino imposible de
// leer — el portero nunca sabe de qué lado le va a llegar.
const WEAVE = {
  duration:  1.5,    // cuánto dura el serpenteo
  freq:      6.2,    // ondulaciones por segundo
  amp:       1750,   // aceleración lateral en el pico de la onda
  falloff:   1.6,    // exponente con que se apaga (1 = lineal)
};

const girante = {
  id: 'girante', name: 'El Girante', tag: '🌀',
  color: '#b26bff',
  cooldown: 0,       // pasiva: no se activa, modifica cada golpe
  passive: true,
  hint: 'Pasiva: cada golpe sale serpenteando en zig-zag curvo',

  init: () => ({ t: 0, active: false, dirX: 0, dirY: 0, phase: 0 }),

  // Lo llama la escena justo después de conectar el golpe.
  onHit(state, ux, uy) {
    state.active = true;
    state.t = 0;
    state.dirX = ux; state.dirY = uy;
    // Fase aleatoria: unas veces arranca curvando a la izquierda, otras a la
    // derecha. Sin esto el primer tramo siempre sale igual y se vuelve legible.
    state.phase = Math.random() * Math.PI * 2;
  },

  update(state, env, dt) {
    if (!state.active) return;
    state.t += dt;
    const k = state.t / WEAVE.duration;
    if (k >= 1) { state.active = false; return; }

    const { ball, particles } = env;
    // La onda se apaga con la distancia recorrida: fuerte al salir, recta al
    // final. Así el tiro serpentea cerca y llega derecho al arco.
    const decay = Math.pow(1 - k, WEAVE.falloff);
    const wave  = Math.sin(state.t * WEAVE.freq * Math.PI * 2 + state.phase);

    // Normal a la dirección de vuelo actual (no a la original): si la pelota
    // rebota, el serpenteo se reorienta solo en vez de empujar de costado.
    const sp = Math.hypot(ball.vel.x, ball.vel.y) || 1;
    const nx = -ball.vel.y / sp, ny = ball.vel.x / sp;

    ball.vel.x += nx * wave * WEAVE.amp * decay * dt;
    ball.vel.y += ny * wave * WEAVE.amp * decay * dt;

    // Estela violeta que marca el camino curvo
    if (Math.random() < 0.55) {
      particles.spawn(
        ball.pos.x, ball.pos.y,
        -ball.vel.x * 0.1, -ball.vel.y * 0.1,
        0.35, 4 + decay * 3, Math.random() < 0.5 ? '#b26bff' : '#e6c8ff', 0,
      );
    }
  },

  draw() {},
};

// ── 🪨 EL MURADOR ──────────────────────────────────────────────────────────
// Dash que deja un muro de piedra donde estaba. Bloquea pelota y rivales.
// El muro se coloca PERPENDICULAR al dash: cortás la línea por la que venías.
const WALL = {
  power:     1700,   // impulso del dash
  dashTime:  0.09,
  life:      5.0,    // segundos que dura el muro
  half:      95,     // media longitud del muro
  thick:     20,
  bounce:    0.86,
  max:       3,      // muros simultáneos (el más viejo se desvanece)
};

const murador = {
  id: 'murador', name: 'El Murador', tag: '🪨',
  color: '#c99a5b',
  cooldown: 3.2,
  hint: 'Dash que deja un muro de piedra atrás',

  init: () => ({ walls: [], dashT: 0 }),

  cast(state, env) {
    const { broom, particles, sound } = env;
    const d = broom.dir();

    // El muro va en la posición actual, girado 90° respecto del dash: queda
    // atravesado en el camino, no paralelo a él.
    state.walls.push({
      x: broom.pos.x, y: broom.pos.y,
      nx: d.x, ny: d.y,             // normal del muro = dirección del dash
      t: 0, life: WALL.life,
    });
    if (state.walls.length > WALL.max) state.walls.shift();

    broom.vel.x += d.x * WALL.power;
    broom.vel.y += d.y * WALL.power;
    state.dashT = WALL.dashTime;

    particles.impact(broom.pos.x, broom.pos.y, 380);
    // Polvo de piedra en la línea del muro
    for (let i = 0; i < 22; i++) {
      const s = (Math.random() * 2 - 1) * WALL.half;
      particles.spawn(
        broom.pos.x - d.y * s, broom.pos.y + d.x * s,
        (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200 - 60,
        0.4 + Math.random() * 0.4, 3 + Math.random() * 5,
        Math.random() < 0.5 ? '#c99a5b' : '#8a6a42', 260,
      );
    }
    sound.thunk();
    return true;
  },

  update(state, env, dt) {
    if (state.dashT > 0) state.dashT -= dt;
    const { ball, broom } = env;

    for (let i = state.walls.length - 1; i >= 0; i--) {
      const w = state.walls[i];
      w.t += dt;
      if (w.t >= w.life) { state.walls.splice(i, 1); continue; }

      // Tangente del muro (perpendicular a su normal)
      const tx = -w.ny, ty = w.nx;

      // ── Pelota vs muro ──
      collideCircleWall(ball.pos, ball.vel, ball.r, w, tx, ty, WALL.bounce);

      // ── Escoba vs muro ── (rebota más suave, no debe trabar al jugador)
      collideCircleWall(broom.pos, broom.vel, 26, w, tx, ty, 0.55);
    }
  },

  draw(state, ctx) {
    for (const w of state.walls) {
      // Se desvanece en el último medio segundo de vida
      const fade = clamp((w.life - w.t) / 0.6, 0, 1);
      const rise = clamp(w.t / 0.12, 0, 1);   // brota del piso al aparecer
      const half = WALL.half * rise;

      const tx = -w.ny, ty = w.nx;
      const ax = w.x - tx * half, ay = w.y - ty * half;
      const bx = w.x + tx * half, by = w.y + ty * half;

      ctx.save();
      ctx.globalAlpha = fade;

      // Cuerpo de piedra
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#6b4f30';
      ctx.lineWidth = WALL.thick + 6;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

      const g = ctx.createLinearGradient(ax, ay, bx, by);
      g.addColorStop(0,   '#a87f4e');
      g.addColorStop(0.5, '#d4a76a');
      g.addColorStop(1,   '#a87f4e');
      ctx.strokeStyle = g;
      ctx.lineWidth = WALL.thick;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

      // Vetas: las juntas entre bloques
      ctx.strokeStyle = 'rgba(70,48,26,0.55)';
      ctx.lineWidth = 2;
      for (let s = -2; s <= 2; s++) {
        const px = w.x + tx * (half * s / 2.6), py = w.y + ty * (half * s / 2.6);
        ctx.beginPath();
        ctx.moveTo(px - w.nx * WALL.thick * 0.45, py - w.ny * WALL.thick * 0.45);
        ctx.lineTo(px + w.nx * WALL.thick * 0.45, py + w.ny * WALL.thick * 0.45);
        ctx.stroke();
      }

      // Contorno mágico que parpadea al morir
      ctx.strokeStyle = `rgba(255,200,120,${0.35 * fade})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

      ctx.restore();
    }
  },
};

// Rebote de un círculo contra un muro-segmento. Muta pos y vel in-place.
function collideCircleWall(pos, vel, r, w, tx, ty, bounce) {
  const rise = clamp(w.t / 0.12, 0, 1);
  const half = WALL.half * rise;

  // Proyectar el centro sobre el segmento
  const dx = pos.x - w.x, dy = pos.y - w.y;
  const along = clamp(dx * tx + dy * ty, -half, half);
  const cx = w.x + tx * along, cy = w.y + ty * along;

  const ox = pos.x - cx, oy = pos.y - cy;
  const d = Math.hypot(ox, oy);
  const minD = r + WALL.thick / 2;
  if (d >= minD || d < 0.0001) return;

  // Separar y rebotar sobre la normal del contacto
  const nx = ox / d, ny = oy / d;
  pos.x = cx + nx * minD;
  pos.y = cy + ny * minD;
  const vn = vel.x * nx + vel.y * ny;
  if (vn < 0) {
    vel.x -= (1 + bounce) * vn * nx;
    vel.y -= (1 + bounce) * vn * ny;
  }
}

// ── ⚡ EL ATURDIDOR ────────────────────────────────────────────────────────
// Lanza un proyectil hacia el cursor. Si alcanza a un rival, lo deja paralizado
// — no puede moverse ni golpear. Recarga larga: es un recurso, no spam.
const STUN = {
  speed:    2100,
  life:     1.1,     // segundos de vuelo antes de disiparse
  r:        16,      // radio del proyectil
  hitR:     52,      // radio de impacto contra un rival
  stunTime: 1.6,     // cuánto dura el aturdimiento
};

const aturdidor = {
  id: 'aturdidor', name: 'El Aturdidor', tag: '⚡',
  color: '#5ce1e6',
  cooldown: 4.5,
  hint: 'Lanza un hechizo que paraliza al rival que toca',

  init: () => ({ bolts: [] }),

  cast(state, env) {
    const { broom, aim, particles, sound } = env;
    let dx = aim.x - broom.pos.x, dy = aim.y - broom.pos.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;

    // Sale desde la punta de la escoba, no del centro
    const tip = broom.tip();
    state.bolts.push({
      x: tip.x, y: tip.y,
      vx: dx * STUN.speed + broom.vel.x * 0.35,
      vy: dy * STUN.speed + broom.vel.y * 0.35,
      t: 0, spin: 0,
    });

    particles.impact(tip.x, tip.y, 220);
    sound.pop();
    return true;
  },

  update(state, env, dt) {
    const { particles, sound, dummies } = env;
    const A = CFG.arena;

    for (let i = state.bolts.length - 1; i >= 0; i--) {
      const p = state.bolts[i];
      p.t += dt;
      p.spin += dt * 22;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Estela eléctrica
      if (Math.random() < 0.8) {
        particles.spawn(
          p.x + (Math.random() - 0.5) * 14, p.y + (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120,
          0.25, 3 + Math.random() * 3,
          Math.random() < 0.5 ? '#5ce1e6' : '#ffffff', 0,
        );
      }

      // ¿Alcanzó a alguien?
      let consumed = false;
      for (const d of dummies) {
        if (Math.hypot(d.x - p.x, d.y - p.y) < STUN.hitR) {
          d.stunT = STUN.stunTime;
          particles.shockwave(d.x, d.y, '#5ce1e6', 34);
          sound.impact(520);
          consumed = true;
          break;
        }
      }

      const out = p.x < A.L || p.x > A.R || p.y < A.T || p.y > A.B;
      if (consumed || out || p.t >= STUN.life) {
        if (!consumed) particles.impact(p.x, p.y, 160);
        state.bolts.splice(i, 1);
      }
    }
  },

  draw(state, ctx) {
    for (const p of state.bolts) {
      const fade = clamp(1 - p.t / STUN.life, 0, 1);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = fade;

      // Halo
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, STUN.r * 2.4);
      g.addColorStop(0,   'rgba(180,255,255,0.9)');
      g.addColorStop(0.4, 'rgba(92,225,230,0.45)');
      g.addColorStop(1,   'rgba(92,225,230,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, STUN.r * 2.4, 0, Math.PI * 2); ctx.fill();

      // Núcleo
      ctx.fillStyle = '#eaffff';
      ctx.shadowColor = '#5ce1e6'; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(0, 0, STUN.r * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      // Chispas orbitando
      ctx.strokeStyle = '#aefaff';
      ctx.lineWidth = 2.5;
      for (let k = 0; k < 3; k++) {
        const a = p.spin + k * (Math.PI * 2 / 3);
        ctx.beginPath();
        ctx.arc(0, 0, STUN.r * 1.25, a, a + 0.7);
        ctx.stroke();
      }
      ctx.restore();
    }
  },
};

// ── 💨 EL SOPLADOR ─────────────────────────────────────────────────────────
// Ráfaga cónica hacia el cursor: repele la pelota y a los rivales que estén
// dentro del cono. No los aturde — los manda lejos. Sirve para despejar.
const BLOW = {
  range:    420,
  arc:      Math.PI * 0.42,   // medio ángulo del cono
  force:    2600,             // impulso a quemarropa
  minMul:   0.25,             // fuerza mínima en el borde del cono
  duration: 0.28,             // cuánto sopla
};

const soplador = {
  id: 'soplador', name: 'El Soplador', tag: '💨',
  color: '#7ee8a2',
  cooldown: 2.6,
  hint: 'Ráfaga que repele la pelota y a los rivales',

  init: () => ({ t: 0, active: false, dirX: 1, dirY: 0 }),

  cast(state, env) {
    const { broom, aim, sound } = env;
    let dx = aim.x - broom.pos.x, dy = aim.y - broom.pos.y;
    const l = Math.hypot(dx, dy) || 1;
    state.dirX = dx / l; state.dirY = dy / l;
    state.active = true;
    state.t = 0;
    sound.pop();
    return true;
  },

  update(state, env, dt) {
    if (!state.active) return;
    state.t += dt;
    if (state.t >= BLOW.duration) { state.active = false; return; }

    const { broom, ball, particles, dummies } = env;
    // La ráfaga es más fuerte al principio del soplido
    const punch = 1 - state.t / BLOW.duration;

    const push = (pos, vel) => {
      const dx = pos.x - broom.pos.x, dy = pos.y - broom.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > BLOW.range || d < 1) return;
      // ¿Está dentro del cono?
      const dot = (dx / d) * state.dirX + (dy / d) * state.dirY;
      const ang = Math.acos(clamp(dot, -1, 1));
      if (ang > BLOW.arc) return;
      // Más fuerte en el eje del cono y de cerca
      const angF  = 1 - (ang / BLOW.arc) * (1 - BLOW.minMul);
      const distF = 1 - (d / BLOW.range) * 0.65;
      const f = BLOW.force * angF * distF * punch;
      vel.x += (dx / d) * f * dt;
      vel.y += (dy / d) * f * dt;
    };

    push(ball.pos, ball.vel);
    for (const dm of dummies) push(dm, dm.vel);

    // Viento visible
    for (let i = 0; i < 3; i++) {
      const a = Math.atan2(state.dirY, state.dirX) + (Math.random() * 2 - 1) * BLOW.arc;
      const r0 = 30 + Math.random() * 70;
      const sp = 420 + Math.random() * 620;
      particles.spawn(
        broom.pos.x + Math.cos(a) * r0, broom.pos.y + Math.sin(a) * r0,
        Math.cos(a) * sp, Math.sin(a) * sp,
        0.3 + Math.random() * 0.25, 3 + Math.random() * 4,
        Math.random() < 0.5 ? 'rgba(190,255,215,0.75)' : 'rgba(255,255,255,0.6)', 0,
      );
    }
  },

  draw(state, ctx, env) {
    if (!state.active) return;
    const { broom } = env;
    const k = 1 - state.t / BLOW.duration;
    const a = Math.atan2(state.dirY, state.dirX);

    ctx.save();
    ctx.translate(broom.pos.x, broom.pos.y);
    ctx.rotate(a);
    // Cono de aire que se abre y se apaga
    const reach = BLOW.range * (1 - k * 0.35);
    const g = ctx.createRadialGradient(0, 0, 20, 0, 0, reach);
    g.addColorStop(0,   `rgba(220,255,235,${0.30 * k})`);
    g.addColorStop(0.6, `rgba(126,232,162,${0.14 * k})`);
    g.addColorStop(1,   'rgba(126,232,162,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, reach, -BLOW.arc, BLOW.arc);
    ctx.closePath();
    ctx.fill();

    // Arcos concéntricos viajando hacia afuera
    ctx.strokeStyle = `rgba(230,255,240,${0.5 * k})`;
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const p = ((state.t / BLOW.duration) + i / 3) % 1;
      ctx.globalAlpha = (1 - p) * k;
      ctx.beginPath();
      ctx.arc(0, 0, 60 + p * reach, -BLOW.arc * 0.85, BLOW.arc * 0.85);
      ctx.stroke();
    }
    ctx.restore();
  },
};

export const HEROES = [girante, murador, aturdidor, soplador];
export const STUN_TIME = STUN.stunTime;
