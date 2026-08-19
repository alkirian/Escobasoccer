// Editor VECTORIAL de personajes: armás un héroe con formas de color pegadas
// a los huesos del ragdoll real. Sin PNGs: todo es vector, como los
// personajes del plantel. Lo que ves acá es literalmente lo que dibuja el
// juego — comparten drawVSkin() de vecskin.js.
import { CFG, FIXED_DT } from './config.js';
import { clamp } from './utils.js';
import { Broom } from './broom.js';
import { Rider } from './rider.js';
import { hitPiece } from './skin.js';
import {
  VBONES, VSHAPES, defaultLayer, layerGeometry, drawVSkin,
  saveVSkin, loadVSkin, clearVSkin, vskinEnabled, setVSkinEnabled,
} from './vecskin.js';

const S = CFG.charScale;

// ── Escenario: una escoba y su jinete, como el editor PNG ─────────────────
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const broom = new Broom(0, 0, 0);
const rider = new Rider(broom);

const POSES = [
  { id: 'idle',  label: 'Flotando' },
  { id: 'vuelo', label: 'En vuelo' },
  { id: 'giro',  label: 'Giro/golpe' },
  { id: 'libre', label: 'Manual' },
];
let pose = 'idle';
let poseT = 0;
let manualAngle = 0;

// ── Estado del documento ──────────────────────────────────────────────────
let vs = { kind: 'vskin', name: 'Mi héroe', broom: true, layers: [] };
let selId = null;
let showBones = true;
let showGeo = true;
let teamOrange = false;

const sel = () => vs.layers.find((l) => l.id === selId) ?? null;
const team = () => teamOrange
  ? { main: CFG.colors.p2, dark: CFG.colors.p2Dark }
  : { main: CFG.colors.p1, dark: CFG.colors.p1Dark };

// ── Historia (deshacer/rehacer) ───────────────────────────────────────────
// Fotos completas del documento. Baratas (JSON chico) y a prueba de todo:
// no hay operación que pueda dejar el historial inconsistente.
const hist = { stack: [], i: -1 };
function snapshot() {
  hist.stack.length = hist.i + 1;
  hist.stack.push(JSON.stringify({ vs, selId }));
  if (hist.stack.length > 80) hist.stack.shift();
  hist.i = hist.stack.length - 1;
}
function restore(json) {
  const st = JSON.parse(json);
  vs = st.vs;
  selId = st.selId;
  rebuildAll();
}
function undo() { if (hist.i > 0) { hist.i--; restore(hist.stack[hist.i]); toast('Deshecho'); } }
function redo() { if (hist.i < hist.stack.length - 1) { hist.i++; restore(hist.stack[hist.i]); toast('Rehecho'); } }

// ── Guion de poses (copiado del editor PNG: misma prueba de fuego) ────────
function drivePose(dt) {
  poseT += dt;
  switch (pose) {
    case 'idle':
      broom.pos.x = Math.cos(poseT * 1.1) * 8;
      broom.pos.y = Math.sin(poseT * 1.6) * 10;
      broom.angle = Math.sin(poseT * 0.9) * 0.12;
      break;
    case 'vuelo': {
      const a = Math.sin(poseT * 1.4) * 0.55;
      broom.angle = a;
      broom.pos.x = Math.cos(poseT * 1.4) * 34;
      broom.pos.y = Math.sin(poseT * 2.1) * 22;
      broom.vel.x = -Math.sin(poseT * 1.4) * 620;
      broom.vel.y = Math.cos(poseT * 2.1) * 260;
      break;
    }
    case 'giro':
      broom.angle += dt * 7.5;
      broom.angVel = 7.5;
      broom.pos.x = Math.cos(poseT * 2) * 16;
      broom.pos.y = Math.sin(poseT * 2) * 12;
      break;
    case 'libre':
      broom.angle = manualAngle;
      broom.pos.x = 0; broom.pos.y = 0;
      break;
  }
}

// ── Manipulación directa (mover/rotar/largo/grosor) ───────────────────────
const drag = {
  mode: null, id: null,
  startMouse: { x: 0, y: 0 }, startTune: null,
  angle: 0, pivot: { x: 0, y: 0 }, center: { x: 0, y: 0 },
  dist: 1, thick0: 1,
};
const HANDLE_R = 7;

