import { animate, inView, stagger } from "https://cdn.jsdelivr.net/npm/motion@11/+esm";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Elenco dei file attesi in ./photos/. Rinomina le tue foto con questi nomi
   (o modifica questa lista) e mettile nella cartella photos/. Se un file non
   esiste, viene semplicemente saltato: puoi averne di meno o di più.
   La prima, photos/1.jpg, diventa lo scatto d'apertura. */
const PHOTO_MANIFEST = Array.from({ length: 12 }, (_, i) => `photos/${i + 1}.jpg`);

/* Decelerazione ampia e senza rimbalzo. */
const EASE_OUT = [0.28, 0, 0.16, 1];
const EASE_IN = [0.32, 0, 0.9, 1];

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

/* Ogni riquadro entra scorrendo: è la firma di questa impaginazione. */
function revealTiles() {
  if (reduceMotion) return;

  const groups = document.querySelectorAll(
    "#canzone .tile__head, #canzone .embed, #foto .tile__head, .outro .tile__head"
  );

  groups.forEach((el) => {
    el.style.opacity = 0;
  });

  inView(
    groups,
    (info) => {
      animate(
        info.target,
        { opacity: [0, 1], transform: ["translateY(24px)", "translateY(0px)"] },
        { duration: 0.75, easing: EASE_OUT }
      );
    },
    { amount: 0.3 }
  );
}

function buildGallery() {
  const strip = document.getElementById("strip");
  const heroShot = document.getElementById("heroShot");
  const emptyMsg = document.getElementById("empty");

  let loaded = 0;
  let checked = 0;

  PHOTO_MANIFEST.forEach((src, i) => {
    const img = new Image();
    img.src = src;
    img.alt = "Foto da bambino";
    img.decoding = "async";

    img.onload = () => {
      loaded += 1;
      checked += 1;
      if (i === 0) {
        mountHeroShot(heroShot, img, src);
      } else {
        addShot(strip, img, src);
      }
      settle();
    };

    img.onerror = () => {
      checked += 1;
      settle();
    };
  });

  function settle() {
    if (checked !== PHOTO_MANIFEST.length) return;
    if (loaded === 0) emptyMsg.hidden = false;
    /* Se esiste solo la prima foto, è già in apertura: la striscia resta
       vuota e lo diciamo. */
    if (loaded === 1 && !strip.children.length) emptyMsg.hidden = false;
  }
}

function mountHeroShot(container, img, src) {
  const button = document.createElement("button");
  button.className = "shot-open";
  button.type = "button";
  button.setAttribute("aria-label", "Apri la foto a schermo intero");
  button.style.cssText = "display:block;width:100%;padding:0;border:0;background:none;cursor:pointer";
  button.appendChild(img);
  container.appendChild(button);
  container.hidden = false;

  button.addEventListener("click", () => openLightbox(src, button));

  if (reduceMotion) return;

  container.style.opacity = 0;
  animate(
    container,
    { opacity: [0, 1], transform: ["scale(1.04)", "scale(1)"] },
    { delay: 0.75, duration: 1, easing: EASE_OUT }
  );
}

function addShot(strip, img, src) {
  const shot = document.createElement("button");
  shot.className = "shot";
  shot.type = "button";
  shot.setAttribute("aria-label", "Apri la foto a schermo intero");
  shot.appendChild(img);
  strip.appendChild(shot);

  shot.addEventListener("click", () => openLightbox(src, shot));

  if (reduceMotion) return;

  shot.style.opacity = 0;

  /* Entra quando la raggiungi, non quando il file finisce di scaricarsi. */
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
}

/* Lightbox */
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxClose = document.getElementById("lightboxClose");
let lastFocused = null;
let closing = false;

function openLightbox(src, trigger) {
  lastFocused = trigger;
  closing = false;
  lightboxImg.src = src;
  lightboxImg.alt = "Foto da bambino, ingrandita";
  lightbox.classList.add("is-open");
  lightbox.setAttribute("aria-hidden", "false");
  lightboxClose.focus();

  if (reduceMotion) return;

  animate(
    lightboxImg,
    { opacity: [0, 1], transform: ["scale(0.94)", "scale(1)"] },
    { duration: 0.42, easing: EASE_OUT }
  );
}

function dismiss() {
  lightbox.classList.remove("is-open");
  lightbox.setAttribute("aria-hidden", "true");
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
  animate(
    lightboxImg,
    { opacity: [1, 0], transform: ["scale(1)", "scale(0.97)"] },
    { duration: 0.2, easing: EASE_IN }
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

heroArrival();
revealTiles();
buildGallery();
