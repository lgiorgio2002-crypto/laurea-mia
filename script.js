import { animate, inView, stagger } from "https://cdn.jsdelivr.net/npm/motion@11/+esm";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const canHover = window.matchMedia("(hover: hover)").matches;

/* Elenco dei file attesi in ./photos/. Rinomina le tue foto con questi nomi
   (o modifica questa lista) e mettile nella cartella photos/. Se un file non
   esiste, la stampa viene semplicemente omessa: puoi averne di meno o di più. */
const PHOTO_MANIFEST = Array.from({ length: 12 }, (_, i) => `photos/${i + 1}.jpg`);

/* Inclinazioni fisse per foto: stampe appoggiate a mano, non ruotate a caso
   a ogni render. */
const TILTS = [-1.6, 1.1, -0.7, 1.5, -1.2, 0.8, -1.4, 1.3, -0.9, 1.6, -1.1, 0.7];

/* Decelerazione per gli arrivi. */
const EASE_OUT = [0.16, 1, 0.3, 1];
/* Accelerazione per le uscite: parte piano, se ne va decisa. */
const EASE_IN = [0.3, 0, 1, 1];
/* Il passo della penna: accelera appena, procede quasi costante, si ferma. */
const EASE_PEN = [0.4, 0, 0.6, 1];

const INK_HIDDEN = "inset(0 100% 0 0)";
const INK_WRITTEN = "inset(0 0% 0 0)";

/* La calligrafia si scrive sempre da sola, ovunque compaia: è una regola
   del mondo della pagina, non un effetto applicato a caso. */
function prepareInk(scope) {
  const ink = scope.querySelectorAll(".ink");
  if (!ink.length || reduceMotion) return null;
  ink.forEach((el) => {
    el.style.clipPath = INK_HIDDEN;
  });
  return ink;
}

function writeInk(ink, startDelay = 0) {
  return animate(
    ink,
    { clipPath: [INK_HIDDEN, INK_WRITTEN] },
    { delay: stagger(0.2, { start: startDelay }), duration: 0.46, easing: EASE_PEN }
  );
}

/* Il momento d'autore della pagina: l'arrivo dopo la scansione del QR.
   Il titolo sale da sotto una maschera, poi la nota si scrive. */
function heroArrival() {
  if (reduceMotion) return;

  const lines = document.querySelectorAll(".hero__line");
  const sub = document.querySelector(".hero__sub");
  const ink = prepareInk(document.querySelector(".hero__note"));

  lines.forEach((el) => {
    el.style.clipPath = "inset(100% 0 0 0)";
  });
  sub.style.opacity = 0;

  animate(
    lines,
    { clipPath: ["inset(100% 0 0 0)", "inset(0% 0 0 0)"], y: [28, 0] },
    { delay: stagger(0.12), duration: 0.8, easing: EASE_OUT }
  );

  animate(sub, { opacity: [0, 1], y: [14, 0] }, { delay: 0.42, duration: 0.65, easing: EASE_OUT });

  if (ink) writeInk(ink, 0.7);
}

/* La calligrafia in chiusura si scrive quando la raggiungi: la lettera
   finisce nel momento in cui finisci di leggerla. */
function inkOnArrival(selector) {
  const scope = document.querySelector(selector);
  if (!scope) return;
  const ink = prepareInk(scope);
  if (!ink) return;
  inView(scope, () => writeInk(ink, 0.1), { amount: 0.6 });
}

function columnCount(grid) {
  const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
  return cols > 0 ? cols : 1;
}

function buildGallery() {
  const grid = document.getElementById("galleryGrid");
  const emptyMsg = document.getElementById("galleryEmpty");

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
      addPrint(grid, img, src, TILTS[i % TILTS.length]);
      settle();
    };

    img.onerror = () => {
      checked += 1;
      settle();
    };
  });

  function settle() {
    if (checked === PHOTO_MANIFEST.length && loaded === 0) {
      emptyMsg.hidden = false;
      inkOnArrival("#galleryEmpty");
    }
  }
}

function addPrint(grid, img, src, tilt) {
  const print = document.createElement("button");
  print.className = "gallery__item";
  print.type = "button";
  print.setAttribute("aria-label", "Apri la foto a schermo intero");
  print.style.transform = `rotate(${tilt}deg)`;
  print.appendChild(img);
  grid.appendChild(print);

  print.addEventListener("click", () => openLightbox(src, print));

  if (reduceMotion) return;

  /* Stato iniziale: la stampa non è ancora sviluppata. */
  print.style.opacity = 0;
  print.style.filter = "blur(12px) saturate(0.3)";
  print.style.transform = `rotate(${tilt * 2.2}deg) scale(0.94)`;

  /* Si sviluppa quando entra in viewport, non quando il file finisce di
     scaricarsi: altrimenti l'animazione va in scena fuori dallo schermo. */
  inView(
    print,
    () => {
      const col = Array.prototype.indexOf.call(grid.children, print) % columnCount(grid);
      animate(
        print,
        {
          opacity: [0, 1],
          filter: ["blur(12px) saturate(0.3)", "blur(0px) saturate(1)"],
          transform: [`rotate(${tilt * 2.2}deg) scale(0.94)`, `rotate(${tilt}deg) scale(1)`],
        },
        { delay: col * 0.07, duration: 0.7, easing: EASE_OUT }
      );
    },
    { amount: 0.25 }
  );

  if (!canHover) return;

  print.addEventListener("pointerenter", () => {
    animate(
      print,
      { transform: `rotate(${tilt * 0.25}deg) scale(1.045) translateY(-4px)` },
      { type: "spring", stiffness: 260, damping: 20 }
    );
  });

  print.addEventListener("pointerleave", () => {
    animate(
      print,
      { transform: `rotate(${tilt}deg) scale(1) translateY(0px)` },
      { type: "spring", stiffness: 260, damping: 22 }
    );
  });
}

/* Lightbox */
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxClose = document.getElementById("lightboxClose");
const lightboxPrint = document.querySelector(".lightbox__print");
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
    lightboxPrint,
    { opacity: [0, 1], transform: ["scale(0.92) rotate(-1deg)", "scale(1) rotate(0deg)"] },
    { type: "spring", stiffness: 210, damping: 24 }
  );
}

function dismiss() {
  lightbox.classList.remove("is-open");
  lightbox.setAttribute("aria-hidden", "true");
  lightboxPrint.style.opacity = "";
  lightboxPrint.style.transform = "";
  closing = false;
  if (lastFocused) lastFocused.focus();
}

/* L'uscita è più rapida dell'entrata e accelera: la foto viene riposata,
   non strappata via. */
function closeLightbox() {
  if (closing) return;

  if (reduceMotion) {
    dismiss();
    return;
  }

  closing = true;
  animate(
    lightboxPrint,
    { opacity: [1, 0], transform: ["scale(1) rotate(0deg)", "scale(0.95) rotate(-0.6deg)"] },
    { duration: 0.19, easing: EASE_IN }
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
buildGallery();
inkOnArrival(".outro__note");
