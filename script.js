import { animate, stagger } from "https://cdn.jsdelivr.net/npm/motion@11/+esm";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const canHover = window.matchMedia("(hover: hover)").matches;

/* Elenco dei file attesi in ./photos/. Rinomina le tue foto con questi nomi
   (o modifica questa lista) e mettile nella cartella photos/. Se un file non
   esiste, la stampa viene semplicemente omessa: puoi averne di meno o di più. */
const PHOTO_MANIFEST = Array.from({ length: 12 }, (_, i) => `photos/${i + 1}.jpg`);

/* Inclinazioni fisse per foto: stampe appoggiate a mano, non ruotate a caso
   a ogni render. */
const TILTS = [-1.6, 1.1, -0.7, 1.5, -1.2, 0.8, -1.4, 1.3, -0.9, 1.6, -1.1, 0.7];

const EASE_OUT = [0.16, 1, 0.3, 1];

/* Il momento d'autore della pagina: l'arrivo dopo la scansione del QR.
   Il titolo sale da sotto una maschera, la nota si scrive da sinistra. */
function heroArrival() {
  const lines = document.querySelectorAll(".hero__line");
  const sub = document.querySelector(".hero__sub");
  const ink = document.querySelectorAll(".hero__note .ink");

  if (reduceMotion) return;

  lines.forEach((el) => {
    el.style.clipPath = "inset(100% 0 0 0)";
  });
  sub.style.opacity = 0;
  ink.forEach((el) => {
    el.style.clipPath = "inset(0 100% 0 0)";
  });

  animate(
    lines,
    { clipPath: ["inset(100% 0 0 0)", "inset(0% 0 0 0)"], y: [28, 0] },
    { delay: stagger(0.14), duration: 0.9, easing: EASE_OUT }
  );

  animate(
    sub,
    { opacity: [0, 1], y: [14, 0] },
    { delay: 0.5, duration: 0.7, easing: EASE_OUT }
  );

  animate(
    ink,
    { clipPath: ["inset(0 100% 0 0)", "inset(0 0% 0 0)"] },
    { delay: stagger(0.26, { start: 0.85 }), duration: 0.5, easing: "ease-out" }
  );
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

  /* La stampa si sviluppa: sfocata e slavata, poi a fuoco. */
  animate(
    print,
    {
      opacity: [0, 1],
      filter: ["blur(12px) saturate(0.3)", "blur(0px) saturate(1)"],
      transform: [`rotate(${tilt * 2.2}deg) scale(0.94)`, `rotate(${tilt}deg) scale(1)`],
    },
    { duration: 0.75, easing: EASE_OUT }
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

function openLightbox(src, trigger) {
  lastFocused = trigger;
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

function closeLightbox() {
  lightbox.classList.remove("is-open");
  lightbox.setAttribute("aria-hidden", "true");
  if (lastFocused) lastFocused.focus();
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
