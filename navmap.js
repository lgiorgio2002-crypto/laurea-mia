// La mappa del navigatore: tra una tappa e l'altra il mondo diventa una
// mappa 3D chiara, come quelle dei navigatori. Isolati bianchi d'argilla
// generati lungo le strade (nessun dato da fuori), parchi verdi, la linea blu
// del percorso fino alla prossima tappa, il pallino blu col cono della
// direzione al posto del pulmino, e in alto il cartello verde con il nome
// della tappa e quanto manca. Alle tappe tornano il pulmino e i luoghi veri.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/* Unità del mondo per chilometro, come misurato sulla mappa di Roma. */
const UNITS_PER_KM = 130;
/* Quanto lontano dalla tappa (lungo la strada) il navigatore lascia il posto al pulmino. */
const NEAR_STOP = 70;

const CITY_STYLE = {
  roma: { floors: [3, 6], storey: 2.8, rows: 4, park: 0.12 },
  lisbona: { floors: [2, 5], storey: 2.8, rows: 4, park: 0.1 },
  melfi: { floors: [2, 3], storey: 2.8, rows: 2, park: 0.2 },
};

function rngOf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Il cartello verde in alto, in HTML: si vede su ogni schermo. */
function makeBanner() {
  const style = document.createElement("style");
  style.textContent = `
  .nav-banner{position:fixed;left:50%;top:max(14px,env(safe-area-inset-top));transform:translate(-50%,-8px);
    display:flex;align-items:center;gap:12px;padding:10px 16px 10px 12px;min-width:min(78vw,300px);max-width:calc(100vw - 32px);
    background:#0d7a4f;color:#fff;border-radius:14px;box-shadow:0 6px 20px rgba(0,0,0,.22);
    font:600 15px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;opacity:0;pointer-events:none;
    transition:opacity .35s ease,transform .35s ease;z-index:30}
  .nav-banner.on{opacity:1;transform:translate(-50%,0)}
  .nav-banner svg{flex:none;width:30px;height:30px}
  .nav-banner .nav-dist{font-size:13px;font-weight:500;opacity:.85}
  .nav-banner .nav-name{font-size:17px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .nav-banner .nav-eta{margin-left:auto;padding-left:10px;font-size:12px;font-weight:600;opacity:.85;white-space:nowrap}`;
  document.head.appendChild(style);
  const el = document.createElement("div");
  el.className = "nav-banner";
  el.setAttribute("role", "status");
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z"/></svg>
    <div><div class="nav-dist"></div><div class="nav-name"></div></div><div class="nav-eta"></div>`;
  document.body.appendChild(el);
  return { el, dist: el.querySelector(".nav-dist"), name: el.querySelector(".nav-name"), eta: el.querySelector(".nav-eta") };
}

function formatDistance(units) {
  const m = (units / UNITS_PER_KM) * 1000;
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace(".", ",")} km`;
  return `${Math.max(10, Math.round(m / 10) * 10)} m`;
}

