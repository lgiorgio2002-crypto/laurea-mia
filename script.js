import { animate, inView, scroll, stagger } from "https://cdn.jsdelivr.net/npm/motion@11/+esm";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Le foto online sono cifrate (photos/N.bin, generati da build.js). La chiave
   arriva dal QR, dopo il "#", e non lascia mai il browser. Senza chiave la
   pagina funziona lo stesso, solo senza foto. */
const KEY_STORE = "laurea-key";

/* Decelerazione lunga, nessun rimbalzo: il registro è quello. */
const EASE_OUT = [0.28, 0, 0.16, 1];
const EASE_IN = [0.32, 0, 0.9, 1];

const MASK_HIDDEN = "inset(100% 0 0 0)";
const MASK_SHOWN = "inset(0% 0 0 0)";

function heroArrival() {
  if (reduceMotion) return;

  const lines = document.querySelectorAll(".hero .reveal-line");
  const rest = document.querySelectorAll(".hero .subhead, .hero .body, .hero .cta-row");

  lines.forEach((el) => {
    el.style.opacity = 0;
  });
  rest.forEach((el) => {
    el.style.opacity = 0;
  });

  animate(
    lines,
    { opacity: [0, 1], transform: ["scale(1.06) translateY(16px)", "scale(1) translateY(0px)"] },
    { delay: stagger(0.12), duration: 0.85, easing: EASE_OUT }
  );

  animate(
    rest,
    { opacity: [0, 1], transform: ["translateY(18px)", "translateY(0px)"] },
    { delay: stagger(0.09, { start: 0.42 }), duration: 0.7, easing: EASE_OUT }
  );
}

/* Titolo che sale da sotto una maschera, poi il testo di supporto.
   Il ritmo è sempre lo stesso, come nei riquadri di un keynote. */
function revealTiles() {
  if (reduceMotion) return;

  const heads = document.querySelectorAll(".outro .tile__head");

  heads.forEach((head) => {
    const headline = head.querySelector(".headline");
    const support = head.querySelectorAll(".subhead, .body, .sign");

    headline.style.clipPath = MASK_HIDDEN;
    headline.style.opacity = 0;
    support.forEach((el) => {
      el.style.opacity = 0;
    });

    inView(
      head,
      () => {
        animate(
          headline,
          {
            clipPath: [MASK_HIDDEN, MASK_SHOWN],
            opacity: [0, 1],
            transform: ["translateY(22px)", "translateY(0px)"],
          },
          { duration: 0.9, easing: EASE_OUT }
        );

        animate(
          support,
          { opacity: [0, 1], transform: ["translateY(16px)", "translateY(0px)"] },
          { delay: stagger(0.08, { start: 0.22 }), duration: 0.7, easing: EASE_OUT }
        );
      },
      { amount: 0.3 }
    );
  });
}

/* Il player entra come un oggetto appoggiato sul riquadro chiaro. */
function revealEmbed() {
  if (reduceMotion) return;

  const embed = document.querySelector(".embed");
  embed.style.opacity = 0;

  inView(
    embed,
    () => {
      animate(
        embed,
        { opacity: [0, 1], transform: ["translateY(28px) scale(0.98)", "translateY(0px) scale(1)"] },
        { duration: 0.85, easing: EASE_OUT }
      );
    },
    { amount: 0.25 }
  );
}

/* Prende la chiave dal frammento dell'URL e la toglie dalla barra degli
   indirizzi, così chi condivide il link non condivide la chiave. La copia in
   sessionStorage fa sopravvivere un ricaricamento della scheda. Un frammento
   che non è una chiave (per esempio "#foto" lasciato dal pulsante Play) non
   viene toccato. */
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

/* Il riquadro foto parte nascosto e compare alla prima foto decifrata: senza
   chiave, o con una chiave sbagliata, nessuno vede un riquadro vuoto. */
function revealPhotoSection() {
  const section = document.getElementById("foto");
  if (!section.hidden) return;
  section.hidden = false;
  const play = document.querySelector(".pill--fill");
  play.setAttribute("href", "#foto");
  play.setAttribute("aria-label", "Play: fa partire la canzone e ti porta alle foto");
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
  const heroShot = document.getElementById("heroShot");

  numbers.forEach((n, i) => {
    const img = new Image();
    img.alt = `Foto ${n}`;
    img.decoding = "async";

    /* Le stampe entrano nella striscia subito, nell'ordine dei numeri, e si
       riempiono quando la foto è decifrata. Aspettando, l'ordine sarebbe
       quello in cui la rete consegna i file. */
    const shot = i === 0 ? null : addShot(strip, img);

    decryptPhoto(key, n).then((url) => {
      if (!url) {
        if (shot) shot.remove();
        return;
      }
      if (shot) {
        revealPhotoSection();
      } else {
        img.onload = () => mountHeroShot(heroShot, img, url);
      }
      img.src = url;
    });
  });
}

