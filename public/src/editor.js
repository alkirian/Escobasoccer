// Editor de personaje: subís un PNG por parte del cuerpo y lo ves montado
// sobre el ragdoll real, moviéndose. Lo que ves acá es literalmente lo que
// vas a ver en el juego — usa la misma física y el mismo dibujo.
import { CFG, FIXED_DT } from './config.js';
import { clamp } from './utils.js';
import { Broom } from './broom.js';
import { Rider } from './rider.js';
import {
  PIECES, DEFAULT_TUNE, SpriteSkin, saveSkin, loadSkin, clearSkin,
  BONES, boneThickness, drawPiece, pieceGeometry, hitPiece,
  BROOM_PIECES, BROOM_ORDER, BROOM_SPANS, BroomSkin, saveBroomSkin, loadBroomSkin,
  clearBroomSkin, broomThickness, broomPieceGeometry,
} from './skin.js';

const S = CFG.charScale;

// ── Escenario mínimo: una escoba y su jinete, sin arena ni pelota ─────────
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

const broom = new Broom(0, 0, 0);
const rider = new Rider(broom);

// El editor no simula vuelo: mueve la escoba por un guion para que el ragdoll
// se deforme y puedas ver cómo responde el sprite. Es la prueba de fuego —
// un sprite que se ve bien quieto puede romperse al girar.
const POSES = [
  { id: 'idle',  label: 'Flotando'  },
  { id: 'vuelo', label: 'En vuelo'  },
  { id: 'giro',  label: 'Giro/golpe' },
  { id: 'libre', label: 'Manual'    },
];
let pose = 'idle';
let poseT = 0;
let manualAngle = 0;

// ── Skins en edición ──────────────────────────────────────────────────────
// Dos secciones independientes: el jinete y la escoba. Comparten el escenario
// (se ven siempre los dos, montados) pero cada una tiene su lista de piezas,
// su archivo guardado y su propio botón de exportar.
const SECTIONS = [
  { id: 'rider', label: 'Personaje' },
  { id: 'broom', label: 'Escoba'    },
];
let section = 'rider';

let skin      = new SpriteSkin({}, 'Mi personaje');
let broomSkin = new BroomSkin({}, 'Mi escoba');
let selected      = PIECES[0].id;         // pieza activa del jinete
let selectedBroom = BROOM_PIECES[0].id;   // pieza activa de la escoba
let showBones = true;
let showGeo = true;   // dibujar el skin geométrico debajo, como referencia

// Atajos que resuelven "lo que corresponde a la sección actual", para que el
// resto de la UI no tenga que ramificar en cada línea.
const isBroom    = () => section === 'broom';
const curSkin    = () => (isBroom() ? broomSkin : skin);
const curPieces  = () => (isBroom() ? BROOM_PIECES : PIECES);
const curSel     = () => (isBroom() ? selectedBroom : selected);
const setCurSel  = (id) => { if (isBroom()) selectedBroom = id; else selected = id; };

function partOf(id) {
  const sk = curSkin();
  if (!sk.parts[id]) sk.parts[id] = { img: null, src: null, tune: { ...DEFAULT_TUNE } };
  return sk.parts[id];
}

// ── Manipulación directa sobre el lienzo ───────────────────────────────────
// En vez de tocar sliders: agarrar la pieza y arrastrarla mueve offX/offY,
// agarrar el mango de arriba la rota, el de la punta cambia el largo, el del
// borde cambia el grosor. Todo se guarda en el mismo `tune` que ya usan los
// sliders — son dos caminos al mismo dato, se pueden combinar sin pisarse.
const drag = {
  mode: null,       // null | 'move' | 'rotate' | 'length' | 'thick'
  id: null,         // pieza que se está arrastrando
  startMouse: { x: 0, y: 0 },
  startTune: null,  // copia del tune al empezar (para deltas limpios)
  angle: 0,         // ángulo del hueso/eje, fijado al empezar
  pivot: { x: 0, y: 0 },   // anclaje de la pieza (bone.from / cola de escoba)
  center: { x: 0, y: 0 },  // centro del sprite, fijado al empezar
  dist: 1,          // distancia inicial pivote→mouse (referencia para 'length')
  thick0: 1,        // grosor inicial (referencia para 'thick')
};

// Radio de los handles, dividido por el zoom al usarse — así se sienten del
// mismo tamaño en pantalla sin importar cuánto acercaste la vista.
const HANDLE_R = 7;

