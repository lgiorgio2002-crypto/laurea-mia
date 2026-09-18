import { animate, inView, stagger } from "https://cdn.jsdelivr.net/npm/motion@11/+esm";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Elenco dei file attesi in ./photos/. Rinomina le tue foto con questi nomi
   (o modifica questa lista) e mettile nella cartella photos/. Se un file non
   esiste, la cella viene semplicemente rimossa: puoi averne di meno o di più. */
const PHOTO_MANIFEST = Array.from({ length: 12 }, (_, i) => `photos/${i + 1}.jpg`);

function buildGallery() {
  const grid = document.getElementById("galleryGrid");
  const emptyMsg = document.getElementById("galleryEmpty");
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightboxImg");
  const lightboxClose = document.getElementById("lightboxClose");

  let loaded = 0;
  let checked = 0;

  const openLightbox = (src, alt) => {
    lightboxImg.src = src;
    lightboxImg.alt = alt;
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
  };

  const closeLightbox = () => {
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
  };

  lightboxClose.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });

  PHOTO_MANIFEST.forEach((src) => {
    const img = new Image();
    img.src = src;

    img.onload = () => {
      loaded += 1;
      checked += 1;

      const cell = document.createElement("button");
      cell.className = "gallery__item";
      cell.type = "button";
      cell.setAttribute("aria-label", "Apri foto a schermo intero");
      cell.appendChild(img);
      grid.appendChild(cell);

      cell.addEventListener("click", () => openLightbox(src, "Foto da bambino"));

      if (!reduceMotion) {
        animate(
          cell,
          { opacity: [0, 1], scale: [0.94, 1] },
          { duration: 0.5, easing: "ease-out" }
        );

        cell.addEventListener("pointerenter", () => {
          animate(cell, { scale: 1.03, rotate: 0.6 }, { type: "spring", stiffness: 300, damping: 18 });
        });
        cell.addEventListener("pointerleave", () => {
          animate(cell, { scale: 1, rotate: 0 }, { type: "spring", stiffness: 300, damping: 18 });
        });
      }

      afterCheck();
    };

    img.onerror = () => {
      checked += 1;
      afterCheck();
    };
  });

  function afterCheck() {
    if (checked === PHOTO_MANIFEST.length && loaded === 0) {
      emptyMsg.hidden = false;
    }
  }
}

function revealOnScroll() {
  const sections = document.querySelectorAll('[data-reveal]:not([data-reveal="hero"])');

  sections.forEach((el) => {
    if (reduceMotion) {
      el.style.opacity = 1;
      return;
    }
    el.style.opacity = 0;
  });

  if (reduceMotion) return;

  inView(
    '[data-reveal]:not([data-reveal="hero"])',
    (info) => {
      animate(
        info.target,
        { opacity: [0, 1], y: [24, 0] },
        { duration: 0.7, easing: [0.16, 1, 0.3, 1] }
      );
    },
    { amount: 0.3 }
  );
}

function heroEntrance() {
  if (reduceMotion) return;

  const hero = document.querySelector(".hero");
  const items = [
    hero.querySelector(".stamp"),
    hero.querySelector(".hero__title"),
    hero.querySelector(".hero__sub"),
    hero.querySelector(".hero__note"),
  ].filter(Boolean);

  items.forEach((el) => {
    el.style.opacity = 0;
  });

  animate(
    items,
    { opacity: [0, 1], y: [16, 0] },
    { delay: stagger(0.12), duration: 0.6, easing: [0.16, 1, 0.3, 1] }
  );

  hero.style.opacity = 1;
}

buildGallery();
revealOnScroll();
heroEntrance();
