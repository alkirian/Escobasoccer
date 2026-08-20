// Preparar partido: modo, héroe y reglas en UNA pantalla, y a volar.
// El héroe se muestra con la física real (mismo truco que la galería), las
// reglas son chips mutuamente exclusivos (tiempo O goles), y todo queda
// guardado para que la próxima vez ¡A VOLAR! sea un solo toque.
import { CFG, FIXED_DT } from './config.js';
import { Player } from './player.js';
import { Renderer } from './render.js';
import { ROSTER, CHARACTERS } from './characters.js';
import { unlockedPalettes, selectedPalettes, selectPalette } from './challenges.js';
import { RONDAS, loadTorneo, resetTorneo } from './torneo.js';
import { statsHTML } from './statsui.js';
import { statsOf, pasivaOf } from './stats_chars.js';
import { isUnlocked, coins, tryUnlock, COSTS } from './roster.js';

import { Storage } from './storage/storage.js';
import { t, applyI18n } from './i18n/i18n.js';

const CHAR_KEY = 'escoba.character.v1';
const PREP_KEY = 'escoba.prep.v1';
const MENU_KEY = 'escoba.menu.v1';   // sonido/orbes: los administra Opciones

const $ = (id) => document.getElementById(id);

// ── Estado (persistido) ────────────────────────────────────────────────────
const DEFAULTS = { mode: '1v1', ruleType: 'tiempo', duration: 120, goals: 5, difficulty: 'normal' };
let prep = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(Storage.get(PREP_KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
})();
function savePrep() {
  try { Storage.set(PREP_KEY, JSON.stringify(prep)); } catch { /* nada */ }
}

let heroIdx = Math.max(0, ROSTER.findIndex((h) => {
  try { return h.id === Storage.get(CHAR_KEY); } catch { return false; }
}));
// Un guardado viejo puede apuntar a un personaje bloqueado: caer al primero
// desbloqueado en vez de dejar seleccionado algo que no se puede jugar.
if (!isUnlocked(ROSTER[heroIdx]?.id)) {
  heroIdx = Math.max(0, ROSTER.findIndex((h) => isUnlocked(h.id)));
}

// ── Pestañas de modo ───────────────────────────────────────────────────────
applyI18n();

const MODES = [
  { id: '1v1', label: t('prep.mode.1v1') },
  { id: '2v2', label: t('prep.mode.2v2') },
  { id: 'practica', label: t('prep.mode.practice') },
  { id: 'torneo', label: t('prep.mode.tournament') },
];
for (const m of MODES) {
  const b = document.createElement('button');
  b.className = 'tab' + (prep.mode === m.id ? ' on' : '');
  b.textContent = m.label;
  b.onclick = () => {
    prep.mode = m.id;
    savePrep();
    [...$('tabs').children].forEach((c) => c.classList.remove('on'));
    b.classList.add('on');
    refreshVisibility();
  };
  $('tabs').appendChild(b);
}

// Qué se ve según el modo: práctica no tiene reglas ni rival; el torneo
// trae las suyas propias (el bracket) y tampoco deja elegir rival.
function refreshVisibility() {
  const m = prep.mode;
  $('rules').style.display = (m === '1v1' || m === '2v2') ? 'flex' : 'none';
  $('rivalRow').style.display = (m === '1v1' || m === '2v2') ? 'flex' : 'none';
  $('bracket').style.display = m === 'torneo' ? 'flex' : 'none';
  if (m === 'torneo') buildBracket();
}

// ── Chips de reglas ────────────────────────────────────────────────────────
function buildChips(boxId, values, current, format, onPick) {
  const box = $(boxId);
  box.innerHTML = '';
  for (const v of values) {
    const c = document.createElement('button');
    c.className = 'chip' + (v === current ? ' on' : '');
    c.textContent = format(v);
    c.onclick = (e) => {
      e.stopPropagation();
      onPick(v);
      [...box.children].forEach((x) => x.classList.remove('on'));
      c.classList.add('on');
    };
    box.appendChild(c);
  }
}

