// Skins del jinete: separa CÓMO SE VE del CÓMO SE MUEVE.
//
// La física (rider.js) calcula 9 puntos cada frame — head, chest, pelvis,
// kneeF/footF, kneeB/footB, handF/handB. Un skin solo decide qué se pinta
// encima de esos puntos. Cambiar de skin no toca el ragdoll: el personaje
// se mueve igual, se ve distinto.
//
// Un skin de sprites es un mapa de PIEZA → { img, ...ajustes }. Cada pieza se
// ancla a un HUESO (un par de puntos) y se estira/rota para seguirlo. Como el
// hueso lo mueve la física, la deformación del ragdoll queda gratis.

// ── Huesos ────────────────────────────────────────────────────────────────
// Cada pieza dice entre qué dos puntos vive. `from` es el pivote (el extremo
// que queda quieto), `to` marca la dirección y el largo.
//
// Convención del PNG: el dibujo mira A LA DERECHA, con el pivote en el borde
// izquierdo y centrado en vertical. Un brazo se dibuja horizontal, el hombro
// pegado al borde izquierdo. Así el motor lo rota sin que tengas que pensar.
export const BONES = {
  capa:      { from: 'chest',  to: 'pelvis' },
  piernaB:   { from: 'pelvis', to: 'kneeB'  },
  pantorriB: { from: 'kneeB',  to: 'footB'  },
  brazoB:    { from: 'chest',  to: 'handB'  },
  piernaF:   { from: 'pelvis', to: 'kneeF'  },
  pantorriF: { from: 'kneeF',  to: 'footF'  },
  torso:     { from: 'pelvis', to: 'chest'  },
  brazoF:    { from: 'chest',  to: 'handF'  },
  cabeza:    { from: 'chest',  to: 'head'   },
};

// Orden de dibujo: lo primero está más atrás. Coincide con el orden que ya
// usa el skin geométrico, para que el cambio de skin no altere la lectura.
export const DRAW_ORDER = [
  'capa',
  'piernaB', 'pantorriB',
  'brazoB',
  '__broom__',           // marcador: acá va la escoba, entre el cuerpo y el frente
  'piernaF', 'pantorriF',
  'torso',
  'brazoF',
  'cabeza',
];

// Piezas que el editor ofrece, con nombre legible y una guía de qué dibujar.
export const PIECES = [
  { id: 'cabeza',    label: 'Cabeza',           hint: 'Cara + sombrero. Mira a la derecha.' },
  { id: 'torso',     label: 'Torso',            hint: 'Túnica. Pelvis a la izquierda, pecho a la derecha.' },
  { id: 'brazoF',    label: 'Brazo delantero',  hint: 'Hombro a la izquierda, mano a la derecha.' },
  { id: 'brazoB',    label: 'Brazo trasero',    hint: 'Igual que el delantero, tono más oscuro.' },
  { id: 'piernaF',   label: 'Muslo delantero',  hint: 'Cadera a la izquierda, rodilla a la derecha.' },
  { id: 'pantorriF', label: 'Pierna delantera', hint: 'Rodilla a la izquierda, pie a la derecha.' },
  { id: 'piernaB',   label: 'Muslo trasero',    hint: 'Igual que el delantero, más oscuro.' },
  { id: 'pantorriB', label: 'Pierna trasera',   hint: 'Igual que la delantera, más oscura.' },
  { id: 'capa',      label: 'Capa',             hint: 'Cuelga del pecho. Opcional.' },
];

// Ajustes por pieza que el editor puede tocar. Se guardan junto a la imagen.
export const DEFAULT_TUNE = {
  scale:    1,     // grosor relativo (alto del sprite vs. alto natural)
  lengthMul: 1,    // estirar/acortar sobre el eje del hueso
  offX:     0,     // correr sobre el eje del hueso
  offY:     0,     // correr perpendicular al hueso
  rot:      0,     // rotación extra en grados
  flip:     false, // espejar en vertical
  visible:  true,
};

