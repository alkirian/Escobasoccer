// Galería de personajes: los 5 héroes animados sobre su ragdoll real, para
// elegir con cuál jugar. Usa el MISMO Renderer y la MISMA física del juego —
// lo que ves acá es exactamente lo que vas a ver en la cancha.
import { CFG, FIXED_DT } from './config.js';
import { Player } from './player.js';
import { Renderer } from './render.js';
import { ROSTER, CHARACTERS } from './characters.js';
import { statsHTML } from './statsui.js';
import { pasivaOf } from './stats_chars.js';
import { isUnlocked, COSTS, coins, tryUnlock } from './roster.js';
import {
  CHALLENGES, isDone, unlockedPalettes, selectedPalettes, selectPalette,
} from './challenges.js';

const CHAR_KEY = 'escoba.character.v1';

// Renderer "prestado": necesita un canvas en el constructor pero dibuja en
// el ctx que se le pase a _player, así que uno oculto alcanza para todos.
const dummy = document.createElement('canvas');
dummy.width = 10; dummy.height = 10;
const rd = new Renderer(dummy, dummy.getContext('2d'));
// La galería muestra los personajes BASE: sin skins PNG ni vectoriales.
rd.skin = null; rd.broomSkin = null; rd.vskin = null;

// Mundo mínimo: _player solo lo usa para saber si el jugador es "el humano"
// (previsualización de puntería) — acá nadie lo es.
const noWorld = { playerA: null, botsMode: true };

let selected = (() => {
  try { return localStorage.getItem(CHAR_KEY) || 'mago'; } catch { return 'mago'; }
})();

const grid = document.getElementById('grid');
const cards = [];

for (const hero of ROSTER) {
  const libre = isUnlocked(hero.id);
  const pas = pasivaOf(hero.id);
  const card = document.createElement('div');
  card.className = 'card' + (hero.id === selected ? ' on' : '') + (libre ? '' : ' locked');
  card.innerHTML = `
    <canvas width="470" height="420"></canvas>
    <div class="nom">${libre ? '' : '🔒 '}${hero.nombre} <small>${hero.titulo}</small></div>
    <div class="rol">${hero.rol}</div>
    <p class="bio">${hero.bio}</p>
    ${statsHTML(hero.id)}
    ${pas ? `<div class="pasiva">${pas.icono} <b>${pas.nombre}</b> — ${pas.desc}</div>` : ''}
    <div class="pal-row"></div>
    ${libre ? '<div class="sel">✓ Seleccionado</div>'
            : `<button class="buy">Desbloquear por ${COSTS[hero.id] ?? '?'} 🪙</button>`}`;
  card.onclick = () => {
    if (!isUnlocked(hero.id)) return;   // bloqueado: no se selecciona
    selected = hero.id;
    try { localStorage.setItem(CHAR_KEY, hero.id); } catch { /* sin storage */ }
    for (const c of cards) c.el.classList.toggle('on', c.hero.id === hero.id);
  };
  // Compra desde la tarjeta: si alcanzan las monedas, se desbloquea en el
  // acto (recarga para reconstruir la tarjeta ya libre).
  const buyBtn = card.querySelector('.buy');
  if (buyBtn) {
    const cost = COSTS[hero.id] ?? Infinity;
    if (coins() < cost) {
      buyBtn.disabled = true;
      buyBtn.textContent = `🔒 Te faltan ${cost - coins()} 🪙`;
    }
    buyBtn.onclick = (e) => {
      e.stopPropagation();
      if (tryUnlock(hero.id)) location.reload();
    };
  }
  grid.appendChild(card);

  // Cada tarjeta tiene su propio jugador con física propia, así las poses
  // no van sincronizadas y el plantel se ve vivo, no coreografiado.
  const pl = new Player(0, 0, 0, 'p1');
  pl.characterId = hero.id;
  pl.paletteId = selectedPalettes()[hero.id] ?? null;

  // ── Paletas alternativas (recompensas de desafíos) ───────────────────────
  // Solo aparecen las desbloqueadas; el chip cambia la vista previa EN VIVO
  // y persiste la elección para el juego.
  const palRow = card.querySelector('.pal-row');
  const unlocked = unlockedPalettes(hero.id);
  if (unlocked.length && CHARACTERS[hero.id]?.palettes) {
    const opciones = [{ id: null, nombre: 'Base' },
                      ...unlocked.map((p) => ({ id: p.id, nombre: p.nombre.split(' ').pop() }))];
    for (const op of opciones) {
      const chip = document.createElement('button');
      chip.className = 'pal' + ((pl.paletteId ?? null) === op.id ? ' on' : '');
      chip.textContent = op.nombre;
      chip.onclick = (e) => {
        e.stopPropagation();   // elegir paleta no debe cambiar el personaje elegido
        pl.paletteId = op.id;
        selectPalette(hero.id, op.id);
        [...palRow.children].forEach((c2) => c2.classList.remove('on'));
        chip.classList.add('on');
      };
      palRow.appendChild(chip);
    }
  }

  cards.push({
    hero, el: card,
    canvas: card.querySelector('canvas'),
    ctx: card.querySelector('canvas').getContext('2d'),
    pl,
    phase: Math.random() * 10,
  });
}

// ── Desafíos: la lista con su estado y recompensa ──────────────────────────
{
  const box = document.getElementById('challenges');
  if (box) {
    for (const c of CHALLENGES) {
      const row = document.createElement('div');
      row.className = 'ch' + (isDone(c.id) ? ' done' : '');
      const premio = c.palette ? `Paleta: ${c.palette.nombre}` : 'Medalla';
      row.innerHTML = `
        <div class="ico">${c.icono}</div>
        <div><div class="tit">${c.titulo}</div><div class="des">${c.desc}</div></div>
        <div class="premio">${premio}</div>`;
      box.appendChild(row);
    }
  }
}

