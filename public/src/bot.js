// Bot: entiende pelota, arcos, trayectoria y rival. Comete errores humanos
// (cursor con velocidad limitada, decisiones a 8Hz, ruido) pero nunca es aleatorio.
import { CFG } from './config.js';
import { portalCenter } from './arena.js';
import { clamp, rand } from './utils.js';

// Dificultad: dos palancas sobre el comportamiento que ya existía.
//   think → cada cuánto replantea la jugada (más alto = más lento de reflejos)
//   aim   → cuánto se equivoca al apuntar (más alto = falla más)
// En 'normal' ambos valen 1, así que el bot queda exactamente como estaba.
const DIFFICULTY = {
  facil:   { think: 2.2, aim: 2.4 },
  normal:  { think: 1.0, aim: 1.0 },
  dificil: { think: 0.6, aim: 0.45 },
};

// Personalidad por héroe: sesgos LEVES sobre el comportamiento base, para
// que el rival se sienta distinto según quién sea sin romper el balance
// (la dificultad sigue mandando por encima). Se lee del characterId del
// jugador que controla este bot; sin personaje → bot clásico.
const PERSONAS = {
  // Valka embiste: patea con el freno más seguido y no se queda trabada.
  valka:   { brakeKick: 0.75, impaciente: true, boostCerca: true },
  // Zefir caza: obsesionado con el fugitivo, decide más rápido, vuela a fondo.
  zefir:   { chaseMul: 1.6, thinkMul: 0.85, boostCerca: true },
  // Mordrak se atrinchera: con la pelota en campo rival, espera y contragolpea.
  mordrak: { defensor: true },
  // Ízar bombardea: carga el golpe MUCHO antes — llega con el latigazo a tope.
  izar:    { francotirador: true, brakeKick: 0.3 },
  // Petra piensa lento y pega con el cuerpo: una montaña no se apura.
  petra:   { thinkMul: 1.15, brakeKick: 0.8 },
  // Hilaria teje fino: paciente y con la mejor puntería del plantel.
  hilaria: { aimMul: 0.7, brakeKick: 0.35 },
  // Vendaval ve botín: el fugitivo es SU tesoro, y vuela a todo trapo.
  vendaval: { chaseMul: 1.5, boostCerca: true },
  // Silvano fluye: sereno para decidir, certero para ejecutar.
  silvano: { thinkMul: 1.05, aimMul: 0.8 },
  // Fogón condimenta de más: impaciente, agresivo y algo desprolijo.
  fogon:   { impaciente: true, brakeKick: 0.65, aimMul: 1.15 },
};

export class Bot {
  constructor(player, ownSide, difficulty = 'normal') {
    this.player = player;
    this.ownSide = ownSide;               // +1 defiende portal derecho
    this.targetSide = -ownSide;           // anota en el portal contrario
    this.aim = { x: player.broom.pos.x + this.targetSide * 200, y: player.broom.pos.y };
    this.diff = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
    // Cuando está por golpear, adónde debe APUNTAR el tiro (null = el cursor
    // sigue dirigiendo la escoba normalmente).
    this.shotAim = null;
    this.decideT = 0;
    this.desired = { x: 0, y: 0 };
    this.thrust = false;
    this.brake = false;
    this.tuck = false;
    this.mode = 'attack';
    this.noise = { x: 0, y: 0 };
    this.stuckT = 0;    // detector de scrum trabado
    this.backoffT = 0;  // maniobra: retroceder y volver a embestir
    this.wantsBoost = false;
    // Dash propio del bot: 2 cargas independientes, igual que el humano.
    // Antes esto no existía y los bots nunca usaban Space — vivía sólo como
    // `dashState` ligado a `playerA` en main.js.
    this.dash = {
      charges: 2,
      rechargeT: 0,
      active: false,
      t: 0,
    };
    this.wantsDash = false;
  }