// Geometría de la pieza actual en coordenadas de MUNDO.
function currentGeo() {
  const t = partOf(curSel()).tune;
  return isBroom()
    ? broomPieceGeometry(curSel(), broom, t, S, 1)
    : pieceGeometry(curSel(), rider.points, t, S, 1);
}

// Handles sobre una geometría dada: mover en el centro, rotar arriba del
// todo, largo en la punta delantera, grosor a mitad de camino en el borde.
function handlesFor(geo) {
  if (!geo) return null;
  const z = zoomNow();
  const cs = Math.cos(geo.angle), sn = Math.sin(geo.angle);
  const local = (lx, ly) => ({ x: geo.center.x + lx * cs - ly * sn, y: geo.center.y + lx * sn + ly * cs });
  return {
    move:   { x: geo.center.x, y: geo.center.y },
    rotate: local(0, -geo.h / 2 - 22 / z),
    length: local(geo.w / 2, 0),
    thick:  local(0, -geo.h / 2),
  };
}

function zoomNow() { return Number(el.zoom?.value || 1); }

// Convierte un punto de pantalla (clientX/Y) a coordenadas de mundo del
// escenario: invierte el translate(centro) → scale(zoom) que aplica frame().
function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const z = zoomNow();
  return {
    x: (clientX - rect.left - w / 2) / z,
    y: (clientY - rect.top  - h / 2) / z,
  };
}

function nearHandle(h, mouse) {
  return Math.hypot(mouse.x - h.x, mouse.y - h.y) <= (HANDLE_R + 4) / zoomNow();
}

function pointerDown(e) {
  const mouse = screenToWorld(e.clientX, e.clientY);
  const geo = currentGeo();
  if (!geo) return;
  const hs = handlesFor(geo);

  let mode = null;
  if (nearHandle(hs.rotate, mouse)) mode = 'rotate';
  else if (nearHandle(hs.length, mouse)) mode = 'length';
  else if (nearHandle(hs.thick, mouse)) mode = 'thick';
  else if (hitPiece(geo, mouse.x, mouse.y)) mode = 'move';
  if (!mode) return;

  const part = partOf(curSel());
  drag.mode = mode;
  drag.id = curSel();
  drag.startMouse = mouse;
  drag.startTune = { ...part.tune };
  drag.angle = geo.angle;
  drag.pivot = geo.pivot;
  drag.center = geo.center;
  drag.dist = Math.hypot(mouse.x - geo.pivot.x, mouse.y - geo.pivot.y) || 1;
  drag.thick0 = geo.h || 1;
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function pointerMove(e) {
  const mouse = screenToWorld(e.clientX, e.clientY);

  if (!drag.mode) {
    canvas.style.cursor = hoverCursor(currentGeo(), mouse);
    return;
  }

  const part = partOf(drag.id);
  const t = part.tune;
  const dx = mouse.x - drag.startMouse.x, dy = mouse.y - drag.startMouse.y;
  const c = Math.cos(drag.angle), s = Math.sin(drag.angle);

  if (drag.mode === 'move') {
    // Proyectar el delta de pantalla sobre los ejes del hueso: así "arrastrar
    // a la derecha" significa "a lo largo del hueso" sin importar la rotación.
    const along = dx * c + dy * s;
    const perp  = -dx * s + dy * c;
    t.offX = (drag.startTune.offX ?? 0) + along / S;
    t.offY = (drag.startTune.offY ?? 0) + perp / S;

  } else if (drag.mode === 'rotate') {
    // Ángulo del mouse respecto del CENTRO fijado al empezar — así el pivote
    // de rotación no se mueve mientras arrastrás.
    const a0 = Math.atan2(drag.startMouse.y - drag.center.y, drag.startMouse.x - drag.center.x);
    const a1 = Math.atan2(mouse.y - drag.center.y, mouse.x - drag.center.x);
    const deltaDeg = ((a1 - a0) * 180) / Math.PI;
    t.rot = (drag.startTune.rot ?? 0) + deltaDeg;

  } else if (drag.mode === 'length') {
    const d = Math.hypot(mouse.x - drag.pivot.x, mouse.y - drag.pivot.y) || 1;
    const f = clamp(d / drag.dist, 0.3, 2.5);
    t.lengthMul = clamp((drag.startTune.lengthMul ?? 1) * f, 0.3, 2.5);

  } else if (drag.mode === 'thick') {
    // Distancia perpendicular al eje: alejarse del centro engrosa la pieza.
    const perp = -dx * s + dy * c;
    const half0 = drag.thick0 / 2;
    const half1 = clamp(half0 - perp, half0 * 0.2, half0 * 3);
    t.scale = clamp((drag.startTune.scale ?? 1) * (half1 / half0), 0.2, 3);
  }

  buildTunePanel();  // refleja el arrastre en los sliders en vivo
}

function pointerUp(e) {
  if (drag.mode) { try { canvas.releasePointerCapture(e.pointerId); } catch {} }
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

// Dibuja el contorno de la pieza seleccionada y sus manijas, en coordenadas
// de mundo (se llama dentro del mismo transform que el resto del escenario).
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
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,8,20,0.7)';
    ctx.lineWidth = 1.5 / z;
    ctx.stroke();
  };
  dot(hs.move,   '#ffd54a', drag.mode === 'move');
  dot(hs.rotate, '#7ee8a2', drag.mode === 'rotate');
  dot(hs.length, '#5ce1e6', drag.mode === 'length');
  dot(hs.thick,  '#ff9d6b', drag.mode === 'thick');
}