function facingNow() { return rider.freezeFlip ?? rider.flipSide ?? 1; }
function zoomNow() { return Number(el.zoom?.value || 1.6); }

function currentGeo() {
  const l = sel();
  if (!l) return null;
  return layerGeometry(l, rider.points, broom, S, facingNow());
}

function handlesFor(geo) {
  if (!geo) return null;
  const z = zoomNow();
  const cs = Math.cos(geo.angle), sn = Math.sin(geo.angle);
  const local = (lx, ly) => ({
    x: geo.center.x + lx * cs - ly * sn,
    y: geo.center.y + lx * sn + ly * cs,
  });
  return {
    move:   { x: geo.center.x, y: geo.center.y },
    rotate: local(0, -geo.h / 2 - 22 / z),
    length: local(geo.w / 2, 0),
    thick:  local(0, -geo.h / 2),
  };
}

function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const z = zoomNow();
  return { x: (clientX - rect.left - w / 2) / z, y: (clientY - rect.top - h / 2) / z };
}

function nearHandle(h, mouse) {
  return Math.hypot(mouse.x - h.x, mouse.y - h.y) <= (HANDLE_R + 4) / zoomNow();
}

function pointerDown(e) {
  const mouse = screenToWorld(e.clientX, e.clientY);
  const geo = currentGeo();
  const hs = geo ? handlesFor(geo) : null;

  let mode = null;
  if (hs) {
    if (nearHandle(hs.rotate, mouse)) mode = 'rotate';
    else if (nearHandle(hs.length, mouse)) mode = 'length';
    else if (nearHandle(hs.thick, mouse)) mode = 'thick';
    else if (hitPiece(geo, mouse.x, mouse.y)) mode = 'move';
  }
  // Sin manija: ¿clickeó otra capa? Se busca de adelante hacia atrás.
  if (!mode) {
    for (let i = vs.layers.length - 1; i >= 0; i--) {
      const l = vs.layers[i];
      if (l.tune.visible === false) continue;
      const g = layerGeometry(l, rider.points, broom, S, facingNow());
      if (g && hitPiece(g, mouse.x, mouse.y)) {
        selId = l.id;
        rebuildLayers(); rebuildProps();
        mode = 'move';
        break;
      }
    }
    if (!mode) return;
  }

  const l = sel();
  if (!l) return;
  const geo2 = currentGeo();
  drag.mode = mode;
  drag.id = l.id;
  drag.startMouse = mouse;
  drag.startTune = { ...l.tune };
  drag.angle = geo2.angle;
  drag.pivot = geo2.pivot;
  drag.center = geo2.center;
  drag.dist = Math.hypot(mouse.x - geo2.pivot.x, mouse.y - geo2.pivot.y) || 1;
  drag.thick0 = geo2.h || 1;
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function pointerMove(e) {
  const mouse = screenToWorld(e.clientX, e.clientY);
  if (!drag.mode) {
    canvas.style.cursor = hoverCursor(currentGeo(), mouse);
    return;
  }
  const l = sel();
  if (!l || l.id !== drag.id) return;
  const t = l.tune;
  const dx = mouse.x - drag.startMouse.x, dy = mouse.y - drag.startMouse.y;
  const c = Math.cos(drag.angle), s = Math.sin(drag.angle);

  if (drag.mode === 'move') {
    const along = dx * c + dy * s;
    const perp  = -dx * s + dy * c;
    t.offX = (drag.startTune.offX ?? 0) + along / S;
    t.offY = (drag.startTune.offY ?? 0) + perp / S;
  } else if (drag.mode === 'rotate') {
    const a0 = Math.atan2(drag.startMouse.y - drag.center.y, drag.startMouse.x - drag.center.x);
    const a1 = Math.atan2(mouse.y - drag.center.y, mouse.x - drag.center.x);
    t.rot = (drag.startTune.rot ?? 0) + ((a1 - a0) * 180) / Math.PI;
  } else if (drag.mode === 'length') {
    const d = Math.hypot(mouse.x - drag.pivot.x, mouse.y - drag.pivot.y) || 1;
    const f = clamp(d / drag.dist, 0.05, 4);
    t.lengthMul = clamp((drag.startTune.lengthMul ?? 1) * f, 0.05, 3);
  } else if (drag.mode === 'thick') {
    const perp = -dx * s + dy * c;
    const half0 = drag.thick0 / 2;
    const half1 = clamp(half0 - perp, half0 * 0.1, half0 * 4);
    t.scale = clamp((drag.startTune.scale ?? 1) * (half1 / half0), 0.05, 4);
  }
  rebuildProps();
}

function pointerUp(e) {
  if (drag.mode) {
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* nada */ }
    snapshot();
  }
  drag.mode = null; drag.id = null;
}