// Alto natural de cada hueso en unidades de mundo. Es la referencia que hace
// que un PNG de 400px y uno de 80px se vean del mismo tamaño en el juego: el
// sprite se escala para que su ALTO ocupe esto (por scale).
const BONE_THICKNESS = {
  capa:      34,
  piernaB:   18, pantorriB: 16,
  brazoB:    16,
  piernaF:   20, pantorriF: 18,
  torso:     40,
  brazoF:    18,
  cabeza:    46,
};

// ── Dibujo de una pieza sobre su hueso ────────────────────────────────────
// El sprite se pega en `from`, se rota hacia `to` y se estira hasta cubrir el
// largo del hueso. Si el ragdoll estira una extremidad, el sprite la sigue.
// `facing`: +1 mirando a la derecha, -1 mirando a la izquierda. Los PNG se
// dibujan siempre "mirando a la derecha", así que al girar el personaje el
// hueso rota ~180° y el sprite quedaría boca abajo; el espejeo vertical
// adicional (scale 1,-1) lo compensa para que la pose se lea del derecho.
export function drawPiece(ctx, img, a, b, tune, S = 1, facing = 1) {
  if (!img || tune.visible === false) return;

  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);

  // Alto en mundo: el grosor del hueso por el ajuste del usuario
  const thick = (tune.thickness ?? 1) * (tune.scale ?? 1) * S;
  const drawLen = len * (tune.lengthMul ?? 1);
  const drawH   = thick;

  ctx.save();
  ctx.translate(a.x, a.y);
  // Mirando a la izquierda, el render debe ser el ESPEJO horizontal exacto
  // del lado derecho: eso exige invertir también el signo de la rotación de
  // ajuste (rot). Con rot sin espejar, cada pieza queda girada 2·rot de más.
  const rot = ((tune.rot ?? 0) * Math.PI) / 180;
  ctx.rotate(ang + (facing < 0 ? -rot : rot));
  if (facing < 0) ctx.scale(1, -1);   // compensa el giro del personaje
  if (tune.flip) ctx.scale(1, -1);
  ctx.translate((tune.offX ?? 0) * S, (tune.offY ?? 0) * S);
  ctx.drawImage(img, 0, -drawH / 2, drawLen, drawH);
  ctx.restore();
}

// Resuelve el grosor real de una pieza: el natural del hueso, por el ajuste.
export function boneThickness(id) {
  return BONE_THICKNESS[id] ?? 20;
}

// Geometría de una pieza del jinete en coordenadas de mundo: centro, ángulo,
// ancho y alto. La usa el editor tanto para saber si clickeaste arriba de la
// pieza como para dibujar sus manijas de arrastre/rotación — así el hit-test
// y el dibujo nunca se desincronizan del transform real que usa drawPiece.
export function pieceGeometry(id, points, tune, S = 1, facing = 1) {
  const bone = BONES[id];
  if (!bone) return null;
  const a = points[bone.from], b = points[bone.to];
  if (!a || !b) return null;

  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const baseAng = Math.atan2(dy, dx);
  const rot = ((tune.rot ?? 0) * Math.PI) / 180;
  const ang = baseAng + (facing < 0 ? -rot : rot);

  const drawLen = len * (tune.lengthMul ?? 1);
  const drawH   = boneThickness(id) * (tune.scale ?? 1) * S;
  const flipY   = (facing < 0) !== !!tune.flip ? -1 : 1;

  // Centro del sprite dibujado: el pivote (a) más el offset local, más medio
  // largo hacia adelante (drawImage arranca en 0, no está centrado en x).
  const ox = (tune.offX ?? 0) * S, oy = (tune.offY ?? 0) * S * flipY;
  const cx = a.x + Math.cos(ang) * (ox + drawLen / 2) - Math.sin(ang) * oy;
  const cy = a.y + Math.sin(ang) * (ox + drawLen / 2) + Math.cos(ang) * oy;

  return { pivot: a, center: { x: cx, y: cy }, angle: ang, w: drawLen, h: drawH, flipY };
}

