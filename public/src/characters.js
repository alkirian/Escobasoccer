// Personajes vectoriales del juego. Cada héroe dibuja su propio cuerpo y su
// propia escoba SOBRE LOS MISMOS 9 PUNTOS del ragdoll: la física no sabe qué
// personaje la viste, así que cambiar de héroe nunca cambia cómo se juega.
//
// Regla de color: cada personaje tiene su paleta de identidad (es lo que lo
// hace reconocible), y el color del EQUIPO aparece como acento fuerte en un
// lugar fijo (tabardo, ojos, faja, bufanda). Silueta = quién es; acento = de
// qué lado juega. Sin esto, con 4 paletas distintas los bandos se confunden.
//
// Interfaz: draw(ctx, r, player, color, dark, world, fx)
//   r  = el Renderer (presta _limb, _limbSeg, _shade, _ink, t)
//   fx = { facing: +1/-1, look: {x,y} rumbo, slam: 0..1 aturdimiento }
import { CFG } from './config.js';
import { lerp, clamp } from './utils.js';

const S = CFG.charScale;
const TAU = Math.PI * 2;

// ── Ayudantes compartidos ─────────────────────────────────────────────────
function axis(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { ux: dx / len, uy: dy / len, px: -dy / len, py: dx / len, len };
}

// Ojos compartidos: iris corrido hacia el rumbo, cruces al estar aturdido.
// `o` ajusta color de iris (por ojo, para heterocromía) y pestañas (Valka).
function eyes(ctx, r, head, ux, uy, fx, o = {}) {
  const R = (o.R ?? 11) * S;
  const px = -uy, py = ux;
  const fxx = px * fx.facing, fyy = py * fx.facing;
  const base = { x: head.x + fxx * R * 0.34 + ux * R * 0.12,
                 y: head.y + fyy * R * 0.34 + uy * R * 0.12 };
  const sep = R * 0.30;
  const es = [
    { x: base.x + ux * sep * 0.55 + fxx * sep * 0.28,
      y: base.y + uy * sep * 0.55 + fyy * sep * 0.28, iris: o.irisA ?? '#241d33' },
    { x: base.x - ux * sep * 0.55 + fxx * sep * 0.28,
      y: base.y - uy * sep * 0.55 + fyy * sep * 0.28, iris: o.irisB ?? o.irisA ?? '#241d33' },
  ];
  if (fx.slam > 0.05) {
    ctx.strokeStyle = '#2a2136';
    ctx.lineWidth = 1.5 * S;
    for (const e of es) {
      const s2 = R * 0.2;
      ctx.beginPath();
      ctx.moveTo(e.x - s2, e.y - s2); ctx.lineTo(e.x + s2, e.y + s2);
      ctx.moveTo(e.x + s2, e.y - s2); ctx.lineTo(e.x - s2, e.y + s2);
      ctx.stroke();
    }
    return es;
  }
  let lx = 0, ly = 0;
  if (fx.look) {
    const ll = Math.hypot(fx.look.x, fx.look.y) || 1;
    lx = (fx.look.x / ll) * R * 0.12;
    ly = (fx.look.y / ll) * R * 0.12;
  }
  ctx.fillStyle = '#fbf7ef';
  for (const e of es) { ctx.beginPath(); ctx.arc(e.x, e.y, R * 0.20, 0, TAU); ctx.fill(); }
  for (const e of es) {
    ctx.fillStyle = e.iris;
    ctx.beginPath(); ctx.arc(e.x + lx, e.y + ly, R * 0.105, 0, TAU); ctx.fill();
  }
  // Pestañas: un par de trazos en la esquina exterior. Dos líneas que cambian
  // una cara por completo — es EL detalle femenino barato y legible.
  if (o.lashes) {
    ctx.strokeStyle = '#241d33';
    ctx.lineWidth = 1.1 * S;
    ctx.lineCap = 'round';
    for (const e of es) {
      ctx.beginPath();
      ctx.moveTo(e.x + fxx * R * 0.20, e.y + fyy * R * 0.20 + uy * R * 0.06);
      ctx.lineTo(e.x + fxx * R * 0.38, e.y + fyy * R * 0.38 + uy * R * 0.16);
      ctx.stroke();
    }
  }
  return es;
}

// Escoba base parametrizable: palo (recto o curvado) + anillos + punta +
// ramas por callback. Cada héroe define solo lo que lo distingue.
function broomBase(ctx, r, b, o) {
  const tip = b.tip(), tail = b.tail(), d = b.dir();
  const nx = -d.y, ny = d.x;
  const w = (o.w ?? 7) * S;
  const bx0 = tail.x + d.x * 14 * S, by0 = tail.y + d.y * 14 * S;
  const shaft = () => {
    ctx.beginPath();
    ctx.moveTo(bx0, by0);
    if (o.bend) {
      ctx.quadraticCurveTo(
        (bx0 + tip.x) / 2 + nx * o.bend * S, (by0 + tip.y) / 2 + ny * o.bend * S,
        tip.x, tip.y);
    } else ctx.lineTo(tip.x, tip.y);
  };
  ctx.lineCap = 'round';
  ctx.strokeStyle = r._ink;
  ctx.lineWidth = w + 3 * S;
  shaft(); ctx.stroke();
  const g = ctx.createLinearGradient(bx0, by0, tip.x, tip.y);
  g.addColorStop(0, o.woodDark);
  g.addColorStop(0.5, o.wood);
  g.addColorStop(1, o.woodLight ?? r._shade(o.wood, 24));
  ctx.strokeStyle = g;
  ctx.lineWidth = w;
  shaft(); ctx.stroke();
  if (o.rings) {
    ctx.strokeStyle = o.rings;
    ctx.lineWidth = w + 2 * S;
    for (const f of o.ringAt ?? [0.3, 0.56]) {
      const x = lerp(bx0, tip.x, f), y = lerp(by0, tip.y, f);
      ctx.beginPath();
      ctx.moveTo(x - d.x * 0.9 * S, y - d.y * 0.9 * S);
      ctx.lineTo(x + d.x * 0.9 * S, y + d.y * 0.9 * S);
      ctx.stroke();
    }
  }
  // Atadura de la cola
  const bxr = tail.x + d.x * 16 * S, byr = tail.y + d.y * 16 * S;
  ctx.strokeStyle = o.bind ?? '#5a3f22';
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(bxr - d.x * 3 * S, byr - d.y * 3 * S);
  ctx.lineTo(bxr + d.x * 3 * S, byr + d.y * 3 * S);
  ctx.stroke();
  o.bristles?.(ctx, bxr, byr, d, nx, ny);
  o.tip?.(ctx, tip, d, nx, ny);
}