function hoverCursor(geo, mouse) {
  if (!geo) return 'default';
  const hs = handlesFor(geo);
  if (nearHandle(hs.rotate, mouse)) return 'grab';
  if (nearHandle(hs.length, mouse)) return 'ew-resize';
  if (nearHandle(hs.thick, mouse))  return 'ns-resize';
  if (hitPiece(geo, mouse.x, mouse.y)) return 'move';
  return 'default';
}

function drawManipulator() {
  const geo = currentGeo();
  if (!geo) return;
  const hs = handlesFor(geo);
  const z = zoomNow();
  ctx.save();
  ctx.translate(geo.center.x, geo.center.y);
  ctx.rotate(geo.angle);
  ctx.strokeStyle = drag.mode ? '#ffffff' : 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.5 / z;
  ctx.setLineDash([5 / z, 4 / z]);
  ctx.strokeRect(-geo.w / 2, -geo.h / 2, geo.w, geo.h);
  ctx.setLineDash([]);
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,213,74,0.6)';
  ctx.lineWidth = 1.5 / z;
  ctx.beginPath(); ctx.moveTo(hs.move.x, hs.move.y); ctx.lineTo(hs.rotate.x, hs.rotate.y); ctx.stroke();

  const dot = (h, color, active) => {
    ctx.beginPath(); ctx.arc(h.x, h.y, (active ? HANDLE_R + 2 : HANDLE_R) / z, 0, 7);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(10,8,20,0.7)';
    ctx.lineWidth = 1.5 / z;
    ctx.stroke();
  };
  dot(hs.move,   '#ffd54a', drag.mode === 'move');
  dot(hs.rotate, '#7ee8a2', drag.mode === 'rotate');
  dot(hs.length, '#5ce1e6', drag.mode === 'length');
  dot(hs.thick,  '#ff9d6b', drag.mode === 'thick');
}

// ── Dibujo del escenario ──────────────────────────────────────────────────
function drawGrid() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.fillStyle = '#0d0f1e';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  const step = 32;
  for (let x = (w / 2) % step; x < w; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = (h / 2) % step; y < h; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(120,180,255,0.16)';
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
}

