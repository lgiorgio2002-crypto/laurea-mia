import { animate, inView, scroll } from "https://cdn.jsdelivr.net/npm/motion@11/+esm";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const canHover = window.matchMedia("(hover: hover)").matches;

/* La pagina comincia sempre dal pulmino parcheggiato, anche ricaricando. */
history.scrollRestoration = "manual";

const EASE_OUT = [0.22, 1, 0.36, 1];
/* Partenza: lenta allo stacco, poi via, come un motore che prende giri. */
const EASE_DEPART = [0.55, 0, 0.85, 0.35];

/* Inclinazioni fisse: stampe appoggiate a mano, non ruotate a caso. */
const TILTS = [-1.6, 1.1, -0.7, 1.5, -1.2, 0.8, -1.4, 1.3, -0.9, 1.6, -1.1, 0.7];

const scene = document.getElementById("scene");
const bus = document.getElementById("bus");
const busBody = bus.querySelector(".bus__body");
const busBadge = bus.querySelector(".bus__badge");
const busWheels = bus.querySelectorAll(".wheel");
const trip = document.getElementById("foto");

/* ---------- Canzone ----------
   Il player Spotify è nascosto: lo si comanda dall'esterno con i messaggi
   che accetta. "toggle" avvia un player fermo (anche ad anteprima finita,
   dove "resume" viene rifiutato) ma mette in pausa uno che suona: per questo
   si riprova solo se il player non ha risposto e si ignorano i tocchi
   mentre un avvio è in corso. */
const SPOTIFY_ORIGIN = "https://open.spotify.com";
const player = document.querySelector(".player iframe");
const sound = document.getElementById("sound");
const song = { playing: false, starting: false, heardAt: 0, everStarted: false };

function updateSoundButton() {
  if (!song.everStarted) return;
  sound.hidden = false;
  sound.classList.toggle("is-paused", !song.playing);
  sound.setAttribute("aria-label", song.playing ? "Metti in pausa la canzone" : "Fai ripartire la canzone");
}

window.addEventListener("message", (e) => {
  if (e.origin !== SPOTIFY_ORIGIN || !e.data) return;
  const { type, payload } = e.data;
  if (type !== "playback_started" && type !== "playback_update") return;

  song.heardAt = performance.now();
  if (type === "playback_started") {
    song.playing = true;
    song.everStarted = true;
  }
  if (type === "playback_update") {
    song.playing = !payload.isPaused && payload.position < payload.duration;
  }
  updateSoundButton();
});

function sendToPlayer(command) {
  player.contentWindow?.postMessage({ command }, SPOTIFY_ORIGIN);
}

function playSong() {
  if (song.playing || song.starting) return;
  song.starting = true;

  let attempts = 0;
  const tryStart = () => {
    attempts += 1;
    const sentAt = performance.now();
    sendToPlayer("toggle");
    setTimeout(() => {
      if (song.heardAt < sentAt && attempts < 7) tryStart();
      else song.starting = false;
    }, 1200);
  };
  tryStart();
}

sound.addEventListener("click", () => {
  if (song.playing) sendToPlayer("pause");
  else playSong();
});

/* ---------- Il pulmino ---------- */
let idleLoop = null;
let badgeLoop = null;
let busBusy = false;

/* Al minimo il motore fa tremare la carrozzeria, le ruote restano ferme.
   Il bollino play respira ogni tanto: è l'unico invito a toccare. */
function idle() {
  if (reduceMotion) return;
  idleLoop = animate(busBody, { y: [0, -2.2, 0] }, { duration: 0.42, repeat: Infinity, easing: "ease-in-out" });
  badgeLoop = animate(
    busBadge,
    { scale: [1, 1.14, 1] },
    { duration: 0.7, repeat: Infinity, repeatDelay: 1.8, easing: "ease-in-out" }
  );
}

function stopIdle() {
  idleLoop?.stop();
  badgeLoop?.stop();
  animate(busBody, { y: 0 }, { duration: 0.1 });
  animate(busBadge, { scale: 1 }, { duration: 0.1 });
}

function spin(wheels, secondsPerTurn) {
  return animate(wheels, { rotate: [0, 360] }, { duration: secondsPerTurn, repeat: Infinity, easing: "linear" });
}

function puffs() {
  const box = bus.getBoundingClientRect();
  const origin = scene.getBoundingClientRect();
  for (let i = 0; i < 3; i++) {
    const puff = document.createElement("span");
    puff.className = "puff";
    puff.style.left = `${box.left - origin.left + box.width * 0.02}px`;
    puff.style.top = `${box.top - origin.top + box.height * 0.7}px`;
    scene.appendChild(puff);
    animate(
      puff,
      { opacity: [0.95, 0], scale: [0.35, 1.7], x: [0, -46 - i * 22], y: [0, -16 - i * 10] },
      { duration: 0.9, delay: i * 0.12, easing: EASE_OUT }
    ).finished.then(() => puff.remove());
  }
}

