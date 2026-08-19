# Sistema de stats + habilidades únicas

Propuesta de diseño. Nada implementado todavía.

---

## Principio rector

**Nadie es mejor: cada uno es mejor EN ALGO y peor en otra cosa.** El total
de puntos es idéntico para los 10 (18 puntos repartidos en 5 stats de 1 a 5).
Si un personaje se siente "el bueno", el sistema falló.

Además: **el stat tiene que sentirse antes de leerse.** Petra tiene que
sentirse pesada a los tres segundos de volar, sin que nadie mire una tabla.

---

## Los 5 stats

Elegidos porque cada uno ya tiene una palanca real en el motor — no hay que
inventar sistemas nuevos, solo multiplicar constantes que ya existen.

| Stat | Qué se siente | Palanca en el motor |
|---|---|---|
| ⚡ **VELOCIDAD** | Qué tan rápido cruzás la cancha | `broom.thrust`, `dragQuad` (techo de velocidad) |
| 🌀 **MANIOBRA** | Qué tan cerrado girás y qué tan rápido respondés al cursor | `angK`, `angAccMax`, `inertia` |
| 💥 **FUERZA** | Qué tan lejos sale la pelota de tu golpe | `SPIN.maxPower`, `whip.aimedPower` |
| 🛡️ **PESO** | Cuánto te mueven los choques y la explosión del gol | masa efectiva en `ram`, `goalBlast.force` |
| 🔮 **MAGIA** | Dash y boost: cuánto y cada cuánto | `DASH.recharge`, `boost.drain`, `boost.thrustMul` |

**Por qué PESO y no "defensa"**: en este juego no hay vida ni daño. Lo único
que te "castiga" es salir despedido — de un choque o del goal blast. PESO es
la defensa real, y además explica por qué Petra empuja y Zefir rebota.

---

## Tabla del plantel (18 puntos cada uno)

| | ⚡VEL | 🌀MAN | 💥FUE | 🛡️PES | 🔮MAG | Arquetipo |
|---|:--:|:--:|:--:|:--:|:--:|---|
| **Aldus** el Errante | 3 | 4 | 3 | 3 | 5 | El equilibrado con más magia |
| **Valka** la Escudera | 3 | 2 | 5 | 5 | 3 | Ariete: pega y empuja |
| **Mordrak** el Brujo | 2 | 3 | 4 | 3 | 5 | Brujo: magia y pegada, lento |
| **Ízar** el Elemental | 3 | 3 | 5 | 2 | 5 | Cañón de cristal |
| **Zefir** el Vientoveloz | 5 | 5 | 2 | 1 | 5 | Puro movimiento, no empuja nada |
| **Petra** la Montaña | 1 | 1 | 5 | 5 | 3 | Muralla inamovible |
| **Hilaria** la Tejedora | 2 | 5 | 3 | 3 | 5 | Precisión de relojera |
| **Vendaval** el Capitán | 5 | 3 | 4 | 3 | 3 | Velocidad con puño |
| **Silvano** el Druida | 4 | 4 | 3 | 4 | 3 | Equilibrado, sin picos |
| **Fogón** el Cocinero | 3 | 3 | 5 | 4 | 3 | Bruto de cocina |

Chequeos de balance:
- **Nadie tiene 5 en todo lo que importa**: Zefir vuela y gira como nadie
  pero su golpe es el más débil y sale volando de cualquier choque.
- **Petra es 1/1 en movimiento** — el precio de ser imparable. Necesita al
  compañero (2v2) o jugar de portera.
- **Silvano no tiene ningún 5**: es EL personaje de "no tengo debilidades",
  y para alguien que recién empieza es la elección segura.
- **La magia baja (3) va con los físicos**: Valka, Petra, Vendaval y Fogón
  compensan con cuerpo lo que no tienen en recursos.

---

## Habilidades únicas — la parte divertida

Una por personaje. Regla de diseño: **debe cambiar cómo jugás, no solo
sumar un número.** Todas son pasivas o de activación implícita (nada de
teclas nuevas: el juego ya usa mouse + click + espacio + shift).