// Igual que pieceGeometry, pero para una pieza de la escoba (ancla sobre el
// eje cola→punta en vez de sobre un hueso del ragdoll).
export function broomPieceGeometry(id, broom, tune, S = 1, facing = 1) {
  const lay = BROOM_SPANS[id];
  if (!lay) return null;
  const d = broom.dir();
  const tail = broom.tail();
  const baseAng = Math.atan2(d.y, d.x);
  const rot = ((tune.rot ?? 0) * Math.PI) / 180;
  const ang = baseAng + (facing < 0 ? -rot : rot);

  const start = (lay.start + (tune.offX ?? 0)) * S;
  const lenRaw = lay.len * (tune.lengthMul ?? 1) * S;
  const drawH  = lay.thickness * (tune.scale ?? 1) * S;
  const flipY  = (facing < 0) !== !!tune.flip ? -1 : 1;

  const pivotX = tail.x + d.x * start, pivotY = tail.y + d.y * start;
  // len negativo (cepillo) dibuja hacia atrás desde el pivote
  const halfLen = lenRaw / 2;
  const cx = pivotX + Math.cos(ang) * halfLen;
  const cy = pivotY + Math.sin(ang) * halfLen;

  return {
    pivot: { x: pivotX, y: pivotY }, center: { x: cx, y: cy },
    angle: ang, w: Math.abs(lenRaw), h: drawH, flipY, negLen: lenRaw < 0,
  };
}

// ¿El punto (px,py) cae dentro del rectángulo de la pieza? Rota el punto al
// espacio local de la pieza y compara contra medio ancho/alto — más barato
// que armar un Path2D y usar isPointInPath.
export function hitPiece(geo, px, py) {
  if (!geo) return false;
  const dx = px - geo.center.x, dy = py - geo.center.y;
  const c = Math.cos(-geo.angle), s = Math.sin(-geo.angle);
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  return Math.abs(lx) <= geo.w / 2 + 4 && Math.abs(ly) <= geo.h / 2 + 4;
}

// ── El skin como objeto ───────────────────────────────────────────────────
export class SpriteSkin {
  // parts: { [pieceId]: { img: HTMLImageElement, tune: {...} } }
  // order: orden de dibujo (de atrás hacia adelante). Si no se pasa, se usa
  // el orden por defecto — así los skins guardados antes de que esto
  // existiera se siguen viendo igual.
  constructor(parts = {}, name = 'Personalizado', order = null) {
    this.name  = name;
    this.parts = parts;
    this.order = order ? [...order] : [...DRAW_ORDER];
  }

  has(id) { return !!this.parts[id]?.img; }

  // ¿Alcanza para reemplazar al skin geométrico? Si faltan piezas clave, la
  // escena puede seguir usando el dibujo por defecto y no romperse.
  get ready() {
    return this.has('torso') && this.has('cabeza');
  }

