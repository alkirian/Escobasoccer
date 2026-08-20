// Estado del partido: cuenta regresiva, juego, gol (slowmo + celebración),
// final, gol de oro. Partidas cortas: terminar y querer "otra".
import { CFG } from './config.js';
import { portalCenter } from './arena.js';
import { damp, lerp } from './utils.js';

export class Match {
  constructor(world, opts = {}) {
    this.world = world;
    this.duration = opts.duration ?? CFG.match.duration;
    // Práctica: cancha libre. Se sigue jugando igual (los goles entran y la
    // celebración se ve), pero el reloj no corre y el partido no termina —
    // no hay presión de tiempo ni marcador que defender.
    this.practice = !!opts.practice;
    // Partido POR GOLES: gana el primero que llega a N. Sin reloj y sin gol
    // de oro (no puede haber empate: alguien llega primero).
    this.goalTarget = opts.goalTarget || 0;
    // Único lugar que hace la presentación de cámara: entrar a la cancha.
    this.reset(true, true);
  }

  // `full`      → reinicia marcador, reloj y fugitivo (partido nuevo).
  // `withIntro` → además hace la presentación de cámara (acercarse al mago y
  //               abrir). Va SEPARADO de `full` a propósito: la presentación
  //               es para la primera vez que se entra a la cancha. Reiniciar
  //               para jugar otra, o apretar R, también son "partido nuevo",
  //               pero ahí el jugador ya está adentro y volver a hacer el
  //               viaje de cámara corta el ritmo en vez de presentar nada.
  reset(full, withIntro = false) {
    this.state = 'countdown';
    this.countT = CFG.match.countdown;
    this.lastBeep = Math.ceil(this.countT);
    if (full) {
      this.score = { p1: 0, p2: 0 };
      this.timeLeft = this.duration;
      this.golden = false;
      this.winner = null;
      if (withIntro) this.world.camera.startIntro(this.world.playerA);
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
    // Se arma acá y se carga recién al pasar a 'play': el bloqueo del dash
    // corre desde el "¡YA!", no desde la cuenta regresiva.
    this.dashLockT = CFG.match.dashLockout;
    this._resetPositions();
  }

  // Devolver a todos al saque. `pl.reset()` limpia escoba y ragdoll; el hook
  // `onReset` limpia lo que vive fuera del Player (dash, giro, carga), que si
  // no sobrevivía al gol y hacía arrancar el punto con el mago girando o
  // dasheando solo.
  _resetPositions() {
    const w = this.world;
    for (const pl of w.players) pl.reset();
    w.onReset?.();
    w.orbs?.reset();
    w.ball.reset(0, (CFG.arena.T + CFG.arena.B) / 2 - 120);
    w.ball.frozen = true;
  }

  // side: 'goalL' (portal izq) | 'goalR' (portal der)
  onGoal(side) {
    const w = this.world;
    // Quién defiende ese portal decide a quién le marcaron. Antes esto era
    // fijo ("portal izq es de p1"), pero ahora el lado de salida se sortea:
    // con el humano arrancando a la derecha, todos los goles se contaban al
    // revés. Se lee del propio jugador (pl.side) en vez de asumirlo.
    const sideSign = side === 'goalL' ? -1 : 1;
    const dueño = (w.players || []).find((p) => p.side === sideSign);
    const scorer = dueño
      ? (dueño.team === 'p1' ? 'p2' : 'p1')   // gol en tu arco = punto del rival
      : (side === 'goalL' ? 'p2' : 'p1');     // respaldo por si no hay jugadores
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

      b.slamT = 0;    // la onda saca del aturdimiento a quien se acababa de golpear
      // PESO (stat): a Petra la onda apenas la despeina; a Zefir lo manda
      // al otro lado del mapa. Es la mitad defensiva del stat.
      // PASIVA de Valka — "Inquebrantable": planta el escudo y la explosión
      // del gol casi no la toca. Mientras todos vuelan por el aire, ella ya
      // está acomodada para el saque.
      const valka = pl.characterId === 'valka' ? 0.15 : 1;
      const kb = (pl.mods ? pl.mods.knockback : 1) * valka;
      b.vel.x += ux * push * kb;
      b.vel.y += uy * push * kb;
      b.angVel += (Math.random() * 2 - 1) * G.spin * (0.35 + falloff) * valka;
      // El cuerpo recibe el golpe por su cuenta: sale disparado respecto de su
      // propia escoba y queda hecho un desastre colgando de las manos.
      // (El de Valka también se queda: la pasiva cubre cuerpo y escoba.)
      for (const { p } of pl.rider.hitPoints()) {
        p.px -= ux * push * G.bodyKick * (0.4 + falloff) * valka;
        p.py -= uy * push * G.bodyKick * (0.4 + falloff) * valka;
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

  // `dt` llega SIEMPRE en tiempo real. La cuenta regresiva y el reloj del
  // partido tienen que correr en tiempo real (un minuto de partido es un
  // minuto de reloj, pase lo que pase en pantalla), pero los temporizadores
  // del festejo cronometran una escena que durante la cámara lenta avanza al
  // 22% — si corrieran en tiempo real terminarían 4.5× antes que la escena.
  // Medido antes del arreglo: `goalPause` decía 2.6 s y el tramo en cámara
  // lenta se consumía en ~0.58 s, así que la explosión se cortaba antes de
  // poder verse. Por eso el estado 'goal' usa su propio dt escalado.
  update(dt, world) {
    const dtGoal = dt * this.timeScale;
    switch (this.state) {
      case 'countdown': {
        this.countT -= dt;
        const c = Math.ceil(this.countT);
        if (c < this.lastBeep && c > 0) { world.sound.beep(); this.lastBeep = c; }
        if (this.countT <= 0) {
          this.state = 'play';
          world.sound.beep(true);
          world.ball.frozen = false;
          // Segundos desde el saque. Lo usan los bots para no salir los dos
          // corriendo al centro en el arranque (ver bot.js, reparto de roles).
          this.playT = 0;
          // El reloj del bloqueo arranca con el pitazo, no antes.
          this.dashLockT = CFG.match.dashLockout;
        }
        break;
      }
      case 'play': {
        this.playT = (this.playT ?? 0) + dt;
        if (this.dashLockT > 0) this.dashLockT = Math.max(0, this.dashLockT - dt);
        // En práctica el reloj no corre: se juega hasta que el jugador se vaya.
        // Por goles tampoco: el partido lo termina el marcador, no el tiempo.
        if (!this.golden && !this.practice && !this.goalTarget) {
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
        // `goalT` es cuánto dura el festejo ANTES del próximo saque: es ritmo
        // de partido, no un evento del mundo, así que va en tiempo real.
        this.goalT -= dt;
        // succión de la pelota hacia el portal
        const w = this.world;
        const portal = portalCenter(this.goalSide);
        const t = 1 - Math.max(this.goalT / CFG.match.goalPause, 0);
        const k = Math.min(t * 2.2, 1);
        w.ball.pos.x = lerp(this._suckFrom.x, portal.x + this.goalSide * 30, k);
        w.ball.pos.y = lerp(this._suckFrom.y, portal.y, k);
        w.ball.scale = 1 - k * 0.9;

        // Carga → detonación → recuperación.
        //
        // Qué reloj usa cada cosa, que es la parte sutil:
        //  · `blastT` y `blastWave` cronometran la ONDA, que es un evento del
        //    mundo — van en tiempo de juego (dtGoal) para que la explosión se
        //    vea desplegarse en cámara lenta y no pasada de largo.
        //  · `slowT` y `flashT` son efectos de PRESENTACIÓN: definen cuántos
        //    segundos reales dura la cámara lenta y el destello. Van en tiempo
        //    real; escalarlos hacía que 1.25 s de slowmo se estiraran a 6.5 s.
        if (!this.blasted) {
          this.blastT -= dtGoal;
          if (this.blastT <= 0) this._detonate();
        } else {
          this.blastWave = Math.min(1, this.blastWave + dtGoal * 2.2);
          if (this.flashT > 0) this.flashT -= dt;
          this.slowT -= dt;
          if (this.slowT <= 0) this.timeScale = damp(this.timeScale, 1, 3.2, dt);
        }
        if (this.scorePunch > 0) this.scorePunch = Math.max(0, this.scorePunch - dt * 1.6);
        if (this.goalT <= 0) {
          this.timeScale = 1;
          // Por goles: alguien llegó a la meta → se terminó.
          const metaAlcanzada = this.goalTarget > 0
            && (this.score.p1 >= this.goalTarget || this.score.p2 >= this.goalTarget);
          if (metaAlcanzada
              || this.golden
              || (!this.goalTarget && this.timeLeft <= 0 && this.score.p1 !== this.score.p2)) {
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

  // ¿Se puede dashear? Solo con el punto en juego y pasado el bloqueo inicial.
  // Lo consultan por igual el humano y los bots — que uno pudiera dashear en
  // el arranque y el otro no rompería el saque parejo que busca el bloqueo.
  dashAllowed() { return this.state === 'play' && this.dashLockT <= 0; }

  // 0..1 de bloqueo restante, para que el HUD lo pueda mostrar. Sin señal
  // visible el jugador aprieta Space, no pasa nada, y parece un bug.
  dashLockFrac() {
    const L = CFG.match.dashLockout;
    return L > 0 ? Math.max(0, this.dashLockT) / L : 0;
  }
}