// Texto de la guia de dibujo, distinto por seccion.
const GUIDE_RIDER = `
  Cada PNG se estira sobre un <b>hueso</b>. Dibuja la pieza
  <b>horizontal, mirando a la derecha</b>, con el punto de union
  pegado al <b>borde izquierdo</b> y centrado en vertical.<br><br>
  Un brazo: hombro en el borde izquierdo, mano en el derecho.<br>
  Fondo <code>transparente</code>. El tamano no importa &mdash; se reescala.<br><br>
  <b>Sobre el dibujo:</b> arrastra la pieza para moverla &middot;
  tira del punto <span style="color:#7ee8a2">verde</span> para rotarla &middot;
  del <span style="color:#5ce1e6">celeste</span> para el largo &middot;
  del <span style="color:#ff9d6b">naranja</span> para el grosor.`;

const GUIDE_BROOM = `
  La escoba se arma sobre el eje <b>cola &rarr; punta</b>. Dibuja cada pieza
  <b>horizontal, mirando a la derecha</b>, pegada al borde izquierdo.<br><br>
  El <b>palo</b> cubre casi todo el largo. El <b>cepillo</b> se dibuja
  normal (apuntando a la derecha) y el motor lo monta hacia atras solo.<br><br>
  El resplandor y las runas siguen siendo automaticos &mdash; dependen de la
  velocidad, no hace falta dibujarlos.<br><br>
  <b>Sobre el dibujo:</b> arrastra la pieza para moverla &middot;
  tira del punto <span style="color:#7ee8a2">verde</span> para rotarla &middot;
  del <span style="color:#5ce1e6">celeste</span> para el largo &middot;
  del <span style="color:#ff9d6b">naranja</span> para el grosor.`;

