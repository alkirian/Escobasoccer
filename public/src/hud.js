// HUD en DOM: la capa de interfaz del partido, hecha con HTML/CSS en vez de
// dibujada sobre el canvas.
//
// Por qué existe: el HUD pintado a mano en render.js exigía matemática de
// coordenadas para cada cajita y reimplementar a mano hover, blur y texto.
// Como DOM, cada pieza es un elemento con clases — se estila en play.html con
// CSS normal (gradientes, backdrop-filter, transiciones) y los botones son
// <button> de verdad: el hit-testing manual desapareció.
//
// El contrato: `sync(world, dt)` corre una vez por frame y copia el estado del
// juego a los nodos. Para no castigar el layout, cada valor se escribe SOLO
// cuando cambió (se cachea el último escrito). Lo que vive anclado al mundo
// (anillo de carga, halo del jugador) sigue en canvas, que para eso es mejor.
import { CFG } from './config.js';
import { clamp } from './utils.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  // `actions` conecta los botones con el juego:
  //   onPause(id)   → 'continuar' | 'controles' | 'menu' | 'salir'
  //   onEnd(id)     → 'revancha' | 'menu'
  //   onCloseControls()
  constructor(actions = {}) {
    this.el = {
      root: $('hud'),
      score: $('score'), scoreP1: $('scoreP1'), scoreP2: $('scoreP2'),
      clock: $('clock'), clockSub: $('clockSub'),
      practice: $('practiceTop'),
      resources: $('resources'),
      bolts: [$('bolt0'), $('bolt1'), $('bolt2')],
      dashLabel: $('dashLabel'),
      energyWrap: $('energyWrap'), energyFill: $('energyFill'), energyLabel: $('energyLabel'),
      bigMain: $('bigMain'), bigSub: $('bigSub'), torneoIntro: $('torneoIntro'),
      coachPill: $('coachPill'), coachKey: $('coachKey'), coachText: $('coachText'),
      coachFlash: $('coachFlash'),
      replayui: $('replayui'), replayWho: $('replayWho'), replayProg: $('replayProg'),
      pause: $('pauseScreen'), closeNote: $('closeNote'),
      controls: $('controlsScreen'),
      end: $('endScreen'), endTitle: $('endTitle'), endScore: $('endScore'),
      endButtons: $('endButtons'), endTap: $('endTap'),
      endStats: $('endStats'), endRecord: $('endRecord'),
    };
    this._last = {};       // caché de lo último escrito, por clave
    this._flashKey = 0;    // fuerza re-animación del ✓ del coach

    // Botones → acciones del juego
    this.el.pause.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => actions.onPause?.(b.dataset.act));
    });
    this.el.endButtons.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => actions.onEnd?.(b.dataset.act));
    });
    $('btnCloseControls').addEventListener('click', () => actions.onCloseControls?.());
  }

  // Escribe solo si cambió. `k` identifica el destino; `fn` hace la escritura.
  _set(k, v, fn) {
    if (this._last[k] === v) return;
    this._last[k] = v;
    fn(v);
  }

  _show(k, el, on) {
    this._set(k, !!on, (v) => el.classList.toggle('hide', !v));
  }

  sync(world, dt) {
    const m = world.match;
    const el = this.el;
    const replayOn = world.replay?.active;

    // ── Visibilidad de las capas grandes ──────────────────────────────────
    this._show('practice', el.practice, world.practice && !replayOn);
    this._show('score', el.score, !world.practice && !replayOn);
    this._show('resources', el.resources, !world.botsMode && !replayOn && m.state !== 'end');
    this._show('replay', el.replayui, replayOn);
    this._show('pause', el.pause, world.paused && !world.controlsScreen?.open);
    this._show('controls', el.controls, !!world.controlsScreen?.open);
    this._show('end', el.end, m.state === 'end' && !replayOn);

    if (replayOn) { this._syncReplay(world); return; }

    // ── Marcador ──────────────────────────────────────────────────────────
    if (!world.practice) {
      this._set('p1', m.score.p1, (v) => { el.scoreP1.textContent = v; });
      this._set('p2', m.score.p2, (v) => { el.scoreP2.textContent = v; });
      // Golpe de escala en el escudo del que acaba de anotar
      this._set('punch', (m.scorePunch > 0.4) ? m.goalScorer : null, (who) => {
        el.score.querySelector('.crest.p1').classList.toggle('punch', who === 'p1');
        el.score.querySelector('.crest.p2').classList.toggle('punch', who === 'p2');
      });
      this._set('golden', m.golden, (v) => el.score.classList.toggle('golden', v));

      let clock, sub, low = false, goldentxt = false;
      if (m.golden) {
        clock = 'GOL DE ORO'; sub = 'el próximo gana'; goldentxt = true;
      } else if (m.goalTarget > 0) {
        clock = `META ${m.goalTarget}`; sub = 'el primero gana'; goldentxt = true;
      } else {
        const t = Math.max(m.timeLeft, 0);
        clock = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
        sub = world.botsMode ? 'AZUL · ROJO' : 'TÚ · RIVAL';
        low = t < 20;
      }
      this._set('clock', clock, (v) => { el.clock.textContent = v; });
      this._set('clockSub', sub, (v) => { el.clockSub.textContent = v; });
      this._set('clockLow', low, (v) => el.clock.classList.toggle('low', v));
      this._set('clockGold', goldentxt, (v) => el.clock.classList.toggle('goldentxt', v));
    }

    // ── Recursos: rayos del dash + barra de energía ───────────────────────
    const pl = world.playerA;
    const d = world.dashState;
    if (pl && d && !world.botsMode) {
      const locked = m.dashAllowed ? (!m.dashAllowed() && m.state !== 'end') : false;
      for (let i = 0; i < el.bolts.length; i++) {
        // Cantidad de rayos según el personaje: la pasiva de Zefir ("Tercer
        // impulso") sube maxCharges a 3 y acá aparece el tercer rayo solo.
        this._set('boltVis' + i, i < d.maxCharges,
          (v) => el.bolts[i].classList.toggle('hide', !v));
        if (i >= d.maxCharges) continue;
        const lit = !locked && i < d.charges;
        const charging = !lit && !locked && i === d.charges;
        this._set('bolt' + i, lit ? 'lit' : charging ? 'chg' : 'off', (st) => {
          el.bolts[i].classList.toggle('lit', st === 'lit');
          el.bolts[i].classList.toggle('charging', st === 'chg');
        });
        if (charging) {
          // fracción continua: se escribe directo (cambia todos los frames)
          el.bolts[i].style.setProperty('--f', (d.rechargeT / d.recharge).toFixed(3));
        }
      }
      let dl = 'ESPACIO';
      if (locked && m.state === 'play' && m.dashLockT > 0) dl = `ESPACIO · listo en ${Math.ceil(m.dashLockT)}s`;
      else if (d.charges < d.maxCharges) dl = `ESPACIO · +1 en ${(d.recharge - d.rechargeT).toFixed(1)}s`;
      this._set('dashLabel', dl, (v) => { el.dashLabel.textContent = v; });
      this._set('dashLocked', locked, (v) => el.dashLabel.classList.toggle('locked', v));

      const unlimited = pl.unlimitedT > 0;
      const boosting = pl.broom.boostPower > 0.05;
      el.energyFill.style.width = (clamp(pl.energy / CFG.boost.max, 0, 1) * 100).toFixed(1) + '%';
      this._set('boosting', boosting, (v) => el.energyWrap.classList.toggle('boosting', v));
      this._set('unlimited', unlimited, (v) => el.energyWrap.classList.toggle('unlimited', v));
      const elabel = unlimited ? `∞ ${pl.unlimitedT.toFixed(1)}s` : 'ENERGÍA · SHIFT';
      this._set('energyLabel', elabel, (v) => { el.energyLabel.textContent = v; });
    }

    // ── Texto grande central ──────────────────────────────────────────────
    let big = '', bigClass = '', sub2 = '';
    if (m.state === 'countdown') {
      const c = Math.ceil(m.countT);
      if (m.countT > 0.35 && c <= 3) { big = String(c); bigClass = 'count'; }
    } else if (m.state === 'play' && world.yaVisible && !m.golden) {
      big = '¡YA!'; bigClass = 'ya';
    } else if (m.state === 'goal' && m.blasted) {
      big = '¡GOOOL!'; bigClass = 'goal ' + (m.goalScorer === 'p1' ? 'p1' : 'p2');
      sub2 = `Gol ${m.goalScorer === 'p1'
        ? (world.botsMode ? 'del bot azul' : 'tuyo')
        : (world.botsMode ? 'del bot rojo' : 'del rival')}`;
    }
    this._set('big', big + '|' + bigClass, () => {
      el.bigMain.textContent = big;
      el.bigMain.className = 'big ' + bigClass;
    });
    this._set('bigSub', sub2, (v) => { el.bigSub.textContent = v; });

    // Presentación de ronda del torneo durante la cuenta regresiva
    const t = world.torneo;
    const intro = (m.state === 'countdown' && t)
      ? `${t.cfg.final ? '🏆 LA FINAL' : `RONDA ${t.indice + 1} de ${t.total}`}<small>vs ${t.cfg.nombre}</small><em>${t.cfg.frase}</em>`
      : '';
    this._set('torneoIntro', intro, (v) => { el.torneoIntro.innerHTML = v; });

    // ── Coach ─────────────────────────────────────────────────────────────
    this._syncCoach(world);

    // ── Pausa: aviso de "no pude cerrar la pestaña" ───────────────────────
    this._show('closeNote', el.closeNote, world.pauseMenu?.closeBlockedT > 0);

    // ── Fin de partido ────────────────────────────────────────────────────
    if (m.state === 'end') this._syncEnd(world);
  }

  _syncCoach(world) {
    const el = this.el;
    const coach = world.coach;
    const canShow = coach && !world.botsMode && !world.touch?.active
      && !world.paused && world.match?.state === 'play';

    const lesson = canShow ? coach.current : null;
    this._show('coach', el.coachPill, !!lesson);
    if (lesson) {
      this._set('coachLesson', lesson.id, () => {
        el.coachKey.textContent = lesson.key;
        el.coachText.textContent = lesson.text;
      });
      const a = this._anchor(lesson.anchor, world);
      const above = a.y > 130;
      el.coachPill.style.left = clamp(a.x, 130, innerWidth - 130) + 'px';
      el.coachPill.style.top = (above ? a.y - 72 : a.y + 72) + 'px';
    }

    const flash = canShow ? coach.flash : null;
    this._show('coachFlash', el.coachFlash, !!flash);
    if (flash) {
      const a = this._anchor(flash.anchor, world);
      el.coachFlash.style.left = a.x + 'px';
      el.coachFlash.style.top = (a.y - 46) + 'px';
      // Reiniciar la animación CSS cuando aparece un flash nuevo
      if (this._flashKey !== flash) {
        this._flashKey = flash;
        el.coachFlash.style.animation = 'none';
        void el.coachFlash.offsetWidth;   // reflow: reinicia el keyframe
        el.coachFlash.style.animation = '';
      }
    }
  }

  // Mundo → pantalla para las anclas del coach. Las de HUD son fijas.
  _anchor(anchor, world) {
    const cam = world.camera;
    const W = innerWidth, H = innerHeight;
    const toScreen = (p) => ({
      x: W / 2 + (p.x - cam.x) * cam.zoom,
      y: H / 2 + (p.y - cam.y) * cam.zoom,
    });
    switch (anchor) {
      case 'ball':      return toScreen(world.ball.pos);
      case 'player':    return toScreen(world.playerA.broom.pos);
      case 'dashHud':   return { x: 60, y: H - 78 };
      case 'energyHud': return { x: 118, y: H - 42 };
      default:          return { x: W / 2, y: H / 2 };
    }
  }

  _syncReplay(world) {
    const rp = world.replay;
    const el = this.el;
    this._set('rwho', rp.scorer, (s) => {
      el.replayWho.textContent = s === 'p1' ? 'Tu gol' : 'Gol del rival';
      el.replayWho.className = s === 'p1' ? 'p1' : 'p2';
    });
    el.replayProg.style.width = (rp.progress * 100).toFixed(1) + '%';
  }

  _syncEnd(world) {
    const m = world.match;
    const el = this.el;
    const tr = world.torneoResult;

    let title, cls;
    if (world.botsMode) {
      title = m.winner === 'p1' ? 'GANA AZUL' : 'GANA ROJO';
      cls = m.winner === 'p1' ? 'win' : 'lose';
    } else if (m.winner === 'p1') {
      title = tr?.campeon ? '¡CAMPEÓN!' : tr ? '¡RONDA SUPERADA!' : '¡VICTORIA!';
      cls = 'win';
    } else {
      title = 'DERROTA'; cls = 'lose';
    }
    this._set('endTitle', title, (v) => {
      el.endTitle.textContent = v;
      el.endTitle.className = cls;
    });
    this._set('endScore', `${m.score.p1} — ${m.score.p2}`,
      (v) => { el.endScore.textContent = v; });

    // Torneo: un solo camino (tocá para seguir) — sin botones.
    this._show('endButtons', el.endButtons, !tr);
    const tap = tr
      ? (tr.campeon ? 'Tocá para reclamar tu trofeo 🏆'
        : tr.win ? `Tocá para la Ronda ${tr.proxima + 1}`
        : 'Tocá para reintentar la ronda')
      : '';
    this._set('endTap', tap, (v) => { el.endTap.textContent = v; });

    const st = world.lastStats;
    // Las monedas ganadas van primero: son la recompensa nueva de cada
    // partido y alimentan el desbloqueo de personajes.
    const coins = world.coinsEarned ? `+${world.coinsEarned} 🪙   ·   ` : '';
    const stats = st
      ? coins + (st.streak > 0
        ? `Racha: ${st.streak} 🔥   ·   Mejor racha: ${st.bestStreak}`
        : `Victorias: ${st.wins} · Derrotas: ${st.losses}   ·   Mejor racha: ${st.bestStreak}`)
      : '';
    this._set('endStats', stats, (v) => { el.endStats.textContent = v; });

    const rec = st?.newBestStreak ? '🏆 ¡Nueva mejor racha!'
      : st?.newBiggestWin ? '🏆 ¡Tu victoria más aplastante!' : '';
    this._set('endRecord', rec, (v) => { el.endRecord.textContent = v; });
  }
}
