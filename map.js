// La mappa: dove stanno davvero le cose. Una sola fonte per strada, acqua e
// cartina. Unità mondo, x verso est, z verso sud. Dentro ogni città direzioni e
// ordine sono quelli reali, le distanze sono compresse (non in modo uniforme a
// Lisbona, dove i luoghi sono a 20 km l'uno dall'altro). Le città stanno lontane
// tra loro: tra una e l'altra non c'è strada, il volo di foto copre il salto.

const ROMA = [0, 0];
const MELFI = [3000, 1400];
const LISBONA = [-6000, 0];

const at = ([ox, oz], x, z) => [ox + x, oz + z];

/* Il Tevere, punto per punto dai suoi ponti, misurato dal Pantheon a 130
   unità per km. */
const TIBER = [
  [-108, -640], [-108, -535], [-113, -417], [-90, -300], [-68, -189], [-36, -110], [-51, -65], [-115, -43],
  [-142, -32], [-143, 38], [-66, 89], [7, 116], [-30, 200], [-75, 291], [-110, 440], [-120, 640],
].map(([x, z]) => at(ROMA, x, z));
const TIBER_WIDTH = 46;

/* La riva nord del Tago e poi dell'oceano, da est a ovest. */
const COAST = [
  [1650, -700], [1500, -300], [1200, -60], [900, 88], [800, 88], [600, 88], [380, 92], [300, 92], [0, 112],
  [-200, 140], [-300, 150], [-430, 160], [-600, 183], [-690, 196], [-800, 216], [-1100, 216], [-1350, 100], [-1550, -300], [-1650, -700],
].map(([x, z]) => at(LISBONA, x, z));
/* Da qui a qui la riva è sabbia. Indici in COAST. */
const SAND = [13, 15];

export const CITIES = [
  { id: "lisbona", name: "Lisboa", box: [LISBONA[0] - 1650, LISBONA[1] - 700, LISBONA[0] + 1650, LISBONA[1] + 620], sea: true },
  { id: "roma", name: "Roma", box: [ROMA[0] - 660, ROMA[1] - 900, ROMA[0] + 760, ROMA[1] + 640], river: true },
  { id: "melfi", name: "Melfi", box: [MELFI[0] - 360, MELFI[1] - 300, MELFI[0] + 360, MELFI[1] + 300] },
];

/* Ogni capitolo del copione è un tratto di strada dentro una città.
   Tappa: landmark (nome in landmarks.js), place [x, z] centro del luogo, heading
   la direzione di marcia passandogli davanti (gradi: 0 nord, 90 est), side 1 a
   destra e -1 a sinistra. via: punti di passaggio tra una tappa e l'altra. */
