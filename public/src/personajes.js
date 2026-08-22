// Galería de personajes: grilla de cards (no carrusel) + una página de
// detalle por personaje. Usa el MISMO Renderer y la MISMA física del
// juego — lo que ves acá es exactamente lo que vas a ver en la cancha.
//
// Dos vistas en un solo documento, alternadas por CSS según la URL:
//   sin ?ver=       → grilla: retrato + nombre, mini-stats al hover
//   ?ver=<id>        → detalle: stats completas, pasiva, lore, consejos
// La navegación entre vistas usa <a href> reales (recarga completa, no
// pushState): cada personaje tiene una URL de verdad, compartible, y el
// botón atrás del navegador funciona sin JS extra para manejarlo.
import { CFG, FIXED_DT } from './config.js';
import { Player } from './player.js';
import { Renderer } from './render.js';
import { ROSTER, CHARACTERS } from './characters.js';
import { STAT_IDS, STAT_INFO } from './stats_chars.js';
import { statsOf, pasivaOf } from './stats_chars.js';
import { statsHTML } from './statsui.js';
import { isUnlocked, COSTS, coins, tryUnlock } from './roster.js';
import { Storage } from './storage/storage.js';
import { t, applyI18n, applyMeta } from './i18n/i18n.js';
import { unlockedPalettes, selectedPalettes, selectPalette } from './challenges.js';

const CHAR_KEY = 'escoba.character.v1';

const params = new URLSearchParams(location.search);
const modeParam = params.get('mode');

// Renderer "prestado": necesita un canvas en el constructor pero dibuja en
// el ctx que se le pase a _player, así que uno oculto alcanza para todos.
const dummy = document.createElement('canvas');
dummy.width = 10; dummy.height = 10;
const rd = new Renderer(dummy, dummy.getContext('2d'));
rd.skin = null; rd.broomSkin = null; rd.vskin = null;
const noWorld = { playerA: null, botsMode: true };

let selected = (() => {
  try { return Storage.get(CHAR_KEY) || 'mago'; } catch { return 'mago'; }
})();
if (!isUnlocked(selected)) {
  selected = ROSTER.find((h) => isUnlocked(h.id))?.id ?? 'mago';
}

applyI18n();
applyMeta('personajes');

// Desbloqueados primero, en el orden del ROSTER; bloqueados después, en el
// mismo orden entre ellos. El ROSTER original (usado por bots, torneo, etc.)
// no se toca — este es sólo el orden de PRESENTACIÓN en la galería.
const ordenados = [...ROSTER].sort((a, b) => {
  const la = isUnlocked(a.id), lb = isUnlocked(b.id);
  if (la !== lb) return la ? -1 : 1;
  return 0;
});

// ── Vista: grilla ────────────────────────────────────────────────────────
const grid = document.getElementById('grid');
const cards = [];

for (const hero of ordenados) {
  const libre = isUnlocked(hero.id);
  const card = document.createElement('div');
  card.className = 'card' + (hero.id === selected ? ' on' : '') + (libre ? '' : ' locked');
  card.innerHTML = `
    <canvas width="360" height="480"></canvas>
    <a class="verMas" href="personajes.html?ver=${hero.id}${modeParam ? `&mode=${modeParam}` : ''}"
       data-i18n="chars.viewMore">${t('chars.viewMore')}</a>
    <div class="footer">
      <div class="nom">${hero.nombre}<small>${t(`hero.${hero.id}.title`)}</small></div>
    </div>
    <div class="peek">${STAT_IDS.map((k) => {
      const info = STAT_INFO[k];
      const s = statsOf(hero.id);
      const pips = Array.from({ length: 5 }, (_, i) =>
        `<span class="pip${i < s[k] ? ' on' : ''}"></span>`).join('');
      return `<div class="strow" style="--c:${info.color}">
        <span class="sn">${info.icono}</span><span class="pips">${pips}</span>
      </div>`;
    }).join('')}</div>`;
  // Click en la card = seleccionar (y, si está desbloqueado, listo para
  // jugar). El botón "Ver más" (aparece al hover, arriba en la esquina) es
  // el único que navega al detalle — así el click principal ya no saca al
  // jugador de la grilla. Los bloqueados no se pueden "elegir": el click
  // los manda directo al detalle, que es donde se compran.
  card.addEventListener('click', (e) => {
    if (e.target.closest('.verMas')) return; // el link maneja su propio click
    if (!libre) { location.href = `personajes.html?ver=${hero.id}${modeParam ? `&mode=${modeParam}` : ''}`; return; }
    selectCard(hero.id);
  });
  grid.appendChild(card);

  const pl = new Player(0, 0, 0, 'p1');
  pl.characterId = hero.id;
  pl.paletteId = selectedPalettes()[hero.id] ?? null;

  cards.push({
    hero, el: card,
    canvas: card.querySelector('canvas'),
    ctx: card.querySelector('canvas').getContext('2d'),
    pl,
    phase: Math.random() * 10,
  });
}

