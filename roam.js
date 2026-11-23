// Dopo la scritta il mondo è libero: si guida il pulmino e la cartina porta da
// una città all'altra. Tutto qui è interfaccia: la guida vera sta in journey.js.
import { CITIES, outlines, PLACES } from "./map.js";

/* I colori delle mappe dei navigatori. */
const LAND = "#f5f3ef";
const WATER = "#9fcbf5";
const BUILDING = "#e6e3dd";
const BUILDING_EDGE = "#d9d5cd";
const PARK = "#c8e6c2";
const ROAD = "#ffffff";
const CASING = "#d4d7dc";
const LABEL = "#3c4043";
const PIN = "#ea4335";
const PIN_DARK = "#b3261e";
const BLUE = "#1a73e8";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const shape = outlines();

/* Lo spillo rosso a goccia, con la punta sul punto. */
function pin(g, x, y, size) {
  const r = size * 0.42;
  const top = y - size;
  g.beginPath();
  g.moveTo(x, y);
  g.bezierCurveTo(x - r * 0.3, y - size * 0.3, x - r, top + r * 1.3, x - r, top + r);
  g.arc(x, top + r, r, Math.PI, 0);
  g.bezierCurveTo(x + r, top + r * 1.3, x + r * 0.3, y - size * 0.3, x, y);
  g.closePath();
  g.fillStyle = PIN;
  g.fill();
  g.lineWidth = 1.2;
  g.strokeStyle = PIN_DARK;
  g.stroke();
  g.beginPath();
  g.arc(x, top + r, r * 0.4, 0, Math.PI * 2);
  g.fillStyle = PIN_DARK;
  g.fill();
}

/* Il pallino blu con il cono della direzione. */
function blueDot(g, x, y, h, r) {
  g.save();
  g.translate(x, y);
  g.rotate(h);
  const cone = g.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 4.2);
  cone.addColorStop(0, "rgba(26,115,232,0.45)");
  cone.addColorStop(1, "rgba(26,115,232,0)");
  g.fillStyle = cone;
  g.beginPath();
  g.moveTo(0, 0);
  g.arc(0, 0, r * 4.2, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
  g.closePath();
  g.fill();
  g.restore();
  g.beginPath();
  g.arc(x, y, r * 2.2, 0, Math.PI * 2);
  g.fillStyle = "rgba(26,115,232,0.16)";
  g.fill();
  g.beginPath();
  g.arc(x, y, r + 2.2, 0, Math.PI * 2);
  g.fillStyle = "#ffffff";
  g.shadowColor = "rgba(0,0,0,0.3)";
  g.shadowBlur = 4;
  g.fill();
  g.shadowBlur = 0;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = BLUE;
  g.fill();
}

/* Una città nel rettangolo: adattata al riquadro, oppure (view) centrata su un
   punto con una certa ampiezza in unità del mondo. Nord in alto. */