// Silueta de referencia del mago base, tenue, para calzar las formas encima.
function drawGeoReference(p) {
  const color = team().main, dark = team().dark;
  ctx.globalAlpha = 0.22;
  const limb = (a, m, b2, w, c) => {
    ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(m.x, m.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
  };
  const seg = (a, b2, w, c) => {
    ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
  };
  limb(p.pelvis, p.kneeB, p.footB, 9 * S, dark);
  seg(p.chest, p.handB, 8 * S, dark);
  limb(p.pelvis, p.kneeF, p.footF, 10 * S, dark);
  const dx = p.chest.x - p.pelvis.x, dy = p.chest.y - p.pelvis.y;
  const d = Math.hypot(dx, dy) || 1;
  const nx = -dy / d, ny = dx / d;
  ctx.beginPath();
  ctx.moveTo(p.chest.x + nx * 10 * S, p.chest.y + ny * 10 * S);
  ctx.lineTo(p.chest.x - nx * 10 * S, p.chest.y - ny * 10 * S);
  ctx.lineTo(p.pelvis.x - nx * 15 * S, p.pelvis.y - ny * 15 * S);
  ctx.lineTo(p.pelvis.x + nx * 15 * S, p.pelvis.y + ny * 15 * S);
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  seg(p.chest, p.handF, 9 * S, color);
  ctx.fillStyle = CFG.colors.skin;
  ctx.beginPath(); ctx.arc(p.head.x, p.head.y, 11 * S, 0, 7); ctx.fill();
  ctx.globalAlpha = 1;
}

// Escoba simple de referencia (la del juego se dibuja bajo el skin si
// vs.broom está activo — acá una versión geométrica alcanza).
function drawBroomSimple() {
  const tip = broom.tip(), tail = broom.tail();
  ctx.strokeStyle = CFG.colors.wood;
  ctx.lineWidth = 7 * S;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(tail.x, tail.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
  const d = broom.dir();
  ctx.strokeStyle = '#c8a24e';
  ctx.lineWidth = 3 * S;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(tail.x - d.x * 26 * S + -d.y * i * 6 * S,
               tail.y - d.y * 26 * S +  d.x * i * 6 * S);
    ctx.stroke();
  }
}

// Huesos, resaltando el de la capa seleccionada
function drawBones(p) {
  const selBone = sel()?.bone;
  ctx.save();
  const boneSeg = (a, b2, hot) => {
    ctx.strokeStyle = hot ? '#ffd54a' : 'rgba(120,200,255,0.35)';
    ctx.lineWidth = hot ? 3 : 1.5;
    ctx.setLineDash(hot ? [] : [4, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = hot ? '#ffd54a' : 'rgba(120,200,255,0.6)';
    ctx.beginPath(); ctx.arc(a.x, a.y, hot ? 5 : 3, 0, 7); ctx.fill();
  };
  const B = {
    capa: [p.chest, p.pelvis], torso: [p.pelvis, p.chest], cabeza: [p.chest, p.head],
    brazoF: [p.chest, p.handF], brazoB: [p.chest, p.handB],
    piernaF: [p.pelvis, p.kneeF], pantorriF: [p.kneeF, p.footF],
    piernaB: [p.pelvis, p.kneeB], pantorriB: [p.kneeB, p.footB],
  };
  for (const [id, [a, b2]] of Object.entries(B)) boneSeg(a, b2, id === selBone);
  // eje de la escoba
  const tail = broom.tail(), tip = broom.tip();
  boneSeg(tail, tip, selBone === 'palo' || selBone === 'cepillo');
  ctx.restore();
}

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min((now - last) / 1000, 0.1);
  last = now;

  acc += dtReal;
  let steps = 0;
  while (acc >= FIXED_DT && steps < 6) {
    drivePose(FIXED_DT);
    rider.update(FIXED_DT, false, null);
    acc -= FIXED_DT;
    steps++;
  }
  if (steps === 6) acc = 0;

  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr; canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawGrid();

  ctx.save();
  ctx.translate(w / 2, h / 2);
  const z = zoomNow();
  ctx.scale(z, z);

  const p = rider.points;
  if (showGeo) drawGeoReference(p);
  if (vs.broom !== false) drawBroomSimple();
  drawVSkin(ctx, vs, p, broom, S, team(), facingNow());
  if (showBones) drawBones(p);
  if (sel()) drawManipulator();
  ctx.restore();

  const l = sel();
  el.stageInfo.textContent = l
    ? `${l.name} · ${l.bone} · ${l.shape}`
    : `${vs.layers.length} capas`;
}

// ══ UI ═════════════════════════════════════════════════════════════════════
const el = {};
function $(id) { return document.getElementById(id); }

function toast(msg, bad = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = 'toast'; }, 2000);
}

function rebuildAll() {
  el.skinName.value = vs.name;
  rebuildLayers();
  rebuildProps();
}

function rebuildLayers() {
  const box = el.layerList;
  box.innerHTML = '';
  el.progress.textContent = `${vs.layers.length} capas`;
  if (!vs.layers.length) {
    box.innerHTML = '<p class="muted">Sin capas todavía.</p>';
    return;
  }
  // De adelante (último del array) hacia atrás: más natural de leer
  for (let i = vs.layers.length - 1; i >= 0; i--) {
    const l = vs.layers[i];
    const row = document.createElement('div');
    row.className = 'layer' + (l.id === selId ? ' on' : '') + (l.tune.visible === false ? ' hid' : '');
    const swCol = l.style.tint === 'main' ? team().main
      : l.style.tint === 'dark' ? team().dark : l.style.fill;
    row.innerHTML = `
      <span class="sw" style="background:${swCol}"></span>
      <span class="lname">${l.name} <span style="color:#55608f">· ${l.bone}</span></span>
      <button class="mini" data-a="eye" title="Mostrar/ocultar">${l.tune.visible === false ? '◌' : '👁'}</button>
      <button class="mini" data-a="up" title="Más adelante">▲</button>
      <button class="mini" data-a="down" title="Más atrás">▼</button>
      <button class="mini" data-a="dup" title="Duplicar">⧉</button>`;
    row.querySelector('.lname').onclick = () => { selId = l.id; rebuildLayers(); rebuildProps(); };
    row.querySelectorAll('button').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const idx = vs.layers.indexOf(l);
        const a = e.currentTarget.dataset.a;
        if (a === 'eye') { l.tune.visible = l.tune.visible === false; }
        else if (a === 'up' && idx < vs.layers.length - 1) {
          vs.layers.splice(idx, 1); vs.layers.splice(idx + 1, 0, l);
        } else if (a === 'down' && idx > 0) {
          vs.layers.splice(idx, 1); vs.layers.splice(idx - 1, 0, l);
        } else if (a === 'dup') {
          const copy = JSON.parse(JSON.stringify(l));
          copy.id = 'L' + Math.random().toString(36).slice(2, 9);
          copy.name = l.name + ' copia';
          copy.tune.offY = (copy.tune.offY ?? 0) + 4;
          vs.layers.splice(idx + 1, 0, copy);
          selId = copy.id;
        }
        snapshot();
        rebuildLayers(); rebuildProps();
      };
    });
    box.appendChild(row);
  }
}

