// Il copione del viaggio. Tutto ciò che si cambia a mano sta qui.
//
// from, to: le foto del capitolo, per numero. L'ordine è quello dei numeri.
// stops:    le tappe. before è la foto davanti a cui il pulmino rallenta e la
//           camera mostra il luogo (nome in landmarks.js). sky è il momento
//           della giornata che comincia lì (PALETTES).
// scenery:  il paesaggio lungo la strada, tra una tappa e l'altra.
// grade:    la pellicola delle foto: 0 colore pieno, 1 stampa antica.
// neon:     quanto le foto risentono delle luci della notte.

// Una canzone per tutto il viaggio. start ed end sono in secondi; end: null =
// fino alla fine. Chi non è collegato a Spotify sente l'anteprima di 30 secondi
// scelta da Spotify, e start/end per lui non valgono.
export const SONG = { uri: "spotify:track:7wFEzF8FbofVlQS1OcbghM", start: 0, end: null };

// Il muro condiviso: l'indirizzo del Worker (cartella worker/). Vuoto = ogni
// foto resta solo sul telefono di chi l'ha scattata.
export const WALL_API = "https://laurea-wall.laurea-mia.workers.dev";

// La scritta finale, fatta con le foto. Una riga per voce dell'elenco: su schermo
// largo e su schermo stretto le parole vanno a capo in modo diverso.
export const THANKS = {
  wide: ["GRAZIE", "DI ESSERCI"],
  narrow: ["GRAZIE", "DI", "ESSERCI"],
};

export const CHAPTERS = [
  {
    id: "casa",
    from: 1,
    to: 4,
    scenery: "romeStreet",
    particles: "dust",
    grade: 0.8,
    neon: 0,
    stops: [{ landmark: "homeStreet", before: 1, sky: "morning" }],
  },
  {
    id: "melfi",
    from: 5,
    to: 9,
    scenery: "melfi",
    particles: "pollen",
    grade: 0.2,
    neon: 0,
    stops: [{ landmark: "melfiStreet", before: 5, sky: "cloudy" }],
  },
  {
    id: "roma",
    from: 10,
    to: 23,
    scenery: "romeCity",
    particles: "laurel",
    grade: 0,
    neon: 0.25,
    stops: [
      { landmark: "luissVilla", before: 10, sky: "morning" },
      { landmark: "luissHouse", before: 12, sky: "noon" },
      { landmark: "aula", before: 14, sky: "afternoon" },
      { landmark: "tiber", before: 16, sky: "sunset", water: true },
      { landmark: "colosseum", before: 18, sky: "night" },
      { landmark: "pantheon", before: 20, sky: "morning" },
      { landmark: "tower", before: 23, sky: "afternoon" },
    ],
  },
  {
    id: "lisbona",
    from: 24,
    to: 99,
    scenery: "lisbon",
    particles: "spray",
    grade: 0,
    neon: 0,
    stops: [
      { landmark: "tram", before: 24, sky: "noon" },
      { landmark: "belem", before: 26, sky: "afternoon", water: true },
      { landmark: "comercio", before: 27, sky: "dusk" },
      { landmark: "nova", before: 29, sky: "morning", water: true, beach: true },
      { landmark: "carcavelos", before: 31, sky: "gold", water: true, beach: true },
      { landmark: "sunsetBeach", before: 32, sky: "sunset", water: true, beach: true },
    ],
  },
];

// Il cielo del finale, oltre il traguardo.
export const FINALE_SKY = "gold";

