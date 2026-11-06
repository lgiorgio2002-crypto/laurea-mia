// Dopo la scritta il mondo è libero: si guida il pulmino e la cartina porta da
// una città all'altra. Tutto qui è interfaccia: la guida vera sta in journey.js.
import { CITIES, outlines, PLACES } from "./map.js";

const INK = "#2b2622";
const LAND = "#f6ecd2";
const WATER = "#7cc4dc";
const ROAD = "#b9a98f";
const DOT = "#e4572e";
const BUS = "#ffd43b";

const shape = outlines();

/* La città dentro un rettangolo, con il nord in alto. */
function drawCity(g, city, rect, { lines, bus, labels }) {
  const [x0, z0, x1, z1] = city.box;
  const scale = Math.min(rect.w / (x1 - x0), rect.h / (z1 - z0));
  const px = (x) => rect.x + (rect.w - (x1 - x0) * scale) / 2 + (x - x0) * scale;
  const pz = (z) => rect.y + (rect.h - (z1 - z0) * scale) / 2 + (z - z0) * scale;
  const trace = (points) => {
    g.beginPath();
    points.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z))));
  };

  g.save();
  g.beginPath();
  g.rect(px(x0), pz(z0), (x1 - x0) * scale, (z1 - z0) * scale);
  g.clip();
  g.fillStyle = city.sea ? WATER : LAND;
  g.fillRect(px(x0), pz(z0), (x1 - x0) * scale, (z1 - z0) * scale);
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
    g.stroke();
  }
  g.strokeStyle = ROAD;
  g.lineWidth = Math.max(1.5, rect.w / 170);
  for (const l of lines) {
    if (l.city !== city.id) continue;
    trace(l.points);
    g.stroke();
  }
  g.restore();

  const spots = [];
  const here = PLACES.filter((p) => p.city === city.id);
  here.forEach((p) => {
    const x = px(p.place[0]);
    const y = pz(p.place[1]);
    g.fillStyle = DOT;
    g.beginPath();
    g.arc(x, y, labels ? 6 : 3, 0, Math.PI * 2);
    g.fill();
    if (labels) {
      /* tag dice da che parte del punto va il nome, per non sovrapporlo. */
      const [side, lift] = p.tag ?? [1, -1];
      const tx = x + side * 9;
      const ty = y + lift * 11 + 4;
      g.font = "700 13px system-ui, sans-serif";
      g.textAlign = side > 0 ? "left" : "right";
      g.lineWidth = 4;
      g.strokeStyle = LAND;
      g.lineJoin = "round";
      g.strokeText(p.name, tx, ty);
      g.fillStyle = INK;
      g.fillText(p.name, tx, ty);
    }
    spots.push({ x, y, landmark: p.landmark });
  });

  if (bus && bus.x >= x0 && bus.x <= x1 && bus.z >= z0 && bus.z <= z1) {
    g.save();
    g.translate(px(bus.x), pz(bus.z));
    g.rotate(bus.h);
    g.fillStyle = BUS;
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(6, 6);
    g.lineTo(-6, 6);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
  return spots;
}

/* Lisbona sta a ovest, Melfi a est: la cartina tiene quest'ordine. */
function layout(w, h) {
  const gap = 10;
  if (w > h * 1.3) {
    const unit = (w - gap * 2) / 4.9;
    return { lisbona: { x: 0, y: 0, w: unit * 2.5, h }, roma: { x: unit * 2.5 + gap, y: 0, w: unit * 1.4, h }, melfi: { x: unit * 3.9 + gap * 2, y: 0, w: unit, h } };
  }
  const top = Math.min(w / 2.5, h * 0.3);
  return { lisbona: { x: 0, y: 0, w, h: top }, roma: { x: 0, y: top + gap, w: w * 0.68, h: h - top - gap }, melfi: { x: w * 0.68 + gap, y: top + gap, w: w * 0.32 - gap, h: h - top - gap } };
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
    drawCity(g, city, { x: 0, y: 0, w: box.width, h: box.height }, { lines, bus });
  }

  function drawBig() {
    const box = big.getBoundingClientRect();
    if (!box.width) return;
    const g = sized(big, box.width, box.height);
    const rects = layout(box.width, box.height);
    spots = CITIES.flatMap((c) => drawCity(g, c, rects[c.id], { lines, bus: journey.bus, labels: true }));
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
    journey.jumpTo(best.landmark);
    panel.hidden = true;
  });

  /* Tastiera */
  const CODES = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
  window.addEventListener("keydown", (e) => {
    if (!active) return;
    if (e.key === "Escape" && !panel.hidden) panel.hidden = true;
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