// ── Animación de la escoba según la pose ──────────────────────────────────
function drivePose(dt) {
  poseT += dt;
  switch (pose) {
    case 'idle':
      // Flotación suave: el ragdoll se acomoda, casi sin deformar
      broom.pos.x = Math.cos(poseT * 1.1) * 8;
      broom.pos.y = Math.sin(poseT * 1.6) * 10;
      broom.angle = Math.sin(poseT * 0.9) * 0.12;
      break;
    case 'vuelo': {
      // Avance con inclinación: el cuerpo se va hacia atrás por inercia
      const a = Math.sin(poseT * 1.4) * 0.55;
      broom.angle = a;
      broom.pos.x = Math.cos(poseT * 1.4) * 34;
      broom.pos.y = Math.sin(poseT * 2.1) * 22;
      // velocidad simulada para que la capa y los miembros vayan hacia atrás
      broom.vel.x = -Math.sin(poseT * 1.4) * 620;
      broom.vel.y = Math.cos(poseT * 2.1) * 260;
      break;
    }
    case 'giro':
      // El golpe: vuelta entera, es donde más se deforma el ragdoll
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

// ── Dibujo ────────────────────────────────────────────────────────────────
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
  // ejes
  ctx.strokeStyle = 'rgba(120,180,255,0.16)';
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
}

// Skin geométrico de referencia (el look actual del juego), simplificado.
function drawGeoReference(p) {
  const color = CFG.colors.p1, dark = CFG.colors.p1Dark;
  ctx.globalAlpha = 0.28;

  const limb = (a, m, b, w, c) => {
    ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(m.x, m.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  };
  const seg = (a, b, w, c) => {
    ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  };

  limb(p.pelvis, p.kneeB, p.footB, 9 * S, dark);
  seg(p.chest, p.handB, 8 * S, dark);
  limb(p.pelvis, p.kneeF, p.footF, 10 * S, dark);

  // torso
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

function drawBroomSimple() {
  // Si hay un skin de escoba cargado, se dibuja ese en lugar del palo genérico.
  if (broomSkin.ready) { broomSkin.draw(ctx, broom, S); return; }
  const tip = broom.tip(), tail = broom.tail();
  ctx.strokeStyle = CFG.colors.wood;
  ctx.lineWidth = 7 * S;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(tail.x, tail.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
  // cepillo
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

function drawBones(p) {
  ctx.save();
  for (const [id, bone] of Object.entries(BONES)) {
    const a = p[bone.from], b = p[bone.to];
    if (!a || !b) continue;
    const isSel = id === selected;
    ctx.strokeStyle = isSel ? '#ffd54a' : 'rgba(120,200,255,0.35)';
    ctx.lineWidth = isSel ? 3 : 1.5;
    ctx.setLineDash(isSel ? [] : [4, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    // pivote
    ctx.fillStyle = isSel ? '#ffd54a' : 'rgba(120,200,255,0.6)';
    ctx.beginPath(); ctx.arc(a.x, a.y, isSel ? 5 : 3, 0, 7); ctx.fill();
  }
  ctx.restore();
}

// Guías de la escoba: marca el eje cola→punta y dónde cae cada pieza, para
// que se entienda de un vistazo qué zona cubre el PNG que estás por subir.
function drawBroomBones() {
  const d = broom.dir();
  const tail = broom.tail(), tip = broom.tip();

  ctx.save();
  // Eje completo
  ctx.strokeStyle = 'rgba(120,200,255,0.3)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(tail.x, tail.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
  ctx.setLineDash([]);

  // Extremos rotulados
  const dot = (x, y, label, c) => {
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(label, x - 8, y - 9);
  };
  dot(tail.x, tail.y, 'cola', 'rgba(120,200,255,0.8)');
  dot(tip.x, tip.y, 'punta', 'rgba(120,200,255,0.8)');

  // Tramo que ocupa la pieza seleccionada
  const lay = BROOM_SPANS[selectedBroom];
  if (lay) {
    const part = broomSkin.parts[selectedBroom];
    const t = part?.tune || {};
    const start = (lay.start + (t.offX ?? 0)) * S;
    const len   = lay.len * (t.lengthMul ?? 1) * S;
    const thick = lay.thickness * (t.scale ?? 1) * S;
    const ax = tail.x + d.x * start,       ay = tail.y + d.y * start;
    const bx = ax + d.x * len,             by = ay + d.y * len;

    ctx.strokeStyle = '#ffd54a';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    // Caja del alto que va a ocupar el sprite
    ctx.strokeStyle = 'rgba(255,213,74,0.35)';
    ctx.lineWidth = 1;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(d.y, d.x));
    ctx.strokeRect(0, -thick / 2, len, thick);
    ctx.restore();
    ctx.fillStyle = '#ffd54a';
    ctx.beginPath(); ctx.arc(ax, ay, 5, 0, 7); ctx.fill();
  }
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

  // ── Render ──
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr; canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawGrid();

  ctx.save();
  ctx.translate(w / 2, h / 2);
  const z = Number(el.zoom.value);
  ctx.scale(z, z);

  const p = rider.points;
  // El jinete se dibuja siempre: aunque estés editando la escoba, verla montada
  // es lo que te dice si el tamaño y la posición del palo funcionan.
  if (showGeo && !skin.ready) drawGeoReference(p);
  if (skin.ready) {
    skin.draw(ctx, p, S, drawBroomSimple);
  } else {
    // Sin skin de jinete: al menos la escoba, para poder editarla sola
    drawBroomSimple();
  }
  if (showBones) { if (isBroom()) drawBroomBones(); else drawBones(p); }
  // Manijas de arrastre de la pieza seleccionada, solo si ya tiene imagen —
  // sin sprite no hay nada que mover, y el contorno confundiría más de lo
  // que ayuda.
  if (curSkin().has(curSel())) drawManipulator();

  ctx.restore();

  // Info de la pieza seleccionada
  const part = curSkin().parts[curSel()];
  el.stageInfo.textContent = part?.img
    ? `${curSel()} · ${part.img.naturalWidth}×${part.img.naturalHeight}px`
    : `${curSel()} · sin imagen`;
}

// ══ UI ═══════════════════════════════════════════════════════════════════
const el = {};
function $(id) { return document.getElementById(id); }

function buildUI() {
  el.list      = $('pieceList');
  el.drop      = $('dropZone');
  el.file      = $('fileInput');
  el.tune      = $('tunePanel');
  el.stageInfo = $('stageInfo');
  el.zoom      = $('zoom');
  el.poseRow   = $('poseRow');
  el.hint      = $('pieceHint');
  el.tabs      = $('sectionTabs');
  el.skinName  = $('skinName');
  el.guide     = $('guideBox');
  el.layers    = $('layerList');

  // Pestañas de sección
  for (const sc of SECTIONS) {
    const b = document.createElement('button');
    b.className = 'tab' + (sc.id === section ? ' on' : '');
    b.textContent = sc.label;
    b.onclick = () => switchSection(sc.id);
    b.dataset.id = sc.id;
    el.tabs.appendChild(b);
  }

  buildPieceList();

  // Poses
  for (const ps of POSES) {
    const b = document.createElement('button');
    b.className = 'pose' + (ps.id === pose ? ' on' : '');
    b.textContent = ps.label;
    b.onclick = () => {
      pose = ps.id; poseT = 0;
      [...el.poseRow.children].forEach(c => c.classList.remove('on'));
      b.classList.add('on');
      $('manualRow').style.display = ps.id === 'libre' ? 'flex' : 'none';
    };
    el.poseRow.appendChild(b);
  }

  $('manualAngle').oninput = (e) => { manualAngle = Number(e.target.value); };
  $('toggleBones').onchange = (e) => { showBones = e.target.checked; };
  $('toggleGeo').onchange   = (e) => { showGeo = e.target.checked; };

  // Manipulación directa: arrastrar la pieza sobre el lienzo en vez de
  // depender solo de los sliders.
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup',   pointerUp);
  canvas.addEventListener('pointerleave', () => { if (!drag.mode) canvas.style.cursor = 'default'; });

  // Carga de archivos
  el.drop.onclick = () => el.file.click();
  el.file.onchange = (e) => { if (e.target.files[0]) loadImage(e.target.files[0]); };

  el.drop.ondragover = (e) => { e.preventDefault(); el.drop.classList.add('over'); };
  el.drop.ondragleave = () => el.drop.classList.remove('over');
  el.drop.ondrop = (e) => {
    e.preventDefault();
    el.drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) loadImage(f);
  };

  // Pegar desde el portapapeles
  addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) loadImage(item.getAsFile());
  });

  $('btnSave').onclick   = doSave;
  $('btnLoad').onclick   = doLoad;
  $('btnClearPiece').onclick = () => {
    const part = partOf(curSel());
    part.img = null; part.src = null;
    refreshList(); buildTunePanel(); buildLayerList();
  };
  $('btnClearAll').onclick = () => {
    const what = isBroom() ? 'la escoba' : 'el personaje';
    if (!confirm(`¿Borrar todas las piezas de ${what}?`)) return;
    if (isBroom()) { broomSkin = new BroomSkin({}, broomSkin.name); clearBroomSkin(); }
    else           { skin = new SpriteSkin({}, skin.name); clearSkin(); }
    refreshList(); buildTunePanel(); buildLayerList();
  };
  $('btnExport').onclick = doExport;
  $('btnImport').onclick = () => $('importInput').click();
  $('importInput').onchange = (e) => { if (e.target.files[0]) doImport(e.target.files[0]); };

  selectPiece(selected);
}

// La lista se reconstruye al cambiar de sección: cada una tiene sus piezas.
function buildPieceList() {
  el.list.innerHTML = '';
  for (const pc of curPieces()) {
    const row = document.createElement('button');
    row.className = 'piece';
    row.dataset.id = pc.id;
    row.innerHTML = `
      <span class="thumb" data-thumb="${pc.id}"></span>
      <span class="pname">${pc.label}</span>
      <span class="pstate" data-state="${pc.id}">vacío</span>`;
    row.onclick = () => selectPiece(pc.id);
    el.list.appendChild(row);
  }
}

function switchSection(id) {
  section = id;
  [...el.tabs.children].forEach(c => c.classList.toggle('on', c.dataset.id === id));
  el.skinName.value = curSkin().name;
  el.skinName.placeholder = isBroom() ? 'Nombre de la escoba' : 'Nombre del personaje';
  el.guide.innerHTML = isBroom() ? GUIDE_BROOM : GUIDE_RIDER;
  buildPieceList();
  refreshList();
  buildLayerList();
  selectPiece(curSel());
}

// Etiqueta legible de una pieza (rider o escoba), para la lista de capas.
function labelOf(id) {
  return curPieces().find(p => p.id === id)?.label || id;
}

// Lista de capas: el orden de dibujo de curSkin(), de ADELANTE hacia atrás
// (más natural de leer — "esto tapa a lo de abajo"), con flechas para mover
// una pieza un lugar. Solo lista piezas que ya tienen imagen: reordenar algo
// vacío no cambia nada visible y solo ensucia la lista.
function buildLayerList() {
  const box = el.layers;
  if (!box) return;
  box.innerHTML = '';
  const sk = curSkin();
  const order = sk.order.filter(id => id !== '__broom__' && sk.has(id));
  const front = [...order].reverse();  // mostrar lo de adelante arriba

  if (front.length === 0) {
    box.innerHTML = '<p class="muted">Subí al menos dos piezas para poder ordenarlas.</p>';
    return;
  }

  for (const id of front) {
    const row = document.createElement('div');
    row.className = 'layer' + (id === curSel() ? ' on' : '');
    row.dataset.id = id;
    row.innerHTML = `
      <span class="lname">${labelOf(id)}</span>
      <button class="mini" data-dir="1" title="Subir (más adelante)">▲</button>
      <button class="mini" data-dir="-1" title="Bajar (más atrás)">▼</button>`;
    row.querySelector('.lname').onclick = () => selectPiece(id);
    row.querySelectorAll('button').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        // dir=+1 (▲ subir) = más adelante = índice más alto en sk.order.
        // dir=-1 (▼ bajar) = más atrás = índice más bajo. Coincide directo
        // con el signo del dataset, sin invertir nada.
        sk.moveLayer(id, Number(e.currentTarget.dataset.dir));
        buildLayerList();
      };
    });
    box.appendChild(row);
  }
}