  update(dt, world) {
    // Anti-atasco: pelota lenta + bot encima durante mucho tiempo
    const ball = world.ball;
    const me = this.player.broom;
    const ballSpeed = Math.hypot(ball.vel.x, ball.vel.y);
    const dBall = Math.hypot(ball.pos.x - me.pos.x, ball.pos.y - me.pos.y);
    if (ballSpeed < 140 && dBall < 260 && this.backoffT <= 0) {
      this.stuckT += dt;
      const lim = (PERSONAS[this.player.characterId] ?? {}).impaciente ? 1.2 : 1.7;
      if (this.stuckT > lim) { this.backoffT = 1.1; this.stuckT = 0; }
    } else {
      this.stuckT = Math.max(this.stuckT - dt * 2, 0);
    }
    if (this.backoffT > 0) this.backoffT -= dt;

    // ── Dash: recarga y disparo ─────────────────────────────────────────
    // Calcado del dash del humano en main.js (mismo CFG.dash), pero corre acá
    // porque cada bot tiene su propio estado. Recarga por tiempo con 2 cargas
    // independientes; MAGIA (mods.dashRecharge) lo acelera igual que al humano.
    const D = CFG.dash;
    // PASIVA de Zefir — "Tercer impulso": una carga extra, también para el
    // bot que lo juegue. Se calcula acá y no en el constructor porque el
    // characterId se asigna después de crear el bot.
    const dashMax = D.maxCharges + (this.player.characterId === 'zefir' ? 1 : 0);
    if (this.dash.charges < dashMax) {
      this.dash.rechargeT += dt / this.player.mods.dashRecharge;
      if (this.dash.rechargeT >= D.recharge) {
        this.dash.charges++;
        this.dash.rechargeT = this.dash.charges < dashMax
          ? this.dash.rechargeT - D.recharge : 0;
      }
    }
    if (this.dash.active) {
      this.dash.t += dt;
      if (this.dash.t >= D.duration) this.dash.active = false;
    }
    // Disparo: mismo candado que el humano (match.dashAllowed — nada de
    // robar la pelota del saque con un dash instantáneo).
    if (this.wantsDash && this.dash.charges > 0 && !this.dash.active
        && world.match?.dashAllowed?.()) {
      this.dash.charges--;
      this.dash.active = true;
      this.dash.t = 0;
      const dir = me.dir();
      const dashP = D.power * this.player.mods.dashPower;
      me.vel.x += dir.x * dashP;
      me.vel.y += dir.y * dashP;
      world.particles?.impact?.(me.pos.x, me.pos.y, 320);
      world.sound?.pop?.();
      this.wantsDash = false;
    }

    // Replanteo INMEDIATO si la pelota cambió de rumbo fuerte (alguien le
    // pegó) o si pasa cerca a toda velocidad. Con la ventana fija de ~11 Hz,
    // una pelota rápida cruzaba al lado del bot entre dos decisiones y él
    // seguía yendo al punto viejo: eso es lo que se ve como "no reacciona".
    const vBall = Math.hypot(ball.vel.x, ball.vel.y);
    const cambioBrusco = Math.hypot(
      ball.vel.x - (this._lastBallV?.x ?? ball.vel.x),
      ball.vel.y - (this._lastBallV?.y ?? ball.vel.y)) > 700;
    if (cambioBrusco || (dBall < 620 && vBall > 900)) this.decideT = 0;
    this._lastBallV = { x: ball.vel.x, y: ball.vel.y };

    this.decideT -= dt;
    if (this.decideT <= 0) {
      // ~11 Hz en normal. Replantear más seguido es lo que más se nota contra
      // un humano: el bot deja de "comprometerse" con una decisión vieja
      // mientras la jugada ya cambió. La dificultad estira o acorta esta
      // ventana — un bot fácil reacciona tarde a lo que acaba de pasar.
      // De 0.09 a 0.06 (~16 Hz): replantear más seguido es lo que hace que
      // el bot no "demore" en salir a buscar la pelota. Con 0.09 se quedaba
      // hasta 90 ms comprometido con una decisión vieja.
      const pThink = (PERSONAS[this.player.characterId] ?? {}).thinkMul ?? 1;
      this.decideT = 0.06 * this.diff.think * pThink;
      this._decide(world);
    }

    // El cursor cumple DOS funciones a la vez: dirige la escoba (persigue
    // `desired`) y apunta el latigazo (rider dispara la pelota de la pelota
    // hacia el cursor). Cuando el bot está por golpear manda la segunda: si no,
    // en modo 'flank' el cursor apunta detrás de la pelota —del lado del arco
    // propio— y el golpe salía derecho al propio arco. Ese era el autogol del
    // saque. `shotAim` lo fija `_decide` en el instante del golpe.
    const goal = this.shotAim ?? this.desired;
    const dx = goal.x + this.noise.x - this.aim.x;
    const dy = goal.y + this.noise.y - this.aim.y;
    const d = Math.hypot(dx, dy);
    const maxMove = 3000 * dt;
    if (d > maxMove) {
      this.aim.x += dx / d * maxMove;
      this.aim.y += dy / d * maxMove;
    } else {
      this.aim.x += dx;
      this.aim.y += dy;
    }

    const c = this.player.control;
    c.aim.x = this.aim.x;
    c.aim.y = this.aim.y;
    c.thrust = this.thrust;
    c.brake = this.brake;
    c.tuck = this.tuck;
  }