// ── Animación: flotar + acelerar suave, como la pose "idle" del editor ────
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  rd.t += dt;

  for (const c of cards) {
    c.phase += dt;
    const b = c.pl.broom;
    // Guion de vuelo: bamboleo suave + una pasada rápida cada tanto para
    // que se vean las reacciones (bufanda, trenza, estelas, llamas).
    const gust = Math.max(0, Math.sin(c.phase * 0.5)) ** 3;
    b.pos.x = Math.cos(c.phase * 1.1) * 8;
    b.pos.y = Math.sin(c.phase * 1.6) * 10;
    b.angle = Math.sin(c.phase * 0.9) * 0.12;
    b.vel.x = 120 + gust * 620;
    b.vel.y = Math.sin(c.phase * 1.3) * 60;
    b.thrustPower = 0.4 + gust * 0.6;
    b.boostPower = gust * 0.7;
    let acc = dt;
    while (acc > 0) { c.pl.rider.update(FIXED_DT, false, null); acc -= FIXED_DT; }

    // Render de la tarjeta
    const ctx = c.ctx;
    const W = c.canvas.width, H = c.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    // La escala sigue al alto disponible (420 era el alto fijo de antes), con
    // tope para que en pantallas grandes no se vuelva gigante.
    const k = Math.min(1.55, Math.max(0.85, (H / 420) * 1.55));
    ctx.translate(W / 2, H / 2 + 26 * (k / 1.55));
    ctx.scale(k, k);
    // sombra de apoyo
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#05030c';
    ctx.beginPath();
    ctx.ellipse(b.pos.x, 92, 62, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    const cols = rd._teamColors(c.pl);
    rd._player(ctx, c.pl, cols.main, cols.dark, noWorld);
    ctx.restore();
  }
}
requestAnimationFrame(frame);

// ── Carrusel ───────────────────────────────────────────────────────────────
// La galería era una grilla que crecía hacia abajo: con 10 personajes la
// página medía 2655 px contra 910 de ventana, o sea 1745 px de scroll — y
// empeoraba con cada personaje nuevo. Ahora es una fila que se desplaza, así
// entra siempre en pantalla sin importar cuántos héroes haya.
{
  const wrap  = document.querySelector('.track-wrap');
  const prevB = document.getElementById('prev');
  const nextB = document.getElementById('next');
  const dotsB = document.getElementById('dots');
  let page = 0;

  // Cuántas tarjetas entran enteras en el ancho visible.
  const porPagina = () => {
    const card = grid.querySelector('.card');
    if (!card || !wrap) return 1;
    const w = card.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(grid).gap) || 0;
    return Math.max(1, Math.floor((wrap.clientWidth + gap) / (w + gap)));
  };
  const paginas = () => Math.max(1, Math.ceil(cards.length / porPagina()));

  function pintar() {
    const per = porPagina();
    const tot = paginas();
    page = Math.min(page, tot - 1);
    const card = grid.querySelector('.card');
    const w = card ? card.getBoundingClientRect().width : 0;
    const gap = parseFloat(getComputedStyle(grid).gap) || 0;
    grid.style.transform = `translateX(${-page * per * (w + gap)}px)`;
    if (prevB) prevB.disabled = page === 0;
    if (nextB) nextB.disabled = page >= tot - 1;
    // Puntos: uno por página, sólo si hay más de una.
    if (dotsB) {
      dotsB.innerHTML = '';
      if (tot > 1) {
        for (let i = 0; i < tot; i++) {
          const d = document.createElement('div');
          d.className = 'dot' + (i === page ? ' on' : '');
          dotsB.appendChild(d);
        }
      }
    }
  }
  const ir = (d) => { page = Math.max(0, Math.min(paginas() - 1, page + d)); pintar(); };

  prevB?.addEventListener('click', () => ir(-1));
  nextB?.addEventListener('click', () => ir(1));
  // Teclado: flechas para moverse sin tocar el mouse.
  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') ir(1);
    else if (e.key === 'ArrowLeft') ir(-1);
  });
  // Rueda del mouse: el gesto natural en una galería horizontal.
  wrap?.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) < 12) return;
    e.preventDefault();
    ir(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  // Arrastre táctil.
  let x0 = null;
  wrap?.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  wrap?.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 45) ir(dx < 0 ? 1 : -1);
    x0 = null;
  });

  // Arrancar mostrando la página donde está el personaje elegido, para que
  // al entrar se vea el que estás usando y no siempre el primero.
  const idx = cards.findIndex((c) => c.hero.id === selected);
  if (idx >= 0) page = Math.floor(idx / porPagina());

  // El canvas de cada tarjeta ya no tiene alto fijo: lo estira el carrusel
  // según la pantalla. Hay que igualar el BUFFER al tamaño real o el dibujo
  // sale deformado (medido: buffer 470x420 contra 204x246 en pantalla, o sea
  // relación 1.12 contra 0.83). Se hace acá —y en cada resize— y no dentro
  // del bucle de animación, para que valga desde el primer frame.
  function ajustarCanvas() {
    for (const c of cards) {
      const w = Math.round(c.canvas.clientWidth), h = Math.round(c.canvas.clientHeight);
      if (w > 0 && h > 0 && (c.canvas.width !== w || c.canvas.height !== h)) {
        c.canvas.width = w; c.canvas.height = h;
      }
    }
  }

  addEventListener('resize', () => { pintar(); ajustarCanvas(); });
  pintar();
  ajustarCanvas();
}