export const PALETTES = {
  cloudy: { top: "#8fa3b8", mid: "#c6cfd4", low: "#e6e6dc", ground: "#8f9a5c", road: "#5e5b58", sun: "#fff4dc", sunEl: 0.5, sunAz: 0.3, hemi: "#f2f2ee", hemiLow: "#a39c86", hemiI: 2.2, keyI: 0.8, stars: 0, lamps: 0 },
  dawn: { top: "#6d7fb8", mid: "#f4b8b0", low: "#ffd9b8", ground: "#c9b48c", road: "#574d50", sun: "#fff1cf", sunEl: 0.07, sunAz: 0.3, hemi: "#ffd9d0", hemiLow: "#a8859c", hemiI: 1.7, keyI: 0.9, stars: 0.25, lamps: 0 },
  sunrise: { top: "#79b4e2", mid: "#ffd9a0", low: "#ffe9b8", ground: "#c7c27a", road: "#5a5048", sun: "#fff4d0", sunEl: 0.16, sunAz: 0.25, hemi: "#fff0d0", hemiLow: "#c9a56e", hemiI: 2, keyI: 1.3, stars: 0, lamps: 0 },
  morning: { top: "#5fb3ea", mid: "#a9dcf2", low: "#e6f3e0", ground: "#a9c25a", road: "#4d4842", sun: "#fffbe6", sunEl: 0.42, sunAz: -0.2, hemi: "#ffffff", hemiLow: "#d8c98a", hemiI: 2.1, keyI: 1.5, stars: 0, lamps: 0 },
  afternoon: { top: "#4f9fe0", mid: "#ffe2a0", low: "#ffefbd", ground: "#b4b552", road: "#4d4640", sun: "#fff0b8", sunEl: 0.26, sunAz: -0.5, hemi: "#fff3cf", hemiLow: "#c9a255", hemiI: 2.1, keyI: 1.6, stars: 0, lamps: 0 },
  dusk: { top: "#2c2a6b", mid: "#c9559b", low: "#ff9a6b", ground: "#4a3560", road: "#2d2738", sun: "#ffc27a", sunEl: 0.03, sunAz: 0.1, hemi: "#c98ac9", hemiLow: "#54306f", hemiI: 1.3, keyI: 0.7, stars: 0.35, lamps: 0.6 },
  night: { top: "#070a24", mid: "#141a4a", low: "#2a2467", ground: "#14143a", road: "#1d1c33", sun: "#eaeaff", sunEl: 0.5, sunAz: 0.3, hemi: "#6a78e0", hemiLow: "#2a1f5e", hemiI: 1.1, keyI: 0.35, stars: 1, lamps: 1 },
  noon: { top: "#2f8fe0", mid: "#8fd3f2", low: "#d9f1f2", ground: "#e4d29a", road: "#51504e", sun: "#ffffff", sunEl: 0.8, sunAz: 0.5, hemi: "#ffffff", hemiLow: "#e6d6a8", hemiI: 2.3, keyI: 1.6, stars: 0, lamps: 0 },
  sunset: { top: "#3b3a86", mid: "#ef6f6c", low: "#ffb26b", ground: "#7a4f52", road: "#3a2c36", sun: "#ffd28a", sunEl: 0.03, sunAz: 0.55, hemi: "#ffb48a", hemiLow: "#6a3a5e", hemiI: 1.5, keyI: 1, stars: 0.15, lamps: 0.3 },
  gold: { top: "#ffb627", mid: "#ffd43b", low: "#ffe98a", ground: "#e8b92c", road: "#3a342f", sun: "#fff8e1", sunEl: 0.3, sunAz: 0, hemi: "#fff3cf", hemiLow: "#e0a93c", hemiI: 2.3, keyI: 1.5, stars: 0, lamps: 0 },
};

// Quello che è nell'aria: size in unità mondo, fall verso il basso.
export const PARTICLES = {
  dust: { amount: 0.35, size: 0.1, a: "#fff6dc", b: "#ffd9b8", fall: 0.1, drift: 0.3, shape: 0 },
  pollen: { amount: 0.45, size: 0.09, a: "#fff8e1", b: "#ffe98a", fall: 0.15, drift: 0.5, shape: 0 },
  bokeh: { amount: 0.85, size: 0.55, a: "#ff4fa3", b: "#4fc3ff", fall: 0.02, drift: 0.12, shape: 0 },
  laurel: { amount: 0.7, size: 0.34, a: "#3f8a4a", b: "#c9a227", fall: 1, drift: 0.9, shape: 1 },
  spray: { amount: 0.3, size: 0.12, a: "#ffffff", b: "#bfe3f2", fall: 0.25, drift: 1.1, shape: 0 },
  confetti: { amount: 1, size: 0.3, a: "#e4572e", b: "#f7c51e", fall: 1.5, drift: 1.2, shape: 2 },
};