  // Subir/bajar una pieza en el orden de dibujo (más arriba = más adelante,
  // se dibuja encima de lo que tiene abajo). Salta piezas sin imagen: son
  // invisibles, así que intercambiar contra una de ellas no movería nada en
  // pantalla y el botón se sentiría roto.
  moveLayer(id, dir) {
    const i = this.order.indexOf(id);
    if (i < 0) return;
    let j = i + dir;
    while (j >= 0 && j < this.order.length) {
      const other = this.order[j];
      if (other !== '__broom__' && this.has(other)) break;
      j += dir;
    }
    if (j < 0 || j >= this.order.length) return;
    [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
  }

  // Dibuja el cuerpo. `drawBroom` es un callback: el skin no sabe dibujar la
  // escoba, solo sabe en qué momento del orden tiene que aparecer.
  // `facing`: +1 mirando a la derecha, -1 mirando a la izquierda (ver drawPiece).
  draw(ctx, points, S, drawBroom, facing = 1) {
    for (const id of this.order) {
      if (id === '__broom__') { drawBroom?.(); continue; }
      const part = this.parts[id];
      if (!part?.img) continue;
      const bone = BONES[id];
      const a = points[bone.from], b = points[bone.to];
      if (!a || !b) continue;
      drawPiece(ctx, part.img, a, b, {
        ...part.tune,
        thickness: boneThickness(id),
      }, S, facing);
    }
  }

  // Serializar para guardar en localStorage: las imágenes van como data URL.
  toJSON() {
    const out = { name: this.name, parts: {}, order: this.order };
    for (const [id, part] of Object.entries(this.parts)) {
      if (!part?.src) continue;
      out.parts[id] = { src: part.src, tune: part.tune };
    }
    return out;
  }

  static async fromJSON(data) {
    const parts = {};
    const jobs = Object.entries(data.parts || {}).map(([id, p]) => (
      new Promise((resolve) => {
        const img = new Image();
        img.onload  = () => { parts[id] = { img, src: p.src, tune: p.tune }; resolve(); };
        img.onerror = () => resolve();
        img.src = p.src;
      })
    ));
    await Promise.all(jobs);
    return new SpriteSkin(parts, data.name || 'Personalizado', data.order);
  }
}

// ── Persistencia ──────────────────────────────────────────────────────────
const STORE_KEY = 'escoba.skin.v1';

export function saveSkin(skin) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(skin.toJSON()));
    return true;
  } catch (e) {
    // Los data URL de varios PNG grandes pueden pasarse de la cuota
    console.warn('No se pudo guardar el skin:', e);
    return false;
  }
}

export async function loadSkin() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    return await SpriteSkin.fromJSON(JSON.parse(raw));
  } catch (e) {
    console.warn('No se pudo cargar el skin:', e);
    return null;
  }
}

export function clearSkin() {
  try { localStorage.removeItem(STORE_KEY); } catch {}
}

// ══ ESCOBA ════════════════════════════════════════════════════════════════
// La escoba no es un ragdoll: es un segmento rígido de tail a tip. Aun así
// conviene partirla en piezas, porque cada una se ancla distinto:
//   palo    → cubre todo el largo, de la cola a la punta
//   cepillo → cuelga de la cola hacia atrás, largo fijo
//   atadura → un adorno chico sobre la unión palo/cepillo
//   punta   → detalle opcional en el extremo delantero
//
// Los efectos (resplandor, runas, temblor) siguen siendo procedurales: dependen
// de la velocidad y el boost, así que no tiene sentido convertirlos en PNG.

export const BROOM_PIECES = [
  { id: 'palo',     label: 'Palo',     hint: 'El mango. Cola a la izquierda, punta a la derecha.' },
  { id: 'cepillo',  label: 'Cepillo',  hint: 'Las ramas. Se dibujan apuntando a la derecha; se montan hacia atrás.' },
  { id: 'atadura',  label: 'Atadura',  hint: 'La cuerda que ata las ramas al palo. Opcional.' },
  { id: 'punta',    label: 'Punta',    hint: 'Adorno del extremo delantero. Opcional.' },
];

// Dónde vive cada pieza sobre el eje de la escoba, en unidades de mundo
// medidas desde la COLA hacia la PUNTA. `thickness` es el alto natural.
export const BROOM_SPANS = {
  cepillo: { start: 16,  len: -46, thickness: 46 },  // len negativo = hacia atrás
  palo:    { start: 14,  len: 96,  thickness: 16 },
  atadura: { start: 6,   len: 18,  thickness: 22 },
  punta:   { start: 88,  len: 22,  thickness: 20 },
};

// Orden de dibujo: el cepillo va detrás del palo, los adornos encima.
export const BROOM_ORDER = ['cepillo', 'palo', 'atadura', 'punta'];