function mountHeroShot(container, img, src) {
  const button = document.createElement("button");
  button.className = "shot-open";
  button.type = "button";
  button.setAttribute("aria-label", `Apri a schermo intero: ${img.alt}`);
  button.appendChild(img);
  container.appendChild(button);
  container.hidden = false;

  button.addEventListener("click", () => openLightbox(src, button));

  if (reduceMotion) return;

  /* L'opacità sta sul contenitore, la trasformazione sull'elemento interno:
     così l'entrata e il movimento legato allo scroll non si contendono la
     stessa proprietà. */
  container.style.opacity = 0;
  animate(container, { opacity: [0, 1] }, { delay: 0.7, duration: 0.9, easing: EASE_OUT });

  heroScrub(button);
}

/* La firma di Apple: lo scatto non "entra", si muove insieme allo scroll.
   Parte leggermente più grande e sale più lentamente della pagina. */
function heroScrub(target) {
  scroll(
    (progress) => {
      const scale = 1.06 - 0.06 * Math.min(progress * 1.8, 1);
      const shift = -34 * progress;
      target.style.transform = `translate3d(0, ${shift}px, 0) scale(${scale})`;
    },
    { target, offset: ["start end", "end start"] }
  );
}

function addShot(strip, img) {
  const shot = document.createElement("button");
  shot.className = "shot";
  shot.type = "button";
  shot.setAttribute("aria-label", `Apri a schermo intero: ${img.alt}`);
  shot.appendChild(img);
  strip.appendChild(shot);

  /* La foto viene decifrata dopo: si legge img.src al momento del tocco. */
  shot.addEventListener("click", () => {
    if (img.src) openLightbox(img.src, shot);
  });

  if (reduceMotion) return shot;

  shot.style.opacity = 0;

  inView(
    shot,
    () => {
      const index = Array.prototype.indexOf.call(strip.children, shot);
      animate(
        shot,
        { opacity: [0, 1], transform: ["translateY(20px)", "translateY(0px)"] },
        { delay: Math.min(index, 3) * 0.08, duration: 0.7, easing: EASE_OUT }
      );
    },
    { amount: 0.2 }
  );

  return shot;
}

/* Lightbox con zoom dal punto di partenza: la foto si espande dalla
   miniatura che hai toccato e ci ritorna, come in Foto su iOS. */
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

  const scale = from.width / to.width;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);

  return `translate(${dx}px, ${dy}px) scale(${scale})`;
}

function openLightbox(src, trigger) {
  lastFocused = trigger;
  closing = false;
  lightboxImg.src = src;
  lightbox.classList.add("is-open");
  lightbox.setAttribute("aria-hidden", "false");
  lightboxImg.alt = `${trigger.querySelector("img")?.alt ?? "Foto"}, ingrandita`;
  lightboxClose.focus();

  if (reduceMotion) return;

  requestAnimationFrame(() => {
    const start = flipFrom(trigger);
    animate(
      lightbox,
      { opacity: [0, 1] },
      { duration: 0.28, easing: EASE_OUT }
    );
    animate(
      lightboxImg,
      start
        ? { transform: [start, "translate(0px, 0px) scale(1)"] }
        : { opacity: [0, 1], transform: ["scale(0.94)", "scale(1)"] },
      { duration: 0.55, easing: EASE_OUT }
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

  animate(lightbox, { opacity: [1, 0] }, { duration: 0.34, easing: EASE_IN });

  animate(
    lightboxImg,
    end
      ? { transform: ["translate(0px, 0px) scale(1)", end] }
      : { opacity: [1, 0], transform: ["scale(1)", "scale(0.97)"] },
    { duration: 0.34, easing: EASE_IN }
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

/* "Play" fa partire il brano mentre il link porta alle foto: la canzone fa
   da colonna sonora mentre le sfogli. L'iframe resta quello originale:
   lo si comanda dall'esterno con i messaggi che il player Spotify accetta.
   Il clic è un gesto dell'utente, quindi il browser concede l'audio. */
const SPOTIFY_ORIGIN = "https://open.spotify.com";
const player = document.querySelector('iframe[data-testid="embed-iframe"]');

/* Stato del player, letto dai messaggi che manda lui stesso.
   heardAt: ultimo messaggio ricevuto, per capire se un comando è arrivato. */
const song = { playing: false, starting: false, heardAt: 0 };

window.addEventListener("message", (e) => {
  if (e.origin !== SPOTIFY_ORIGIN || !e.data) return;
  const { type, payload } = e.data;
  if (type !== "playback_started" && type !== "playback_update") return;

  song.heardAt = performance.now();
  if (type === "playback_started") song.playing = true;
  if (type === "playback_update") {
    song.playing = !payload.isPaused && payload.position < payload.duration;
  }
});

function sendToPlayer(command) {
  player.contentWindow?.postMessage({ command }, SPOTIFY_ORIGIN);
}

/* Quando il brano non suona, "toggle" equivale a play in ogni caso: player
   mai usato, in pausa, o con l'anteprima finita (lì Spotify scarica il brano
   e "resume" verrebbe rifiutato). Siccome però su un brano che suona
   "toggle" mette in pausa, si riprova solo se il player non ha risposto per
   nulla (iframe in lazy loading non ancora pronto) e si ignorano i clic
   mentre un avvio è in corso: un doppio tocco non lo spegne. */
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

document.querySelector(".pill--fill").addEventListener("click", playSong);

heroArrival();
revealTiles();
revealEmbed();
buildGallery();