/* Tocco: parte la canzone, il pulmino si carica all'indietro e parte.
   Poi rientra da sinistra e si riparcheggia, così l'apertura non resta vuota. */
async function drive() {
  playSong();
  if (busBusy) return;
  busBusy = true;

  const goToPhotos = !trip.hidden;

  if (reduceMotion) {
    if (goToPhotos) trip.scrollIntoView();
    busBusy = false;
    return;
  }

  stopIdle();
  await animate(bus, { x: -16, rotate: -1.2 }, { duration: 0.2, easing: EASE_OUT }).finished;

  const wheels = spin(busWheels, 0.32);
  puffs();
  const distance = window.innerWidth + bus.offsetWidth;
  await animate(bus, { x: distance, rotate: 0 }, { duration: 1.15, easing: EASE_DEPART }).finished;

  if (goToPhotos) trip.scrollIntoView({ behavior: "smooth" });

  await animate(bus, { x: [-distance, 0] }, { duration: 1.5, delay: 0.5, easing: EASE_OUT }).finished;
  wheels.stop();
  idle();
  busBusy = false;
}

bus.addEventListener("click", drive);

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
    return plain ? URL.createObjectURL(new Blob([plain], { type: "image/jpeg" })) : null;
  } catch {
    return null;
  }
}

/* Il viaggio parte nascosto e compare alla prima foto decifrata: senza
   chiave, o con una chiave sbagliata, resta solo il pulmino con la musica. */
function revealTrip() {
  if (!trip.hidden) return;
  trip.hidden = false;
  bus.setAttribute("aria-label", "Play: fa partire la canzone e ti porta alle foto");
  initRoute();
}

async function buildGallery() {
  const raw = takeKey();
  if (!raw) return;

  let key;
  let numbers;
  try {
    key = await window.LaureaCrypto.importKey(raw);
    numbers = (await (await fetch("photos/manifest.json")).json()).photos;
  } catch {
    return;
  }

  const strip = document.getElementById("strip");

  numbers.forEach((n, i) => {
    const img = new Image();
    img.alt = `Foto ${n}`;
    img.decoding = "async";

    /* Le stampe entrano subito nell'ordine dei numeri e si riempiono quando
       la foto è decifrata: aspettando, l'ordine sarebbe quello della rete. */
    const shot = addShot(strip, img, TILTS[i % TILTS.length]);

    decryptPhoto(key, n).then((url) => {
      if (!url) {
        shot.remove();
        return;
      }
      img.src = url;
      revealTrip();
    });
  });
}

function addShot(strip, img, tilt) {
  const shot = document.createElement("button");
  shot.className = "shot";
  shot.type = "button";
  shot.setAttribute("aria-label", `Apri a schermo intero: ${img.alt}`);
  shot.style.transform = `rotate(${tilt}deg)`;
  shot.appendChild(img);
  strip.appendChild(shot);

  shot.addEventListener("click", () => {
    if (img.src) openLightbox(img.src, shot);
  });

  if (reduceMotion) return shot;

  shot.style.opacity = 0;
  inView(
    shot,
    () => {
      animate(
        shot,
        {
          opacity: [0, 1],
          transform: [`rotate(${tilt * 2.4}deg) translateY(18px) scale(0.94)`, `rotate(${tilt}deg) translateY(0px) scale(1)`],
        },
        { duration: 0.7, easing: EASE_OUT }
      );
    },
    { root: strip, amount: 0.3 }
  );

  if (canHover) {
    shot.addEventListener("pointerenter", () => {
      animate(shot, { transform: `rotate(${tilt * 0.25}deg) translateY(-6px) scale(1.04)` }, { type: "spring", stiffness: 260, damping: 20 });
    });
    shot.addEventListener("pointerleave", () => {
      animate(shot, { transform: `rotate(${tilt}deg) translateY(0px) scale(1)` }, { type: "spring", stiffness: 260, damping: 22 });
    });
  }

  return shot;
}

/* ---------- La strada sotto le foto ----------
   Un pulmino piccolo avanza mentre scorri le foto. È legato al gesto, non
   è un'animazione autonoma, quindi resta anche con il movimento ridotto. */
let celebrated = false;