export class BroomSkin {
  constructor(parts = {}, name = 'Mi escoba', order = null) {
    this.name  = name;
    this.parts = parts;
    this.order = order ? [...order] : [...BROOM_ORDER];
  }

  has(id) { return !!this.parts[id]?.img; }

  // Con el palo alcanza: el resto son adornos.
  get ready() { return this.has('palo'); }

  // Ver el comentario en SpriteSkin.moveLayer: salta piezas sin imagen para
  // que el botón siempre mueva algo visible.
  moveLayer(id, dir) {
    const i = this.order.indexOf(id);
    if (i < 0) return;
    let j = i + dir;
    while (j >= 0 && j < this.order.length && !this.has(this.order[j])) j += dir;
    if (j < 0 || j >= this.order.length) return;
    [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
  }

  // Dibuja sobre el eje cola→punta. `broom` es el objeto físico real, así que
  // la escoba dibujada sigue exactamente la que colisiona.
  // `facing`: -1 espeja verticalmente (mirando a la izquierda el sprite se ve
  // como espejo del lado derecho en vez de boca abajo).
  draw(ctx, broom, S = 1, facing = 1) {
    const d = broom.dir();
    const tail = broom.tail();
    const ang = Math.atan2(d.y, d.x);

    for (const id of this.order) {
      const part = this.parts[id];
      if (!part?.img || part.tune?.visible === false) continue;
      const lay = BROOM_SPANS[id];
      const t = part.tune || {};

      const start = (lay.start + (t.offX ?? 0)) * S;
      const len   = lay.len * (t.lengthMul ?? 1) * S;
      const thick = lay.thickness * (t.scale ?? 1) * S;

      ctx.save();
      ctx.translate(tail.x + d.x * start, tail.y + d.y * start);
      const rot = ((t.rot ?? 0) * Math.PI) / 180;
      ctx.rotate(ang + (facing < 0 ? -rot : rot));
      if (facing < 0) ctx.scale(1, -1);
      if (t.flip) ctx.scale(1, -1);
      ctx.translate(0, (t.offY ?? 0) * S);
      // len negativo dibuja hacia atrás: se espeja en X y se usa el valor abs
      if (len < 0) {
        ctx.scale(-1, 1);
        ctx.drawImage(part.img, 0, -thick / 2, -len, thick);
      } else {
        ctx.drawImage(part.img, 0, -thick / 2, len, thick);
      }
      ctx.restore();
    }
  }

  toJSON() {
    const out = { name: this.name, parts: {}, order: this.order };
    for (const [id, part] of Object.entries(this.parts)) {
      if (!part?.src) continue;
      out.parts[id] = { src: part.src, tune: part.tune };
    }
    return out;
  }

  static async fromJSON(data) {
    const parts = {};
    const jobs = Object.entries(data.parts || {}).map(([id, p]) => (
      new Promise((resolve) => {
        const img = new Image();
        img.onload  = () => { parts[id] = { img, src: p.src, tune: p.tune }; resolve(); };
        img.onerror = () => resolve();
        img.src = p.src;
      })
    ));
    await Promise.all(jobs);
    return new BroomSkin(parts, data.name || 'Mi escoba', data.order);
  }
}

export function broomThickness(id) {
  return BROOM_SPANS[id]?.thickness ?? 20;
}

const BROOM_KEY = 'escoba.broom.v1';

export function saveBroomSkin(skin) {
  try {
    localStorage.setItem(BROOM_KEY, JSON.stringify(skin.toJSON()));
    return true;
  } catch (e) {
    console.warn('No se pudo guardar la escoba:', e);
    return false;
  }
}

export async function loadBroomSkin() {
  try {
    const raw = localStorage.getItem(BROOM_KEY);
    if (!raw) return null;
    return await BroomSkin.fromJSON(JSON.parse(raw));
  } catch (e) {
    console.warn('No se pudo cargar la escoba:', e);
    return null;
  }
}

export function clearBroomSkin() {
  try { localStorage.removeItem(BROOM_KEY); } catch {}
}