// Selecciona un personaje desbloqueado con un click en la card: marca el
// contorno + glow (.on), persiste la elección y listo para jugar — ya no
// hace falta pasar por la página de detalle para elegir.
function selectCard(heroId) {
  selected = heroId;
  try { Storage.set(CHAR_KEY, heroId); } catch { /* sin storage */ }
  for (const c of cards) c.el.classList.toggle('on', c.hero.id === heroId);
}

// ── Botón "Jugar" (grilla) ─────────────────────────────────────────────────
{
  const btnPlay = document.getElementById('btnPlay');
  const btnMenu = document.getElementById('btnMenu');
  if (modeParam) {
    btnMenu.href = 'modo.html';
    btnPlay.onclick = () => {
      const q = new URLSearchParams({ mode: modeParam, char: selected });
      location.href = `jugar.html?${q}`;
    };
  } else {
    btnPlay.onclick = () => { location.href = 'jugar.html'; };
  }
}

// ── Vista: detalle de un personaje ──────────────────────────────────────
const gridView = document.getElementById('gridView');
const detailView = document.getElementById('detailView');
const detCanvas = document.getElementById('detCanvas');
const detCtx = detCanvas.getContext('2d');
let detPl = null;
let detPhase = Math.random() * 10;
let detHeroId = null;

function showDetail(heroId) {
  const hero = ROSTER.find((h) => h.id === heroId);
  if (!hero) { showGrid(); return; }
  detHeroId = heroId;
  const libre = isUnlocked(heroId);

  gridView.classList.add('hide');
  detailView.classList.add('show');

  document.getElementById('detNom').innerHTML =
    `${hero.nombre}<small>${t(`hero.${heroId}.title`)}</small>`;
  document.getElementById('detRol').textContent = t(`hero.${heroId}.role`);
  document.getElementById('detArq').textContent = t(`arq.${heroId}`);
  document.getElementById('detStats').innerHTML = statsHTML(heroId);

  const pas = pasivaOf(heroId);
  const pasivaBox = document.getElementById('detPasiva');
  if (pas) {
    pasivaBox.style.display = '';
    pasivaBox.innerHTML = `${pas.icono} <b>${t(`pasiva.${heroId}.name`)}</b> — ${t(`pasiva.${heroId}.desc`)}`;
  } else {
    pasivaBox.style.display = 'none';
  }

  document.getElementById('detLore').textContent = t(`lore.${heroId}`);
  document.getElementById('detTipsPlay').textContent = t(`tips.play.${heroId}`);
  document.getElementById('detTipsAgainst').textContent = t(`tips.against.${heroId}`);

  // Paletas alternativas (recompensa de desafíos)
  detPl = new Player(0, 0, 0, 'p1');
  detPl.characterId = heroId;
  detPl.paletteId = selectedPalettes()[heroId] ?? null;
  const palRow = document.getElementById('detPalRow');
  palRow.innerHTML = '';
  const unlocked = unlockedPalettes(heroId);
  if (unlocked.length && CHARACTERS[heroId]?.palettes) {
    const opciones = [{ id: null, nombre: t('palette.base') },
                      ...unlocked.map((p) => ({ id: p.id, nombre: t(`pal.${p.id}.chip`) }))];
    for (const op of opciones) {
      const chip = document.createElement('button');
      chip.className = 'pal' + ((detPl.paletteId ?? null) === op.id ? ' on' : '');
      chip.textContent = op.nombre;
      chip.onclick = () => {
        detPl.paletteId = op.id;
        selectPalette(heroId, op.id);
        [...palRow.children].forEach((c) => c.classList.remove('on'));
        chip.classList.add('on');
      };
      palRow.appendChild(chip);
    }
  }

  // Botón principal: elegir + jugar (si está desbloqueado) o comprar.
  const playBtn = document.getElementById('detPlayBtn');
  if (libre) {
    playBtn.disabled = false;
    playBtn.textContent = t('detail.play');
    playBtn.onclick = () => {
      selected = heroId;
      try { Storage.set(CHAR_KEY, heroId); } catch { /* sin storage */ }
      if (modeParam) {
        const q = new URLSearchParams({ mode: modeParam, char: heroId });
        location.href = `jugar.html?${q}`;
      } else {
        location.href = 'jugar.html';
      }
    };
  } else {
    const cost = COSTS[heroId] ?? Infinity;
    const c = coins();
    if (c < cost) {
      playBtn.disabled = true;
      playBtn.textContent = t('prep.missing', { n: cost - c });
      playBtn.onclick = null;
    } else {
      playBtn.disabled = false;
      playBtn.textContent = t('prep.unlockFor', { cost });
      playBtn.onclick = () => { if (tryUnlock(heroId)) showDetail(heroId); };
    }
  }
}

