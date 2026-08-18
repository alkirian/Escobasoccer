// Estado del partido: cuenta regresiva, juego, gol (slowmo + celebración),
// final, gol de oro. Partidas cortas: terminar y querer "otra".
import { CFG } from './config.js';
import { portalCenter } from './arena.js';
import { damp, lerp } from './utils.js';

export class Match {
  constructor(world, opts = {}) {
    this.world = world;
    this.duration = opts.duration ?? CFG.match.duration;
    this.reset(true);
  }

  reset(full) {
    this.state = 'countdown';
    this.countT = CFG.match.countdown;
    this.lastBeep = Math.ceil(this.countT);
    if (full) {
      this.score = { p1: 0, p2: 0 };
      this.timeLeft = this.duration;
      this.golden = false;
      this.winner = null;
      // Presentación solo al empezar el partido, no después de cada gol:
      // repetirla cortaría el ritmo competitivo.
      this.world.camera.startIntro(this.world.playerA);
      // El fugitivo sólo se reinicia con el partido entero. Si se reiniciara
      // en cada gol, con ~10 goles por partido su temporizador de 40 s nunca
      // llegaría a cero y no aparecería nunca. Entre goles simplemente queda
      // congelado (sólo corre con `state === 'play'`) y después sigue.
      this.world.runner?.reset(true);
    }
    this.goalT = 0;
    this.goalSide = null;
    this.goalScorer = null;
    this.timeScale = 1;
    this.blastT = 0;
    this.blasted = false;
    this.blastWave = 0;
    this.scorePunch = 0;
    this.slowT = 0;
    this.flashT = 0;
    this._resetPositions();
  }

  _resetPositions() {
    const w = this.world;
    for (const pl of w.players) pl.reset();
    w.orbs?.reset();
    w.ball.reset(0, (CFG.arena.T + CFG.arena.B) / 2 - 120);
    w.ball.frozen = true;
  }

  // side: 'goalL' (portal izq) | 'goalR' (portal der)
  onGoal(side) {
    const w = this.world;
    // Portal izq es de p1 → gol allí = punto p2. Portal der es de p2 → punto p1.
    const scorer = side === 'goalL' ? 'p2' : 'p1';
    this.score[scorer]++;
    this.goalScorer = scorer;
    this.goalSide = side === 'goalL' ? -1 : 1;
    this.state = 'goal';
    this.goalT = CFG.match.goalPause;
    // El portal primero ACUMULA energía; la explosión llega después.
    this.blastT = CFG.goalBlast.charge;
    this.blasted = false;
    this.blastWave = 0;      // 0..1, radio de la onda para el render
    this.scorePunch = 1;     // reacción del HUD
    this.flashT = 0;
    this.timeScale = 1;

    w.sound.goal();
    w.ball.frozen = true;
    this._suckFrom = { x: w.ball.pos.x, y: w.ball.pos.y };
  }

  // La onda expansiva: manda por el aire a TODOS los jugadores, no sólo a los
  // que estaban cerca. Salen despedidos girando y sin soltar la escoba (las
  // manos siguen fijas por el constraint del ragdoll), con un sesgo hacia
  // abajo que los estampa contra el campo.
  _detonate() {
    const w = this.world;
    const G = CFG.goalBlast;
    const portal = portalCenter(this.goalSide);
    const color = this.goalScorer === 'p1' ? CFG.colors.p1 : CFG.colors.p2;

    for (const pl of w.players) {
      if (!pl) continue;
      const b = pl.broom;
      const dx = b.pos.x - portal.x, dy = b.pos.y - portal.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > G.radius) continue;
      // Falloff con piso: cerca del portal es un cañonazo, lejos igual sacude.
      // Que nadie quede inmóvil es lo que hace que el gol se sienta.
      const falloff = Math.max(1 - d / G.radius, 0);
      const push = G.force * (G.minPush + (1 - G.minPush) * falloff * falloff);

      // Radial + un empujón hacia abajo: en vez de dispersarse prolijo, los
      // magos salen despedidos contra el suelo.
      let ux = dx / d, uy = dy / d + G.slam;
      const ul = Math.hypot(ux, uy) || 1;
      ux /= ul; uy /= ul;

      b.stuck = null; // la onda también despega a quien estuviera clavado
      b.vel.x += ux * push;
      b.vel.y += uy * push;
      b.angVel += (Math.random() * 2 - 1) * G.spin * (0.35 + falloff);
      // El cuerpo recibe el golpe por su cuenta: sale disparado respecto de su
      // propia escoba y queda hecho un desastre colgando de las manos.
      for (const { p } of pl.rider.hitPoints()) {
        p.px -= ux * push * G.bodyKick * (0.4 + falloff);
        p.py -= uy * push * G.bodyKick * (0.4 + falloff);
      }
    }

