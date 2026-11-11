// L'avvio: chiave, foto cifrate, musica, e la scelta tra il viaggio 3D e la
// versione semplice (movimento ridotto, oppure WebGL assente).
import { CHAPTERS, FINALE_SONG, SONG, WALL_API } from "./chapters.js";
import { createBooth } from "./booth.js";
import { createMusic } from "./music.js";
import { createRoam } from "./roam.js";
import { createWall } from "./wall.js";

/* Quanto si aspetta Spotify prima di partire senza. */
const MUSIC_WAIT_MS = 3000;
/* Quanto si resta in un capitolo prima di cambiare canzone: chi fa avanti e
   indietro sul confine non sente dieci attacchi. */
const SONG_SETTLE_MS = 700;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const start = document.getElementById("start");
const sound = document.getElementById("sound");
const hud = document.getElementById("hud");
const hudBus = document.getElementById("hudBus");
const hint = document.getElementById("hint");
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxClose = document.getElementById("lightboxClose");

/* ---------- Musica ---------- */
const music = createMusic({
  container: document.getElementById("spotify"),
  song: SONG,
  onChange({ playing, everStarted }) {
    if (!everStarted) return;
    document.documentElement.classList.remove("needs-player");
    sound.hidden = false;
    sound.classList.toggle("is-paused", !playing);
    sound.setAttribute("aria-label", playing ? "Metti in pausa la musica" : "Fai ripartire la musica");
  },
});

sound.addEventListener("click", () => music.toggle());

/* I browser fanno partire l'audio solo dentro un gesto: va bene il primo. */
for (const type of ["pointerup", "keydown"]) {
  window.addEventListener(type, () => music.unlock(), { once: true });
}

/* ---------- Foto cifrate ----------
   Online ci sono solo photos/N.bin (generati da build.js). La chiave arriva
   dal QR dopo il "#" e non lascia mai il browser. */
const KEY_STORE = "laurea-key";

/* Prende la chiave dal frammento e la toglie dalla barra degli indirizzi,
   così chi condivide il link non condivide la chiave. La copia in
   sessionStorage fa sopravvivere un ricaricamento della scheda. */
function takeKey() {
  const fromHash = window.LaureaCrypto.fromB64url(location.hash.slice(1));
  if (fromHash) {
    try {
      sessionStorage.setItem(KEY_STORE, location.hash.slice(1));
    } catch {}
    history.replaceState(null, "", location.pathname + location.search);
    return fromHash;
  }
  try {
    return window.LaureaCrypto.fromB64url(sessionStorage.getItem(KEY_STORE) || "");
  } catch {
    return null;
  }
}

async function decryptPhoto(key, n) {
  try {
    const res = await fetch(`photos/${n}.bin`);
    if (!res.ok) return null;
    const plain = await window.LaureaCrypto.open(key, new Uint8Array(await res.arrayBuffer()));
    if (!plain) return null;
    const img = new Image();
    img.alt = `Foto ${n}`;
    img.src = URL.createObjectURL(new Blob([plain], { type: "image/jpeg" }));
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/* Ogni foto va nel capitolo del suo numero; quelle fuori da ogni intervallo
   finiscono nell'ultimo, così una foto nuova non sparisce mai. */
function arrangeChapters(numbers) {
  const chapters = CHAPTERS.map((c) => ({ ...c, photos: [] }));
  for (const n of [...numbers].sort((a, b) => a - b)) {
    const home = chapters.find((c) => n >= c.from && n <= c.to) ?? chapters[chapters.length - 1];
    home.photos.push(n);
  }
  return chapters.filter((c) => c.photos.length);
}

async function loadPhotos(key, numbers, onPhoto) {
  /* Poche alla volta: 29 decodifiche insieme bloccano un telefono. */
  const queue = [...numbers];
  let found = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const n = queue.shift();
        const img = await decryptPhoto(key, n);
        if (img) {
          found += 1;
          onPhoto(n, img);
        }
      }
    })
  );
  return found;
}

/* ---------- Lightbox ---------- */
let lastFocused = null;

function openLightbox(src, alt, trigger) {
  lastFocused = trigger;
  lightboxImg.src = src;
  lightboxImg.alt = `${alt}, ingrandita`;
  lightbox.classList.add("is-open");
  lightbox.setAttribute("aria-hidden", "false");
  lightboxClose.focus();
}

function closeLightbox() {
  lightbox.classList.remove("is-open");
  lightbox.setAttribute("aria-hidden", "true");
  lastFocused?.focus();
}

lightboxClose.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});
window.addEventListener("keydown", (e) => {
  if (!lightbox.classList.contains("is-open")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "Tab") {
    e.preventDefault();
    lightboxClose.focus();
  }
});

/* ---------- Versione semplice ---------- */
function buildSimple(chapters, key) {
  document.documentElement.classList.add("is-simple");
  const list = document.getElementById("simple");
  list.hidden = false;
  chapters.forEach((c) => {
    const section = document.createElement("section");
    section.className = "simple__chapter";
    list.appendChild(section);
    c.photos.forEach((n) => {
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "simple__print";
      slot.dataset.n = n;
      slot.hidden = true;
      section.appendChild(slot);
    });
  });

  loadPhotos(key, chapters.flatMap((c) => c.photos), (n, img) => {
    const slot = list.querySelector(`[data-n="${n}"]`);
    slot.setAttribute("aria-label", `Apri a schermo intero: ${img.alt}`);
    slot.appendChild(img);
    slot.hidden = false;
    slot.addEventListener("click", () => openLightbox(img.src, img.alt, slot));
  });
}

