// Skin VECTORIAL: personajes hechos de formas de color, no de PNGs.
//
// Un skin vectorial es una lista ordenada de CAPAS. Cada capa es una forma
// (cápsula, óvalo, caja, triángulo…) anclada a un hueso del ragdoll o a la
// escoba, con los mismos ajustes que las piezas PNG (grosor, largo, offset,
// rotación, espejo) más estilo propio: relleno, degradado, borde, contorno,
// transparencia y tinte de equipo. Como la geometría reutiliza pieceGeometry
// de skin.js, el editor vectorial hereda gratis el hit-test y las manijas del
// editor PNG — y la alineación con el ragdoll es exactamente la misma.
import { CFG } from './config.js';
import { Storage } from './storage/storage.js';

import {
  BONES, boneThickness, BROOM_SPANS,
  pieceGeometry, broomPieceGeometry,
} from './skin.js';

const TAU = Math.PI * 2;
const INK = 'rgba(16,12,28,0.92)';

export const VSKIN_KEY = 'escoba.vskin.v1';
export const VSKIN_ON_KEY = 'escoba.vskin.on';

// Huesos que una capa puede habitar. Los del cuerpo salen de BONES (ragdoll);
// 'palo' y 'cepillo' anclan sobre el eje de la escoba.
export const VBONES = [
  { id: 'cabeza',    label: 'Cabeza' },
  { id: 'torso',     label: 'Torso' },
  { id: 'brazoF',    label: 'Brazo delantero' },
  { id: 'brazoB',    label: 'Brazo trasero' },
  { id: 'piernaF',   label: 'Muslo delantero' },
  { id: 'pantorriF', label: 'Pierna delantera' },
  { id: 'piernaB',   label: 'Muslo trasero' },
  { id: 'pantorriB', label: 'Pierna trasera' },
  { id: 'capa',      label: 'Capa (pecho→pelvis)' },
  { id: 'palo',      label: 'Escoba: palo' },
  { id: 'cepillo',   label: 'Escoba: cepillo' },
];

// Formas disponibles. Cada una se dibuja en el rectángulo local de la pieza:
// x de 0 a L (a lo largo del hueso), y de -T/2 a T/2.
export const VSHAPES = [
  { id: 'capsula',  label: 'Cápsula' },
  { id: 'ovalo',    label: 'Óvalo' },
  { id: 'caja',     label: 'Caja' },
  { id: 'triangulo', label: 'Triángulo' },
  { id: 'rombo',    label: 'Rombo' },
  { id: 'estrella', label: 'Estrella' },
  { id: 'anillo',   label: 'Anillo' },
  { id: 'linea',    label: 'Línea' },
  { id: 'luna',     label: 'Luna' },
];

let _id = 0;
export function defaultLayer(bone = 'torso', shape = 'capsula') {
  return {
    id: 'L' + (++_id) + '_' + Date.now().toString(36),
    name: shape,
    bone, shape,
    tune: { scale: 0.6, lengthMul: 1, offX: 0, offY: 0, rot: 0, flip: false, visible: true },
    style: {
      fill: '#8a90a0',
      fill2: null,       // segundo color → degradado a lo largo de la forma
      stroke: null,      // color del borde fino (null = sin borde)
      strokeW: 2,        // grosor del borde, en unidades
      alpha: 1,
      outline: true,     // contorno de tinta grueso (el look del juego)
      tint: 'none',      // 'none' | 'main' | 'dark' → pinta con el color del equipo
    },
  };
}

// Sombra simple de un color hex (copiada de render._shade para no acoplar)
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const cl = (v) => Math.max(0, Math.min(255, v));
  const r = cl(((n >> 16) & 255) + amt);
  const g = cl(((n >> 8) & 255) + amt);
  const b = cl((n & 255) + amt);
  return `rgb(${r},${g},${b})`;
}

// Geometría de una capa en mundo (para hit-test y manijas del editor).
// Delegar en skin.js garantiza que coincida 1:1 con el transform de dibujo.
export function layerGeometry(layer, points, broom, S = 1, facing = 1) {
  const tune = { ...layer.tune, thickness: undefined };
  if (BROOM_SPANS[layer.bone]) {
    return broom ? broomPieceGeometry(layer.bone, broom, tune, S, facing) : null;
  }
  return pieceGeometry(layer.bone, points, tune, S, facing);
}