function refreshRuleCards() {
  $('cardTiempo').className = 'rule-card ' + (prep.ruleType === 'tiempo' ? 'on' : 'off');
  $('cardGoles').className = 'rule-card ' + (prep.ruleType === 'goles' ? 'on' : 'off');
}

buildChips('chipsTiempo', [90, 120, 180], prep.duration, (v) => `${v}s`, (v) => {
  prep.ruleType = 'tiempo'; prep.duration = v; savePrep(); refreshRuleCards();
});
buildChips('chipsGoles', [3, 5, 10], prep.goals, (v) => `${v}`, (v) => {
  prep.ruleType = 'goles'; prep.goals = v; savePrep(); refreshRuleCards();
});
$('cardTiempo').onclick = () => { prep.ruleType = 'tiempo'; savePrep(); refreshRuleCards(); };
$('cardGoles').onclick = () => { prep.ruleType = 'goles'; savePrep(); refreshRuleCards(); };
refreshRuleCards();

const DIFF_LABEL = { facil: t('prep.diff.facil'), normal: t('prep.diff.normal'), dificil: t('prep.diff.dificil') };
buildChips('chipsRival', ['facil', 'normal', 'dificil'], prep.difficulty,
  (v) => DIFF_LABEL[v], (v) => { prep.difficulty = v; savePrep(); });

// ── Bracket del torneo ─────────────────────────────────────────────────────
function buildBracket() {
  const tor = loadTorneo();
  const box = $('bracket');
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 't-head';
  head.innerHTML = `
    <b>${t('prep.champRoad')} ${tor.campeonatos > 0 ? `· 🏆×${tor.campeonatos}` : ''}</b>
    ${tor.ronda > 0 ? `<button id="btnResetT">${t('prep.resetT')}</button>` : ''}`;
  box.appendChild(head);
  RONDAS.forEach((r, i) => {
    const row = document.createElement('div');
    const estado = i < tor.ronda ? 'done' : i === tor.ronda ? 'actual' : '';
    row.className = 'ronda ' + estado;
    const st = i < tor.ronda ? '✅' : i === tor.ronda ? '▶' : '🔒';
    const regla = r.goles ? t('prep.toGoals', { n: r.goles }) : `${r.duracion}s`;
    row.innerHTML = `
      <span class="st">${st}</span>
      <span>
        <span class="quien">${t('prep.round', { star: r.final ? '🏆 ' : '', n: i + 1, name: t(`torneo.r${i}.name`) })}</span><br>
        <span class="det">${t(`torneo.r${i}.phrase`)}</span>
      </span>
      <span class="regla">${DIFF_LABEL[r.dificultad]}<br>${regla}</span>`;
    box.appendChild(row);
  });
  const btn = head.querySelector('#btnResetT');
  if (btn) {
    btn.onclick = () => {
      if (confirm('¿Empezar el torneo de cero? Los trofeos ganados se conservan.')) {
        resetTorneo();
        buildBracket();
      }
    };
  }
}

// ── Héroe: vista previa animada con la física real ────────────────────────
const dummy = document.createElement('canvas');
dummy.width = 10; dummy.height = 10;
const rd = new Renderer(dummy, dummy.getContext('2d'));
rd.skin = null; rd.broomSkin = null; rd.vskin = null;
const noWorld = { playerA: null, botsMode: true };

const canvas = $('heroCanvas');
const ctx = canvas.getContext('2d');
const pl = new Player(0, 0, 0, 'p1');
let phase = Math.random() * 10;

function heroNow() { return ROSTER[heroIdx]; }