### 🧙 Aldus — **Segundo Aliento**
Cuando te queda menos de 1/4 de barra de energía, se recarga sola al doble
de velocidad durante unos segundos. *El veterano nunca se queda sin nafta
del todo.* Premia arriesgar la última gota de boost.

### 🛡️ Valka — **Carga de Escudo**
Embestir a un rival con el escudo (dashear contra él) lo manda MUCHO más
lejos y te devuelve media carga de dash. *Convierte el dash en un arma
ofensiva en vez de solo movilidad.* Su bio dice "vuela como quien carga" —
esto lo hace verdad.

### 🔮 Mordrak — **Maldición del Portal**
Cada gol que metés deja el arco rival "maldito" 8 segundos: la succión del
portal es más fuerte para tu equipo. *Premia el momentum: el segundo gol es
más fácil que el primero.* Encaja con "su arco está maldito" del torneo.

### 🔥 Ízar — **Doble Elemento**
Tu tiro de fuego alterna: uno sale ardiendo (la pelota quema), el siguiente
sale **congelado** — la pelota queda lenta y pesada, imposible de despejar
lejos. *Convierte cada tiro cargado en una decisión: ¿quiero velocidad o
quiero que se quede ahí?*

### 💨 Zefir — **Estela de Viento**
Volar rápido deja una corriente que **acelera a la pelota** si la pelota la
cruza. *Podés "empujar" la pelota sin tocarla, corriendo al lado.* Es la
habilidad más rara del set y la más suya: no golpea, guía.

### 🗿 Petra — **Inamovible**
La explosión del gol y las embestidas casi no te mueven, y **la pelota rebota
en vos con más fuerza** (como una pared). *Podés pararte frente a tu arco y
ser literalmente un obstáculo.* El contrapeso de su 1 en velocidad.

### 🧶 Hilaria — **Hilo Conductor**
Tu golpe dirigido tiene **más rango de captura** y la pelota sale con una
corrección de puntería mayor. *Nunca fallás el pase que querías hacer.*
Es la abuela que teje: precisión pura.

### 🏴‍☠️ Vendaval — **Viento a Favor**
Tu vela se infla con la velocidad y te da un **techo de velocidad más alto**
mientras vayas en línea recta sin girar más de X grados. *Premia planear
trayectorias largas en vez de zigzaguear.*

### 🦌 Silvano — **Ciclo Natural**
Los orbes de energía que agarrás valen más, y **reaparecen más rápido cerca
tuyo**. *Convertís el mapa en tu jardín: si controlás el centro, tenés
energía infinita.* Recompensa el juego posicional.

### 👨‍🍳 Fogón — **Punto de Cocción**
Cuanto más tiempo mantenés cargado el golpe, más "se cocina": pasado el
máximo normal sigue creciendo un 25% extra, **pero si te pasás de tiempo se
quema** y sale flojo. *Un mini-juego de timing dentro del golpe.* Muy suyo:
condimenta de más.

---

## Cómo se muestra al jugador

- **En la galería y en "Preparar partido"**: cinco barritas de 5 puntos con
  el color del stat, y la habilidad con su nombre + una línea. Nada de
  números crudos: barras que se leen de un vistazo.
- **En el partido**: la habilidad se anuncia UNA vez la primera vez que se
  dispara ("⚡ Segundo Aliento"), igual que los desafíos.

---

## Riesgo honesto

El riesgo real de este sistema no es técnico, es de **balance**: en cuanto
los personajes dejan de ser solo cosméticos, aparece "el personaje roto".
Mi recomendación es implementarlo en dos tandas:

1. **Primero los stats** (multiplicadores suaves, ±20% máximo respecto al
   valor base). Se siente la diferencia, nadie es injugable.
2. **Después las habilidades**, de a una, midiendo con `__sim` bot-vs-bot
   si alguna dispara la tasa de gol.

Si en el paso 1 el rango de ±20% se siente poco, se sube; es mucho más fácil
subir que arreglar un personaje roto que ya le gustó a la gente.