  _decide(world) {
    const ball = world.ball;
    const me = this.player.broom;
    const halfW = CFG.arena.R;
    const persona = PERSONAS[this.player.characterId] ?? {};
    const scorePortal = portalCenter(this.targetSide);
    const ownPortal = portalCenter(this.ownSide);

    // Predicción simple de la pelota. La ventana llega más lejos que antes
    // (0.55 → 0.75): con el tope corto el bot perseguía el lugar donde la
    // pelota YA estuvo en los tiros largos y siempre llegaba tarde.
    const distToBall = Math.hypot(ball.pos.x - me.pos.x, ball.pos.y - me.pos.y);
    const tPred = clamp(distToBall / 750, 0.08, 0.75);
    const bp = {
      x: ball.pos.x + ball.vel.x * tPred,
      y: ball.pos.y + ball.vel.y * tPred + 0.5 * CFG.ball.gravity * tPred * tPred * 0.6,
    };

    // Dirección pelota → portal rival (donde quiero empujarla)
    let sx = scorePortal.x - bp.x, sy = scorePortal.y - bp.y;
    const sl = Math.hypot(sx, sy) || 1;
    sx /= sl; sy /= sl;

    // ¿Peligro? La pelota va hacia mi portal. El umbral de velocidad bajó de
    // 220 a 90: una pelota lenta yendo al arco propio es igual de peligrosa y
    // antes no despertaba la defensa hasta que ya era tarde. Y si además está
    // MUY cerca del arco, es emergencia sin importar a qué velocidad vaya.
    const towardOwn = this.ownSide > 0 ? ball.vel.x > 90 : ball.vel.x < -90;
    const ballNearOwn = Math.abs(ball.pos.x - ownPortal.x) < halfW * 0.85;
    const ballOnDoorstep = Math.hypot(ball.pos.x - ownPortal.x, ball.pos.y - ownPortal.y) < 520;
    const meBehindBall = (me.pos.x - bp.x) * this.ownSide > 30; // entre pelota y mi arco

    // PELIGRO: la pelota está en mi mitad de cancha, se mueva o no. Antes la
    // defensa sólo despertaba si la pelota VENÍA hacia el arco o ya estaba en
    // la puerta; una pelota quieta o lenta en mi área no activaba nada y el
    // bot la ignoraba mientras el rival la acomodaba. Con esto, tener la
    // pelota cerca del arco propio ya es motivo suficiente para ir a sacarla.
    const enPeligro = (bp.x - ownPortal.x) * -this.ownSide < halfW * 0.55;

    // ¿Estoy del lado correcto para empujar la pelota al arco rival?
    const toMe = { x: me.pos.x - bp.x, y: me.pos.y - bp.y };
    const tml = Math.hypot(toMe.x, toMe.y) || 1;
    const alignment = (toMe.x / tml) * sx + (toMe.y / tml) * sy; // < 0 = bien posicionado

    const speed = Math.hypot(me.vel.x, me.vel.y);

    // --- Reparto de roles (2v2) ---
    // Sin esto los dos compañeros persiguen la misma pelota y se estorban.
    //
    // El reparto es DINÁMICO, no por etiqueta fija: el que está mejor parado
    // para la pelota ataca y el otro cubre, y los papeles se intercambian
    // solos durante el partido. Antes `role` era una etiqueta fija y el
    // 'striker' NUNCA cubría — si el 'support' se iba arriba, el arco quedaba
    // solo. Ahora siempre hay alguien atrás: es la queja principal.
    let hangBack = false;
    this.mate = null;
    // Mordrak defensor: con la pelota bien metida en campo rival no la
    // persigue — se queda cubriendo y espera el contragolpe. Sale de la
    // cueva apenas la pelota cruza al medio.
    if (persona.defensor && ball.pos.x * this.ownSide < -halfW * 0.2) {
      hangBack = true;
    }
    const mates = (world.players || []).filter(
      (p) => p !== this.player && p.team === this.player.team);
    if (mates.length) {
      this.mate = mates[0];
      // "Mejor parado" no es sólo distancia: pesa el estar del lado correcto
      // de la pelota. Un compañero pegado a la pelota pero del lado del arco
      // propio está PEOR parado que uno un poco más lejos pero bien ubicado,
      // porque el primero, si va, la empuja hacia adentro.
      const cost = (p) => {
        const d = Math.hypot(ball.pos.x - p.broom.pos.x, ball.pos.y - p.broom.pos.y);
        const behind = (p.broom.pos.x - ball.pos.x) * this.ownSide > 0;
        return d + (behind ? 0 : 420);   // penalización por estar mal parado
      };
      const myCost = distToBall + (meBehindBall ? 0 : 420);
      const iAmBest = mates.every((p) => cost(p) > myCost);
      // El que no va a la pelota cubre. Siempre uno de los dos: nunca los dos
      // arriba, nunca los dos atrás.
      hangBack = !iAmBest;
      this.attacking = iAmBest;

      // ...salvo emergencia: si la pelota está entrando al arco propio, van
      // los dos. Que el compañero "tenga el rol de atacante" no puede impedir
      // que ayude cuando se está por comer un gol.
      if (ballOnDoorstep) hangBack = false;

      // SAQUE: los primeros segundos el que no ataca se queda atrás sí o sí.
      // En el saque la pelota está en el centro, a igual distancia de todos, y
      // el desempate por costo puede dar vuelta entre frames — se veía como
      // los dos saliendo disparados al medio y chocándose entre ellos.
      if ((world.match?.playT ?? 99) < 2.2 && !iAmBest) hangBack = true;
    }

    if (hangBack) {
      // CUBRIR / ATAJAR. Dos comportamientos según dónde esté la pelota:
      //
      //  a) La pelota viene o está cerca → ARQUERO: pararse sobre la línea
      //     que une la pelota con el centro del arco, a media distancia. Ahí
      //     es donde hay que estar para tapar, y no "cerca del arco" a secas.
      //     Antes se interpolaba pelota↔arco sin mirar la trayectoria, así que
      //     la pelota le pasaba al lado y entraba igual.
      //  b) La pelota está lejos → esperar en posición adelantada, listo para
      //     recibir un pase o salir de contra.
      this.mode = 'cover';
      this.shotAim = null;

      const dBallOwn = Math.hypot(bp.x - ownPortal.x, bp.y - ownPortal.y);
      const amenaza = dBallOwn < halfW * 1.15 || towardOwn;

      if (amenaza) {
        // Colocarse EN LA LÍNEA de tiro, del lado del arco. Es lo que hace un
        // arquero: achicar el ángulo. Cuanto más cerca está la pelota, más
        // sale a achicar; de lejos se queda cerca de la línea.
        let lx = bp.x - ownPortal.x, ly = bp.y - ownPortal.y;
        const ll = Math.hypot(lx, ly) || 1;
        lx /= ll; ly /= ll;
        const salida = clamp(dBallOwn * 0.42, 150, 460);
        this.desired.x = ownPortal.x + lx * salida;
        this.desired.y = ownPortal.y + ly * salida;
        this.wantsBoost = dBallOwn < halfW * 0.7;   // apurarse si es urgente
      } else {
        // Posición de espera: adelantado respecto del arco, listo para recibir.
        this.desired.x = ownPortal.x * 0.62 + bp.x * 0.38;
        this.desired.y = ownPortal.y * 0.62 + bp.y * 0.38;
        this.wantsBoost = false;

        // RECARGAR mientras no hay peligro. Con los orbes en las esquinas los
        // bots no pasaban nunca por ellos y jugaban SIEMPRE sin impulso:
        // medido, querían boost el 47% del tiempo pero sólo lo tenían el 5%,
        // con la reserva vacía el 88% del partido. Eso es lo que los hacía
        // ver lentos. El que cubre y no tiene nada urgente que hacer va a
        // buscar el orbe más cercano que le quede de camino al arco.
        if (this.player.energy < 45 && world.orbs?.orbs) {
          let mejor = null, mejorD = 1e9;
          for (const o of world.orbs.orbs) {
            if (!o.alive) continue;
            const d = Math.hypot(o.fx - me.pos.x, o.fy - me.pos.y);
            // Sólo si está de mi lado de la cancha: no cruzar el mapa entero.
            if ((o.x - ownPortal.x) * -this.ownSide > halfW * 1.1) continue;
            if (d < mejorD) { mejorD = d; mejor = o; }
          }
          if (mejor && mejorD < 1300) {
            this.desired.x = mejor.fx;
            this.desired.y = mejor.fy;
            this.wantsBoost = false;   // no gastar lo poco que queda
          }
        }
      }

      const toT = Math.hypot(this.desired.x - me.pos.x, this.desired.y - me.pos.y);
      this.thrust = toT > 110;
      this.brake = toT < 90 && speed > 380;
      this.tuck = false;
      // Al arquero se le pide MENOS error que a un atacante: un arquero que
      // falla por ruido es un arquero que no ataja, y eso se lee como bot tonto.
      const n = (amenaza ? 22 : 45) * this.diff.aim;
      this.noise.x = rand(-n, n);
      this.noise.y = rand(-n, n);
      return;
    }

    // --- Orbe fugitivo ---
    // Va sólo el que está mejor parado del equipo, y sólo si no está apagando
    // un incendio en su propio arco. Si fueran todos, el partido se
    // transformaría en una cacería y nadie defendería.
    const runner = world.runner;
    if (runner?.active) {
      const dRun = Math.hypot(runner.x - me.pos.x, runner.y - me.pos.y);
      const mates = (world.players || []).filter(
        (p) => p !== this.player && p.team === this.player.team);
      const bestOfTeam = mates.every(
        (p) => Math.hypot(runner.x - p.broom.pos.x, runner.y - p.broom.pos.y) > dRun);
      const emergency = towardOwn && ballNearOwn && !meBehindBall;
      // NO abandonar una ocasión de gol por ir a buscar el orbe. Si tengo la
      // pelota cerca y estoy bien parado para empujarla al arco rival, eso
      // vale más que cualquier premio: un bot que sale corriendo detrás del
      // orbe teniendo el gol servido se ve directamente roto.
      const chanceDeGol = distToBall < 520 && alignment < -0.1
        && Math.hypot(bp.x - scorePortal.x, bp.y - scorePortal.y) < halfW * 1.25;
      if (bestOfTeam && !emergency && !chanceDeGol
          && dRun < CFG.runner.chaseRange * (persona.chaseMul ?? 1)) {
        this.mode = 'runner';
        this.shotAim = null;
        // Interceptar: apuntar adonde VA a estar, no donde está
        const lead = clamp(dRun / 900, 0.1, 0.55);
        this.desired.x = runner.x + runner.vx * lead;
        this.desired.y = runner.y + runner.vy * lead;
        this.thrust = true;
        this.brake = false;
        this.tuck = false;
        // Sin impulso no lo alcanza nunca: el fugitivo corre más que un
        // vuelo normal. Gastar la reserva para ganar reserva infinita.
        this.wantsBoost = true;
        const n = 30 * this.diff.aim;
        this.noise.x = rand(-n, n);
        this.noise.y = rand(-n, n);
        return;
      }
    }

    if (this.backoffT > 0) {
      // RETROCEDER para tomar carrera y volver a embestir la pelota
      this.mode = 'backoff';
      this.desired.x = bp.x - sx * 400;
      this.desired.y = bp.y - sy * 400 - 60;
      this.thrust = true;
      this.brake = false;
    } else if ((towardOwn && ballNearOwn && !meBehindBall) || ballOnDoorstep || enPeligro) {
      // DEFENSA: interponerse entre la pelota y mi portal
      this.mode = 'defend';
      if (distToBall < 180) {
        // Despeje. Antes esto era `bp.x - ownSide * 120`, un corrimiento
        // lateral fijo, y ahí estaba el gol en contra: si la pelota quedaba
        // ENTRE el bot y su propio arco, ese punto caía del lado del arco y el
        // bot aceleraba empujándola adentro. Medido: perdía 5-7 contra un
        // humano quieto, casi todo en contra.
        // Ahora se ataca desde el lado del arco propio hacia afuera: el punto
        // objetivo se coloca detrás de la pelota sobre la recta arco→pelota,
        // así el contacto siempre la manda lejos del portal, nunca adentro.
        let ax = bp.x - ownPortal.x, ay = bp.y - ownPortal.y;
        const al = Math.hypot(ax, ay) || 1;
        ax /= al; ay /= al;
        // Punto de despeje a 200 (antes 150). Probado 150 vs 200 vs 260 sobre
        // 8 partidos cada uno: la diferencia en autogoles es ruido, pero con
        // 200 el equipo convierte más (17 goles legítimos contra 12 con 150),
        // porque el defensor sale del área con más impulso en vez de quedar
        // pegado a la pelota. 260 ya es demasiado: llega tarde a tapar.
        this.desired.x = bp.x - ax * 200;
        this.desired.y = bp.y - ay * 200;
      } else {
        this.desired.x = bp.x * 0.45 + ownPortal.x * 0.55;
        this.desired.y = bp.y * 0.6;
      }
      this.thrust = true;
      this.brake = false;

      // NOTA (probado y descartado): hice que el defensor se apartara de la
      // línea pelota→arco cuando quedaba del lado de adentro, para no empujar
      // la pelota a su propio arco. Salió peor — los autogoles subieron de 29%
      // a 38% y los goles legítimos bajaron de 12 a 8, porque el que se aparta
      // deja de tapar y entran los tiros que antes bloqueaba. Estar delante
      // del arco vale más que el autogol ocasional. No reintentar.

      // LO QUE DECIDE EL CONTACTO ES MI VELOCIDAD, no mi posición. El choque
      // empuja la pelota por la normal cuerpo→pelota, así que si llego
      // MOVIÉNDOME hacia mi propio arco, la toco y se va para adentro por
      // mucho que apunte bien. Medido: de los golpes que acercan la pelota al
      // arco propio, ~90% son choques de cuerpo y no latigazos.
      //
      // Si vengo hacia mi arco y la pelota está cerca, se corrige el rumbo:
      // el objetivo se pone del lado propio de la pelota para que el
      // acercamiento final sea EN SENTIDO CONTRARIO, hacia campo rival.
      // Rodear SÓLO si hay margen. En defensa el tiempo manda: si la pelota
      // está lejos del arco todavía se puede ganar la espalda, pero con la
      // pelota encima del arco rodear es regalar el gol — ahí se va de frente
      // y se saca como se pueda. (Medido: aplicar el rodeo siempre subía los
      // toques malos de 'defend' de 24 a 41, porque la pelota se quedaba
      // dando vueltas en el área en vez de salir.)
      const dOwnGoal = Math.hypot(bp.x - ownPortal.x, bp.y - ownPortal.y);
      const hayMargen = dOwnGoal > 620;
      const vengoHaciaMiArco = me.vel.x * this.ownSide > 200;
      const ladoMalo = (me.pos.x - bp.x) * this.ownSide < -40;
      if (hayMargen && (ladoMalo || vengoHaciaMiArco) && distToBall < 420) {
        const sgn = me.pos.y > bp.y ? 1 : -1;
        // Punto de rodeo: por fuera en Y, y bien del lado propio en X, para
        // llegar empujando hacia el rival.
        this.desired.x = bp.x + this.ownSide * 340;
        this.desired.y = bp.y + sgn * 280;
        this.thrust = true;         // sin frenar: rodear rápido
        this.brake = false;
      }
      // Umbral de -0.1 a -0.32: con -0.1 se atacaba estando casi de costado,
      // y desde ahí el contacto sale para cualquier lado. Exigir estar mejor
      // parado manda esos casos a 'flank', que rodea — que es lo correcto.
    } else if (alignment < -0.32) {
      // ATAQUE: estoy detrás de la pelota → empujarla a través hacia el portal
      this.mode = 'attack';
      // El punto objetivo va apenas PASADA la pelota en la dirección del arco
      // rival, para atravesarla. Pero se recorta si eso me pusiera del lado
      // malo: con 60 fijos, llegando rápido y en diagonal, el bot terminaba
      // pasándose y el siguiente contacto salía para atrás.
      this.desired.x = bp.x + sx * 60;
      this.desired.y = bp.y + sy * 60;
      this.thrust = true;
      // Brake kick: cerca y rápido → frenar para que el cuerpo golpee.
      // La personalidad mueve la probabilidad: Valka patea casi siempre,
      // Ízar casi nunca (prefiere llegar cargado).
      this.brake = distToBall < 150 && speed > 480 && Math.random() < (persona.brakeKick ?? 0.5);

      // Seguro anti-autogol: si además de atacar la pelota está pegada al
      // arco propio, empujar "hacia el portal rival" puede significar
      // atravesarla contra el arco de uno. En esa zona se despeja hacia
      // afuera y recién después se ataca.
      const dOwn = Math.hypot(bp.x - ownPortal.x, bp.y - ownPortal.y);
      if (dOwn < 420) {
        let ax = bp.x - ownPortal.x, ay = bp.y - ownPortal.y;
        const al = Math.hypot(ax, ay) || 1;
        this.desired.x = bp.x - (ax / al) * 150;
        this.desired.y = bp.y - (ay / al) * 150;
      }
    } else {
      // RODEAR: ir al punto detrás de la pelota (con arco para no empujarla mal)
      this.mode = 'flank';
      const behind = { x: bp.x - sx * 150, y: bp.y - sy * 150 };
      // Desvío perpendicular para NO atravesar la pelota. Este era el mayor
      // productor de golpes hacia atrás (medido: 33 de 66): el rodeo apuntaba
      // a un punto 150 detrás de la pelota con un desvío de sólo 120, así que
      // yendo rápido el bot cortaba camino POR ENCIMA de la pelota y la
      // empujaba justo para el lado contrario. El desvío ahora es más ancho
      // que el acercamiento, así que el arco pasa siempre por afuera.
      const perpX = -sy, perpY = sx;
      const side = (me.pos.y - bp.y) * perpY + (me.pos.x - bp.x) * perpX > 0 ? 1 : -1;
      const detour = clamp(1 - Math.abs(alignment), 0, 1) * 260;
      this.desired.x = behind.x + perpX * side * detour;
      this.desired.y = behind.y + perpY * side * detour;
      const toT = Math.hypot(this.desired.x - me.pos.x, this.desired.y - me.pos.y);
      this.thrust = toT > 100;
      // frenar si me paso de largo
      const closing = (me.vel.x * (this.desired.x - me.pos.x) + me.vel.y * (this.desired.y - me.pos.y));
      this.brake = closing < 0 && speed > 420;

      // DESPEJARSE DE LA PELOTA cuando vengo mal parado. Medido: el 33.6% de
      // los contactos empujan la pelota hacia el arco propio y CASI TODOS son
      // choques de cuerpo, no latigazos (los latigazos malos ya son sólo el
      // 2.2%). Contra eso no sirve apuntar mejor: el bot ni siquiera está
      // decidiendo pegar, es el ragdoll que roza la pelota al pasar.
      //
      // La única defensa es no estar ahí: si estoy mal parado y cerca, el
      // punto objetivo se aleja LATERALMENTE de la pelota para rodearla por
      // fuera, en vez de pasarle por encima.
      // Y lo que más pesa: mi VELOCIDAD. Si vengo moviéndome hacia mi propio
      // arco, cualquier roce manda la pelota para adentro.
      const malParado = (me.pos.x - bp.x) * this.ownSide < -40;
      const vengoMal = me.vel.x * this.ownSide > 200;
      if ((malParado || vengoMal) && distToBall < 380) {
        // Rodeo amplio: por el costado y ganando la espalda de la pelota.
        this.desired.x = bp.x + this.ownSide * 340;
        this.desired.y = bp.y + perpY * side * 300;
        this.thrust = true;
        this.brake = false;
      }
    }

    // Recogerse en giros bruscos
    const targetAngle = Math.atan2(this.desired.y - me.pos.y, this.desired.x - me.pos.x);
    let diff = targetAngle - me.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.tuck = Math.abs(diff) > 1.7;

    // Latigazo: cargar al acercarse a la pelota y soltar justo al llegar.
    // Sin esto el bot queda claramente débil contra un humano que sí lo usa.
    //
    // PERO sólo si el golpe saldría en la dirección correcta. El latigazo
    // manda la pelota hacia donde el bot está yendo, y disparar por tiempo sin
    // mirar la dirección era la causa del autogol del saque: los dos salen de
    // frente al centro, el bot llega a la pelota MIRANDO A SU PROPIO ARCO,
    // latiguea y la mete adentro. Ahora se exige que el rumbo actual del bot
    // aleje la pelota del arco propio antes de permitir el golpe.
    if (this.mode === 'attack' || this.mode === 'defend' || this.mode === 'flank') {
      const closingSpeed = Math.max(speed, 120);
      const tToBall = distToBall / closingSpeed;
      // Ízar francotirador: entra en ventana de golpe mucho antes → carga
      // el latigazo más tiempo → llega con el tiro a tope (y de fuego, si
      // tiene reserva). Es SU forma de jugar.
      // Ventana de carga más ancha (0.34 → 0.50): con la ventana corta el bot
      // llegaba a la pelota SIN el latigazo armado y la empujaba con el cuerpo
      // en vez de pegarle. Medido: estaba cerca de la pelota sin armar el
      // golpe el 61% del tiempo. Cargar antes = llegar con el tiro listo.
      const ventana = persona.francotirador ? 0.70 : 0.50;
      const aboutToHit = tToBall < ventana;

      if (aboutToHit) {
        // Al entrar en la ventana de golpe el cursor deja de dirigir la escoba
        // y pasa a APUNTAR EL TIRO: al arco rival, no al punto de rodeo. Sin
        // esto, en 'flank' el cursor está detrás de la pelota (del lado propio)
        // y el latigazo salía derecho al arco de uno — el autogol del saque.
        // Se apunta un poco por dentro del arco para que el tiro converja.
        this.shotAim = { x: scorePortal.x - this.targetSide * 40, y: scorePortal.y };

        // ── ¿Tiro o pase? ────────────────────────────────────────────────
        // La decisión que más "piensa" hace parecer al bot. Se pasa cuando el
        // compañero está MEJOR ubicado para convertir: más cerca del arco
        // rival, con línea despejada y no demasiado lejos (un pase de media
        // cancha lo intercepta cualquiera).
        if (this.mate) {
          const mp = this.mate.broom.pos;
          const dMate = Math.hypot(mp.x - bp.x, mp.y - bp.y);
          const miDistArco = Math.hypot(bp.x - scorePortal.x, bp.y - scorePortal.y);
          const suDistArco = Math.hypot(mp.x - scorePortal.x, mp.y - scorePortal.y);
          // Línea de pase despejada: que ningún rival esté cerca del segmento
          // pelota→compañero. Se aproxima mirando la distancia del rival a la
          // recta, que para esto alcanza y es barato.
          let despejada = true;
          for (const p of world.players || []) {
            if (p.team === this.player.team) continue;
            const ex = mp.x - bp.x, ey = mp.y - bp.y;
            const el = Math.hypot(ex, ey) || 1;
            const t = clamp(((p.broom.pos.x - bp.x) * ex + (p.broom.pos.y - bp.y) * ey) / (el * el), 0, 1);
            const px = bp.x + ex * t, py = bp.y + ey * t;
            if (Math.hypot(p.broom.pos.x - px, p.broom.pos.y - py) < 190) { despejada = false; break; }
          }
          // Y que el pase vaya hacia adelante: pasarla hacia atrás, al propio
          // campo, es justo lo que no queremos.
          const haciaAdelante = (mp.x - bp.x) * this.targetSide > -80;
          // En peligro NO se toca el pase: con la pelota en el área propia, un
          // pase interceptado es un gol. Ahí siempre se despeja al arco rival.
          if (!enPeligro && despejada && haciaAdelante && dMate > 260 && dMate < 1500
              && suDistArco < miDistArco - 200) {
            // Pase al PUNTO FUTURO del compañero, no a donde está: si no,
            // la pelota le llega siempre por detrás.
            const lead = clamp(dMate / 1200, 0.1, 0.5);
            this.shotAim = {
              x: mp.x + this.mate.broom.vel.x * lead,
              y: mp.y + this.mate.broom.vel.y * lead,
            };
            this.mode = 'pass';
          }
        }
      } else {
        this.shotAim = null;
      }

      // DESPEJE OBLIGATORIO: con la pelota en peligro, el bot SIEMPRE pega
      // para el lado del rival. Antes, si la geometría no daba, simplemente
      // no golpeaba (`shotAim = null`) — y ahí quedaba la pelota, dando
      // vueltas en el área propia mientras el bot la acompañaba sin resolver.
      // Eso se leía como "no reaccionan". Ahora, en vez de cancelar el golpe,
      // se CORRIGE la puntería hacia campo rival: es la acción por defecto.
      if (enPeligro && this.shotAim) {
        // Dirección de despeje: desde el arco propio hacia afuera, mezclada
        // con la dirección al arco rival. Así la pelota sale del área aunque
        // el ángulo al arco rival sea malo.
        let ox = bp.x - ownPortal.x, oy = bp.y - ownPortal.y;
        const ol = Math.hypot(ox, oy) || 1;
        ox /= ol; oy /= ol;
        // Siempre con componente hacia el campo rival: nada de despejes que
        // vuelvan hacia atrás.
        const fx = this.targetSide;
        this.shotAim = {
          x: bp.x + (ox * 0.35 + fx * 0.65) * 1200,
          y: bp.y + oy * 0.35 * 1200,
        };
      }

      // Además, si por la geometría el tiro igual saldría hacia el arco propio,
      // no se golpea: mejor acompañar la pelota que rematarla en contra.
      let hx = this.shotAim ? this.shotAim.x - bp.x : 0;
      let hy = this.shotAim ? this.shotAim.y - bp.y : 0;
      const hl = Math.hypot(hx, hy) || 1;
      hx /= hl; hy /= hl;
      let ax = bp.x - ownPortal.x, ay = bp.y - ownPortal.y;
      const al = Math.hypot(ax, ay) || 1;
      const awayFromOwn = (hx * ax + hy * ay) / al;
      // En peligro el umbral se relaja: la puntería ya fue corregida arriba
      // para que apunte afuera, y NO golpear es peor que golpear regular.
      let safeToHit = !this.shotAim || awayFromOwn > (enPeligro ? -0.6 : -0.35);

      // VETO DURO por geometría de contacto. Lo anterior mira a dónde APUNTA
      // el bot, pero el latigazo barre la pelota desde donde el cuerpo la
      // toca: si el bot llega del lado del arco rival, el barrido la devuelve
      // hacia su propio arco por más que el cursor apunte bien. Medido: 33%
      // de los golpes acercaban la pelota al arco propio, y la mayoría eran
      // latigazos "bien apuntados".
      //
      // Regla simple y robusta: para mandarla hacia el rival hay que estar
      // del lado propio de la pelota. Si no lo estoy y encima vengo rápido,
      // no se golpea — se acompaña y se rodea.
      // Vale también EN PELIGRO. Al principio eximí el despeje pensando que
      // "golpear siempre" era mejor que dudar, pero medido resultó al revés:
      // 'defend' pasó a ser el que más pelotas mandaba a su propio arco (23
      // de 48) justo por esa excepción. Un despeje mal parado ES el autogol.
      // Si no estoy del lado bueno, primero me acomodo — para eso el modo
      // 'defend' ya me lleva por detrás de la pelota.
      // El margen pasa de -40 a -170: con -40 el veto era tan estricto que
      // bloqueaba casi cualquier tiro y los bots se veían pasivos ("tienen la
      // ocasión y no le pegan"). -170 sigue frenando el golpe claramente malo
      // —el que sale de frente al arco propio— pero deja pasar el tiro normal
      // desde el costado, que es la mayoría.
      const ladoBueno = (me.pos.x - bp.x) * this.ownSide > -170;
      if (!ladoBueno) safeToHit = false;

      if (safeToHit && tToBall < ventana && tToBall > 0.06) this.tuck = true;
      else if (tToBall <= 0.06) this.tuck = false;             // soltar → latigazo
      else if (!safeToHit) { this.tuck = false; this.shotAim = null; }
    } else {
      this.shotAim = null;
    }

    // Boost: antes solo lo usaba lejos y atacando, así que en defensa llegaba
    // caminando a tapar. Ahora también cubre la carrera defensiva, que es
    // donde un humano hacía la diferencia yendo con impulso.
    // MÁXIMO ESFUERZO POR LA PELOTA. Antes el bot sólo usaba impulso lejos o
    // defendiendo, y medido volaba a 494 de media teniendo ~830 disponibles:
    // iba paseando a buscar la pelota. Ahora acelera a fondo siempre que esté
    // yendo a la pelota o a despejar, y el ángulo permitido es más ancho
    // (0.6 → 1.0 rad) para que no pierda el impulso en cada corrección.
    const yendoALaPelota = this.mode === 'attack' || this.mode === 'defend'
      || this.mode === 'flank' || this.mode === 'runner';
    // Y se reserva un mínimo para la carrera que importa: quemar la barra en
    // un traslado cualquiera deja al bot sin nada cuando hay que llegar a
    // despejar. Con la reserva baja sólo se gasta si es urgente de verdad.
    const urgente = this.mode === 'defend' || enPeligro || distToBall > 700;
    const hayReserva = this.player.energy > (urgente ? 12 : 45);
    const boostWorthIt = (yendoALaPelota || distToBall > (persona.boostCerca ? 230 : 320))
      && hayReserva;
    this.wantsBoost = this.thrust && boostWorthIt && Math.abs(diff) < 1.0;

    // DASH: el bot nunca lo usaba (Space quedaba ligado sólo al humano en
    // main.js). Dos casos, calcados de cómo lo usa un humano que juega bien:
    //
    //  1) REMATE: a poca distancia, bien alineado y encarando la pelota, el
    //     empujón de golpe llega antes y con más fuerza que sólo el vuelo. Es
    //     lo que hace que un despeje o un tiro se sienta contundente.
    //  2) EMERGENCIA: la pelota está en peligro y hay que llegar YA — no
    //     hay tiempo de esperar el vuelo normal.
    //
    // Igual que el humano: exige estar bien encarado (si no, el dash tira la
    // escoba para cualquier lado) y no lo gasta si ya viene frenando.
    const encarado = Math.abs(diff) < 0.35;
    const rematando = (this.mode === 'attack' || this.mode === 'flank')
      && distToBall < 260 && distToBall > 60 && alignment < -0.15;
    const emergencia = (this.mode === 'defend' || enPeligro)
      && distToBall < 340 && distToBall > 60;
    this.wantsDash = this.dash.charges > 0 && !this.dash.active && encarado
      && this.thrust && !this.brake && (rematando || emergencia);

    // ORBE DE PASO: si estoy seco y hay un orbe prácticamente en el camino a
    // donde ya iba, se pasa por él. No es un desvío a buscarlo — sólo se
    // acepta si casi no alarga el recorrido, así el bot no abandona la jugada
    // pero deja de jugar todo el partido con la barra en cero.
    if (this.player.energy < 25 && world.orbs?.orbs && this.mode !== 'defend' && !enPeligro) {
      const dDest = Math.hypot(this.desired.x - me.pos.x, this.desired.y - me.pos.y);
      for (const o of world.orbs.orbs) {
        if (!o.alive) continue;
        const dOrb = Math.hypot(o.fx - me.pos.x, o.fy - me.pos.y);
        const dOrbDest = Math.hypot(this.desired.x - o.fx, this.desired.y - o.fy);
        // Desvío total contra ruta directa: hasta un 35% más largo se acepta.
        if (dOrb + dOrbDest < dDest * 1.35 + 120) {
          this.desired.x = o.fx;
          this.desired.y = o.fy;
          break;
        }
      }
    }

    // Error humano (menos cuando está encima de la pelota). La personalidad
    // afina o empeora la puntería: Hilaria teje fino, Fogón condimenta de más.
    //
    // Bajado bastante (9→4 cerca, 30→16 lejos): el ruido alto hacía que los
    // tiros salieran desviados incluso con la decisión correcta, y se leía
    // como que el bot "no sabe pegarle". La dificultad sigue escalándolo.
    const n = (distToBall < 220 ? 4 : 16) * this.diff.aim * (persona.aimMul ?? 1);
    this.noise.x = rand(-n, n);
    this.noise.y = rand(-n, n);
  }
}