function applyHero() {
  const h = heroNow();
  const libre = isUnlocked(h.id);
  pl.characterId = h.id;
  pl.paletteId = selectedPalettes()[h.id] ?? null;
  // Solo se persiste la elección si el personaje está desbloqueado: mirar
  // uno bloqueado no debe romper el guardado.
  if (libre) { try { Storage.set(CHAR_KEY, h.id); } catch { /* nada */ } }
  $('heroNom').innerHTML = libre
    ? `${h.nombre} <small>${t(`hero.${h.id}.title`)}</small>`
    : `🔒 ${h.nombre} <small>${t(`hero.${h.id}.title`)}</small>`;
  $('heroRol').textContent = t(`hero.${h.id}.role`);
  $('heroStats').innerHTML = statsHTML(h.id);
  const pas = pasivaOf(h.id);
  $('heroArq').textContent = t(`arq.${h.id}`)
    + (pas ? `  ·  ${pas.icono} ${t(`pasiva.${h.id}.name`)}: ${t(`pasiva.${h.id}.desc`)}` : '');

  // ── Candado / desbloqueo ─────────────────────────────────────────────────
  const lockRow = $('lockRow');
  if (libre) {
    lockRow.classList.add('hide');
    $('btnGo').disabled = false;
    $('btnGo').textContent = t('prep.go');
  } else {
    const cost = COSTS[h.id] ?? 0;
    const c = coins();
    lockRow.classList.remove('hide');
    $('lockTxt').textContent = t('prep.unlockWith', { cost, coins: c });
    const btn = $('btnUnlock');
    btn.disabled = c < cost;
    btn.textContent = c < cost ? t('prep.missing', { n: cost - c }) : t('prep.unlockFor', { cost });
    btn.onclick = () => { if (tryUnlock(h.id)) applyHero(); };
    $('btnGo').disabled = true;
    $('btnGo').textContent = t('prep.locked');
  }
  // chips de paleta (solo desbloqueadas)
  const row = $('palRow');
  row.innerHTML = '';
  const unlocked = unlockedPalettes(h.id);
  if (unlocked.length && CHARACTERS[h.id]?.palettes) {
    const ops = [{ id: null, nombre: t('palette.base') },
                 ...unlocked.map((p) => ({ id: p.id, nombre: t(`pal.${p.id}.chip`) }))];
    for (const op of ops) {
      const chip = document.createElement('button');
      chip.className = 'pal' + ((pl.paletteId ?? null) === op.id ? ' on' : '');
      chip.textContent = op.nombre;
      chip.onclick = () => {
        pl.paletteId = op.id;
        selectPalette(h.id, op.id);
        [...row.children].forEach((c) => c.classList.remove('on'));
        chip.classList.add('on');
      };
      row.appendChild(chip);
    }
  }
}

$('prevHero').onclick = () => { heroIdx = (heroIdx - 1 + ROSTER.length) % ROSTER.length; applyHero(); };
$('nextHero').onclick = () => { heroIdx = (heroIdx + 1) % ROSTER.length; applyHero(); };
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') $('prevHero').click();
  else if (e.key === 'ArrowRight') $('nextHero').click();
  else if (e.key === 'Enter') $('btnGo').click();
});
applyHero();
refreshVisibility();

// Animación del héroe (guion de vuelo, como la galería)
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  rd.t += dt;
  phase += dt;
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
  ctx.translate(W / 2, H / 2 + 20);
  ctx.scale(1.5, 1.5);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#05030c';
  ctx.beginPath();
  ctx.ellipse(b.pos.x, 82, 60, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  const cols = rd._teamColors(pl);
  rd._player(ctx, pl, cols.main, cols.dark, noWorld);
  ctx.restore();
}
requestAnimationFrame(frame);

// ── ¡A VOLAR! ──────────────────────────────────────────────────────────────
$('btnGo').onclick = () => {
  if (!isUnlocked(heroNow().id)) return;   // candado: Enter tampoco pasa
  savePrep();
  const q = new URLSearchParams();
  // sonido/orbes: preferencias que administra la página de Opciones
  let menuOpts = {};
  try { menuOpts = JSON.parse(Storage.get(MENU_KEY) || '{}'); } catch { /* nada */ }
  if (menuOpts.sound === false) q.set('mute', '1');
  if (menuOpts.orbs === false) q.set('noorbs', '1');

  if (prep.mode === 'torneo') {
    q.set('mode', 'torneo');
  } else if (prep.mode === 'practica') {
    q.set('mode', 'practica');
  } else {
    q.set('mode', prep.mode);
    q.set('difficulty', prep.difficulty);
    if (prep.ruleType === 'goles') q.set('goals', prep.goals);
    else q.set('duration', prep.duration);
  }
  location.href = `play.html?${q}`;
};