/* ---------- Una canzone per capitolo ----------
   createJourney scrive su ogni capitolo dove comincia (u0) e finisce (u1).
   Dove un capitolo non ne ha una suona SONG; dal GRAZIE in poi FINALE_SONG. */
function createSongSwitch(route) {
  let wanted = SONG;
  let timer = 0;
  return {
    at(u) {
      /* Prima della partenza suona già la canzone del primo capitolo. */
      const here = u < route[0].u0 ? route[0] : route.find((c) => u >= c.u0 && u < c.u1);
      const song = here ? here.song ?? SONG : FINALE_SONG;
      if (song === wanted) return;
      wanted = song;
      clearTimeout(timer);
      timer = setTimeout(() => music.setSong(wanted), SONG_SETTLE_MS);
    },
  };
}

/* ---------- Il viaggio ---------- */
async function buildJourney(chapters, key, rawKey, numbers) {
  const { createJourney } = await import("./journey.js");
  let focused = null;
  let booth = null;
  let roam = null;

  /* Senza chiave si vede il pulmino e si sente la musica, nient'altro. */
  const route = chapters.length ? chapters : CHAPTERS.map((c) => ({ ...c, photos: [] }));
  const songs = createSongSwitch(route);

  const journey = createJourney({
    canvas: document.getElementById("stage"),
    chapters: route,
    onReady() {
      document.documentElement.classList.add("is-ready");
    },
    onFocusPrint(print) {
      focused = print;
      document.documentElement.classList.toggle("has-focus", !!print);
    },
    /* La guida libera si apre solo qui: finito il viaggio, vista la scritta. */
    onThanks(done) {
      roam?.setAvailable(done);
    },
    /* Un tocco è un passo: per ingrandire la foto la si tiene premuta. */
    onHold() {
      if (focused?.src) openLightbox(focused.src, focused.alt, document.getElementById("stage"));
    },
    onProgress(fraction, u) {
      hud.style.setProperty("--progress", fraction.toFixed(4));
      hudBus.style.transform = `translateX(calc(${(fraction * 100).toFixed(2)}cqw - 50%))`;
      start.hidden = u > 0.7;
      document.documentElement.classList.toggle("has-left", u > 0.25);
      const arrived = fraction > 0.985;
      document.documentElement.classList.toggle("has-arrived", arrived);
      booth?.setArrived(arrived);
      songs.at(u);
    },
  });

  roam = createRoam({ journey });

  /* Il primo gesto fa partire la canzone; il pulmino aspetta di sentirla. */
  const go = () =>
    music.whenPlaying(MUSIC_WAIT_MS).then(() => {
      journey.release();
      /* Se il telefono blocca il player nascosto, lo si mostra: un tocco dentro
         il player di Spotify vale sempre. */
      if (!music.heard) document.documentElement.classList.add("needs-player");
    });
  for (const type of ["pointerup", "keydown"]) window.addEventListener(type, go, { once: true });

  start.addEventListener("click", () => {
    music.unlock();
    journey.kick();
    journey.advance();
  });

  if (!key) return;
  const wall = WALL_API ? await createWall({ api: WALL_API, rawKey, key, onGuest: (img) => journey.addGuest(img) }) : null;
  booth = createBooth({ onPhoto: (image, options) => journey.setSelfie(image, options), wall });
  /* Le foto nuove arrivano da sole a chi è già al traguardo. */
  if (wall) {
    const poll = () => wall.refresh().then(() => booth.refresh());
    poll();
    setInterval(() => {
      if (document.documentElement.classList.contains("has-arrived") && !document.hidden) poll();
    }, 20000);
  }
  const found = await loadPhotos(key, numbers, (n, img) => {
    journey.addPhoto(n, img);
    if (!journey.unlocked) {
      journey.unlock();
      start.setAttribute("aria-label", "Play: fa partire la musica e parti");
      hud.hidden = false;
      hint.hidden = false;
    }
  });
  if (!found) console.warn("Nessuna foto decifrata.");
}

function webglWorks() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

(async () => {
  const raw = takeKey();
  let key = null;
  let numbers = [];
  if (raw) {
    try {
      key = await window.LaureaCrypto.importKey(raw);
      numbers = (await (await fetch("photos/manifest.json")).json()).photos;
    } catch {
      key = null;
    }
  }
  const chapters = key ? arrangeChapters(numbers) : [];

  if (reduceMotion || !webglWorks()) {
    if (key) buildSimple(chapters, key);
    else document.documentElement.classList.add("is-simple");
    return;
  }

  try {
    await buildJourney(chapters, key, raw, numbers);
  } catch (e) {
    console.error(e);
    document.documentElement.classList.remove("is-ready");
    if (key) buildSimple(chapters, key);
    else document.documentElement.classList.add("is-simple");
  }
})();
