// Menú principal: modo de juego → a jugar.
//
// Vive fuera del loop del partido: se dibuja en su propio canvas y cuando el
// jugador confirma, llama a onStart(config) con todo elegido. Quien lo use
// decide qué hacer con eso (arrancar main.js, navegar, lo que sea).
//
// Contrato de salida:
//   { mode: '1v1' | '2v2' | 'practica', opts: {...} }
//
// Sin selección de personaje por ahora: el modo alcanza para arrancar. Si en
// el futuro vuelve, es una página más entre 'modo' y el arranque.
//
// Se dibuja en canvas 2D con la misma tipografía y paleta que el juego, así el
// menú y el partido se leen como la misma cosa.
import { CFG } from './config.js';
import { clamp } from './utils.js';

// ── Modos ──────────────────────────────────────────────────────────────────
// `slots` = cuántos personajes elige el jugador (en 2v2 también el compañero).
const MODES = [
  {
    id: '1v1', name: '1 vs 1', tag: '⚔️',
    desc: 'Duelo directo contra un rival',
    detail: 'Vos y un rival. El primero que llegue al marcador se lleva el partido.',
    slots: 1, color: CFG.colors.p1,
  },
  {
    id: '2v2', name: '2 vs 2', tag: '🛡️',
    desc: 'En equipo, con un compañero',
    detail: 'Vos y un aliado contra dos rivales. Uno ataca y el otro cubre: repartirse la cancha es la clave.',
    slots: 2, color: CFG.colors.p2,
  },
  {
    id: 'practica', name: 'Práctica', tag: '🎯',
    desc: 'Cancha libre, sin rivales',
    detail: 'Sin reloj ni marcador. Los arcos siguen ahí para practicar puntería a tu ritmo.',
    slots: 1, color: '#7ee8a2',
  },
];

// ── Filtro visual ──────────────────────────────────────────────────────────
// Post-proceso del menú. La idea es emparejar los gráficos: los degradados
// planos y los bordes de vector se unen bajo una misma luz en vez de leerse
// como formas pegadas encima del fondo. Todo suave a propósito — si se nota
// el filtro, está de más.
const MENU_FX = {
  bloom: {
    strength:   0.42,  // cuánto resplandor se suma (0 = apagado)
    // Ojo con bajar `brightness`: por debajo de ~0.5 se apagan los medios
    // tonos donde vive el texto y el bloom deja de verse (medido: a 0.34 el
    // título ganaba +0.7 de luminancia, o sea nada; a 0.7 gana +20).
    brightness: 0.70,
    contrast:   2.5,   // separa las luces del resto
    passes: [
      // Halo ceñido: define el borde luminoso de textos y bordes.
      { scale: 0.25, blur: 1.6, weight: 1.00 },
      // Halo amplio: tiñe el aire alrededor, da la sensación de atmósfera.
      { scale: 0.10, blur: 2.2, weight: 0.62 },
    ],
  },
  vignette: {
    strength: 0.30,   // oscurecimiento en las esquinas
    inner:    0.38,   // dónde arranca (fracción del lado corto)
    outer:    0.68,   // dónde termina (fracción de la diagonal)
  },
  grain: {
    strength: 0.035,  // muy sutil: solo rompe el bandeado
    fps:      12,     // saltos por segundo del patrón
  },
};

// Opciones persistidas en localStorage
const DEFAULT_OPTS = {
  duration: 120,     // segundos de partido
  difficulty: 'normal',
  sound: true,
  orbs: true,
};

const DIFFICULTIES = ['facil', 'normal', 'dificil'];
const DIFF_LABEL = { facil: 'Fácil', normal: 'Normal', dificil: 'Difícil' };
const DURATIONS = [60, 120, 180];

const STORE_KEY = 'escoba.menu.v1';

function loadOpts() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULT_OPTS };
    return { ...DEFAULT_OPTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_OPTS };
  }
}