function initRoute() {
  const strip = document.getElementById("strip");
  const route = document.getElementById("route");
  const slot = document.getElementById("miniBus");

  const art = bus.querySelector(".bus__art").cloneNode(true);
  art.querySelector("clipPath").id = "busShapeMini";
  art.querySelector("[clip-path]").setAttribute("clip-path", "url(#busShapeMini)");
  slot.appendChild(art);
  const wheels = art.querySelectorAll(".wheel");

  scroll(
    (progress) => {
      const travel = route.clientWidth - slot.offsetWidth - 38;
      slot.style.transform = `translateX(${progress * travel}px)`;
      wheels.forEach((w) => {
        w.style.transform = `rotate(${progress * 1440}deg)`;
      });
      if (progress > 0.97 && !celebrated) {
        celebrated = true;
        celebrate();
      }
    },
    { container: strip, axis: "x" }
  );
}

/* Arrivo al traguardo: coriandoli, una volta sola. */
function celebrate() {
  if (reduceMotion) return;
  const flag = document.querySelector(".route__flag").getBoundingClientRect();
  const origin = trip.getBoundingClientRect();
  const colors = ["#e4572e", "#fff8e1", "#2b2622", "#bfe3f2", "#f7c51e"];

  for (let i = 0; i < 30; i++) {
    const bit = document.createElement("span");
    bit.className = "confetti";
    bit.style.background = colors[i % colors.length];
    bit.style.left = `${flag.left - origin.left + flag.width / 2}px`;
    bit.style.top = `${flag.top - origin.top}px`;
    trip.appendChild(bit);

    const spreadX = (Math.random() - 0.65) * 320;
    const rise = 110 + Math.random() * 120;
    animate(
      bit,
      {
        x: [0, spreadX * 0.6, spreadX],
        y: [0, -rise, -rise + 190],
        rotate: [0, (Math.random() - 0.5) * 720],
        opacity: [1, 1, 0],
      },
      { duration: 1.5 + Math.random() * 0.6, easing: "ease-out" }
    ).finished.then(() => bit.remove());
  }
}

/* ---------- Lightbox ----------
   La foto si espande dalla stampa toccata e ci ritorna. */
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxClose = document.getElementById("lightboxClose");
let lastFocused = null;
let closing = false;

function flipFrom(sourceEl) {
  const sourceImg = sourceEl.querySelector("img");
  if (!sourceImg) return null;
  const from = sourceImg.getBoundingClientRect();
  const to = lightboxImg.getBoundingClientRect();
  if (!to.width || !to.height || !from.width) return null;
  const s = from.width / to.width;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${s})`;
}

function openLightbox(src, trigger) {
  lastFocused = trigger;
  closing = false;
  lightboxImg.src = src;
  lightboxImg.alt = `${trigger.querySelector("img")?.alt ?? "Foto"}, ingrandita`;
  lightbox.classList.add("is-open");
  lightbox.setAttribute("aria-hidden", "false");
  lightboxClose.focus();

  if (reduceMotion) return;

  requestAnimationFrame(() => {
    const start = flipFrom(trigger);
    animate(lightbox, { opacity: [0, 1] }, { duration: 0.28, easing: EASE_OUT });
    animate(
      lightboxImg,
      start ? { transform: [start, "translate(0px, 0px) scale(1)"] } : { opacity: [0, 1], transform: ["scale(0.94)", "scale(1)"] },
      { duration: 0.5, easing: EASE_OUT }
    );
  });
}

function dismiss() {
  lightbox.classList.remove("is-open");
  lightbox.setAttribute("aria-hidden", "true");
  lightbox.style.opacity = "";
  lightboxImg.style.opacity = "";
  lightboxImg.style.transform = "";
  closing = false;
  if (lastFocused) lastFocused.focus();
}

function closeLightbox() {
  if (closing) return;
  if (reduceMotion) {
    dismiss();
    return;
  }
  closing = true;
  const end = lastFocused ? flipFrom(lastFocused) : null;
  animate(lightbox, { opacity: [1, 0] }, { duration: 0.32, easing: "ease-in" });
  animate(
    lightboxImg,
    end ? { transform: ["translate(0px, 0px) scale(1)", end] } : { opacity: [1, 0], transform: ["scale(1)", "scale(0.97)"] },
    { duration: 0.32, easing: "ease-in" }
  ).finished.then(dismiss);
}

lightboxClose.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});

window.addEventListener("keydown", (e) => {
  if (!lightbox.classList.contains("is-open")) return;
  if (e.key === "Escape") {
    closeLightbox();
    return;
  }
  /* La chiusura è l'unico comando del lightbox: il focus resta lì dentro. */
  if (e.key === "Tab") {
    e.preventDefault();
    lightboxClose.focus();
  }
});

idle();
buildGallery();