function rebuildProps() {
  const box = el.propsPanel;
  const l = sel();
  if (!l) {
    box.innerHTML = '<p class="muted">Agregá una forma para empezar, o cargá la plantilla.</p>';
    return;
  }
  const t = l.tune, st = l.style;
  box.innerHTML = '';

  // nombre de la capa
  const name = document.createElement('input');
  name.className = 'text';
  name.value = l.name;
  name.style.marginBottom = '8px';
  name.onchange = () => { l.name = name.value || l.shape; snapshot(); rebuildLayers(); };
  box.appendChild(name);

  // hueso y forma
  const mkSelect = (options, value, onchange) => {
    const s = document.createElement('select');
    s.className = 'sel';
    for (const o of options) {
      const op = document.createElement('option');
      op.value = o.id; op.textContent = o.label;
      if (o.id === value) op.selected = true;
      s.appendChild(op);
    }
    s.onchange = () => { onchange(s.value); snapshot(); rebuildLayers(); };
    return s;
  };
  box.appendChild(mkSelect(VBONES, l.bone, (v) => { l.bone = v; }));
  box.appendChild(mkSelect(VSHAPES, l.shape, (v) => { l.shape = v; }));

  // sliders
  const sliders = [
    { k: 'scale',     obj: t, label: 'Grosor',   min: 0.05, max: 4,   step: 0.01 },
    { k: 'lengthMul', obj: t, label: 'Largo',    min: 0.05, max: 3,   step: 0.01 },
    { k: 'offX',      obj: t, label: 'Correr ↔', min: -80,  max: 80,  step: 0.5 },
    { k: 'offY',      obj: t, label: 'Correr ↕', min: -80,  max: 80,  step: 0.5 },
    { k: 'rot',       obj: t, label: 'Rotar °',  min: -180, max: 180, step: 1 },
    { k: 'alpha',     obj: st, label: 'Opacidad', min: 0.05, max: 1,  step: 0.01 },
    { k: 'strokeW',   obj: st, label: 'Borde',   min: 0,    max: 12,  step: 0.5 },
  ];
  for (const sdef of sliders) {
    const row = document.createElement('div');
    row.className = 'slider';
    const val = sdef.obj[sdef.k] ?? 0;
    row.innerHTML = `
      <label>${sdef.label}<b>${(+val).toFixed(sdef.step < 1 ? 2 : 0)}</b></label>
      <input type="range" min="${sdef.min}" max="${sdef.max}" step="${sdef.step}" value="${val}">`;
    const input = row.querySelector('input');
    const out = row.querySelector('b');
    input.oninput = () => {
      sdef.obj[sdef.k] = Number(input.value);
      out.textContent = Number(input.value).toFixed(sdef.step < 1 ? 2 : 0);
    };
    input.onchange = () => snapshot();
    box.appendChild(row);
  }

  // colores
  const colorRow = (label, value, onchange, allowNull = false) => {
    const row = document.createElement('div');
    row.className = 'colorrow';
    const active = value != null;
    row.innerHTML = `
      ${allowNull ? `<input type="checkbox" ${active ? 'checked' : ''}>` : ''}
      <label>${label}</label>
      <input type="color" value="${active ? value : '#8a90a0'}" ${!active && allowNull ? 'disabled' : ''}>`;
    const chk = allowNull ? row.querySelector('input[type=checkbox]') : null;
    const col = row.querySelector('input[type=color]');
    col.oninput = () => onchange(col.value);
    col.onchange = () => snapshot();
    if (chk) {
      chk.onchange = () => {
        col.disabled = !chk.checked;
        onchange(chk.checked ? col.value : null);
        snapshot();
      };
    }
    box.appendChild(row);
  };
  colorRow('Relleno', st.fill, (v) => { st.fill = v; rebuildLayers(); });
  colorRow('Degradé hacia…', st.fill2, (v) => { st.fill2 = v; }, true);
  colorRow('Borde fino', st.stroke, (v) => { st.stroke = v; }, true);

  // tinte de equipo
  const tintSel = mkSelect(
    [{ id: 'none', label: 'Color propio' },
     { id: 'main', label: 'Tinte: color del equipo' },
     { id: 'dark', label: 'Tinte: equipo oscuro' }],
    st.tint ?? 'none',
    (v) => { st.tint = v; },
  );
  box.appendChild(tintSel);

  // checks
  const checks = document.createElement('div');
  checks.className = 'checkrow';
  checks.innerHTML = `
    <label><input type="checkbox" ${st.outline ? 'checked' : ''} data-k="outline"> Contorno</label>
    <label><input type="checkbox" ${t.flip ? 'checked' : ''} data-k="flip"> Espejar</label>
    <label><input type="checkbox" ${t.visible !== false ? 'checked' : ''} data-k="visible"> Visible</label>`;
  checks.querySelectorAll('input').forEach((c) => {
    c.onchange = () => {
      if (c.dataset.k === 'outline') st.outline = c.checked;
      else t[c.dataset.k] = c.checked;
      snapshot();
      rebuildLayers();
    };
  });
  box.appendChild(checks);
}