function saveOpts(opts) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(opts)); } catch { /* sin storage: da igual */ }
}

// ── Utilidades de dibujo ───────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Convierte '#rrggbb' a 'rgba(r,g,b,a)'
function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ── Menú ───────────────────────────────────────────────────────────────────
export class Menu {
  // onStart: (config) => void — se llama al confirmar todo.
  constructor(canvas, onStart) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onStart = onStart;

    this.page = 'modo';        // modo | opciones
    this.mode = null;          // objeto de MODES
    this.opts = loadOpts();

    this.t = 0;                // reloj para animaciones
    this.hot = null;           // id del elemento bajo el cursor
    this.mouse = { x: -1, y: -1 };
    this.rects = [];           // zonas clickeables recalculadas cada frame
    this.done = false;

    // Transición suave entre páginas
    this.fade = 1;
    this.pageT = 0;

    // Estrellas del fondo: fijas, para que el menú no sea un plano liso
    this.stars = Array.from({ length: 70 }, () => ({
      x: Math.random(), y: Math.random(),
      r: 0.6 + Math.random() * 1.6,
      p: Math.random() * Math.PI * 2,
      s: 0.5 + Math.random(),
    }));

    this._bind();
  }

  // ── Entrada ──────────────────────────────────────────────────────────────
  _bind() {
    this._onMove = (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    };
    this._onDown = (e) => {
      if (this.done) return;
      this._onMove(e);
      const hit = this._hitTest(this.mouse.x, this.mouse.y);
      if (hit) this._activate(hit);
    };
    this._onKey = (e) => {
      if (this.done) return;
      const k = e.key;
      if (k === 'Escape')     { this._back(); e.preventDefault(); }
      if (k === 'Enter')      { this._confirm(); e.preventDefault(); }
      if (k === 'ArrowLeft')  { this._nudge(-1); e.preventDefault(); }
      if (k === 'ArrowRight') { this._nudge(+1); e.preventDefault(); }
    };

    this.canvas.addEventListener('mousemove', this._onMove);
    this.canvas.addEventListener('mousedown', this._onDown);
    addEventListener('keydown', this._onKey);
  }

  destroy() {
    this.canvas.removeEventListener('mousemove', this._onMove);
    this.canvas.removeEventListener('mousedown', this._onDown);
    removeEventListener('keydown', this._onKey);
  }

  // Flechas: en la página de modo cambian de tarjeta
  _nudge(d) {
    if (this.page === 'modo') {
      const i = this.mode ? MODES.indexOf(this.mode) : 0;
      this.mode = MODES[clamp(i + d, 0, MODES.length - 1)];
    }
  }

  _back() {
    if (this.page === 'opciones') this._go('modo');
  }

  _confirm() {
    if (this.page === 'modo' && this.mode) this._start();
  }

  _go(page) {
    this.page = page;
    this.pageT = 0;
    this.fade = 0;
  }

  _activate(id) {
    // Modos: elegir la tarjeta y arrancar directo, sin paso intermedio.
    const mode = MODES.find((m) => m.id === id);
    if (mode) { this.mode = mode; this._start(); return; }

    if (id === 'opciones')  { this._go('opciones'); return; }
    if (id === 'volver')    { this._back(); return; }
    if (id === 'jugar')     { this._start(); return; }

    // Opciones
    if (id === 'opt:duration') {
      const i = DURATIONS.indexOf(this.opts.duration);
      this.opts.duration = DURATIONS[(i + 1) % DURATIONS.length];
    }
    if (id === 'opt:difficulty') {
      const i = DIFFICULTIES.indexOf(this.opts.difficulty);
      this.opts.difficulty = DIFFICULTIES[(i + 1) % DIFFICULTIES.length];
    }
    if (id === 'opt:sound') this.opts.sound = !this.opts.sound;
    if (id === 'opt:orbs')  this.opts.orbs = !this.opts.orbs;
    if (id.startsWith('opt:')) saveOpts(this.opts);
  }

  _start() {
    if (!this.mode) return;
    this.done = true;
    saveOpts(this.opts);
    const cfg = {
      mode: this.mode.id,
      opts: { ...this.opts },
    };
    this.destroy();
    this.onStart?.(cfg);
  }

  _hitTest(x, y) {
    // Se recorre al revés: lo dibujado último queda arriba
    for (let i = this.rects.length - 1; i >= 0; i--) {
      const r = this.rects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.id;
    }
    return null;
  }

  // Registra una zona clickeable para este frame
  _zone(id, x, y, w, h) {
    this.rects.push({ id, x, y, w, h });
    return this.hot === id;
  }

  // ── Loop ─────────────────────────────────────────────────────────────────
  update(dt) {
    this.t += dt;
    this.pageT += dt;
    this.fade = Math.min(1, this.fade + dt * 4);
  }

  draw() {
    const ctx = this.ctx;
    const W = this.canvas.clientWidth || this.canvas.width;
    const H = this.canvas.clientHeight || this.canvas.height;

    this.rects = [];
    this.hot = this._hitTest(this.mouse.x, this.mouse.y);

    // Todo se pinta primero en un buffer aparte: así el bloom puede leer la
    // imagen terminada y devolver el resplandor encima. Dibujar directo al
    // canvas visible no deja hacer eso (no se puede leer y escribir a la vez
    // sin que el filtro se realimente frame a frame).
    const buf = this._buffer(W, H);
    const bx = buf.ctx;

    this._background(bx, W, H);

    // Las páginas entran con un fade + leve desplazamiento hacia arriba
    bx.save();
    bx.globalAlpha = this.fade;
    bx.translate(0, (1 - this.fade) * 18);

    if (this.page === 'modo')      this._pageModo(bx, W, H);
    else if (this.page === 'opciones') this._pageOpciones(bx, W, H);

    bx.restore();

    // ── Composición final ──
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(buf.canvas, 0, 0, W, H);
    this._bloom(ctx, buf.canvas, W, H);
    this._vignette(ctx, W, H);
    this._grain(ctx, W, H);

    // El cursor va después del filtro: tiene que leerse nítido siempre
    this._cursor(ctx);

    // Recalcular hover con las zonas nuevas: si no, el primer frame tras
    // cambiar de página resalta lo que estaba antes.
    this.hot = this._hitTest(this.mouse.x, this.mouse.y);
  }

  // ── Post-proceso ──────────────────────────────────────────────────────────
  // Buffer del tamaño de la pantalla donde se pinta la escena sin filtrar.
  _buffer(W, H) {
    if (!this._buf) {
      const c = document.createElement('canvas');
      this._buf = { canvas: c, ctx: c.getContext('2d'), w: 0, h: 0 };
    }
    const b = this._buf;
    if (b.w !== W || b.h !== H) {
      b.canvas.width = W; b.canvas.height = H;
      b.w = W; b.h = H;
    }
    b.ctx.setTransform(1, 0, 0, 1, 0, 0);
    b.ctx.clearRect(0, 0, W, H);
    return b;
  }

  // Bloom: se reduce la escena a una fracción del tamaño (eso ya difumina y
  // además hace el filtro barato), se sube el contraste para quedarse solo con
  // lo más brillante, y se suma de vuelta con 'lighter'. Dos pasadas de radio
  // distinto: una ceñida que da el halo, otra amplia que tiñe el aire.
  _bloom(ctx, src, W, H) {
    const B = MENU_FX.bloom;
    if (!B.strength) return;

    if (!this._bloomBufs) {
      this._bloomBufs = [0, 1].map(() => {
        const c = document.createElement('canvas');
        return { canvas: c, ctx: c.getContext('2d') };
      });
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    B.passes.forEach((pass, i) => {
      const b = this._bloomBufs[i];
      const w = Math.max(1, Math.round(W * pass.scale));
      const h = Math.max(1, Math.round(H * pass.scale));
      if (b.canvas.width !== w || b.canvas.height !== h) {
        b.canvas.width = w; b.canvas.height = h;
      }

      // Extraer lo brillante: brightness bajo apaga los medios tonos, y el
      // contraste alto separa las luces del resto. Lo que sobrevive es el
      // halo. `blur` termina de suavizar los bordes del reescalado.
      b.ctx.setTransform(1, 0, 0, 1, 0, 0);
      b.ctx.clearRect(0, 0, w, h);
      b.ctx.filter = `brightness(${B.brightness}) contrast(${B.contrast}) blur(${pass.blur}px)`;
      b.ctx.drawImage(src, 0, 0, w, h);
      b.ctx.filter = 'none';

      ctx.globalAlpha = B.strength * pass.weight;
      ctx.drawImage(b.canvas, 0, 0, W, H);
    });

    ctx.restore();
  }

  // Viñeta: oscurece las esquinas para que la vista caiga al centro.
  _vignette(ctx, W, H) {
    const V = MENU_FX.vignette;
    if (!V.strength) return;
    const g = ctx.createRadialGradient(
      W / 2, H / 2, Math.min(W, H) * V.inner,
      W / 2, H / 2, Math.hypot(W, H) * V.outer,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(4,3,14,${V.strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Grano fino: rompe el bandeado de los degradados y le saca el look plano
  // de vector. Se genera una vez y se repite desplazado, que es mucho más
  // barato que rehacer el ruido cada frame.
  _grain(ctx, W, H) {
    const G = MENU_FX.grain;
    if (!G.strength) return;

    if (!this._grainPat) {
      const S = 128;
      const c = document.createElement('canvas');
      c.width = S; c.height = S;
      const g = c.getContext('2d');
      const img = g.createImageData(S, S);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 120 + Math.random() * 135;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      this._grainPat = ctx.createPattern(c, 'repeat');
      this._grainSize = S;
    }

    // Se mueve a saltos discretos: si se desplazara continuo, el grano
    // "flotaría" y llamaría la atención en vez de disimularse.
    const S = this._grainSize;
    const step = Math.floor(this.t * G.fps);
    const ox = (step * 37) % S;
    const oy = (step * 61) % S;

    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = G.strength;
    ctx.translate(-ox, -oy);
    ctx.fillStyle = this._grainPat;
    ctx.fillRect(0, 0, W + S, H + S);
    ctx.restore();
  }

  // ── Fondo ────────────────────────────────────────────────────────────────
  _background(ctx, W, H) {
    // Degradado nocturno, el mismo cielo que la cancha
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d0b22');
    g.addColorStop(0.55, '#0a0918');
    g.addColorStop(1, '#07061a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Estrellas titilando
    for (const s of this.stars) {
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(this.t * s.s + s.p));
      ctx.globalAlpha = tw * 0.8;
      ctx.fillStyle = '#cfe6ff';
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Resplandor cálido abajo: sugiere el castillo sin dibujarlo
    const gl = ctx.createRadialGradient(W / 2, H * 1.08, 0, W / 2, H * 1.08, H * 0.62);
    gl.addColorStop(0, 'rgba(255,170,70,0.20)');
    gl.addColorStop(1, 'rgba(255,170,70,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(0, 0, W, H);
  }

  // Título del juego, compartido por las páginas
  _header(ctx, W, sub) {
    const cx = W / 2;
    const bob = Math.sin(this.t * 1.6) * 3;

    ctx.textAlign = 'center';
    ctx.font = 'bold 62px Georgia, serif';
    ctx.fillStyle = '#f3efff';
    ctx.shadowColor = CFG.colors.p1Glow;
    ctx.shadowBlur = 26;
    ctx.fillText('ESCOBA VOLADORA', cx, 96 + bob);
    ctx.shadowBlur = 0;

    // Subrayado mágico
    ctx.strokeStyle = alpha(CFG.colors.p1, 0.5);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 210, 112 + bob);
    ctx.lineTo(cx + 210, 112 + bob);
    ctx.stroke();

    if (sub) {
      ctx.font = '18px Georgia, serif';
      ctx.fillStyle = 'rgba(232,230,245,0.62)';
      ctx.fillText(sub, cx, 142 + bob);
    }
  }

  // Pie con las teclas disponibles
  _footer(ctx, W, H, text) {
    ctx.textAlign = 'center';
    ctx.font = '14px Georgia, serif';
    ctx.fillStyle = 'rgba(232,230,245,0.34)';
    ctx.fillText(text, W / 2, H - 26);
  }

  // ── Página: modo de juego ────────────────────────────────────────────────
  _pageModo(ctx, W, H) {
    this._header(ctx, W, 'Elegí cómo querés jugar');

    const CW = 260, CH = 300, GAP = 26;
    const total = MODES.length * CW + (MODES.length - 1) * GAP;
    const x0 = (W - total) / 2;
    const y = H / 2 - CH / 2 + 26;

    MODES.forEach((m, i) => {
      const x = x0 + i * (CW + GAP);
      const hover = this._zone(m.id, x, y, CW, CH);
      const sel = this.mode === m;
      this._modeCard(ctx, m, x, y, CW, CH, hover, sel);
    });

    // Botón de opciones, discreto abajo
    const bw = 150, bh = 40;
    const bx = W / 2 - bw / 2, by = y + CH + 34;
    const hov = this._zone('opciones', bx, by, bw, bh);
    this._button(ctx, '⚙  Opciones', bx, by, bw, bh, hov, 'rgba(232,230,245,0.5)');

    this._footer(ctx, W, H, '← →  elegir     ENTER  jugar');
  }

  _modeCard(ctx, m, x, y, w, h, hover, sel) {
    const lift = hover || sel ? -6 : 0;
    const yy = y + lift;

    ctx.save();

    // Halo del color del modo cuando está activa
    if (hover || sel) {
      ctx.shadowColor = alpha(m.color, 0.55);
      ctx.shadowBlur = 30;
    }

    // Cuerpo
    roundRect(ctx, x, yy, w, h, 16);
    const g = ctx.createLinearGradient(x, yy, x, yy + h);
    g.addColorStop(0, hover || sel ? 'rgba(30,28,60,0.95)' : 'rgba(20,18,42,0.85)');
    g.addColorStop(1, 'rgba(12,11,28,0.92)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Borde
    roundRect(ctx, x, yy, w, h, 16);
    ctx.strokeStyle = hover || sel ? m.color : 'rgba(255,255,255,0.10)';
    ctx.lineWidth = sel ? 2.5 : 1.5;
    ctx.stroke();

    const cx = x + w / 2;

    // Ícono
    ctx.textAlign = 'center';
    ctx.font = '58px Georgia, serif';
    ctx.fillText(m.tag, cx, yy + 96);

    // Nombre
    ctx.font = 'bold 30px Georgia, serif';
    ctx.fillStyle = hover || sel ? '#fff' : '#e8e6f5';
    ctx.fillText(m.name, cx, yy + 146);

    // Descripción corta
    ctx.font = '15px Georgia, serif';
    ctx.fillStyle = alpha(m.color, 0.9);
    ctx.fillText(m.desc, cx, yy + 174);

    // Detalle en dos líneas
    ctx.font = '13px Georgia, serif';
    ctx.fillStyle = 'rgba(232,230,245,0.45)';
    this._wrap(ctx, m.detail, cx, yy + 204, w - 44, 19, 3);

    // Marca de selección
    if (sel) {
      ctx.fillStyle = m.color;
      ctx.font = 'bold 13px Georgia, serif';
      ctx.fillText('▼ SELECCIONADO', cx, yy + h - 18);
    }

    ctx.restore();
  }

  // ── Página: opciones ─────────────────────────────────────────────────────
  _pageOpciones(ctx, W, H) {
    this._header(ctx, W, 'Opciones');

    const RW = 460, RH = 56, GAP = 12;
    const x = W / 2 - RW / 2;
    let y = 210;

    const rows = [
      ['opt:duration',   'Duración del partido', `${this.opts.duration}s`],
      ['opt:difficulty', 'Dificultad de los bots', DIFF_LABEL[this.opts.difficulty]],
      ['opt:sound',      'Sonido',  this.opts.sound ? 'Activado' : 'Silenciado'],
      ['opt:orbs',       'Orbes de energía', this.opts.orbs ? 'Activados' : 'Desactivados'],
    ];

    for (const [id, label, value] of rows) {
      const hover = this._zone(id, x, y, RW, RH);
      this._optionRow(ctx, label, value, x, y, RW, RH, hover);
      y += RH + GAP;
    }

    const bw = 170, bh = 46;
    const bx = W / 2 - bw / 2, by = y + 26;
    const hov = this._zone('volver', bx, by, bw, bh);
    this._button(ctx, '←  Volver', bx, by, bw, bh, hov, CFG.colors.p1);

    this._footer(ctx, W, H, 'Clic para cambiar     ESC  volver');
  }

  _optionRow(ctx, label, value, x, y, w, h, hover) {
    ctx.save();
    roundRect(ctx, x, y, w, h, 10);
    ctx.fillStyle = hover ? 'rgba(63,192,255,0.10)' : 'rgba(255,255,255,0.04)';
    ctx.fill();
    roundRect(ctx, x, y, w, h, 10);
    ctx.strokeStyle = hover ? alpha(CFG.colors.p1, 0.55) : 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = '17px Georgia, serif';
    ctx.fillStyle = '#e8e6f5';
    ctx.fillText(label, x + 20, y + h / 2 + 6);

    ctx.textAlign = 'right';
    ctx.font = 'bold 17px Georgia, serif';
    ctx.fillStyle = hover ? '#fff' : CFG.colors.p1;
    ctx.fillText(value, x + w - 20, y + h / 2 + 6);
    ctx.restore();
  }

  // ── Piezas compartidas ───────────────────────────────────────────────────
  _button(ctx, text, x, y, w, h, hover, color, solid = false) {
    ctx.save();
    if (hover) { ctx.shadowColor = alpha(color.startsWith('#') ? color : CFG.colors.p1, 0.5); ctx.shadowBlur = 20; }

    roundRect(ctx, x, y, w, h, h / 2);
    if (solid) {
      ctx.fillStyle = hover ? color : alpha(color, 0.82);
      ctx.fill();
    } else {
      ctx.fillStyle = hover ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.04)';
      ctx.fill();
      roundRect(ctx, x, y, w, h, h / 2);
      ctx.strokeStyle = hover ? color : 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    ctx.textAlign = 'center';
    ctx.font = 'bold 17px Georgia, serif';
    ctx.fillStyle = solid ? '#08131c' : (hover ? '#fff' : color);
    ctx.fillText(text, x + w / 2, y + h / 2 + 6);
    ctx.restore();
  }

  // Texto centrado con corte por palabras y tope de líneas
  _wrap(ctx, text, cx, y, maxW, lh, maxLines) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = word;
        if (lines.length === maxLines) break;
      } else {
        line = test;
      }
    }
    if (lines.length < maxLines && line) lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l, cx, y + i * lh));
  }

  // Cursor propio: el canvas del juego esconde el del sistema
  _cursor(ctx) {
    const { x, y } = this.mouse;
    if (x < 0) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.stroke();
    ctx.fillStyle = CFG.colors.p1;
    ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 7); ctx.fill();
    ctx.restore();
  }
}

export { MODES, DEFAULT_OPTS, MENU_FX };
