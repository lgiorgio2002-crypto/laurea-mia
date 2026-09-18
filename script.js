import { animate, inView, scroll, stagger } from "https://cdn.jsdelivr.net/npm/motion@11/+esm";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Elenco dei file attesi in ./photos/. Rinomina le tue foto con questi nomi
   (o modifica questa lista) e mettile nella cartella photos/. Se un file non
   esiste, viene semplicemente saltato: puoi averne di meno o di più.
   La prima, photos/1.jpg, diventa lo scatto d'apertura. */
const PHOTO_MANIFEST = Array.from({ length: 12 }, (_, i) => `photos/${i + 1}.jpg`);

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

  const heads = document.querySelectorAll("#canzone .tile__head, #foto .tile__head, .outro .tile__head");

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
    if (loaded === 1 && !strip.children.length) emptyMsg.hidden = false;
  }
}

function mountHeroShot(container, img, src) {
  const button = document.createElement("button");
  button.className = "shot-open";
  button.type = "button";
  button.setAttribute("aria-label", "Apri la foto a schermo intero");
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
  lightboxImg.alt = "Foto da bambino, ingrandita";
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

heroArrival();
revealTiles();
revealEmbed();
buildGallery();