// ── Plantilla: un cuerpo base alineado a los huesos, para no arrancar de cero
function template() {
  const L = (bone, shape, name, tune, style) => {
    const l = defaultLayer(bone, shape);
    l.name = name;
    Object.assign(l.tune, tune);
    Object.assign(l.style, style);
    return l;
  };
  return [
    L('piernaB', 'capsula', 'muslo tras', { scale: 0.5 }, { tint: 'dark', alpha: 0.9 }),
    L('pantorriB', 'capsula', 'pierna tras', { scale: 0.5 }, { tint: 'dark', alpha: 0.9 }),
    L('brazoB', 'capsula', 'brazo tras', { scale: 0.5 }, { tint: 'dark', alpha: 0.9 }),
    L('cepillo', 'triangulo', 'cepillo', { scale: 0.55, lengthMul: 0.8 }, { fill: '#c9a04e' }),
    L('palo', 'capsula', 'palo', { scale: 0.5 }, { fill: '#8a5a2b' }),
    L('piernaF', 'capsula', 'muslo del', { scale: 0.55 }, { tint: 'dark' }),
    L('pantorriF', 'capsula', 'pierna del', { scale: 0.55 }, { tint: 'dark' }),
    L('torso', 'capsula', 'torso', { scale: 0.8 }, { tint: 'main' }),
    L('torso', 'caja', 'cinturón', { scale: 1, lengthMul: 0.16, offX: 6 }, { fill: '#3f2f20' }),
    L('brazoF', 'capsula', 'brazo del', { scale: 0.55 }, { tint: 'main' }),
    L('cabeza', 'ovalo', 'cara', { scale: 0.5, lengthMul: 0.85 }, { fill: '#e8c39a' }),
    L('cabeza', 'triangulo', 'sombrero', { scale: 0.55, lengthMul: 1.15, offX: 9, rot: 0 }, { tint: 'main' }),
  ];
}