/* ctx: { world, legs, beats, roadPoint, roadDir, onLand, onBeachFront, nearRoad, clearing, isPhone, roadHalf, walkHalf } */
export function createNavMap(ctx) {
  const { world, legs, beats, roadPoint, roadDir, onLand, onBeachFront, nearRoad, clearing, isPhone } = ctx;
  const rng = rngOf(1811);
  const group = new THREE.Group();
  world.add(group);

  /* ---------- Isolati ---------- */
  const placed = new Map();
  const CELL = 20;
  const key = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const overlaps = (x, z, r) => {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const list = placed.get(`${cx + i},${cz + j}`);
        if (list && list.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + r)) return true;
      }
    }
    return false;
  };
  const remember = (x, z, r) => {
    const k = key(x, z);
    if (!placed.has(k)) placed.set(k, []);
    placed.get(k).push({ x, z, r });
  };
  const nearStopPlace = (x, z, r) => beats.some((b) => Math.hypot(b.place[0] - x, b.place[1] - z) < (clearing[b.landmark] ?? 58) + r);

  const blocks = [];
  const parks = [];
  const trees = [];
  const p = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (const leg of legs) {
    const style = CITY_STYLE[leg.city] ?? CITY_STYLE.roma;
    for (let s = leg.start + 6; s < leg.end - 6; s += 9) {
      roadPoint(s, p);
      roadDir(s, d);
      const rx = -d.z;
      const rz = d.x;
      for (const side of [1, -1]) {
        let offset = ctx.walkHalf + 1.5;
        for (let row = 0; row < style.rows; row++) {
          const depth = 11 + rng() * 9;
          const width = 8 + rng() * 9;
          const o = offset + depth / 2;
          const x = p.x + rx * side * o;
          const z = p.z + rz * side * o;
          const r = Math.max(depth, width) * 0.55;
          offset += depth + (row === 0 ? 3 : 5 + rng() * 4);
          if (!onLand(x, z, r) || onBeachFront(x, z) || nearRoad(x, z, r * 0.8 + ctx.walkHalf) || nearStopPlace(x, z, r) || overlaps(x, z, r * 0.8)) continue;
          remember(x, z, r * 0.8);
          if (rng() < style.park) {
            parks.push({ x, z, w: width + 4, dd: depth + 4, rot: Math.atan2(-d.x, -d.z) });
            for (let k = 0; k < 4; k++) trees.push({ x: x + (rng() - 0.5) * width, z: z + (rng() - 0.5) * depth, h: 4 + rng() * 3 });
            continue;
          }
          const floors = style.floors[0] + Math.floor(rng() * (style.floors[1] - style.floors[0] + 1)) - row * 0.5;
          const h = Math.max(2, floors) * style.storey;
          blocks.push({ x, z, w: width, dd: depth, h, rot: Math.atan2(-d.x, -d.z) });
          /* Ogni tanto un alberello davanti alla facciata. */
          if (row === 0 && rng() < 0.3) {
            const t = ctx.walkHalf - 1;
            trees.push({ x: p.x + rx * side * t, z: p.z + rz * side * t, h: 3 + rng() * 2 });
          }
        }
      }
    }
  }

  /* Un isolato non è una scatola sola: corte romana, a L, torre su un basamento
     o stecca, ognuno coi suoi volumi. [x, z, w, d, y0, h] nel riferimento
     dell'isolato (x lungo la strada, z verso l'interno). */
  function volumes(b) {
    const { w, dd, h } = b;
    const r = rng();
    if (w > 12 && dd > 13 && r < 0.3) {
      const t = Math.min(w, dd) * 0.26;
      return [
        [0, -dd / 2 + t / 2, w, t, 0, h],
        [0, dd / 2 - t / 2, w, t, 0, h * 0.92],
        [-w / 2 + t / 2, 0, t, dd - 2 * t, 0, h * 0.96],
        [w / 2 - t / 2, 0, t, dd - 2 * t, 0, h],
      ];
    }
    if (r < 0.5) {
      return [
        [0, -dd / 4, w, dd / 2, 0, h],
        [-w / 4, dd / 4, w / 2, dd / 2, 0, h * (0.7 + rng() * 0.25)],
      ];
    }
    if (r < 0.62 && h > 10) {
      return [
        [0, 0, w, dd, 0, h * 0.35],
        [rng() * 2 - 1, rng() * 2 - 1, w * 0.62, dd * 0.6, h * 0.35, h * 0.95],
      ];
    }
    const out = [[0, 0, w, dd, 0, h]];
    /* Un attico arretrato sul tetto, ogni tanto. */
    if (rng() < 0.35) out.push([w * 0.12, dd * 0.1, w * 0.5, dd * 0.45, h, 2.6]);
    return out;
  }
  const boxes = [];
  for (const b of blocks) for (const v of volumes(b)) boxes.push({ b, v });

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  /* Argilla bianca: un filo di luce propria la tiene chiara anche sotto i
     cieli colorati, come nelle mappe dei navigatori; verso terra si scurisce
     appena, come l'ombra d'ambiente al piede dei muri, e i tetti sono un tono
     più grigi delle facciate. */
  const clay = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, emissive: "#f4f2ee", emissiveIntensity: 0.2 });
  clay.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