    w.particles.shockwave(portal.x, portal.y, color, 150);
    w.particles.goal(portal.x, portal.y, color);
    w.camera.shake(G.shake, G.shake + 8);
    w.sound.blast();
    this.flashT = G.flash;
    this.timeScale = G.slowmo;
    this.slowT = G.slowmoTime;
    this.blasted = true;
  }

  update(dt, world) {
    switch (this.state) {
      case 'countdown': {
        this.countT -= dt;
        const c = Math.ceil(this.countT);
        if (c < this.lastBeep && c > 0) { world.sound.beep(); this.lastBeep = c; }
        if (this.countT <= 0) {
          this.state = 'play';
          world.sound.beep(true);
          world.ball.frozen = false;
        }
        break;
      }
      case 'play': {
        if (!this.golden) {
          this.timeLeft -= dt;
          if (this.timeLeft <= 0) {
            this.timeLeft = 0;
            if (this.score.p1 === this.score.p2) {
              this.golden = true;
              world.sound.golden();
            } else {
              this._end(world);
            }
          }
        }
        break;
      }
      case 'goal': {
        this.goalT -= dt;
        // succión de la pelota hacia el portal
        const w = this.world;
        const portal = portalCenter(this.goalSide);
        const t = 1 - Math.max(this.goalT / CFG.match.goalPause, 0);
        const k = Math.min(t * 2.2, 1);
        w.ball.pos.x = lerp(this._suckFrom.x, portal.x + this.goalSide * 30, k);
        w.ball.pos.y = lerp(this._suckFrom.y, portal.y, k);
        w.ball.scale = 1 - k * 0.9;

        // Carga → detonación → recuperación
        if (!this.blasted) {
          this.blastT -= dt;
          if (this.blastT <= 0) this._detonate();
        } else {
          this.blastWave = Math.min(1, this.blastWave + dt * 2.2);
          if (this.flashT > 0) this.flashT -= dt;
          this.slowT -= dt;
          // La cámara lenta dura solo lo justo para apreciar el caos físico
          if (this.slowT <= 0) this.timeScale = damp(this.timeScale, 1, 3.2, dt);
        }
        if (this.scorePunch > 0) this.scorePunch = Math.max(0, this.scorePunch - dt * 1.6);
        if (this.goalT <= 0) {
          this.timeScale = 1;
          if (this.golden || (this.timeLeft <= 0 && this.score.p1 !== this.score.p2)) {
            this._end(world);
          } else {
            this.state = 'countdown';
            this.countT = CFG.match.quickCountdown;
            this.lastBeep = Math.ceil(this.countT);
            this._resetPositions();
          }
        }
        break;
      }
      case 'end':
        break;
    }
  }

  _end(world) {
    this.state = 'end';
    this.winner = this.score.p1 > this.score.p2 ? 'p1' : this.score.p2 > this.score.p1 ? 'p2' : null;
    world.sound.whistle();
  }

  // ¿Física activa? (jugadores siempre pueden moverse salvo countdown)
  playersFrozen() { return this.state === 'countdown'; }
  ballActive() { return this.state === 'play'; }
}