// ── Construcción de la UI ─────────────────────────────────────────────────
function buildUI() {
  el.layerList  = $('layerList');
  el.propsPanel = $('propsPanel');
  el.stageInfo  = $('stageInfo');
  el.zoom       = $('zoom');
  el.poseRow    = $('poseRow');
  el.skinName   = $('skinName');
  el.progress   = $('progress');
  el.useInGame  = $('useInGame');
  el.useState   = $('useState');

  for (const ps of POSES) {
    const b = document.createElement('button');
    b.className = 'pose' + (ps.id === pose ? ' on' : '');
    b.textContent = ps.label;
    b.onclick = () => {
      pose = ps.id; poseT = 0;
      [...el.poseRow.children].forEach((c) => c.classList.remove('on'));
      b.classList.add('on');
      $('manualRow').style.display = ps.id === 'libre' ? 'flex' : 'none';
    };
    el.poseRow.appendChild(b);
  }
  $('manualAngle').oninput = (e) => { manualAngle = Number(e.target.value); };
  $('toggleBones').onchange = (e) => { showBones = e.target.checked; };
  $('toggleGeo').onchange = (e) => { showGeo = e.target.checked; };
  $('toggleTeam').onchange = (e) => { teamOrange = e.target.checked; rebuildLayers(); };

  // Grilla de formas
  const grid = $('shapeGrid');
  for (const sh of VSHAPES) {
    const b = document.createElement('button');
    b.className = 'shape';
    b.textContent = sh.label;
    b.onclick = () => {
      const bone = sel()?.bone ?? 'torso';
      const l = defaultLayer(bone, sh.id);
      l.name = sh.label.toLowerCase();
      vs.layers.push(l);
      selId = l.id;
      snapshot();
      rebuildLayers(); rebuildProps();
    };
    grid.appendChild(b);
  }

  el.skinName.onchange = () => { vs.name = el.skinName.value || 'Mi héroe'; snapshot(); };

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointerleave', () => { if (!drag.mode) canvas.style.cursor = 'default'; });

  $('btnUndo').onclick = undo;
  $('btnRedo').onclick = redo;
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (e.key === 'Delete' && sel()) { e.preventDefault(); delLayer(); }
  });

  $('btnSave').onclick = () => {
    vs.name = el.skinName.value || 'Mi héroe';
    const ok = saveVSkin(vs);
    toast(ok ? 'Guardado — activalo abajo para verlo en el juego'
             : 'No se pudo guardar', !ok);
  };
  $('btnLoad').onclick = () => {
    const loaded = loadVSkin();
    if (!loaded) { toast('No hay nada guardado', true); return; }
    vs = loaded; selId = vs.layers[0]?.id ?? null;
    snapshot(); rebuildAll();
    toast('Cargado');
  };
  $('btnTemplate').onclick = () => {
    vs.layers = template();
    selId = vs.layers[vs.layers.length - 1].id;
    snapshot(); rebuildAll();
    toast('Plantilla cargada: un cuerpo base para retocar');
  };
  $('btnExport').onclick = () => {
    vs.name = el.skinName.value || 'Mi héroe';
    const blob = new Blob([JSON.stringify(vs, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${vs.name.replace(/\s+/g, '-').toLowerCase()}.vskin.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Archivo descargado');
  };
  $('btnImport').onclick = () => $('importInput').click();
  $('importInput').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.kind !== 'vskin' || !Array.isArray(data.layers)) throw new Error('formato');
      vs = data;
      selId = vs.layers[0]?.id ?? null;
      snapshot(); rebuildAll();
      toast('Importado');
    } catch {
      toast('Archivo inválido', true);
    }
    e.target.value = '';
  };
  $('btnDelLayer').onclick = delLayer;
  $('btnClearAll').onclick = () => {
    if (!confirm('¿Borrar todas las capas? (lo guardado no se toca hasta que guardes de nuevo)')) return;
    vs.layers = [];
    selId = null;
    snapshot(); rebuildAll();
  };

  // Activar en el juego
  el.useInGame.checked = vskinEnabled();
  el.useState.textContent = vskinEnabled() ? '· activado' : '';
  el.useInGame.onchange = () => {
    setVSkinEnabled(el.useInGame.checked);
    el.useState.textContent = el.useInGame.checked ? '· activado' : '';
    toast(el.useInGame.checked
      ? 'Activado: el juego usa tu skin (guardalo primero)'
      : 'Desactivado: el juego vuelve al personaje elegido');
  };
}

function delLayer() {
  const l = sel();
  if (!l) return;
  const idx = vs.layers.indexOf(l);
  vs.layers.splice(idx, 1);
  selId = vs.layers[Math.min(idx, vs.layers.length - 1)]?.id ?? null;
  snapshot();
  rebuildLayers(); rebuildProps();
}

// ── Arranque ──────────────────────────────────────────────────────────────
buildUI();
const saved = loadVSkin();
if (saved) { vs = saved; selId = vs.layers[0]?.id ?? null; }
snapshot();
rebuildAll();
requestAnimationFrame(frame);

window.vs = () => vs;