function selectPiece(id) {
  setCurSel(id);
  [...el.list.children].forEach(c => c.classList.toggle('on', c.dataset.id === id));
  const pc = curPieces().find(p => p.id === id);
  if (pc) el.hint.textContent = pc.hint;
  buildTunePanel();
  // Resaltar la fila activa en la lista de capas sin reconstruirla entera
  el.layers?.querySelectorAll('.layer').forEach(r => {
    r.classList.toggle('on', r.dataset.id === id);
  });
}

function loadImage(file) {
  if (!file.type.startsWith('image/')) { alert('Tiene que ser una imagen (PNG con transparencia idealmente).'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const part = partOf(curSel());
      part.img = img;
      part.src = reader.result;
      refreshList();
      buildTunePanel();
      buildLayerList();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function refreshList() {
  const sk = curSkin(), pieces = curPieces();
  for (const pc of pieces) {
    const has = sk.has(pc.id);
    const st = el.list.querySelector(`[data-state="${pc.id}"]`);
    const th = el.list.querySelector(`[data-thumb="${pc.id}"]`);
    if (!st || !th) continue;
    st.textContent = has ? 'ok' : 'vacío';
    st.className = 'pstate' + (has ? ' ok' : '');
    th.style.backgroundImage = has ? `url(${sk.parts[pc.id].src})` : '';
    th.classList.toggle('empty', !has);
  }
  const n = pieces.filter(p => sk.has(p.id)).length;
  $('progress').textContent = `${n}/${pieces.length} piezas`;
}

// Panel de ajustes de la pieza actual
function buildTunePanel() {
  const part = partOf(curSel());
  const t = part.tune;
  const sliders = [
    { k: 'scale',     label: 'Grosor',    min: 0.2, max: 3,   step: 0.02 },
    { k: 'lengthMul', label: 'Largo',     min: 0.3, max: 2.5, step: 0.02 },
    { k: 'offX',      label: 'Correr ↔',  min: -60, max: 60,  step: 1 },
    { k: 'offY',      label: 'Correr ↕',  min: -60, max: 60,  step: 1 },
    { k: 'rot',       label: 'Rotar °',   min: -180, max: 180, step: 1 },
  ];

  el.tune.innerHTML = '';
  if (!part.img) {
    el.tune.innerHTML = '<p class="muted">Subí una imagen para ajustarla.</p>';
    return;
  }

  for (const s of sliders) {
    const row = document.createElement('div');
    row.className = 'slider';
    row.innerHTML = `
      <label>${s.label}<b>${(t[s.k] ?? 0).toFixed(s.step < 1 ? 2 : 0)}</b></label>
      <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${t[s.k] ?? 0}">`;
    const input = row.querySelector('input');
    const out = row.querySelector('b');
    input.oninput = () => {
      t[s.k] = Number(input.value);
      out.textContent = Number(input.value).toFixed(s.step < 1 ? 2 : 0);
    };
    el.tune.appendChild(row);
  }

  const checks = document.createElement('div');
  checks.className = 'checkrow';
  checks.innerHTML = `
    <label><input type="checkbox" ${t.flip ? 'checked' : ''} data-k="flip"> Espejar</label>
    <label><input type="checkbox" ${t.visible !== false ? 'checked' : ''} data-k="visible"> Visible</label>
    <button class="mini" id="btnReset">Reiniciar</button>`;
  checks.querySelectorAll('input').forEach(c => {
    c.onchange = () => { t[c.dataset.k] = c.checked; };
  });
  checks.querySelector('#btnReset').onclick = () => {
    part.tune = { ...DEFAULT_TUNE };
    buildTunePanel();
  };
  el.tune.appendChild(checks);
}

// ── Guardar / cargar / exportar ───────────────────────────────────────────
function toast(msg, bad = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (bad ? ' bad' : '');
  setTimeout(() => { t.className = 'toast'; }, 2200);
}

function doSave() {
  const sk = curSkin();
  sk.name = el.skinName.value || (isBroom() ? 'Mi escoba' : 'Mi personaje');
  const ok = isBroom() ? saveBroomSkin(sk) : saveSkin(sk);
  toast(ok ? 'Guardado — el juego lo va a usar'
           : 'No entró en el almacenamiento (imágenes muy grandes)', !ok);
}

async function doLoad() {
  const s = isBroom() ? await loadBroomSkin() : await loadSkin();
  if (!s) { toast('No hay nada guardado', true); return; }
  if (isBroom()) broomSkin = s; else skin = s;
  el.skinName.value = s.name;
  refreshList(); buildTunePanel(); buildLayerList();
  toast('Cargado');
}

function doExport() {
  const sk = curSkin();
  sk.name = el.skinName.value || (isBroom() ? 'Mi escoba' : 'Mi personaje');
  const kind = isBroom() ? 'escoba' : 'skin';
  const blob = new Blob([JSON.stringify({ kind, ...sk.toJSON() })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${sk.name.replace(/\s+/g, '-').toLowerCase()}.${kind}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Archivo descargado');
}

async function doImport(file) {
  try {
    const data = JSON.parse(await file.text());
    // El archivo dice de qué sección es; si no lo dice, va a la actual.
    const toBroom = data.kind ? data.kind === 'escoba' : isBroom();
    if (toBroom) {
      broomSkin = await BroomSkin.fromJSON(data);
      if (!isBroom()) switchSection('broom');
    } else {
      skin = await SpriteSkin.fromJSON(data);
      if (isBroom()) switchSection('rider');
    }
    el.skinName.value = curSkin().name;
    refreshList(); buildTunePanel(); buildLayerList();
    toast('Importado');
  } catch {
    toast('Archivo inválido', true);
  }
}

// ── Arranque ──────────────────────────────────────────────────────────────
buildUI();
switchSection('rider');

// Cargar lo que haya guardado de las dos secciones
Promise.all([loadSkin(), loadBroomSkin()]).then(([rs, bs]) => {
  if (rs) skin = rs;
  if (bs) broomSkin = bs;
  el.skinName.value = curSkin().name;
  refreshList();
  buildTunePanel();
  buildLayerList();
});

requestAnimationFrame(frame);

window.skin      = () => skin;
window.broomSkin = () => broomSkin;
window.section   = () => section;