varying float vNavY; varying float vNavUp;`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vNavY = (modelMatrix * instanceMatrix * vec4(position, 1.0)).y;
        #else
          vNavY = (modelMatrix * vec4(position, 1.0)).y;
        #endif
        vNavUp = normal.y;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying float vNavY; varying float vNavUp;`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float navAo = mix(0.72, 1.0, smoothstep(0.0, 7.0, vNavY));
        diffuseColor.rgb *= mix(navAo, 0.93, step(0.5, vNavUp));`
      );
  };
  clay.customProgramCacheKey = () => "nav-clay";
  const blockMesh = new THREE.InstancedMesh(boxGeo, clay, Math.max(1, boxes.length));
  /* Il bordo del tetto: una lastra appena più larga, grigio chiaro. */
  const capGeo = new THREE.BoxGeometry(1, 1, 1);
  capGeo.translate(0, 0.5, 0);
  const capMesh = new THREE.InstancedMesh(capGeo, new THREE.MeshStandardMaterial({ color: "#dedcd7", roughness: 0.95, emissive: "#dedcd7", emissiveIntensity: 0.15 }), Math.max(1, boxes.length));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  boxes.forEach(({ b, v }, i) => {
    const [lx, lz, w, dd, y0, h] = v;
    q.setFromAxisAngle(up, b.rot);
    const c = Math.cos(b.rot);
    const sn = Math.sin(b.rot);
    const x = b.x + lx * c + lz * sn;
    const z = b.z - lx * sn + lz * c;
    m4.compose(pos.set(x, y0, z), q, sc.set(w, h, dd));
    blockMesh.setMatrixAt(i, m4);
    const tone = 0.95 + rng() * 0.05;
    blockMesh.setColorAt(i, col.setRGB(tone, tone * 0.995, tone * 0.98));
    m4.compose(pos.set(x, y0 + h, z), q, sc.set(w + 0.35, 0.35, dd + 0.35));
    capMesh.setMatrixAt(i, m4);
  });
  blockMesh.count = capMesh.count = boxes.length;
  blockMesh.castShadow = !isPhone;
  blockMesh.receiveShadow = capMesh.receiveShadow = true;
  blockMesh.frustumCulled = capMesh.frustumCulled = false;
  group.add(blockMesh, capMesh);

  /* I parchi: lastre verdi appena sopra la terra. */
  const parkGeo = new THREE.BoxGeometry(1, 0.12, 1);
  parkGeo.translate(0, 0.06, 0);
  const parkMat = new THREE.MeshStandardMaterial({ color: "#bfe3b0", roughness: 1, emissive: "#bfe3b0", emissiveIntensity: 0.12 });
  const parkMesh = new THREE.InstancedMesh(parkGeo, parkMat, Math.max(1, parks.length));
  parks.forEach((b, i) => {
    q.setFromAxisAngle(up, b.rot);
    m4.compose(pos.set(b.x, 0, b.z), q, sc.set(b.w, 1, b.dd));
    parkMesh.setMatrixAt(i, m4);
  });
  parkMesh.count = parks.length;
  parkMesh.receiveShadow = true;
  parkMesh.frustumCulled = false;
  group.add(parkMesh);

  /* Gli alberi da mappa: palle verdi su un gambo. */
  const crown = new THREE.IcosahedronGeometry(1, 1);
  crown.translate(0, 1.6, 0);
  const stem = new THREE.CylinderGeometry(0.12, 0.16, 1.2, 5);
  stem.translate(0, 0.6, 0);
  const treeMesh = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: "#8cc97a", roughness: 0.95, flatShading: true }), Math.max(1, trees.length));
  const stemMesh = new THREE.InstancedMesh(stem, new THREE.MeshStandardMaterial({ color: "#c9c2b6", roughness: 1 }), Math.max(1, trees.length));
  trees.forEach((t, i) => {
    m4.compose(pos.set(t.x, 0, t.z), q.identity(), sc.setScalar(t.h / 3));
    treeMesh.setMatrixAt(i, m4);
    stemMesh.setMatrixAt(i, m4);
  });
  treeMesh.count = stemMesh.count = trees.length;
  treeMesh.castShadow = !isPhone;
  treeMesh.frustumCulled = stemMesh.frustumCulled = false;
  group.add(treeMesh, stemMesh);

  /* ---------- La linea blu del percorso ---------- */
  const routeUniforms = { uFrom: { value: 0 }, uTo: { value: -1 }, uShow: { value: 0 } };
  const routeGeos = legs.map((leg) => {
    const verts = [];
    const ss = [];
    const across = [];
    const idx = [];
    const n = Math.ceil((leg.end - leg.start) / 2);
    for (let i = 0; i <= n; i++) {
      const s = leg.start + ((leg.end - leg.start) * i) / n;
      roadPoint(s, p);
      roadDir(s, d);
      for (const e of [-1, 1]) {
        verts.push(p.x - d.z * e * 1.35, 0.16, p.z + d.x * e * 1.35);
        ss.push(s);
        across.push(e);
      }
      if (i < n) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute("aS", new THREE.Float32BufferAttribute(ss, 1));
    g.setAttribute("aAcross", new THREE.Float32BufferAttribute(across, 1));
    g.setIndex(idx);
    return g;
  });
  const routeMat = new THREE.ShaderMaterial({
    uniforms: routeUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aS; attribute float aAcross;
      varying float vS; varying float vAcross;
      void main() { vS = aS; vAcross = aAcross; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uFrom; uniform float uTo; uniform float uShow;
      varying float vS; varying float vAcross;
      void main() {
        if (vS < uFrom || vS > uTo) discard;
        float edge = abs(vAcross);
        vec3 blue = vec3(0.26, 0.52, 0.96);
        vec3 rim = vec3(0.1, 0.32, 0.75);
        vec3 c = mix(blue, rim, smoothstep(0.72, 0.86, edge));
        float fadeIn = smoothstep(uFrom, uFrom + 4.0, vS);
        float fadeOut = 1.0 - smoothstep(uTo - 6.0, uTo, vS);
        gl_FragColor = vec4(c, uShow * fadeIn * fadeOut);
      }`,
  });
  const route = new THREE.Mesh(mergeGeometries(routeGeos), routeMat);
  route.frustumCulled = false;
  route.renderOrder = 2;
  group.add(route);

  /* ---------- Il pallino blu con il cono della direzione ---------- */
  const dot = new THREE.Group();
  const flat = (geo, color, opacity = 1) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 3;
    return m;
  };
  const halo = flat(new THREE.CircleGeometry(4.2, 40), "#4a8af4", 0.18);
  halo.position.y = 0.2;
  const ring = flat(new THREE.CircleGeometry(1.75, 40), "#ffffff");
  ring.position.y = 0.24;
  const core = flat(new THREE.CircleGeometry(1.35, 40), "#1a73e8");
  core.position.y = 0.26;
  /* Il cono: un ventaglio che sfuma in avanti. */
  const cone = (() => {
    const g = new THREE.BufferGeometry();
    const verts = [0, 0, 0];
    const alpha = [0.55];
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const a = -0.55 + (1.1 * i) / steps;
      verts.push(Math.sin(a) * 9, 0, -Math.cos(a) * 9);
      alpha.push(0);
    }
    const idx = [];
    for (let i = 1; i <= steps; i++) idx.push(0, i + 1, i);
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute("aAlpha", new THREE.Float32BufferAttribute(alpha, 1));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uOpacity: { value: 1 } },
      side: THREE.DoubleSide,
      vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(0.16,0.45,0.95, vA * uOpacity); }`,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = 0.22;
    mesh.renderOrder = 3;
    return mesh;
  })();
  dot.add(halo, cone, ring, core);
  dot.visible = false;
  world.add(dot);

  /* ---------- Gli spilli rossi sui luoghi, col nome ---------- */
  function pinTexture(name) {
    const c = document.createElement("canvas");
    const W = 512;
    const H = 256;
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    g.font = "700 40px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    const tw = Math.min(W - 20, g.measureText(name).width);
    /* Il nome sopra, col bordo bianco come sulle mappe. */
    g.textAlign = "center";
    g.lineJoin = "round";
    g.lineWidth = 9;
    g.strokeStyle = "rgba(255,255,255,0.95)";
    g.strokeText(name, W / 2, 52, W - 20);
    g.fillStyle = "#b3261e";
    g.fillText(name, W / 2, 52, W - 20);
    /* La goccia rossa con il cerchio scuro. */
    const cx = W / 2;
    const top = 76;
    const r = 46;
    g.beginPath();
    g.moveTo(cx, H - 6);
    g.bezierCurveTo(cx - 14, H - 60, cx - r, top + r * 1.25, cx - r, top + r);
    g.arc(cx, top + r, r, Math.PI, 0);
    g.bezierCurveTo(cx + r, top + r * 1.25, cx + 14, H - 60, cx, H - 6);
    g.closePath();
    g.fillStyle = "#ea4335";
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = "#b3261e";
    g.stroke();
    g.beginPath();
    g.arc(cx, top + r, r * 0.38, 0, Math.PI * 2);
    g.fillStyle = "#7a1a14";
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    void tw;
    return t;
  }
  const pins = beats.map((b) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: pinTexture(b.name), transparent: true, depthTest: false, depthWrite: false, toneMapped: false, sizeAttenuation: false }));
    sprite.center.set(0.5, 0);
    sprite.scale.set(0.16, 0.08, 1);
    sprite.position.set(b.place[0], 26, b.place[1]);
    sprite.renderOrder = 10;
    sprite.visible = false;
    world.add(sprite);
    return { b, sprite, k: 0 };
  });

  /* ---------- Il cartello ---------- */
  const banner = makeBanner();
  let lastText = "";

  /* amount: 1 lontano dalle tappe, 0 alle tappe. */
  let amount = 0;
  function update({ s, u, t, dt, pBus, pDir, active, roaming = false }) {
    /* La prossima tappa sulla stessa strada. */
    let next = null;
    for (const b of beats) {
      if (b.u0 > u - 1e-6 && b.s > s - 1) {
        next = b;
        break;
      }
    }
    const leg = legs.find((l) => s >= l.start - 1 && s <= l.end + 1);
    const sameLeg = next && leg && next.s >= leg.start && next.s <= leg.end;
    const prev = [...beats].reverse().find((b) => b.s <= s + 1 && leg && b.s >= leg.start);
    const toNext = sameLeg ? next.s - s : Infinity;
    const fromPrev = prev ? s - prev.s : Infinity;
    const away = Math.min(toNext, fromPrev);
    /* In Esplora si è sempre il pallino blu, come su una mappa. */
    const want = roaming ? 1 : active && leg && away > NEAR_STOP ? 1 : 0;
    amount += (want - amount) * (1 - Math.exp(-dt * 2.5));
    if (Math.abs(want - amount) < 0.002) amount = want;

    dot.visible = amount > 0.02;
    if (dot.visible) {
      dot.position.set(pBus.x, pBus.y, pBus.z);
      dot.rotation.y = Math.atan2(-pDir.x, -pDir.z);
      const k = 0.4 + 0.6 * amount;
      dot.scale.setScalar(k);
      halo.scale.setScalar(1 + 0.25 * Math.sin(t * 2.4));
      halo.material.opacity = 0.18 * amount;
      ring.material.opacity = core.material.opacity = amount;
      cone.material.uniforms.uOpacity.value = amount;
    }
    /* Gli spilli: in Esplora su tutti i luoghi vicini, in viaggio sulla prossima tappa. */
    for (const pin of pins) {
      const dist = Math.hypot(pin.b.place[0] - pBus.x, pin.b.place[1] - pBus.z);
      const on = roaming ? dist < 900 && dist > 25 : !roaming && sameLeg && pin.b === next && amount > 0.5 && dist > 60;
      pin.k += ((on ? 1 : 0) - pin.k) * (1 - Math.exp(-dt * 4));
      pin.sprite.visible = pin.k > 0.02;
      pin.sprite.material.opacity = pin.k;
      const sz = (0.75 + 0.25 * pin.k) * (dist < 200 ? 1 : Math.max(0.6, 1 - (dist - 200) / 1400));
      pin.sprite.scale.set(0.16 * sz, 0.08 * sz, 1);
    }
    if (roaming) {
      routeUniforms.uShow.value = 0;
      banner.el.classList.remove("on");
      return amount;
    }
    routeUniforms.uShow.value = sameLeg ? Math.min(1, amount * 1.6) : 0;
    routeUniforms.uFrom.value = s;
    routeUniforms.uTo.value = sameLeg ? next.s : -1;

    const show = sameLeg && amount > 0.5;
    banner.el.classList.toggle("on", show);
    if (show) {
      const text = `${next.name}|${formatDistance(toNext)}`;
      if (text !== lastText) {
        lastText = text;
        banner.name.textContent = next.name;
        banner.dist.textContent = formatDistance(toNext);
        const mins = Math.max(1, Math.round((toNext / UNITS_PER_KM) * 2.2));
        banner.eta.textContent = `${mins} min`;
      }
    }
    return amount;
  }

  /* Le piante degli isolati e dei parchi, per la cartina 2D. */
  const footprints = {
    blocks: boxes.filter(({ v }) => v[4] === 0).map(({ b, v }) => {
      const c = Math.cos(b.rot);
      const sn = Math.sin(b.rot);
      return { x: b.x + v[0] * c + v[1] * sn, z: b.z - v[0] * sn + v[1] * c, w: v[2], d: v[3], rot: b.rot };
    }),
    parks: parks.map((pk) => ({ x: pk.x, z: pk.z, w: pk.w, d: pk.dd, rot: pk.rot })),
  };

  return { update, group, footprints, get amount() { return amount; } };
}