function drawCity(g, city, rect, { lines, bus, labels, footprints, view }) {
  const [x0, z0, x1, z1] = city.box;
  let scale;
  let px;
  let pz;
  if (view) {
    scale = rect.w / view.span;
    px = (x) => rect.x + rect.w / 2 + (x - view.cx) * scale;
    pz = (z) => rect.y + rect.h / 2 + (z - view.cz) * scale;
  } else {
    scale = Math.min(rect.w / (x1 - x0), rect.h / (z1 - z0));
    px = (x) => rect.x + (rect.w - (x1 - x0) * scale) / 2 + (x - x0) * scale;
    pz = (z) => rect.y + (rect.h - (z1 - z0) * scale) / 2 + (z - z0) * scale;
  }
  const trace = (points) => {
    g.beginPath();
    points.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z))));
  };
  const inCity = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  const rectOf = (f) => {
    const c = Math.cos(f.rot);
    const sn = Math.sin(f.rot);
    g.beginPath();
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b], i) => {
      const lx = (a * f.w) / 2;
      const lz = (b * f.d) / 2;
      const X = px(f.x + lx * c + lz * sn);
      const Y = pz(f.z - lx * sn + lz * c);
      if (i) g.lineTo(X, Y);
      else g.moveTo(X, Y);
    });
    g.closePath();
  };

  g.save();
  g.beginPath();
  if (view) g.rect(rect.x, rect.y, rect.w, rect.h);
  else g.rect(px(x0), pz(z0), (x1 - x0) * scale, (z1 - z0) * scale);
  g.clip();
  g.fillStyle = city.sea ? WATER : LAND;
  if (view) g.fillRect(rect.x, rect.y, rect.w, rect.h);
  else g.fillRect(px(x0), pz(z0), (x1 - x0) * scale, (z1 - z0) * scale);
  if (city.sea) {
    trace(shape.lisbonLand);
    g.closePath();
    g.fillStyle = LAND;
    g.fill();
  }
  if (city.river) {
    trace(shape.tiber);
    g.strokeStyle = WATER;
    g.lineWidth = Math.max(2.5, 46 * scale);
    g.lineJoin = "round";
    g.lineCap = "round";
    g.stroke();
  }
  /* Parchi e isolati, appena c'è abbastanza spazio per vederli. */
  if (footprints && scale > 0.12) {
    g.fillStyle = PARK;
    for (const f of footprints.parks) if (inCity(f.x, f.z)) {
      rectOf(f);
      g.fill();
    }
    g.fillStyle = BUILDING;
    g.strokeStyle = BUILDING_EDGE;
    g.lineWidth = 0.6;
    for (const f of footprints.blocks) if (inCity(f.x, f.z)) {
      rectOf(f);
      g.fill();
      if (scale > 0.35) g.stroke();
    }
  }
  /* Le strade: bordo grigio, poi il bianco sopra. */
  const roadW = Math.max(2.2, 9 * scale);
  g.lineJoin = "round";
  g.lineCap = "round";
  for (const [color, width] of [[CASING, roadW + 2], [ROAD, roadW]]) {
    g.strokeStyle = color;
    g.lineWidth = width;
    for (const l of lines) {
      if (l.city !== city.id) continue;
      trace(l.points);
      g.stroke();
    }
  }
  g.restore();

  const spots = [];
  const here = PLACES.filter((p) => p.city === city.id);
  const visible = here
    .map((p) => ({ p, x: px(p.place[0]), y: pz(p.place[1]) }))
    .filter(({ x, y }) => !view || (x > rect.x - 20 && x < rect.x + rect.w + 20 && y > rect.y - 20 && y < rect.y + rect.h + 30));
  const size = labels ? 24 : 15;
  for (const { x, y } of visible) pin(g, x, y, size);
  if (labels) {
    /* I nomi: per ognuno quattro posti intorno allo spillo, il primo che sta
       nel riquadro e non copre un altro nome o uno spillo. */
    g.font = `600 13px ${FONT}`;
    const taken = visible.map(({ x, y }) => ({ x0: x - 9, x1: x + 9, y0: y - size, y1: y }));
    const hits = (b) => taken.some((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0);
    for (const { p, x, y } of visible) {
      const tw = g.measureText(p.name).width;
      const [side0, lift0] = p.tag ?? [1, -1];
      const tries = [[side0, lift0], [side0, -lift0], [-side0, lift0], [-side0, -lift0], [0, -1]];
      let best = null;
      for (const [side, lift] of tries) {
        const tx = side === 0 ? x : x + side * 13;
        const ty = side === 0 ? y - size - 6 : y - 13 + lift * 7;
        const x0 = side > 0 ? tx : side < 0 ? tx - tw : tx - tw / 2;
        const box = { x0: x0 - 2, x1: x0 + tw + 2, y0: ty - 10, y1: ty + 4 };
        const inside = box.x0 >= rect.x + 2 && box.x1 <= rect.x + rect.w - 2;
        if (inside && !hits(box)) {
          best = { tx, ty, side, box };
          break;
        }
      }
      /* Se non c'è posto il nome si tace: lo spillo resta, e toccandolo si legge. */
      if (!best) continue;
      taken.push(best.box);
      g.textAlign = best.side > 0 ? "left" : best.side < 0 ? "right" : "center";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(255,255,255,0.95)";
      g.lineJoin = "round";
      g.strokeText(p.name, best.tx, best.ty);
      g.fillStyle = LABEL;
      g.fillText(p.name, best.tx, best.ty);
    }
  }
  for (const { p, x, y } of visible) spots.push({ x, y: y - (labels ? 14 : 9), landmark: p.landmark, name: p.name, city: city.id, place: p.place });

  if (bus && (view || inCity(bus.x, bus.z))) blueDot(g, px(bus.x), pz(bus.z), bus.h, labels ? 6 : 5);
  return spots;
}