function showGrid() {
  detHeroId = null;
  detailView.classList.remove('show');
  gridView.classList.remove('hide');
}

document.getElementById('btnBack').href =
  `personajes.html${modeParam ? `?mode=${modeParam}` : ''}`;

// La URL manda al cargar la página: entrar directo a personajes.html?ver=X
// muestra el detalle de una.
{
  const ver = params.get('ver');
  if (ver && ROSTER.some((h) => h.id === ver)) showDetail(ver);
  else showGrid();
}

// ── Animación: flotar + acelerar suave, como la pose "idle" del editor ────
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  rd.t += dt;

  for (const c of cards) {
    animarYPintar(c, dt);
  }
  if (detHeroId && detPl) {
    detPhase += dt;
    animarYPintarUno(detPl, detCtx, detCanvas, detPhase, dt);
  }
}
requestAnimationFrame(frame);

function animarYPintar(c, dt) {
  c.phase += dt;
  const resultado = animarYPintarUno(c.pl, c.ctx, c.canvas, c.phase, dt);
}

// Guion de vuelo compartido: bamboleo suave + una pasada rápida cada tanto,
// para que se vean las reacciones del personaje (bufanda, trenza, llamas).
function animarYPintarUno(pl, ctx, canvas, phase, dt) {
  const b = pl.broom;
  const gust = Math.max(0, Math.sin(phase * 0.5)) ** 3;
  b.pos.x = Math.cos(phase * 1.1) * 8;
  b.pos.y = Math.sin(phase * 1.6) * 10;
  b.angle = Math.sin(phase * 0.9) * 0.12;
  b.vel.x = 120 + gust * 620;
  b.vel.y = Math.sin(phase * 1.3) * 60;
  b.thrustPower = 0.4 + gust * 0.6;
  b.boostPower = gust * 0.7;
  let acc = dt;
  while (acc > 0) { pl.rider.update(FIXED_DT, false, null); acc -= FIXED_DT; }

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  const k = Math.min(1.55, Math.max(0.85, (H / 420) * 1.55));
  ctx.translate(W / 2, H / 2 + 26 * (k / 1.55));
  ctx.scale(k, k);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#05030c';
  ctx.beginPath();
  ctx.ellipse(b.pos.x, 92, 62, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  const cols = rd._teamColors(pl);
  rd._player(ctx, pl, cols.main, cols.dark, noWorld);
  ctx.restore();
}

// El canvas de cada card no tiene alto fijo en CSS (aspect-ratio decide el
// tamaño real): hay que igualar el BUFFER al tamaño en pantalla o el dibujo
// sale deformado. Se hace en cada resize, no dentro del loop de animación,
// para no medir el layout 60 veces por segundo.
function ajustarCanvas() {
  for (const c of cards) {
    const w = Math.round(c.canvas.clientWidth), h = Math.round(c.canvas.clientHeight);
    if (w > 0 && h > 0 && (c.canvas.width !== w || c.canvas.height !== h)) {
      c.canvas.width = w; c.canvas.height = h;
    }
  }
  const dw = Math.round(detCanvas.clientWidth), dh = Math.round(detCanvas.clientHeight);
  if (dw > 0 && dh > 0 && (detCanvas.width !== dw || detCanvas.height !== dh)) {
    detCanvas.width = dw; detCanvas.height = dh;
  }
}
addEventListener('resize', ajustarCanvas);
ajustarCanvas();