export const ROUTE = {
  /* Via Eleonora d'Arborea, a 3,9 km dal Pantheon verso est-nord-est. */
  casa: {
    city: "roma",
    path: [
      { via: at(ROMA, 560, -520) },
      { via: at(ROMA, 548, -380) },
      { landmark: "homeStreet", name: "Casa", tag: [1, 1], place: at(ROMA, 511, -180), heading: 180, side: 1 },
      { via: at(ROMA, 530, -60) },
      { via: at(ROMA, 480, 60) },
      { via: at(ROMA, 420, 200) },
    ],
  },
  melfi: {
    city: "melfi",
    path: [
      { via: at(MELFI, -300, -40) },
      { via: at(MELFI, -180, -30) },
      { landmark: "melfiStreet", name: "Melfi", place: at(MELFI, -60, 2), heading: 90, side: 1 },
      { via: at(MELFI, 80, -16) },
      { via: at(MELFI, 200, 30) },
      { via: at(MELFI, 320, 90) },
    ],
  },
  /* Villa, corpo nuovo e Aula Chiesa stanno tutti nel campus di viale Romania. */
  roma: {
    city: "roma",
    path: [
      { via: at(ROMA, 640, -500) },
      { via: at(ROMA, 500, -470) },
      { landmark: "luissVilla", name: "LUISS, la villa", tag: [1, -1], place: at(ROMA, 330, -480), heading: 270, side: 1 },
      { via: at(ROMA, 240, -440) },
      { landmark: "luissGlass", name: "LUISS, il corpo nuovo", tag: [-1, -1], place: at(ROMA, 130, -412), heading: 270, side: -1 },
      { via: at(ROMA, 40, -450) },
      { via: at(ROMA, 70, -530) },
      { via: at(ROMA, 200, -520) },
      { via: at(ROMA, 268, -445) },
      { landmark: "aula", name: "Aula Chiesa", tag: [1, 1], place: at(ROMA, 268, -352), heading: 180, side: 0 },
      { via: at(ROMA, 262, -296) },
      { via: at(ROMA, 190, -290) },
      { via: at(ROMA, 40, -285) },
      { via: at(ROMA, 4, -210) },
      { via: at(ROMA, 6, -140) },
      /* Si arriva lungo il fiume e il ponte si vede d'infilata, come dalle foto. */
      { landmark: "tiber", name: "Ponte Sant'Angelo", tag: [-1, -1], place: at(ROMA, -82, -53), heading: 180, side: 1 },
      { via: at(ROMA, -14, 30) },
      { via: at(ROMA, 4, 74) },
      { landmark: "vittoriano", name: "Il Vittoriano", tag: [-1, 1], place: at(ROMA, 60, 138), heading: 90, side: 1 },
      { via: at(ROMA, 140, 60) },
      { via: at(ROMA, 200, 46) },
      { via: at(ROMA, 248, 56) },
      { landmark: "colosseum", name: "Il Colosseo", tag: [1, 1], place: at(ROMA, 185, 125), heading: 180, side: 1 },
      { via: at(ROMA, 262, 196) },
      { via: at(ROMA, 310, 180) },
      { via: at(ROMA, 322, 60) },
      { via: at(ROMA, 240, -24) },
      { via: at(ROMA, 140, -66) },
      /* Il Pantheon guarda a nord: lo si passa davanti andando verso ovest. */
      { landmark: "pantheon", name: "Il Pantheon", tag: [1, 1], place: at(ROMA, 60, -8), heading: 270, side: -1 },
      { via: at(ROMA, 2, -84) },
      { via: at(ROMA, 8, -102) },
      /* Torre della Scimmia, a nord del Pantheon verso Palazzo Chigi. */
      { landmark: "tower", name: "Torre della Scimmia", tag: [-1, -1], place: at(ROMA, 60, -130), heading: 90, side: -1 },
      { via: at(ROMA, 130, -124) },
      { landmark: "spagna", name: "Piazza di Spagna", tag: [1, -1], place: at(ROMA, 190, -201), heading: 90, side: -1 },
      { via: at(ROMA, 300, -150) },
      { via: at(ROMA, 380, -120) },
      { via: at(ROMA, 440, -104) },
    ],
  },
  lisbona: {
    city: "lisbona",
    path: [
      { via: at(LISBONA, 1060, -120) },
      { via: at(LISBONA, 860, -78) },
      { landmark: "tram", name: "Ascensor da Bica", tag: [1, -1], place: at(LISBONA, 690, -74), heading: 270, side: 1 },
      { via: at(LISBONA, 540, -30) },
      { via: at(LISBONA, 440, 30) },
      { landmark: "belem", name: "Torre de Belém", tag: [1, 1], place: at(LISBONA, 300, 128), heading: 270, side: -1 },
      { via: at(LISBONA, 170, 50) },
      { via: at(LISBONA, 300, 16) },
      { via: at(LISBONA, 620, 62) },
      { landmark: "comercio", name: "Comércio", tag: [1, 1], place: at(LISBONA, 800, -38), heading: 90, side: -1 },
      { via: at(LISBONA, 930, 40) },
      { via: at(LISBONA, 900, -40) },
      { via: at(LISBONA, 640, -6) },
      { via: at(LISBONA, 200, -20) },
      { via: at(LISBONA, -120, 90) },
      /* Il campus sta sopra il forte, la spiaggia comincia a ovest del forte. */
      { landmark: "nova", name: "Nova SBE", tag: [1, -1], place: at(LISBONA, -430, 70), heading: 270, side: 1 },
      { landmark: "carcavelos", name: "Forte de São Julião", tag: [-1, 1], place: at(LISBONA, -590, 196), heading: 270, side: -1 },
      /* Praia de Carcavelos, verso il ristorante Capricciosa. */
      { landmark: "sunsetBeach", name: "Praia de Carcavelos", tag: [1, 1], place: at(LISBONA, -800, 236), heading: 270, side: -1 },
      { via: at(LISBONA, -960, 160) },
      { via: at(LISBONA, -1100, 150) },
      { via: at(LISBONA, -1280, 90) },
    ],
  },
};

/* ---------- Acqua e terra ---------- */
function bandAround(line, width) {
  const left = [];
  const right = [];
  line.forEach(([x, z], i) => {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / l;
    const nz = (b[0] - a[0]) / l;
    left.push([x + nx * width * 0.5, z + nz * width * 0.5]);
    right.push([x - nx * width * 0.5, z - nz * width * 0.5]);
  });
  return [...left, ...right.reverse()];
}

const RIVER = bandAround(TIBER, TIBER_WIDTH);

function inside(poly, x, z) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

function coastZ(x) {
  for (let i = 0; i < COAST.length - 1; i++) {
    const [ax, az] = COAST[i];
    const [bx, bz] = COAST[i + 1];
    if (x <= ax && x >= bx) return az + ((bz - az) * (x - ax)) / (bx - ax);
  }
  return -Infinity;
}

export function cityAt(x, z) {
  return CITIES.find((c) => x >= c.box[0] && x <= c.box[2] && z >= c.box[1] && z <= c.box[3]) ?? null;
}

/* C'è terra sotto questo punto? margin allarga l'acqua. */
export function onLand(x, z, margin = 0) {
  const c = cityAt(x, z);
  if (!c) return false;
  if (c.river) return ![[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]].some(([a, b]) => inside(RIVER, x + a, z + b));
  if (c.sea) return z + margin < coastZ(x);
  return true;
}

/* La fascia tra la strada e il mare a Carcavelos: lì non si costruisce. */
export function onBeachFront(x, z) {
  return x > LISBONA[0] - 1100 && x < LISBONA[0] - 500 && z > LISBONA[1] + 20;
}

/* I contorni per disegnare: terra, acqua, rive. */
export function outlines() {
  const [lx0, lz0, lx1] = CITIES[0].box;
  return {
    /* La terra di Lisbona si chiude a nord, oltre il riquadro. */
    lisbonLand: [...COAST, [lx0 - 700, lz0 - 900], [lx1 + 700, lz0 - 900]],
    river: RIVER,
    coast: COAST,
    sand: COAST.slice(SAND[0], SAND[1] + 1),
    hard: [COAST.slice(0, SAND[0] + 1), COAST.slice(SAND[1])],
    tiber: TIBER,
  };
}

/* Le tappe, in ordine di viaggio. */
export const PLACES = Object.values(ROUTE).flatMap((r) => r.path.filter((p) => p.landmark).map((p) => ({ ...p, city: r.city })));