// Puños genéricos sobre los agarres (con contorno y reflejo)
function fists(ctx, r, p, skin = CFG.colors.skin) {
  for (const [h, rad] of [[p.handF, 5.8], [p.handB, 5.2]]) {
    ctx.fillStyle = r._ink;
    ctx.beginPath(); ctx.arc(h.x, h.y, rad * S + 1.4 * S, 0, TAU); ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(h.x, h.y, rad * S, 0, TAU); ctx.fill();
    ctx.fillStyle = r._shade(skin, 26);
    ctx.beginPath(); ctx.arc(h.x - 1.4 * S, h.y - 1.6 * S, rad * 0.42 * S, 0, TAU); ctx.fill();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// VALKA — La Escudera (guerrera)
// Silueta: yelmo alado + trenza que flamea + escudo redondo a la espalda.
// El equipo vive en el tabardo, la cinta de la trenza y el emblema del escudo.
// ══════════════════════════════════════════════════════════════════════════
const VALKA = {
  id: 'valka', nombre: 'Valka', titulo: 'la Escudera', rol: 'Guerrera',
  bio: 'Escudera del valle del trueno. Vuela como quien carga: de frente y ' +
       'gritando. Su trenza ha tumbado más rivales que su escudo.',
  // Paletas de identidad. La alternativa se desbloquea con el desafío
  // "La Muralla" y se elige en la galería (player.paletteId).
  palettes: {
    base:     { STEEL: '#b9c2cf', STEEL_D: '#6b7686', LEATHER: '#5a4030', HAIR: '#c96f2f' },
    nocturna: { STEEL: '#5f6b80', STEEL_D: '#39414f', LEATHER: '#2f2a3a', HAIR: '#e8e2d0' },
  },
  draw(ctx, r, player, color, dark, world, fx) {
    const p = player.rider.points, b = player.broom, cape = player.rider.cape;
    const { STEEL, STEEL_D, LEATHER, HAIR } =
      this.palettes[player.paletteId] ?? this.palettes.base;

    // Trenza (usa la cadena física de la capa): cuerda que se afina, con
    // ataduras cruzadas y cinta del equipo en la punta. Flamea gratis porque
    // la mueve el mismo verlet que movía la capa del mago.
    ctx.lineCap = 'round';
    for (let i = 1; i < cape.length; i++) {
      const w0 = (9 - i * 1.1) * S;
      ctx.strokeStyle = r._ink;
      ctx.lineWidth = w0 + 2.6 * S;
      ctx.beginPath();
      ctx.moveTo(cape[i - 1].x, cape[i - 1].y);
      ctx.lineTo(cape[i].x, cape[i].y);
      ctx.stroke();
    }
    for (let i = 1; i < cape.length; i++) {
      const w0 = (9 - i * 1.1) * S;
      ctx.strokeStyle = i % 2 ? HAIR : r._shade(HAIR, -22);
      ctx.lineWidth = w0;
      ctx.beginPath();
      ctx.moveTo(cape[i - 1].x, cape[i - 1].y);
      ctx.lineTo(cape[i].x, cape[i].y);
      ctx.stroke();
    }
    const tipC = cape[cape.length - 1];
    ctx.fillStyle = color;   // cinta del equipo
    ctx.beginPath();
    ctx.arc(tipC.x, tipC.y, 3.4 * S, 0, TAU);
    ctx.fill();

    // Escudo redondo a la espalda (detrás de todo el cuerpo)
    const tA = axis(p.pelvis, p.chest);
    const backX = -tA.px * fx.facing, backY = -tA.py * fx.facing;
    const shX = p.chest.x + backX * 15 * S - tA.ux * 3 * S;
    const shY = p.chest.y + backY * 15 * S - tA.uy * 3 * S;
    ctx.fillStyle = r._ink;
    ctx.beginPath(); ctx.arc(shX, shY, 17.5 * S, 0, TAU); ctx.fill();
    const gs = ctx.createRadialGradient(shX - 4 * S, shY - 5 * S, 2 * S, shX, shY, 16 * S);
    gs.addColorStop(0, r._shade(STEEL, 28));
    gs.addColorStop(1, STEEL_D);
    ctx.fillStyle = gs;
    ctx.beginPath(); ctx.arc(shX, shY, 16 * S, 0, TAU); ctx.fill();
    ctx.strokeStyle = r._shade(STEEL_D, -24);
    ctx.lineWidth = 2.4 * S;
    ctx.beginPath(); ctx.arc(shX, shY, 12.5 * S, 0, TAU); ctx.stroke();
    // emblema del equipo + remaches
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(shX + 5 * S, shY); ctx.lineTo(shX, shY + 5 * S);
    ctx.lineTo(shX - 5 * S, shY); ctx.lineTo(shX, shY - 5 * S);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8e2d0';
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.arc(shX + Math.cos(a) * 12.5 * S, shY + Math.sin(a) * 12.5 * S, 1.4 * S, 0, TAU);
      ctx.fill();
    }

    // Miembros traseros (cuero oscuro)
    r._limb(ctx, p.pelvis, p.kneeB, p.footB, 9.5 * S, r._shade(LEATHER, -18));
    r._limbSeg(ctx, p.chest, p.handB, 8.5 * S, r._shade(LEATHER, -12));

    // Escoba-lanza: madera oscura, anillos de hierro, punta de lanza con
    // borla roja, cola atada corta (una guerrera no decora, asegura).
    broomBase(ctx, r, b, {
      wood: '#6b4a2b', woodDark: '#452e18', rings: '#8d99a6', w: 7.5,
      bristles: (c, x, y) => {
        c.strokeStyle = '#8a6a3a';
        c.lineWidth = 2.6 * S;
        for (let i = -2; i <= 2; i++) {
          const a = b.angle + Math.PI + i * 0.09;
          const len = (22 - Math.abs(i) * 2) * S;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
          c.stroke();
        }
      },
      tip: (c, tip, d, nx, ny) => {
        // hoja de lanza
        c.fillStyle = r._ink;
        c.beginPath();
        c.moveTo(tip.x + d.x * 13 * S, tip.y + d.y * 13 * S);
        c.lineTo(tip.x + nx * 4.6 * S, tip.y + ny * 4.6 * S);
        c.lineTo(tip.x - nx * 4.6 * S, tip.y - ny * 4.6 * S);
        c.closePath(); c.fill();
        c.fillStyle = STEEL;
        c.beginPath();
        c.moveTo(tip.x + d.x * 11.5 * S, tip.y + d.y * 11.5 * S);
        c.lineTo(tip.x + nx * 3.4 * S, tip.y + ny * 3.4 * S);
        c.lineTo(tip.x - nx * 3.4 * S, tip.y - ny * 3.4 * S);
        c.closePath(); c.fill();
        // borla
        c.strokeStyle = '#b03a30';
        c.lineWidth = 1.6 * S;
        for (let i = -1; i <= 1; i++) {
          c.beginPath();
          c.moveTo(tip.x, tip.y);
          c.lineTo(tip.x - d.x * 7 * S + nx * i * 3 * S + Math.sin(r.t * 8 + i) * S,
                   tip.y - d.y * 7 * S + ny * i * 3 * S);
          c.stroke();
        }
      },
    });

    // Pierna delantera + greba de acero sobre la pantorrilla
    r._limb(ctx, p.pelvis, p.kneeF, p.footF, 10.5 * S, LEATHER);
    ctx.strokeStyle = STEEL;
    ctx.lineWidth = 7 * S;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lerp(p.kneeF.x, p.footF.x, 0.15), lerp(p.kneeF.y, p.footF.y, 0.15));
    ctx.lineTo(lerp(p.kneeF.x, p.footF.x, 0.72), lerp(p.kneeF.y, p.footF.y, 0.72));
    ctx.stroke();

    // Coraza: torso más entallado que el del mago (cintura marcada), acero
    // con degradado, dos costillas de placa, tabardo del equipo colgando del
    // cinturón y hombrera redonda del lado del frente.
    {
      const A = axis(p.pelvis, p.chest);
      const HW_C = 11 * S, HW_H = 12.5 * S, HW_W = 8.5 * S; // pecho/cadera/cintura
      const at = (f, side, hw) => ({
        x: lerp(p.pelvis.x, p.chest.x, f) + A.px * hw * side,
        y: lerp(p.pelvis.y, p.chest.y, f) + A.py * hw * side,
      });
      const path = () => {
        const c1 = at(1, 1, HW_C), c2 = at(1, -1, HW_C);
        const w1 = at(0.42, -1, HW_W), h1 = at(0, -1, HW_H);
        const h2 = at(0, 1, HW_H), w2 = at(0.42, 1, HW_W);
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y);
        ctx.quadraticCurveTo(w1.x, w1.y, h1.x, h1.y);
        ctx.lineTo(h2.x, h2.y);
        ctx.quadraticCurveTo(w2.x, w2.y, c1.x, c1.y);
        ctx.closePath();
      };
      path();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 3.2 * S; ctx.lineJoin = 'round'; ctx.stroke();
      const g = ctx.createLinearGradient(
        p.chest.x + A.px * HW_C, p.chest.y + A.py * HW_C,
        p.chest.x - A.px * HW_C, p.chest.y - A.py * HW_C);
      g.addColorStop(0, r._shade(STEEL, 22));
      g.addColorStop(0.55, STEEL);
      g.addColorStop(1, STEEL_D);
      path(); ctx.fillStyle = g; ctx.fill();
      // costillas de la placa
      ctx.strokeStyle = STEEL_D;
      ctx.globalAlpha = 0.6; ctx.lineWidth = 1.4 * S;
      for (const f of [0.62, 0.8]) {
        const l1 = at(f, 0.8, HW_C), l2 = at(f, -0.8, HW_C);
        ctx.beginPath(); ctx.moveTo(l1.x, l1.y);
        ctx.quadraticCurveTo(
          lerp(p.pelvis.x, p.chest.x, f - 0.08), lerp(p.pelvis.y, p.chest.y, f - 0.08),
          l2.x, l2.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // tabardo del equipo (faldón que cae del cinturón)
      const b1 = at(0.34, 0.75, HW_W + 2 * S), b2 = at(0.34, -0.75, HW_W + 2 * S);
      const low = { x: p.pelvis.x - A.ux * 12 * S, y: p.pelvis.y - A.uy * 12 * S };
      ctx.beginPath();
      ctx.moveTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y);
      ctx.lineTo(low.x - A.px * 7 * S, low.y - A.py * 7 * S);
      ctx.lineTo(low.x + A.px * 7 * S, low.y + A.py * 7 * S);
      ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 2 * S; ctx.stroke();
      // franja clara del tabardo
      ctx.strokeStyle = r._shade(color, 55);
      ctx.lineWidth = 1.6 * S;
      ctx.beginPath();
      ctx.moveTo(lerp(b1.x, b2.x, 0.5), lerp(b1.y, b2.y, 0.5));
      ctx.lineTo(low.x, low.y);
      ctx.stroke();
      // cinturón + hebilla redonda
      const bl1 = at(0.36, 1, HW_W + 2.5 * S), bl2 = at(0.36, -1, HW_W + 2.5 * S);
      ctx.strokeStyle = r._ink; ctx.lineWidth = 6 * S;
      ctx.beginPath(); ctx.moveTo(bl1.x, bl1.y); ctx.lineTo(bl2.x, bl2.y); ctx.stroke();
      ctx.strokeStyle = '#3f2f20'; ctx.lineWidth = 4.4 * S;
      ctx.beginPath(); ctx.moveTo(bl1.x, bl1.y); ctx.lineTo(bl2.x, bl2.y); ctx.stroke();
      const bc = at(0.36, 0, 0);
      ctx.fillStyle = '#e8c25a';
      ctx.beginPath(); ctx.arc(bc.x, bc.y, 3.4 * S, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8a6c22';
      ctx.beginPath(); ctx.arc(bc.x, bc.y, 1.5 * S, 0, TAU); ctx.fill();
      // hombrera del frente: dos arcos apilados sobre el hombro
      const sf = at(0.97, 0, 0);
      const shoX = sf.x + A.px * fx.facing * 9 * S, shoY = sf.y + A.py * fx.facing * 9 * S;
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(shoX, shoY, 8.6 * S, 0, TAU); ctx.fill();
      ctx.fillStyle = r._shade(STEEL, 12);
      ctx.beginPath(); ctx.arc(shoX, shoY, 7.2 * S, 0, TAU); ctx.fill();
      ctx.strokeStyle = STEEL_D; ctx.lineWidth = 1.6 * S;
      ctx.beginPath(); ctx.arc(shoX, shoY, 4.6 * S, 0, TAU); ctx.stroke();
    }

    // Brazo delantero + brazalete
    r._limbSeg(ctx, p.chest, p.handF, 9 * S, LEATHER);
    ctx.strokeStyle = STEEL;
    ctx.lineWidth = 6.5 * S;
    ctx.beginPath();
    ctx.moveTo(lerp(p.chest.x, p.handF.x, 0.55), lerp(p.chest.y, p.handF.y, 0.55));
    ctx.lineTo(lerp(p.chest.x, p.handF.x, 0.86), lerp(p.chest.y, p.handF.y, 0.86));
    ctx.stroke();

    // Guanteletes de acero
    fists(ctx, r, p, STEEL);

    // Cabeza: cara femenina (mentón más fino), pintura de guerra del equipo,
    // pestañas, mechones de la trenza asomando y yelmo alado con nasal.
    {
      const head = p.head, chest = p.chest;
      const A = axis(chest, head);
      const R = 10.5 * S;
      const fxx = A.px * fx.facing, fyy = A.py * fx.facing;
      // contorno + cara (levemente elíptica: mentón fino)
      ctx.fillStyle = r._ink;
      ctx.save();
      ctx.translate(head.x, head.y);
      ctx.rotate(Math.atan2(A.uy, A.ux));
      ctx.beginPath(); ctx.ellipse(0, 0, (R + 1.5 * S) * 1.02, R + 1.5 * S, 0, 0, TAU); ctx.fill();
      const gf = ctx.createLinearGradient(R, 0, -R, 0);
      gf.addColorStop(0, r._shade(CFG.colors.skin, 20));
      gf.addColorStop(1, r._shade(CFG.colors.skin, -24));
      ctx.fillStyle = gf;
      ctx.beginPath(); ctx.ellipse(0, 0, R * 0.98, R, 0, 0, TAU); ctx.fill();
      ctx.restore();
      // mechones de pelo bajo el casco
      ctx.strokeStyle = HAIR;
      ctx.lineWidth = 2.6 * S;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(head.x - fxx * R * 0.7 + A.ux * R * 0.5, head.y - fyy * R * 0.7 + A.uy * R * 0.5);
      ctx.lineTo(head.x - fxx * R * 0.95 - A.ux * R * 0.35, head.y - fyy * R * 0.95 - A.uy * R * 0.35);
      ctx.stroke();
      // pintura de guerra: dos rayas del equipo en el pómulo
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.7 * S;
      for (const o2 of [0, 0.24]) {
        ctx.beginPath();
        ctx.moveTo(head.x + fxx * R * (0.45 + o2) - A.ux * R * 0.05,
                   head.y + fyy * R * (0.45 + o2) - A.uy * R * 0.05);
        ctx.lineTo(head.x + fxx * R * (0.62 + o2) - A.ux * R * 0.42,
                   head.y + fyy * R * (0.62 + o2) - A.uy * R * 0.42);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      eyes(ctx, r, head, A.ux, A.uy, fx, { R: 10.5, lashes: true });
      // boca: media sonrisa segura
      ctx.strokeStyle = '#a15a4a';
      ctx.lineWidth = 1.4 * S;
      ctx.beginPath();
      ctx.arc(head.x + fxx * R * 0.42 - A.ux * R * 0.34,
              head.y + fyy * R * 0.42 - A.uy * R * 0.34, R * 0.2,
              Math.atan2(fyy, fxx) - 0.5, Math.atan2(fyy, fxx) + 0.7);
      ctx.stroke();
      // yelmo: casquete + nasal + alas
      const domeA = Math.atan2(A.py, A.px);
      ctx.fillStyle = r._ink;
      ctx.beginPath();
      ctx.ellipse(head.x + A.ux * R * 0.55, head.y + A.uy * R * 0.55,
                  R * 1.12, R * 0.78, domeA, Math.PI, TAU);
      ctx.fill();
      const gh = ctx.createLinearGradient(
        head.x + A.px * R, head.y + A.py * R,
        head.x - A.px * R, head.y - A.py * R);
      gh.addColorStop(0, r._shade(STEEL, 26));
      gh.addColorStop(1, STEEL_D);
      ctx.fillStyle = gh;
      ctx.beginPath();
      ctx.ellipse(head.x + A.ux * R * 0.55, head.y + A.uy * R * 0.55,
                  R * 1.02, R * 0.68, domeA, Math.PI, TAU);
      ctx.fill();
      // nasal
      ctx.strokeStyle = STEEL_D;
      ctx.lineWidth = 2.2 * S;
      ctx.beginPath();
      ctx.moveTo(head.x + fxx * R * 0.62 + A.ux * R * 0.5,
                 head.y + fyy * R * 0.62 + A.uy * R * 0.5);
      ctx.lineTo(head.x + fxx * R * 0.68 + A.ux * R * 0.05,
                 head.y + fyy * R * 0.68 + A.uy * R * 0.05);
      ctx.stroke();
      // alas del yelmo (la del frente grande, la de atrás asoma)
      const wing = (side, sc) => {
        const wx = head.x + A.px * side * R * 0.95 + A.ux * R * 0.62;
        const wy = head.y + A.py * side * R * 0.95 + A.uy * R * 0.62;
        ctx.fillStyle = r._ink;
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.lineTo(wx + A.px * side * 7 * S * sc + A.ux * 10 * S * sc,
                   wy + A.py * side * 7 * S * sc + A.uy * 10 * S * sc);
        ctx.lineTo(wx + A.px * side * 2 * S * sc + A.ux * 4 * S * sc,
                   wy + A.py * side * 2 * S * sc + A.uy * 4 * S * sc);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e8e2d0';
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.lineTo(wx + A.px * side * 5.6 * S * sc + A.ux * 8.4 * S * sc,
                   wy + A.py * side * 5.6 * S * sc + A.uy * 8.4 * S * sc);
        ctx.lineTo(wx + A.px * side * 1.6 * S * sc + A.ux * 3.4 * S * sc,
                   wy + A.py * side * 1.6 * S * sc + A.uy * 3.4 * S * sc);
        ctx.closePath(); ctx.fill();
      };
      wing(-fx.facing, 0.8);
      wing(fx.facing, 1.1);
    }
  },
};

// ══════════════════════════════════════════════════════════════════════════
// MORDRAK — El Brujo del Pantano
// Silueta: capucha profunda sin cara (solo ojos brillantes), túnica harapienta
// de dobladillo dentado, báculo torcido con calavera. El equipo vive en el
// BRILLO: ojos, runas y frascos relucen del color del bando.
// ══════════════════════════════════════════════════════════════════════════
const MORDRAK = {
  id: 'mordrak', nombre: 'Mordrak', titulo: 'el Brujo del Pantano', rol: 'Brujo',
  bio: 'Nadie sabe qué guarda en los frascos y nadie quiere averiguarlo. Su ' +
       'escoba no fue tallada: una noche sin luna se talló sola.',
  // "Espectro": túnica pálida y amuletos oscuros — el negativo del brujo.
  // Se desbloquea con el desafío "Imparable".
  palettes: {
    base:     { ROBE: '#3b2b52', ROBE_D: '#241a38', BONE: '#cfc4a4' },
    espectro: { ROBE: '#8f8ca0', ROBE_D: '#5f5c72', BONE: '#2a2136' },
  },
  draw(ctx, r, player, color, dark, world, fx) {
    const p = player.rider.points, b = player.broom, cape = player.rider.cape;
    const { ROBE, ROBE_D, BONE } =
      this.palettes[player.paletteId] ?? this.palettes.base;
    const glow = color;   // el acento de equipo es el brillo

    // Capa harapienta: mismo verlet, pero el borde inferior alterna ancho
    // completo y medio ancho — dobladillo dentado, tela podrida.
    const capePath = () => {
      ctx.beginPath();
      ctx.moveTo(cape[0].x, cape[0].y);
      for (let i = 1; i < cape.length; i++) {
        const w = (13 - i * 1.4) * S * (i % 2 ? 1 : 0.45);
        ctx.lineTo(cape[i].x, cape[i].y + w);
      }
      for (let i = cape.length - 1; i >= 0; i--) {
        const w = (13 - i * 1.4) * S * (i % 2 ? 0.5 : 1);
        ctx.lineTo(cape[i].x, cape[i].y - w);
      }
      ctx.closePath();
    };
    capePath();
    ctx.strokeStyle = r._ink; ctx.lineWidth = 2.6 * S; ctx.lineJoin = 'round'; ctx.stroke();
    const gc = ctx.createLinearGradient(cape[0].x, cape[0].y,
      cape[cape.length - 1].x, cape[cape.length - 1].y);
    gc.addColorStop(0, ROBE);
    gc.addColorStop(1, r._shade(ROBE_D, -14));
    capePath();
    ctx.fillStyle = gc; ctx.globalAlpha = 0.96; ctx.fill(); ctx.globalAlpha = 1;

    // Miembros: esqueléticos (más finos que cualquier otro héroe)
    r._limb(ctx, p.pelvis, p.kneeB, p.footB, 6.5 * S, r._shade(ROBE_D, -8));
    r._limbSeg(ctx, p.chest, p.handB, 6 * S, ROBE_D);

    // Báculo torcido: curva, sin anillos, calavera de cuervo en la punta con
    // ojo brillante del equipo, y ramas raídas con un amuleto colgando.
    broomBase(ctx, r, b, {
      wood: '#4a4034', woodDark: '#2e2820', woodLight: '#5f5442', w: 6, bend: 9,
      bind: '#3a3028',
      bristles: (c, x, y, d, nx, ny) => {
        c.strokeStyle = '#4f4636';
        c.lineWidth = 2 * S;
        for (let i = -2; i <= 2; i++) {
          const wob = 1 + Math.sin(i * 3.1) * 0.35;
          const a = b.angle + Math.PI + i * 0.17 + Math.sin(r.t * 2 + i * 2) * 0.04;
          const len = (34 - Math.abs(i) * 3) * wob * S;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
          c.stroke();
        }
        // amuleto: un huesito colgando que se hamaca
        const sw = Math.sin(r.t * 3.2) * 0.5;
        const ax2 = x - d.x * 6 * S + nx * (10 * S + sw * 4 * S);
        const ay2 = y - d.y * 6 * S + ny * (10 * S + sw * 4 * S);
        c.strokeStyle = '#8a8070';
        c.lineWidth = 1 * S;
        c.beginPath(); c.moveTo(x - d.x * 6 * S, y - d.y * 6 * S); c.lineTo(ax2, ay2); c.stroke();
        c.fillStyle = BONE;
        c.beginPath(); c.arc(ax2, ay2, 2 * S, 0, TAU); c.fill();
        c.beginPath(); c.arc(ax2 + nx * 3 * S, ay2 + ny * 3 * S, 2 * S, 0, TAU); c.fill();
      },
      tip: (c, tip, d, nx, ny) => {
        // calavera de cuervo: cráneo + pico
        c.fillStyle = r._ink;
        c.beginPath(); c.arc(tip.x, tip.y, 5.6 * S, 0, TAU); c.fill();
        c.fillStyle = BONE;
        c.beginPath(); c.arc(tip.x, tip.y, 4.4 * S, 0, TAU); c.fill();
        c.beginPath();
        c.moveTo(tip.x + d.x * 3 * S + nx * 2 * S, tip.y + d.y * 3 * S + ny * 2 * S);
        c.lineTo(tip.x + d.x * 10 * S, tip.y + d.y * 10 * S);
        c.lineTo(tip.x + d.x * 3 * S - nx * 1.4 * S, tip.y + d.y * 3 * S - ny * 1.4 * S);
        c.closePath(); c.fill();
        // ojo brillante del equipo
        const pulse = 0.6 + 0.4 * Math.sin(r.t * 5);
        c.fillStyle = glow;
        c.shadowColor = glow;
        c.shadowBlur = 8 * pulse;
        c.beginPath();
        c.arc(tip.x + d.x * 1.2 * S - d.y * 1.2 * S,
              tip.y + d.y * 1.2 * S + d.x * 1.2 * S, 1.4 * S, 0, TAU);
        c.fill();
        c.shadowBlur = 0;
      },
    });

    r._limb(ctx, p.pelvis, p.kneeF, p.footF, 7 * S, ROBE_D);

    // Túnica: acampanada, con dobladillo dentado, cordón con frascos que
    // brillan y tres runas del equipo encendidas por el pecho.
    {
      const A = axis(p.pelvis, p.chest);
      const HW_C = 10 * S, HW_H = 18 * S;
      const at = (f, side, extra = 0) => ({
        x: lerp(p.pelvis.x, p.chest.x, f) + A.px * (lerp(HW_H, HW_C, f) + extra) * side,
        y: lerp(p.pelvis.y, p.chest.y, f) + A.py * (lerp(HW_H, HW_C, f) + extra) * side,
      });
      const path = () => {
        const c1 = at(1, 1), c2 = at(1, -1);
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y);
        ctx.lineTo(c2.x, c2.y);
        // bajada con dobladillo dentado (5 picos)
        const h1 = at(0, -1, 2 * S), h2 = at(0, 1, 2 * S);
        ctx.lineTo(h1.x, h1.y);
        for (let i = 1; i <= 5; i++) {
          const f = i / 5;
          const bxp = lerp(h1.x, h2.x, f), byp = lerp(h1.y, h2.y, f);
          const dip = (i % 2 ? 6 : 1.5) * S;
          ctx.lineTo(bxp - A.ux * dip, byp - A.uy * dip);
        }
        ctx.closePath();
      };
      path();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 3 * S; ctx.lineJoin = 'round'; ctx.stroke();
      const g = ctx.createLinearGradient(
        p.chest.x + A.px * HW_C, p.chest.y + A.py * HW_C,
        p.chest.x - A.px * HW_C, p.chest.y - A.py * HW_C);
      g.addColorStop(0, r._shade(ROBE, 16));
      g.addColorStop(0.55, ROBE);
      g.addColorStop(1, r._shade(ROBE_D, -10));
      path(); ctx.fillStyle = g; ctx.fill();
      // runas del equipo, encendidas y latiendo
      const pulse = 0.55 + 0.45 * Math.sin(r.t * 3.2);
      ctx.strokeStyle = glow;
      ctx.globalAlpha = 0.5 + pulse * 0.4;
      ctx.shadowColor = glow; ctx.shadowBlur = 7 * pulse;
      ctx.lineWidth = 1.5 * S;
      const runa = (f, kind) => {
        const cx2 = lerp(p.pelvis.x, p.chest.x, f), cy2 = lerp(p.pelvis.y, p.chest.y, f);
        ctx.beginPath();
        if (kind === 0) ctx.arc(cx2, cy2, 2.4 * S, 0, TAU);
        else if (kind === 1) {
          ctx.moveTo(cx2 - 2.4 * S, cy2 + 2 * S); ctx.lineTo(cx2, cy2 - 2.4 * S);
          ctx.lineTo(cx2 + 2.4 * S, cy2 + 2 * S); ctx.closePath();
        } else {
          ctx.moveTo(cx2 - 2.4 * S, cy2 - 2 * S); ctx.lineTo(cx2, cy2);
          ctx.lineTo(cx2 - 1 * S, cy2 + 1 * S); ctx.lineTo(cx2 + 2.4 * S, cy2 + 2.4 * S);
        }
        ctx.stroke();
      };
      runa(0.72, 0); runa(0.52, 1); runa(0.32, 2);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      // cordón + frascos colgantes con líquido brillante
      const b1 = at(0.3, 1, 1 * S), b2 = at(0.3, -1, 1 * S);
      ctx.strokeStyle = '#9a8f6e'; ctx.lineWidth = 1.8 * S;
      ctx.beginPath(); ctx.moveTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
      for (const side of [0.45, -0.5]) {
        const hx = lerp(b1.x, b2.x, 0.5 + side * 0.4), hy = lerp(b1.y, b2.y, 0.5 + side * 0.4);
        const vx = hx - A.ux * 5 * S, vy = hy - A.uy * 5 * S;
        ctx.strokeStyle = '#9a8f6e'; ctx.lineWidth = 0.9 * S;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(vx, vy); ctx.stroke();
        ctx.fillStyle = r._ink;
        ctx.fillRect(vx - 2.2 * S, vy - 0.6 * S, 4.4 * S, 6 * S);
        ctx.fillStyle = glow;
        ctx.globalAlpha = 0.5 + 0.4 * Math.sin(r.t * 4 + side * 9);
        ctx.fillRect(vx - 1.4 * S, vy + 1.2 * S, 2.8 * S, 3.4 * S);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#6a5f48';
        ctx.fillRect(vx - 1.2 * S, vy - 1.6 * S, 2.4 * S, 1.6 * S);
      }
    }

    r._limbSeg(ctx, p.chest, p.handF, 6.5 * S, ROBE);

    // Garras de hueso en vez de puños: tres trazos que salen de cada mano
    for (const [h, sc] of [[p.handF, 1], [p.handB, 0.85]]) {
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(h.x, h.y, 4.6 * S * sc, 0, TAU); ctx.fill();
      ctx.fillStyle = '#9aa08a';
      ctx.beginPath(); ctx.arc(h.x, h.y, 3.6 * S * sc, 0, TAU); ctx.fill();
      ctx.strokeStyle = BONE;
      ctx.lineWidth = 1.5 * S * sc;
      ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(h.x, h.y);
        ctx.lineTo(h.x + Math.cos(b.angle + i * 0.5) * 6.5 * S * sc,
                   h.y + Math.sin(b.angle + i * 0.5) * 6.5 * S * sc);
        ctx.stroke();
      }
    }

    // Capucha profunda: la cara es sombra, solo dos ojos del equipo. Collar
    // de dientes y plumas de cuervo en el hombro.
    {
      const head = p.head, chest = p.chest;
      const A = axis(chest, head);
      const R = 11 * S;
      const fxx = A.px * fx.facing, fyy = A.py * fx.facing;
      // hueco de la capucha: elipse casi negra
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(head.x, head.y, R + 1.4 * S, 0, TAU); ctx.fill();
      ctx.fillStyle = '#120d1e';
      ctx.beginPath(); ctx.arc(head.x, head.y, R, 0, TAU); ctx.fill();
      // ojos brillantes (cruces al aturdirse los apagan)
      if (fx.slam > 0.05) {
        eyes(ctx, r, head, A.ux, A.uy, fx, { R: 11 });
      } else {
        const pulse = 0.7 + 0.3 * Math.sin(r.t * 4.2);
        let lx = 0, ly = 0;
        if (fx.look) {
          const ll = Math.hypot(fx.look.x, fx.look.y) || 1;
          lx = (fx.look.x / ll) * R * 0.1; ly = (fx.look.y / ll) * R * 0.1;
        }
        ctx.fillStyle = glow;
        ctx.shadowColor = glow;
        ctx.shadowBlur = 9 * pulse;
        for (const sgn of [0.55, -0.55]) {
          ctx.beginPath();
          ctx.arc(head.x + fxx * R * 0.4 + A.ux * R * sgn * 0.5 + lx,
                  head.y + fyy * R * 0.4 + A.uy * R * sgn * 0.5 + ly,
                  1.7 * S, 0, TAU);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }
      // capucha: cubre la cabeza y cae en punta hacia atrás
      const hood = () => {
        const bL = { x: head.x + fxx * (R + 3 * S) - A.ux * R * 0.5,
                     y: head.y + fyy * (R + 3 * S) - A.uy * R * 0.5 };
        const top = { x: head.x + A.ux * (R + 5 * S), y: head.y + A.uy * (R + 5 * S) };
        const tipH = { x: head.x - fxx * (R + 12 * S) - A.ux * R * 0.1,
                       y: head.y - fyy * (R + 12 * S) - A.uy * R * 0.1 };
        const low = { x: head.x - fxx * R * 0.7 - A.ux * R * 0.75,
                      y: head.y - fyy * R * 0.7 - A.uy * R * 0.75 };
        ctx.beginPath();
        ctx.moveTo(bL.x, bL.y);
        ctx.quadraticCurveTo(top.x + fxx * R * 0.6, top.y + fyy * R * 0.6, top.x, top.y);
        ctx.quadraticCurveTo(tipH.x + A.ux * 6 * S, tipH.y + A.uy * 6 * S, tipH.x, tipH.y);
        ctx.quadraticCurveTo(low.x, low.y, bL.x, bL.y);
        ctx.closePath();
      };
      hood();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 2.8 * S; ctx.lineJoin = 'round'; ctx.stroke();
      const gh = ctx.createLinearGradient(
        head.x + A.ux * R, head.y + A.uy * R,
        head.x - A.ux * R, head.y - A.uy * R);
      gh.addColorStop(0, r._shade(ROBE, 14));
      gh.addColorStop(1, ROBE_D);
      hood(); ctx.fillStyle = gh; ctx.fill();
      // collar de dientes bajo el mentón
      ctx.fillStyle = BONE;
      for (let i = -1; i <= 1; i++) {
        const tx = head.x - A.ux * (R + 2 * S) + A.px * i * 4 * S + fxx * 2 * S;
        const ty = head.y - A.uy * (R + 2 * S) + A.py * i * 4 * S + fyy * 2 * S;
        ctx.beginPath();
        ctx.moveTo(tx - 1.4 * S, ty); ctx.lineTo(tx + 1.4 * S, ty);
        ctx.lineTo(tx, ty + 3.6 * S);
        ctx.closePath(); ctx.fill();
      }
      // plumas de cuervo en el hombro trasero
      ctx.fillStyle = '#1a1526';
      for (let i = 0; i < 3; i++) {
        const px2 = chest.x - fxx * (8 + i * 3) * S + A.ux * (4 - i) * S;
        const py2 = chest.y - fyy * (8 + i * 3) * S + A.uy * (4 - i) * S;
        ctx.beginPath();
        ctx.moveTo(px2, py2);
        ctx.lineTo(px2 - fxx * 6 * S - A.ux * 2 * S, py2 - fyy * 6 * S - A.uy * 2 * S);
        ctx.lineTo(px2 - fxx * 3 * S + A.ux * 3 * S, py2 - fyy * 3 * S + A.uy * 3 * S);
        ctx.closePath(); ctx.fill();
      }
    }
  },
};

// ══════════════════════════════════════════════════════════════════════════
// ÍZAR — El Mago Elemental
// Silueta: cresta de fuego animada + diadema de cristal + dos orbes (fuego e
// hielo) orbitando el torso. Mitad cálida, mitad fría; el equipo va en la faja.
// ══════════════════════════════════════════════════════════════════════════
const IZAR = {
  id: 'izar', nombre: 'Ízar', titulo: 'el Elemental', rol: 'Mago elemental',
  bio: 'Discute consigo mismo: la mano derecha quema y la izquierda congela. ' +
       'Cuando las dos se ponen de acuerdo, mejor mirar desde lejos.',
  // "Inverso": fuego y hielo intercambiados — la cresta arde en azul y la
  // cola de la escoba es de brasas. Se desbloquea con "Piromanía".
  palettes: {
    base:    { ROBE: '#4a3f6e', FIRE: '#ff8a3c', FIRE2: '#ffd76a', ICE: '#7fd8ff', ICE2: '#e8f8ff' },
    inverso: { ROBE: '#3f4a6e', FIRE: '#7fd8ff', FIRE2: '#e8f8ff', ICE: '#ff8a3c', ICE2: '#ffd76a' },
  },
  draw(ctx, r, player, color, dark, world, fx) {
    const p = player.rider.points, b = player.broom;
    const { ROBE, FIRE, FIRE2, ICE, ICE2 } =
      this.palettes[player.paletteId] ?? this.palettes.base;

    // Orbes elementales orbitando el pecho: el de atrás se dibuja antes del
    // cuerpo y el de adelante al final — profundidad real, no truco de alpha.
    const orbPos = (phase) => {
      const a = r.t * 1.8 + phase;
      return {
        x: p.chest.x + Math.cos(a) * 24 * S,
        y: p.chest.y + Math.sin(a) * 10 * S,
        front: Math.sin(a) > 0,
      };
    };
    const orbs = [
      { ...orbPos(0), col: FIRE, col2: FIRE2 },
      { ...orbPos(Math.PI), col: ICE, col2: ICE2 },
    ];
    const drawOrb = (o) => {
      ctx.fillStyle = o.col;
      ctx.shadowColor = o.col;
      ctx.shadowBlur = 9;
      ctx.beginPath(); ctx.arc(o.x, o.y, 3.6 * S, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = o.col2;
      ctx.beginPath(); ctx.arc(o.x - 0.8 * S, o.y - S, 1.4 * S, 0, TAU); ctx.fill();
    };
    for (const o of orbs) if (!o.front) drawOrb(o);

    // Estela elemental (la cadena de la capa): motas alternadas de brasa y
    // escarcha que se apagan hacia la punta. No hay tela: hay temperatura.
    const cape = player.rider.cape;
    for (let i = 1; i < cape.length; i++) {
      const hot = i % 2 === 0;
      const rad = (6.5 - i * 0.8) * S;
      if (rad <= 0.5) continue;
      ctx.globalAlpha = Math.max(0.05, 0.75 - i * 0.09);
      ctx.fillStyle = hot ? FIRE : ICE;
      ctx.shadowColor = hot ? FIRE : ICE;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(cape[i].x, cape[i].y + Math.sin(r.t * 6 + i) * 2 * S, rad, 0, TAU);
      ctx.fill();
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;

    r._limb(ctx, p.pelvis, p.kneeB, p.footB, 8.5 * S, r._shade(ROBE, -26));
    r._limbSeg(ctx, p.chest, p.handB, 7.5 * S, r._shade(ROBE, -18));

    // Escoba de obsidiana: punta de cristal facetado que arde con el impulso
    // y cola de carámbanos de hielo.
    broomBase(ctx, r, b, {
      wood: '#3a3450', woodDark: '#26223a', woodLight: '#575178', w: 6.5,
      bind: '#575178',
      bristles: (c, x, y, d, nx, ny) => {
        // carámbanos: triángulos rellenos, del más largo al más corto
        for (let i = -2; i <= 2; i++) {
          const a = b.angle + Math.PI + i * 0.16;
          const len = (26 - Math.abs(i) * 4) * S;
          const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
          c.fillStyle = i % 2 ? ICE : ICE2;
          c.globalAlpha = 0.9;
          c.beginPath();
          c.moveTo(x + nx * 2 * S, y + ny * 2 * S);
          c.lineTo(x - nx * 2 * S, y - ny * 2 * S);
          c.lineTo(ex, ey);
          c.closePath(); c.fill();
        }
        c.globalAlpha = 1;
      },
      tip: (c, tip, d, nx, ny) => {
        const heat = 0.3 + b.thrustPower * 0.5 + (b.boostPower || 0) * 0.6;
        // cristal facetado: dos triángulos espejados
        c.fillStyle = r._ink;
        c.beginPath();
        c.moveTo(tip.x - d.x * 2 * S + nx * 4.4 * S, tip.y - d.y * 2 * S + ny * 4.4 * S);
        c.lineTo(tip.x + d.x * 9 * S, tip.y + d.y * 9 * S);
        c.lineTo(tip.x - d.x * 2 * S - nx * 4.4 * S, tip.y - d.y * 2 * S - ny * 4.4 * S);
        c.lineTo(tip.x - d.x * 6 * S, tip.y - d.y * 6 * S);
        c.closePath(); c.fill();
        c.fillStyle = FIRE;
        c.shadowColor = FIRE;
        c.shadowBlur = 14 * heat;
        c.globalAlpha = Math.min(1, 0.55 + heat * 0.5);
        c.beginPath();
        c.moveTo(tip.x - d.x * 1.4 * S + nx * 3.2 * S, tip.y - d.y * 1.4 * S + ny * 3.2 * S);
        c.lineTo(tip.x + d.x * 7.4 * S, tip.y + d.y * 7.4 * S);
        c.lineTo(tip.x - d.x * 1.4 * S - nx * 3.2 * S, tip.y - d.y * 1.4 * S - ny * 3.2 * S);
        c.lineTo(tip.x - d.x * 4.6 * S, tip.y - d.y * 4.6 * S);
        c.closePath(); c.fill();
        c.shadowBlur = 0; c.globalAlpha = 1;
        c.strokeStyle = FIRE2;
        c.lineWidth = 0.9 * S;
        c.beginPath();
        c.moveTo(tip.x - d.x * 4.6 * S, tip.y - d.y * 4.6 * S);
        c.lineTo(tip.x + d.x * 7.4 * S, tip.y + d.y * 7.4 * S);
        c.stroke();
      },
    });

    r._limb(ctx, p.pelvis, p.kneeF, p.footF, 9 * S, r._shade(ROBE, -12));

    // Túnica mitad y mitad: base violeta con un velo térmico encima — cálido
    // hacia el frente, frío hacia atrás — más faja del equipo y glifos.
    {
      const A = axis(p.pelvis, p.chest);
      const HW_C = 10.5 * S, HW_H = 15.5 * S;
      const at = (f, side, extra = 0) => ({
        x: lerp(p.pelvis.x, p.chest.x, f) + A.px * (lerp(HW_H, HW_C, f) + extra) * side,
        y: lerp(p.pelvis.y, p.chest.y, f) + A.py * (lerp(HW_H, HW_C, f) + extra) * side,
      });
      const path = () => {
        const c1 = at(1, 1), c2 = at(1, -1), h1 = at(0, -1, 2 * S), h2 = at(0, 1, 2 * S);
        const mid = { x: lerp(h1.x, h2.x, 0.5) - A.ux * 3 * S,
                      y: lerp(h1.y, h2.y, 0.5) - A.uy * 3 * S };
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(h1.x, h1.y);
        ctx.quadraticCurveTo(mid.x, mid.y, h2.x, h2.y);
        ctx.closePath();
      };
      path();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 3.2 * S; ctx.lineJoin = 'round'; ctx.stroke();
      const gb = ctx.createLinearGradient(
        p.chest.x + A.px * HW_C, p.chest.y + A.py * HW_C,
        p.chest.x - A.px * HW_C, p.chest.y - A.py * HW_C);
      gb.addColorStop(0, r._shade(ROBE, 22));
      gb.addColorStop(1, r._shade(ROBE, -30));
      path(); ctx.fillStyle = gb; ctx.fill();
      // velo térmico: cálido en la mitad del frente, frío en la de atrás
      const gt = ctx.createLinearGradient(
        p.chest.x + A.px * fx.facing * HW_C, p.chest.y + A.py * fx.facing * HW_C,
        p.chest.x - A.px * fx.facing * HW_C, p.chest.y - A.py * fx.facing * HW_C);
      gt.addColorStop(0, FIRE);
      gt.addColorStop(0.5, 'rgba(90,70,140,0)');
      gt.addColorStop(1, ICE);
      path();
      ctx.fillStyle = gt;
      ctx.globalAlpha = 0.30;
      ctx.fill();
      ctx.globalAlpha = 1;
      // faja del equipo, en diagonal hombro→cadera
      const s1 = at(0.92, fx.facing * 0.7), s2 = at(0.18, -fx.facing * 0.85);
      ctx.strokeStyle = r._ink; ctx.lineWidth = 6.2 * S;
      ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 4.6 * S;
      ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
      ctx.strokeStyle = r._shade(color, 50); ctx.lineWidth = 1.2 * S;
      ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
      // glifos gemelos: llama y copo a cada lado del pecho
      const gl = (side, col, kind) => {
        const gx = lerp(p.pelvis.x, p.chest.x, 0.66) + A.px * side * 6 * S;
        const gy = lerp(p.pelvis.y, p.chest.y, 0.66) + A.py * side * 6 * S;
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.2 * S;
        ctx.beginPath();
        if (kind === 'fuego') {
          ctx.moveTo(gx - 1.6 * S, gy + 2 * S);
          ctx.quadraticCurveTo(gx - 2 * S, gy - 1.5 * S, gx, gy - 2.6 * S);
          ctx.quadraticCurveTo(gx + 2 * S, gy - 1, gx + 1.6 * S, gy + 2 * S);
        } else {
          for (let i = 0; i < 3; i++) {
            const a = i * Math.PI / 3;
            ctx.moveTo(gx - Math.cos(a) * 2.6 * S, gy - Math.sin(a) * 2.6 * S);
            ctx.lineTo(gx + Math.cos(a) * 2.6 * S, gy + Math.sin(a) * 2.6 * S);
          }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      gl(fx.facing, FIRE2, 'fuego');
      gl(-fx.facing, ICE2, 'copo');
    }

    r._limbSeg(ctx, p.chest, p.handF, 8 * S, ROBE);

    // Manos con aura: la delantera arde, la trasera escarcha
    fists(ctx, r, p);
    {
      const flick = Math.sin(r.t * 11);
      ctx.fillStyle = FIRE;
      ctx.globalAlpha = 0.5 + 0.25 * flick;
      ctx.shadowColor = FIRE; ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.handF.x + flick * S, p.handF.y - 6 * S - Math.abs(flick) * 2 * S, 2.6 * S, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = ICE2;
      ctx.lineWidth = 1.1 * S;
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i - 1) * 0.7 + Math.sin(r.t * 3) * 0.1;
        ctx.beginPath();
        ctx.moveTo(p.handB.x, p.handB.y);
        ctx.lineTo(p.handB.x + Math.cos(a) * 6.5 * S, p.handB.y + Math.sin(a) * 6.5 * S);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Cabeza: cráneo con tatuajes rúnicos, diadema de cristales y CRESTA DE
    // FUEGO animada. Heterocromía: un ojo de fuego, otro de hielo.
    {
      const head = p.head, chest = p.chest;
      const A = axis(chest, head);
      const R = 11 * S;
      const fxx = A.px * fx.facing, fyy = A.py * fx.facing;
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(head.x, head.y, R + 1.5 * S, 0, TAU); ctx.fill();
      const gf = ctx.createLinearGradient(
        head.x + A.ux * R, head.y + A.uy * R,
        head.x - A.ux * R, head.y - A.uy * R);
      gf.addColorStop(0, r._shade(CFG.colors.skin, 14));
      gf.addColorStop(1, r._shade(CFG.colors.skin, -26));
      ctx.fillStyle = gf;
      ctx.beginPath(); ctx.arc(head.x, head.y, R, 0, TAU); ctx.fill();
      // tatuajes rúnicos: dos arcos finos sobre la sien trasera
      ctx.strokeStyle = r._shade(ROBE, 30);
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1 * S;
      for (const o2 of [0.35, 0.55]) {
        ctx.beginPath();
        ctx.arc(head.x - fxx * R * o2, head.y - fyy * R * o2, R * 0.5,
                Math.atan2(A.uy, A.ux) - 0.9, Math.atan2(A.uy, A.ux) + 0.9);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // heterocromía
      eyes(ctx, r, head, A.ux, A.uy, fx, { R: 11, irisA: '#ff7a2c', irisB: '#3fb9e6' });
      // perilla corta
      ctx.fillStyle = '#3a2f4a';
      ctx.beginPath();
      ctx.arc(head.x - A.ux * R * 0.95 + fxx * R * 0.28,
              head.y - A.uy * R * 0.95 + fyy * R * 0.28, R * 0.24, 0, TAU);
      ctx.fill();
      // diadema de cristales sobre la frente
      for (let i = -1; i <= 1; i++) {
        const dx2 = head.x + A.ux * R * 0.72 + A.px * i * 5 * S;
        const dy2 = head.y + A.uy * R * 0.72 + A.py * i * 5 * S;
        const h2 = (i === 0 ? 4.6 : 3.2) * S;
        ctx.fillStyle = r._ink;
        ctx.beginPath();
        ctx.moveTo(dx2 - 1.8 * S, dy2); ctx.lineTo(dx2, dy2 - h2);
        ctx.lineTo(dx2 + 1.8 * S, dy2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = i === 0 ? color : ICE;   // el central marca el equipo
        ctx.beginPath();
        ctx.moveTo(dx2 - 1.2 * S, dy2 - 0.6 * S); ctx.lineTo(dx2, dy2 - h2 + 0.8 * S);
        ctx.lineTo(dx2 + 1.2 * S, dy2 - 0.6 * S); ctx.closePath(); ctx.fill();
      }
      // cresta de fuego: lenguas que flamean con el tiempo y crecen al acelerar
      const heat = 1 + b.thrustPower * 0.6 + (b.boostPower || 0) * 0.8;
      for (let i = -1; i <= 2; i++) {
        const base = 0.35 - i * 0.28;
        const bx2 = head.x + A.ux * R * 0.95 - fxx * R * base * 0.9;
        const by2 = head.y + A.uy * R * 0.95 - fyy * R * base * 0.9;
        const fl = Math.sin(r.t * 9 + i * 1.7);
        const hgt = (8 + (2 - Math.abs(i)) * 3.5) * heat * (0.8 + 0.2 * fl) * S;
        const lean = -fxx * (2.5 + fl * 1.5) * S;
        const grd = ctx.createLinearGradient(bx2, by2, bx2 + A.ux * hgt, by2 + A.uy * hgt);
        grd.addColorStop(0, FIRE);
        grd.addColorStop(1, FIRE2);
        ctx.fillStyle = grd;
        ctx.shadowColor = FIRE; ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(bx2 - A.px * 2.4 * S, by2 - A.py * 2.4 * S);
        ctx.quadraticCurveTo(
          bx2 + A.ux * hgt * 0.6 + lean, by2 + A.uy * hgt * 0.6,
          bx2 + A.ux * hgt + lean * 1.6, by2 + A.uy * hgt);
        ctx.quadraticCurveTo(
          bx2 + A.ux * hgt * 0.5 + lean * 0.4, by2 + A.uy * hgt * 0.5,
          bx2 + A.px * 2.4 * S, by2 + A.py * 2.4 * S);
        ctx.closePath();
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    for (const o of orbs) if (o.front) drawOrb(o);
  },
};

// ══════════════════════════════════════════════════════════════════════════
// ZEFIR — El Vientoveloz (ágil)
// Silueta: bufanda bífida del equipo + pelo en punta barrido por el viento +
// alitas en los tobillos que aletean con la velocidad. Todo en él dice "rápido".
// ══════════════════════════════════════════════════════════════════════════
const ZEFIR = {
  id: 'zefir', nombre: 'Zefir', titulo: 'el Vientoveloz', rol: 'Ágil',
  bio: 'Correo del reino: una vez entregó una carta antes de que la ' +
       'escribieran. Odia frenar — frenar es admitir que el viento ganó.',
  // "Escarlata": el uniforme del correo urgente. Desafío "Cazador".
  palettes: {
    base:      { VEST: '#2f6157', PANTS: '#c8a878', WRAP: '#e8e0cc', BRASS: '#d8a848' },
    escarlata: { VEST: '#7a2f38', PANTS: '#4a4358', WRAP: '#e8e0cc', BRASS: '#e8c25a' },
  },
  draw(ctx, r, player, color, dark, world, fx) {
    const p = player.rider.points, b = player.broom, cape = player.rider.cape;
    const { VEST, PANTS, WRAP, BRASS } =
      this.palettes[player.paletteId] ?? this.palettes.base;
    const spd = Math.hypot(b.vel.x, b.vel.y);

    // Bufanda bífida del equipo: dos cintas sobre la misma cadena física,
    // una entera y otra más corta y oscura — al flamear se separan y se ve
    // el "tenedor" clásico de bufanda de aviador.
    ctx.lineCap = 'round';
    const ribbon = (n, off, col, wMul) => {
      for (let i = 1; i < n; i++) {
        const w = (7.5 - i * 0.9) * S * wMul;
        if (w <= 0.4) continue;
        const fl = Math.sin(r.t * 9 + i * 1.3 + off) * i * 0.7 * S;
        ctx.strokeStyle = r._ink;
        ctx.lineWidth = w + 2.2 * S;
        ctx.beginPath();
        ctx.moveTo(cape[i - 1].x, cape[i - 1].y + off * S + fl * 0.5);
        ctx.lineTo(cape[i].x, cape[i].y + off * S + fl);
        ctx.stroke();
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(cape[i - 1].x, cape[i - 1].y + off * S + fl * 0.5);
        ctx.lineTo(cape[i].x, cape[i].y + off * S + fl);
        ctx.stroke();
      }
    };
    ribbon(cape.length, 2.5, color, 1);
    ribbon(Math.max(3, cape.length - 2), -3, r._shade(color, -32), 0.8);

    // Miembros traseros, finos
    r._limb(ctx, p.pelvis, p.kneeB, p.footB, 7.5 * S, r._shade(PANTS, -34));
    r._limbSeg(ctx, p.chest, p.handB, 6.5 * S, r._shade(VEST, -18));

    // Escoba de carrera: palo fino, nariz oscura, aro de velocidad, timón
    // del equipo en la cola y ramas cortas bien atadas (aerodinámica).
    broomBase(ctx, r, b, {
      wood: '#a8763e', woodDark: '#6b4423', w: 5,
      bind: '#4a3a26',
      bristles: (c, x, y, d, nx, ny) => {
        c.strokeStyle = '#7d5a30';
        c.lineWidth = 2.2 * S;
        for (let i = -1; i <= 1; i++) {
          const a = b.angle + Math.PI + i * 0.07;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + Math.cos(a) * (20 - Math.abs(i) * 2) * S,
                   y + Math.sin(a) * (20 - Math.abs(i) * 2) * S);
          c.stroke();
        }
        // timón: aleta triangular del equipo sobre la cola
        c.fillStyle = r._ink;
        c.beginPath();
        c.moveTo(x + d.x * 2 * S, y + d.y * 2 * S);
        c.lineTo(x - d.x * 6 * S - nx * 11 * S, y - d.y * 6 * S - ny * 11 * S);
        c.lineTo(x - d.x * 9 * S, y - d.y * 9 * S);
        c.closePath(); c.fill();
        c.fillStyle = color;
        c.beginPath();
        c.moveTo(x + d.x * 1 * S, y + d.y * 1 * S);
        c.lineTo(x - d.x * 5.4 * S - nx * 8.8 * S, y - d.y * 5.4 * S - ny * 8.8 * S);
        c.lineTo(x - d.x * 7.8 * S, y - d.y * 7.8 * S);
        c.closePath(); c.fill();
      },
      tip: (c, tip, d, nx, ny) => {
        // nariz cónica oscura
        c.fillStyle = '#3a2c1a';
        c.beginPath();
        c.moveTo(tip.x + d.x * 8 * S, tip.y + d.y * 8 * S);
        c.lineTo(tip.x + nx * 2.8 * S, tip.y + ny * 2.8 * S);
        c.lineTo(tip.x - nx * 2.8 * S, tip.y - ny * 2.8 * S);
        c.closePath(); c.fill();
        // aro de velocidad: se enciende con la rapidez real
        const k = clamp(spd / 900, 0, 1);
        if (k > 0.1) {
          c.strokeStyle = '#bfe9ff';
          c.globalAlpha = k * 0.8;
          c.lineWidth = 1.6 * S;
          c.beginPath();
          c.ellipse(tip.x - d.x * 4 * S, tip.y - d.y * 4 * S, 3 * S, 6.5 * S,
                    Math.atan2(d.y, d.x), 0, TAU);
          c.stroke();
          c.globalAlpha = 1;
        }
      },
    });

    // Pierna delantera + vendas en la pantorrilla
    r._limb(ctx, p.pelvis, p.kneeF, p.footF, 8.5 * S, PANTS);
    ctx.strokeStyle = WRAP;
    ctx.lineWidth = 1.6 * S;
    for (const f of [0.3, 0.48, 0.66]) {
      ctx.beginPath();
      ctx.moveTo(lerp(p.kneeF.x, p.footF.x, f) - 3.5 * S, lerp(p.kneeF.y, p.footF.y, f) - S);
      ctx.lineTo(lerp(p.kneeF.x, p.footF.x, f) + 3.5 * S, lerp(p.kneeF.y, p.footF.y, f) + S);
      ctx.stroke();
    }

    // Chaleco entallado con cierre, cuello alto y cinturón de mensajero con
    // dos bolsitas. La silueta más flaca del plantel: todo en él es liviano.
    {
      const A = axis(p.pelvis, p.chest);
      const HW_C = 9.5 * S, HW_H = 11.5 * S, HW_W = 7.5 * S;
      const at = (f, side, hw) => ({
        x: lerp(p.pelvis.x, p.chest.x, f) + A.px * hw * side,
        y: lerp(p.pelvis.y, p.chest.y, f) + A.py * hw * side,
      });
      const path = () => {
        const c1 = at(1, 1, HW_C), c2 = at(1, -1, HW_C);
        const w1 = at(0.45, -1, HW_W), h1 = at(0, -1, HW_H);
        const h2 = at(0, 1, HW_H), w2 = at(0.45, 1, HW_W);
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y);
        ctx.quadraticCurveTo(w1.x, w1.y, h1.x, h1.y);
        ctx.lineTo(h2.x, h2.y);
        ctx.quadraticCurveTo(w2.x, w2.y, c1.x, c1.y);
        ctx.closePath();
      };
      path();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 3 * S; ctx.lineJoin = 'round'; ctx.stroke();
      const g = ctx.createLinearGradient(
        p.chest.x + A.px * HW_C, p.chest.y + A.py * HW_C,
        p.chest.x - A.px * HW_C, p.chest.y - A.py * HW_C);
      g.addColorStop(0, r._shade(VEST, 24));
      g.addColorStop(0.5, VEST);
      g.addColorStop(1, r._shade(VEST, -34));
      path(); ctx.fillStyle = g; ctx.fill();
      // cierre + cuello
      ctx.strokeStyle = r._shade(VEST, 46);
      ctx.lineWidth = 1.1 * S;
      ctx.beginPath();
      ctx.moveTo(lerp(p.pelvis.x, p.chest.x, 0.1), lerp(p.pelvis.y, p.chest.y, 0.1));
      ctx.lineTo(lerp(p.pelvis.x, p.chest.x, 0.95), lerp(p.pelvis.y, p.chest.y, 0.95));
      ctx.stroke();
      const n1 = at(0.98, 0.6, HW_C), n2 = at(0.98, -0.6, HW_C);
      ctx.strokeStyle = r._shade(VEST, -20); ctx.lineWidth = 3.4 * S;
      ctx.beginPath(); ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.stroke();
      // cinturón + bolsitas
      const bl1 = at(0.3, 1, HW_W + 2 * S), bl2 = at(0.3, -1, HW_W + 2 * S);
      ctx.strokeStyle = '#4a3a26'; ctx.lineWidth = 3.6 * S;
      ctx.beginPath(); ctx.moveTo(bl1.x, bl1.y); ctx.lineTo(bl2.x, bl2.y); ctx.stroke();
      for (const sd of [0.55, -0.45]) {
        const hx = lerp(bl1.x, bl2.x, 0.5 + sd * 0.4), hy = lerp(bl1.y, bl2.y, 0.5 + sd * 0.4);
        ctx.fillStyle = r._ink;
        ctx.fillRect(hx - 2.6 * S, hy, 5.2 * S, 5.6 * S);
        ctx.fillStyle = '#6b5334';
        ctx.fillRect(hx - 2 * S, hy + 0.6 * S, 4 * S, 4.4 * S);
        ctx.fillStyle = BRASS;
        ctx.fillRect(hx - 0.7 * S, hy + 2 * S, 1.4 * S, 1.4 * S);
      }
    }

    // Brazo delantero + vendas del antebrazo
    r._limbSeg(ctx, p.chest, p.handF, 7 * S, VEST);
    ctx.strokeStyle = WRAP;
    ctx.lineWidth = 1.5 * S;
    for (const f of [0.6, 0.78]) {
      ctx.beginPath();
      ctx.moveTo(lerp(p.chest.x, p.handF.x, f) - 3 * S, lerp(p.chest.y, p.handF.y, f) - S);
      ctx.lineTo(lerp(p.chest.x, p.handF.x, f) + 3 * S, lerp(p.chest.y, p.handF.y, f) + S);
      ctx.stroke();
    }

    // Guantes sin dedos: puño + banda clara
    fists(ctx, r, p, '#caa27a');
    ctx.strokeStyle = WRAP;
    ctx.lineWidth = 1.6 * S;
    for (const h of [p.handF, p.handB]) {
      ctx.beginPath(); ctx.arc(h.x, h.y, 4.6 * S, -0.6, 0.9); ctx.stroke();
    }

    // Alitas en los tobillos: aletean más rápido cuanto más rápido vuela
    const flap = Math.sin(r.t * (6 + clamp(spd * 0.02, 0, 14)));
    for (const [foot, sc] of [[p.footF, 1], [p.footB, 0.8]]) {
      const wr = (5.5 + flap * 1.6) * sc * S;
      ctx.fillStyle = r._ink;
      ctx.beginPath();
      ctx.moveTo(foot.x, foot.y - 2 * S * sc);
      ctx.lineTo(foot.x - wr * 1.6, foot.y - wr - 2 * S * sc);
      ctx.lineTo(foot.x - wr * 0.5, foot.y - 1 * S * sc);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f2ecdd';
      ctx.beginPath();
      ctx.moveTo(foot.x, foot.y - 2.4 * S * sc);
      ctx.lineTo(foot.x - wr * 1.35, foot.y - wr * 0.9 - 2.4 * S * sc);
      ctx.lineTo(foot.x - wr * 0.45, foot.y - 1.6 * S * sc);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = color;     // puntas de pluma del equipo
      ctx.lineWidth = 1.1 * S;
      ctx.beginPath();
      ctx.moveTo(foot.x - wr * 1.35, foot.y - wr * 0.9 - 2.4 * S * sc);
      ctx.lineTo(foot.x - wr * 0.9, foot.y - wr * 0.5 - 2 * S * sc);
      ctx.stroke();
    }

    // Cabeza: pelo en punta barrido por el rumbo, antiparras en la frente,
    // sonrisa enorme y una cicatriz chiquita — cara de nunca haber frenado.
    {
      const head = p.head, chest = p.chest;
      const A = axis(chest, head);
      const R = 10.5 * S;
      const fxx = A.px * fx.facing, fyy = A.py * fx.facing;
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(head.x, head.y, R + 1.4 * S, 0, TAU); ctx.fill();
      const gf = ctx.createLinearGradient(
        head.x + A.ux * R, head.y + A.uy * R,
        head.x - A.ux * R, head.y - A.uy * R);
      gf.addColorStop(0, r._shade('#caa27a', 20));
      gf.addColorStop(1, r._shade('#caa27a', -22));
      ctx.fillStyle = gf;
      ctx.beginPath(); ctx.arc(head.x, head.y, R, 0, TAU); ctx.fill();
      // pelo: puntas barridas EN CONTRA del rumbo (reactivo a la velocidad)
      let wx = -fxx, wy = -fyy;
      if (fx.look && spd > 60) {
        const ll = Math.hypot(fx.look.x, fx.look.y) || 1;
        wx = -fx.look.x / ll; wy = -fx.look.y / ll;
      }
      const HAIRC = '#6b4a2f';
      for (let i = -1; i <= 2; i++) {
        const base = 0.55 - i * 0.35;
        const hx2 = head.x + A.ux * R * 0.85 + fxx * R * base * 0.55;
        const hy2 = head.y + A.uy * R * 0.85 + fyy * R * base * 0.55;
        const len = (7 + (2 - Math.abs(i - 0.5)) * 3) * S;
        ctx.fillStyle = i % 2 ? HAIRC : r._shade(HAIRC, -16);
        ctx.beginPath();
        ctx.moveTo(hx2 - A.px * 2.2 * S, hy2 - A.py * 2.2 * S);
        ctx.lineTo(hx2 + A.ux * len * 0.5 + wx * len, hy2 + A.uy * len * 0.5 + wy * len);
        ctx.lineTo(hx2 + A.px * 2.2 * S, hy2 + A.py * 2.2 * S);
        ctx.closePath(); ctx.fill();
      }
      // antiparras en la frente: correa + dos lentes
      ctx.strokeStyle = '#2a2136';
      ctx.lineWidth = 2.6 * S;
      ctx.beginPath();
      ctx.arc(head.x, head.y, R * 0.98,
              Math.atan2(A.uy, A.ux) - 1.25, Math.atan2(A.uy, A.ux) + 1.25);
      ctx.stroke();
      for (const sgn of [0.45, -0.45]) {
        const gx = head.x + A.ux * R * 0.78 + A.px * sgn * R * 0.55;
        const gy = head.y + A.uy * R * 0.78 + A.py * sgn * R * 0.55;
        ctx.fillStyle = r._ink;
        ctx.beginPath(); ctx.arc(gx, gy, 3.4 * S, 0, TAU); ctx.fill();
        ctx.fillStyle = BRASS;
        ctx.beginPath(); ctx.arc(gx, gy, 2.8 * S, 0, TAU); ctx.fill();
        ctx.fillStyle = '#9fd8e8';
        ctx.beginPath(); ctx.arc(gx, gy, 1.8 * S, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e8f8ff';
        ctx.beginPath(); ctx.arc(gx - 0.6 * S, gy - 0.6 * S, 0.7 * S, 0, TAU); ctx.fill();
      }
      eyes(ctx, r, head, A.ux, A.uy, fx, { R: 10.5 });
      // sonrisa enorme
      ctx.strokeStyle = '#7a4a3a';
      ctx.lineWidth = 1.5 * S;
      ctx.beginPath();
      ctx.arc(head.x + fxx * R * 0.34 - A.ux * R * 0.3,
              head.y + fyy * R * 0.34 - A.uy * R * 0.3, R * 0.34,
              Math.atan2(fyy, fxx) - 0.9, Math.atan2(fyy, fxx) + 1.0);
      ctx.stroke();
      // cicatriz en el pómulo trasero
      ctx.strokeStyle = r._shade('#caa27a', -40);
      ctx.lineWidth = 1 * S;
      ctx.beginPath();
      ctx.moveTo(head.x - fxx * R * 0.5, head.y - fyy * R * 0.5 - A.uy * R * 0.1);
      ctx.lineTo(head.x - fxx * R * 0.62, head.y - fyy * R * 0.62 - A.uy * R * 0.34);
      ctx.stroke();
    }
  },
};

// ══════════════════════════════════════════════════════════════════════════
// ESTELAS — la firma de cada personaje en el aire
// ══════════════════════════════════════════════════════════════════════════
// Cada uno deja un rastro propio al volar, y al usar el turbo lo exagera.
// La identidad no puede ser solo el color: si las cuatro estelas son las
// mismas chispas pintadas distinto, de lejos son todas iguales. Por eso
// cambia también la FÍSICA — qué pesa y qué flota, qué vive mucho y qué
// parpadea, qué sale derecho y qué gira.
//
//   trail(particles, x, y, dirX, dirY, power, boost, color)
//     x,y        cola de la escoba
//     dirX,dirY  hacia dónde apunta (la estela sale al revés)
//     power      0..1 propulsión/velocidad
//     boost      0..1 turbo
//     color      color del EQUIPO — un toque, para no perder de qué lado juega
//
// Nota de rendimiento: el tope de partículas es 600 y ya lo consume el
// partido entero (4 jugadores + pelota + orbes). Por eso cada estela emite
// con probabilidad, no a chorro: el gasto por jugador queda acotado.
const rnd = (a, b) => a + Math.random() * (b - a);

// ── Aldus, el Errante — chispa mágica clásica ─────────────────────────────
// El de siempre: la estela con la que nació el juego. Dorado y celeste, sin
// personalidad marcada a propósito — es el punto de comparación contra el
// que se leen las otras cuatro.
function trailMago(particles, x, y, dirX, dirY, power, boost, color) {
  particles.magicTrail(x, y, dirX, dirY, power, boost, color);
}

// ── Valka, la Escudera — chispas de acero ─────────────────────────────────
// No hace magia: hace FUERZA. Deja el chisperío de un yunque — partículas
// que salen en abanico corto, caen rápido y se apagan enseguida, como el
// metal al rojo saltando del golpe. Con turbo, la fricción se enciende.
function trailValka(particles, x, y, dirX, dirY, power, boost, color) {
  if (Math.random() > 0.26 + power * 0.6) return;
  const px = -dirY, py = dirX;
  const s = rnd(60, 200) * (0.5 + power);
  const n = 1 + (Math.random() < boost ? 1 : 0);

  for (let i = 0; i < n; i++) {
    const side = Math.random() < 0.5 ? 1 : -1;
    particles.spawn(
      x + rnd(-4, 4), y + rnd(-4, 4),
      -dirX * s + px * side * rnd(20, 90) * (1 + boost),
      -dirY * s + py * side * rnd(20, 90) * (1 + boost),
      rnd(0.16, 0.34),                       // chispa de yunque: vida corta
      rnd(1.8, 3.6) + boost * 1.6,           // finita y dura
      Math.random() < 0.4 ? '#fff1c4'        // acero al blanco
        : Math.random() < 0.6 ? '#ffb347'    // al rojo
          : '#b9c2cf',                       // esquirla fría (su acero)
      rnd(260, 520),                          // pesa: cae como viruta
    );
  }
  // Destello de equipo ocasional: mantiene legible el bando
  if (Math.random() < 0.10 + boost * 0.18) {
    particles.spawn(x, y, -dirX * s * 0.7, -dirY * s * 0.7,
      rnd(0.2, 0.4), rnd(2.5, 4.5) + boost * 2, color, 120);
  }
}

// ── Mordrak, el Brujo del Pantano — humo de ciénaga ───────────────────────
// La estela más oscura y sucia del plantel. Volutas moradas casi negras que
// PESAN: se hunden en vez de subir, viven mucho y se quedan colgadas como
// niebla de pantano. De lejos parece que arrastra su propia noche.
function trailMordrak(particles, x, y, dirX, dirY, power, boost, color) {
  // Emite menos seguido que el resto a propósito: sus volutas viven el doble
  // (~1.2 s), así que a igual ritmo acumulaba el triple de partículas. Con 4
  // Mordrak a fondo llegaba a 497 de las 600 del tope, y el estallido del gol
  // ya no entraba — se recortaba solo. Menos densidad de emisión, misma
  // presencia en pantalla porque cada voluta dura mucho.
  if (Math.random() > 0.20 + power * 0.40) return;
  const px = -dirY, py = dirX;
  // Serpenteo lento: el humo no sale derecho, ondula al alejarse
  const ph = performance.now() / 1000 * 4.5;
  const wob = Math.sin(ph) * (10 + boost * 22);
  const s = rnd(25, 95) * (0.5 + power);

  for (const side of [1, -1]) {
    if (side < 0 && Math.random() < 0.4) return;   // el par no siempre cierra
    particles.spawn(
      x + px * side * rnd(1, 8), y + py * side * rnd(1, 8),
      -dirX * s + px * side * wob + rnd(-18, 18),
      -dirY * s + py * side * wob + rnd(-18, 18),
      rnd(0.45, 0.85) + boost * 0.3,         // se queda: niebla, no chispa
      rnd(6, 12) + boost * 5,                // volutas gordas
      Math.random() < 0.45 ? '#241a38'       // su túnica, casi negro
        : Math.random() < 0.6 ? '#3b2b52'    // morado de ciénaga
          : '#6b4a8a',                       // realce apenas visible
      rnd(50, 140),                          // se HUNDE: humo pesado
    );
  }
  // Brasa de brujería: el brillo del equipo, que en él ES el acento
  if (Math.random() < 0.16 + boost * 0.22) {
    particles.spawn(x + rnd(-3, 3), y + rnd(-3, 3),
      -dirX * s * 1.4, -dirY * s * 1.4,
      rnd(0.25, 0.5), rnd(2, 4) + boost * 2, color, -20);
  }
}

// ── Ízar, el Elemental — fuego e hielo a la vez ───────────────────────────
// Su gracia es la dualidad: la mano derecha quema y la izquierda congela.
// La estela emite las DOS a la vez, cada una con física opuesta — las ascuas
// suben y se apagan, los cristales caen y se quedan. El resultado es una
// estela que se abre en dos capas, cálida arriba y fría abajo.
function trailIzar(particles, x, y, dirX, dirY, power, boost, color) {
  if (Math.random() > 0.32 + power * 0.68) return;
  const px = -dirY, py = dirX;
  const s = rnd(45, 165) * (0.5 + power);
  // Alterna lado: el fuego sale por una mano y el hielo por la otra
  const side = Math.random() < 0.5 ? 1 : -1;

  if (side > 0) {
    // FUEGO: sube, se apaga rápido, amarillo→naranja
    particles.spawn(
      x + px * rnd(2, 9), y + py * rnd(2, 9),
      -dirX * s + rnd(-30, 30), -dirY * s + rnd(-30, 30) - rnd(20, 70),
      rnd(0.3, 0.62), rnd(3.5, 7.5) + boost * 3.5,
      Math.random() < 0.4 ? '#ffd76a' : (Math.random() < 0.6 ? '#ff8a3c' : '#ff5a1f'),
      rnd(-190, -80),                        // ascua: SUBE
    );
  } else {
    // HIELO: cae despacio, dura más, celeste→blanco
    particles.spawn(
      x - px * rnd(2, 9), y - py * rnd(2, 9),
      -dirX * s * 0.75 + rnd(-22, 22), -dirY * s * 0.75 + rnd(-22, 22),
      rnd(0.5, 0.95) + boost * 0.3, rnd(2.5, 5) + boost * 2.5,
      Math.random() < 0.45 ? '#e8f8ff' : (Math.random() < 0.6 ? '#7fd8ff' : '#4aa8d8'),
      rnd(70, 200),                          // cristal: CAE
    );
  }
  // Con turbo los dos elementos chocan: chispa blanca en el medio
  if (boost > 0.4 && Math.random() < boost * 0.3) {
    particles.spawn(x, y, rnd(-90, 90), rnd(-90, 90),
      rnd(0.12, 0.28), rnd(3, 6), '#ffffff', 0);
  }
}

// ── Zefir, el Vientoveloz — corrientes de aire ────────────────────────────
// El más liviano: todo SUBE y se abre. Dos hebras que giran en espiral (el
// ángulo avanza parejo con el tiempo, no al azar) y se cruzan formando el
// remolino. Casi no ensucia el aire: se va enseguida hacia arriba, que es
// justo lo que uno espera de alguien que odia frenar.
function trailZefir(particles, x, y, dirX, dirY, power, boost, color) {
  if (Math.random() > 0.34 + power * 0.66) return;
  const px = -dirY, py = dirX;
  const spin = performance.now() / 1000 * 12;
  const s = rnd(70, 230) * (0.5 + power);

  for (const side of [1, -1]) {
    const swirl = Math.sin(spin + (side > 0 ? 0 : Math.PI)) * (20 + boost * 42);
    particles.spawn(
      x + px * side * rnd(3, 13), y + py * side * rnd(3, 13),
      -dirX * s + px * swirl + rnd(-16, 16),
      -dirY * s + py * swirl + rnd(-16, 16),
      rnd(0.26, 0.55) + boost * 0.22,        // se disipa rápido: es aire
      rnd(2.2, 4.8) + boost * 2.8,
      Math.random() < 0.4 ? '#e8e0cc'        // sus vendas
        : Math.random() < 0.6 ? '#7ee8a2'    // verde de velocidad
          : '#d8fff0',
      rnd(-230, -110),                       // SUBE fuerte: viento
    );
  }
  // Con turbo suelta plumas del color del equipo (sus alitas de tobillo)
  if (boost > 0.35 && Math.random() < boost * 0.25) {
    particles.spawn(x + rnd(-8, 8), y + rnd(-8, 8),
      -dirX * s * 0.5 + rnd(-40, 40), -dirY * s * 0.5 + rnd(-40, 40),
      rnd(0.35, 0.7), rnd(3, 6), color, rnd(-150, -60));
  }
}

// Tabla id → estela. La usa main.js; si un personaje no está acá, cae en la
// mágica clásica, así sumar un skin nuevo nunca rompe el partido.
export const TRAILS = {
  mago:    trailMago,
  valka:   trailValka,
  mordrak: trailMordrak,
  izar:    trailIzar,
  zefir:   trailZefir,
};

// Emite la estela del personaje indicado (o la clásica si no tiene una).
export function emitTrail(id, particles, x, y, dirX, dirY, power, boost, color) {
  (TRAILS[id] || trailMago)(particles, x, y, dirX, dirY, power, boost, color);
}

export const CHARACTERS = {
  valka: VALKA,
  mordrak: MORDRAK,
  izar: IZAR,
  zefir: ZEFIR,
};

// Plantel completo para la galería (el mago clásico se dibuja en render.js,
// por eso va como builtin sin función propia).
export const ROSTER = [
  {
    id: 'mago', nombre: 'Aldus', titulo: 'el Errante', rol: 'Mago clásico',
    bio: 'El primero en subirse a una escoba y el último en bajarse. ' +
         'Equilibrado en todo, brillante en nada — salvo en ganar.',
    builtin: true,
  },
  VALKA, MORDRAK, IZAR, ZEFIR,
];