// Traza el path de la forma en el rect local [0..L] × [-T/2..T/2].
function shapePath(ctx, shape, L, T) {
  const hw = L / 2, hh = T / 2;
  ctx.beginPath();
  switch (shape) {
    case 'capsula': {
      const rr = Math.min(hh, hw);
      ctx.roundRect(0, -hh, L, T, rr);
      break;
    }
    case 'ovalo':
      ctx.ellipse(hw, 0, hw, hh, 0, 0, TAU);
      break;
    case 'caja':
      ctx.rect(0, -hh, L, T);
      break;
    case 'triangulo':
      ctx.moveTo(0, -hh); ctx.lineTo(0, hh); ctx.lineTo(L, 0);
      ctx.closePath();
      break;
    case 'rombo':
      ctx.moveTo(0, 0); ctx.lineTo(hw, -hh); ctx.lineTo(L, 0); ctx.lineTo(hw, hh);
      ctx.closePath();
      break;
    case 'estrella': {
      const R = Math.min(hw, hh), rIn = R * 0.45;
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const rr = i % 2 ? rIn : R;
        const x = hw + Math.cos(a) * rr, y = Math.sin(a) * rr;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case 'anillo':
      ctx.ellipse(hw, 0, Math.max(1, hw - T * 0.15), Math.max(1, hh - T * 0.15), 0, 0, TAU);
      break;
    case 'linea':
      ctx.moveTo(0, 0); ctx.lineTo(L, 0);
      break;
    case 'luna': {
      const R = Math.min(hw, hh);
      ctx.arc(hw, 0, R, Math.PI * 0.5, Math.PI * 1.5, false);
      ctx.arc(hw - R * 0.5, 0, R * 0.75, Math.PI * 1.35, Math.PI * 0.65, true);
      ctx.closePath();
      break;
    }
  }
}

// Dibuja UNA capa. `team` = { main, dark } para el tinte de equipo.
export function drawVLayer(ctx, layer, points, broom, S = 1, team = null, facing = 1) {
  const t = layer.tune, st = layer.style;
  if (t.visible === false) return;

  // ── Frame local: idéntico al de drawPiece (skin.js) ─────────────────────
  let ax, ay, ang, L, T;
  const span = BROOM_SPANS[layer.bone];
  if (span) {
    if (!broom) return;
    const d = broom.dir(), tail = broom.tail();
    const start = (span.start + (t.offX ?? 0)) * S;
    ax = tail.x + d.x * start;
    ay = tail.y + d.y * start;
    const rot = ((t.rot ?? 0) * Math.PI) / 180;
    ang = Math.atan2(d.y, d.x) + (facing < 0 ? -rot : rot);
    L = span.len * (t.lengthMul ?? 1) * S;
    T = span.thickness * (t.scale ?? 1) * S;
  } else {
    const bone = BONES[layer.bone];
    if (!bone) return;
    const a = points[bone.from], b = points[bone.to];
    if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    const blen = Math.hypot(dx, dy) || 1;
    const rot = ((t.rot ?? 0) * Math.PI) / 180;
    ang = Math.atan2(dy, dx) + (facing < 0 ? -rot : rot);
    ax = a.x; ay = a.y;
    L = blen * (t.lengthMul ?? 1);
    T = boneThickness(layer.bone) * (t.scale ?? 1) * S;
  }

  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(ang);
  if (facing < 0) ctx.scale(1, -1);
  if (t.flip) ctx.scale(1, -1);
  if (!span) ctx.translate((t.offX ?? 0) * S, (t.offY ?? 0) * S);
  else ctx.translate(0, (t.offY ?? 0) * S);
  // len negativo (cepillo): dibujar espejado hacia atrás
  if (L < 0) { ctx.scale(-1, 1); L = -L; }

  ctx.globalAlpha = st.alpha ?? 1;

  // Colores: el tinte de equipo pisa al relleno propio
  let fill = st.fill;
  let fill2 = st.fill2;
  if (team && st.tint === 'main') { fill = team.main; fill2 = fill2 ? shade(team.main, -40) : null; }
  else if (team && st.tint === 'dark') { fill = team.dark; fill2 = fill2 ? shade(team.dark, -30) : null; }

  const isStrokeShape = layer.shape === 'linea' || layer.shape === 'anillo';

  // 1) Contorno de tinta (el look del juego): un trazo grueso por debajo
  if (st.outline) {
    shapePath(ctx, layer.shape, L, T);
    ctx.strokeStyle = INK;
    ctx.lineWidth = (isStrokeShape ? (st.strokeW ?? 2) + 3 : 3.2) * S;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  // 2) Cuerpo de la forma
  shapePath(ctx, layer.shape, L, T);
  if (isStrokeShape) {
    // 'linea' usa el grosor de la pieza como ancho; 'anillo' usa el borde.
    ctx.strokeStyle = fill;
    ctx.lineWidth = layer.shape === 'linea' ? Math.max(1, T) : (st.strokeW ?? 2) * S;
    ctx.lineCap = 'round';
    ctx.stroke();
  } else {
    if (fill2) {
      const g = ctx.createLinearGradient(0, 0, L, 0);
      g.addColorStop(0, fill);
      g.addColorStop(1, fill2);
      ctx.fillStyle = g;
    } else ctx.fillStyle = fill;
    ctx.fill();
    // 3) Borde fino opcional
    if (st.stroke) {
      ctx.strokeStyle = st.stroke;
      ctx.lineWidth = (st.strokeW ?? 2) * S * 0.6;
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

export function drawVSkin(ctx, vs, points, broom, S = 1, team = null, facing = 1) {
  if (!vs?.layers?.length) return;
  for (const layer of vs.layers) drawVLayer(ctx, layer, points, broom, S, team, facing);
}

// ── Persistencia ──────────────────────────────────────────────────────────
export function saveVSkin(vs) {
  try {
    Storage.set(VSKIN_KEY, JSON.stringify(vs));
    return true;
  } catch { return false; }
}

export function loadVSkin() {
  try {
    const raw = Storage.get(VSKIN_KEY);
    if (!raw) return null;
    const vs = JSON.parse(raw);
    if (!vs || vs.kind !== 'vskin' || !Array.isArray(vs.layers)) return null;
    return vs;
  } catch { return null; }
}

export function clearVSkin() {
  try { Storage.remove(VSKIN_KEY); } catch { /* nada */ }
}

export function vskinEnabled() {
  try { return Storage.get(VSKIN_ON_KEY) === '1'; } catch { return false; }
}

export function setVSkinEnabled(on) {
  try { Storage.set(VSKIN_ON_KEY, on ? '1' : '0'); } catch { /* nada */ }
}