/* Lisbona sta a ovest, Melfi a est: la cartina tiene quest'ordine. */
function layout(w, h) {
  const gap = 10;
  if (w > h * 1.3) {
    const unit = (w - gap * 2) / 4.9;
    return { lisbona: { x: 0, y: 0, w: unit * 2.5, h }, roma: { x: unit * 2.5 + gap, y: 0, w: unit * 1.4, h }, melfi: { x: unit * 3.9 + gap * 2, y: 0, w: unit, h } };
  }
  /* In verticale Roma, la più fitta, prende tutta la larghezza. */
  const top = Math.min(w / 2.6, h * 0.24);
  const low = Math.min(w / 3.2, h * 0.16);
  return { lisbona: { x: 0, y: 0, w, h: top }, roma: { x: 0, y: top + gap, w, h: h - top - low - gap * 2 }, melfi: { x: 0, y: h - low, w, h: low } };
}

export function createRoam({ journey }) {
  const root = document.documentElement;
  const button = document.getElementById("roamButton");
  const pad = document.getElementById("roamPad");
  const stick = document.getElementById("roamStick");
  const mini = document.getElementById("roamMini");
  const panel = document.getElementById("roamMap");
  const big = document.getElementById("roamMapCanvas");
  const closeMap = document.getElementById("roamMapClose");
  const leave = document.getElementById("roamLeave");

  const lines = journey.lines();
  const search = document.getElementById("roamSearch");
  const results = document.getElementById("roamResults");
  const card = document.getElementById("roamCard");
  const cardName = document.getElementById("roamCardName");
  const cardWhere = document.getElementById("roamCardWhere");
  const cardGo = document.getElementById("roamCardGo");
  const cardClose = document.getElementById("roamCardClose");
  const CITY_NAMES = Object.fromEntries(CITIES.map((c) => [c.id, c.name]));
  let chosen = null;
  let active = false;
  let spots = [];
  const keys = new Set();
  const touch = { id: null, x: 0, y: 0 };
  let stickGas = 0;
  let stickSteer = 0;

  function applyDrive() {
    const gas = (keys.has("up") ? 1 : 0) - (keys.has("down") ? 1 : 0);
    const steer = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
    journey.drive(gas || stickGas, steer || stickSteer);
  }

  const sized = (canvas, w, h) => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * ratio)) {
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
    }
    const g = canvas.getContext("2d");
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, w, h);
    return g;
  };

  function drawMini() {
    const box = mini.getBoundingClientRect();
    if (!box.width) return;
    const g = sized(mini, box.width, box.height);
    const bus = journey.bus;
    const city = CITIES.find((c) => bus.x >= c.box[0] && bus.x <= c.box[2] && bus.z >= c.box[1] && bus.z <= c.box[3]) ?? CITIES[0];
    /* La cartina piccola segue il pallino, da vicino, col nord in alto. */
    g.fillStyle = LAND;
    g.fillRect(0, 0, box.width, box.height);
    drawCity(g, city, { x: 0, y: 0, w: box.width, h: box.height }, { lines, bus, footprints: journey.footprints, view: { cx: bus.x, cz: bus.z, span: 420 } });
    g.font = `700 11px ${FONT}`;
    g.textAlign = "center";
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(14, 14, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = PIN_DARK;
    g.fillText("N", 14, 18);
  }

  function drawBig() {
    const box = big.getBoundingClientRect();
    if (!box.width) return;
    const g = sized(big, box.width, box.height);
    const rects = layout(box.width, box.height);
    spots = CITIES.flatMap((c) => drawCity(g, c, rects[c.id], { lines, bus: journey.bus, labels: true, footprints: journey.footprints }));
    /* Il nome della città, in alto a sinistra del suo riquadro. */
    g.font = `700 15px ${FONT}`;
    g.textAlign = "left";
    for (const c of CITIES) {
      const r = rects[c.id];
      g.lineWidth = 4;
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.strokeText(c.name, r.x + 10, r.y + 22);
      g.fillStyle = LABEL;
      g.fillText(c.name, r.x + 10, r.y + 22);
    }
  }

  function tick() {
    if (!active) return;
    requestAnimationFrame(tick);
    drawMini();
    if (!panel.hidden) drawBig();
  }

  function enter() {
    active = true;
    root.classList.add("is-roaming");
    journey.enterRoam();
    button.hidden = true;
    tick();
  }

  function exit() {
    active = false;
    root.classList.remove("is-roaming");
    panel.hidden = true;
    keys.clear();
    stickGas = stickSteer = 0;
    journey.exitRoam();
    button.hidden = false;
  }

  button.addEventListener("click", enter);
  leave.addEventListener("click", exit);
  mini.addEventListener("click", () => {
    panel.hidden = false;
    card.hidden = true;
    results.hidden = true;
    search.value = "";
    drawBig();
  });
  closeMap.addEventListener("click", () => {
    panel.hidden = true;
  });
  big.addEventListener("click", (e) => {
    const box = big.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    let best = null;
    let bestD = 34;
    for (const s of spots) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (!best) return;
    showCard(best);
  });

  /* La scheda del luogo, in basso, come sulle mappe: nome, città, distanza, Vai. */
  function showCard(place) {
    chosen = place;
    const bus = journey.bus;
    const km = Math.hypot(place.place[0] - bus.x, place.place[1] - bus.z) / 130;
    const sameCity = CITIES.find((c) => c.id === place.city);
    const here = sameCity && bus.x >= sameCity.box[0] && bus.x <= sameCity.box[2] && bus.z >= sameCity.box[1] && bus.z <= sameCity.box[3];
    cardName.textContent = place.name;
    cardWhere.textContent = here ? `${CITY_NAMES[place.city]} · a ${km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${km.toFixed(1).replace(".", ",")} km`}` : CITY_NAMES[place.city];
    card.hidden = false;
    results.hidden = true;
    cardGo.focus({ preventScroll: true });
  }
  cardGo.addEventListener("click", () => {
    if (!chosen) return;
    journey.jumpTo(chosen.landmark);
    card.hidden = true;
    panel.hidden = true;
  });
  cardClose.addEventListener("click", () => {
    card.hidden = true;
  });

  /* La ricerca: filtra i luoghi mentre si scrive. */
  const ALL = PLACES.map((p) => ({ landmark: p.landmark, name: p.name, city: p.city, place: p.place }));
  const plain = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  function listResults() {
    const q = plain(search.value.trim());
    const found = ALL.filter((p) => !q || plain(`${p.name} ${CITY_NAMES[p.city]}`).includes(q));
    results.replaceChildren(
      ...found.map((p) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.innerHTML = `<span class="roam-results__pin" aria-hidden="true"></span><span><b></b><small></small></span>`;
        b.querySelector("b").textContent = p.name;
        b.querySelector("small").textContent = CITY_NAMES[p.city];
        b.addEventListener("click", () => {
          search.value = p.name;
          showCard(p);
        });
        li.append(b);
        return li;
      })
    );
    results.hidden = !found.length;
  }
  search.addEventListener("focus", () => {
    card.hidden = true;
    listResults();
  });
  search.addEventListener("input", listResults);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") results.querySelector("button")?.click();
    if (e.key === "Escape") {
      results.hidden = true;
      search.blur();
    }
  });

  /* Tastiera */
  const CODES = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
  window.addEventListener("keydown", (e) => {
    if (!active) return;
    if (e.key === "Escape" && !panel.hidden) {
      if (!card.hidden) card.hidden = true;
      else panel.hidden = true;
    }
    if (document.activeElement === search) return;
    const name = CODES[e.code];
    if (!name) return;
    e.preventDefault();
    keys.add(name);
    applyDrive();
  });
  window.addEventListener("keyup", (e) => {
    const name = CODES[e.code];
    if (!name) return;
    keys.delete(name);
    applyDrive();
  });
  window.addEventListener("blur", () => {
    keys.clear();
    if (active) applyDrive();
  });

  /* Pollice: dove si appoggia nasce lo stick. Su è gas, giù retromarcia, ai lati
     si sterza. */
  const REACH = 64;
  pad.addEventListener("pointerdown", (e) => {
    if (touch.id !== null) return;
    touch.id = e.pointerId;
    touch.x = e.clientX;
    touch.y = e.clientY;
    pad.setPointerCapture(e.pointerId);
    stick.hidden = false;
    stick.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    stick.style.setProperty("--dx", "0px");
    stick.style.setProperty("--dy", "0px");
  });
  pad.addEventListener("pointermove", (e) => {
    if (e.pointerId !== touch.id) return;
    const dx = Math.max(-REACH, Math.min(REACH, e.clientX - touch.x));
    const dy = Math.max(-REACH, Math.min(REACH, e.clientY - touch.y));
    stickSteer = Math.abs(dx) < 8 ? 0 : dx / REACH;
    stickGas = Math.abs(dy) < 8 ? 0 : -dy / REACH;
    stick.style.setProperty("--dx", `${dx}px`);
    stick.style.setProperty("--dy", `${dy}px`);
    applyDrive();
  });
  const release = (e) => {
    if (e.pointerId !== touch.id) return;
    touch.id = null;
    stickGas = stickSteer = 0;
    stick.hidden = true;
    applyDrive();
  };
  pad.addEventListener("pointerup", release);
  pad.addEventListener("pointercancel", release);

  return {
    /* Il pulsante esiste solo dopo la scritta. */
    setAvailable(value) {
      button.hidden = !value || active;
    },
  };
}
