// Galería de personajes: los 5 héroes animados sobre su ragdoll real, para
// elegir con cuál jugar. Usa el MISMO Renderer y la MISMA física del juego —
// lo que ves acá es exactamente lo que vas a ver en la cancha.
import { CFG, FIXED_DT } from './config.js';
import { Player } from './player.js';
import { Renderer } from './render.js';
import { ROSTER, CHARACTERS } from './characters.js';
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
  const card = document.createElement('div');
  card.className = 'card' + (hero.id === selected ? ' on' : '');
  card.innerHTML = `
    <canvas width="470" height="420"></canvas>
    <div class="nom">${hero.nombre} <small>${hero.titulo}</small></div>
    <div class="rol">${hero.rol}</div>
    <p class="bio">${hero.bio}</p>
    <div class="pal-row"></div>
    <div class="sel">✓ Seleccionado</div>`;
  card.onclick = () => {
    selected = hero.id;
    try { localStorage.setItem(CHAR_KEY, hero.id); } catch { /* sin storage */ }
    for (const c of cards) c.el.classList.toggle('on', c.hero.id === hero.id);
  };
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
    const ctx = c.ctx, W = c.canvas.width, H = c.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2 + 26);
    ctx.scale(1.55, 1.55);
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
