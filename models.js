// I modelli dei luoghi, fatti in Blender: .gltf con la geometria compressa
// Draco e le texture in models/tex/, condivise fra tutti i modelli. Caricati
// una volta, poi clonati.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

/* Sul telefono le texture a metà: la memoria grafica è poca, e se finisce il
   browser chiude la pagina senza dire niente. */
const TEX_MAX = window.matchMedia?.("(pointer: coarse)").matches ? 512 : 1024;

/* Una texture per file, per tutti i modelli: GLTFLoader da solo ne crea una
   copia per ogni modello che la usa (416 invece di 69, circa 2 GB). */
const textures = new Map();

async function decode(url) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = url;
  await img.decode();
  const scale = Math.min(1, TEX_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1) return img;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function sharedTexture(url) {
  if (!textures.has(url)) {
    textures.set(
      url,
      decode(url).then((image) => {
        const t = new THREE.Texture(image);
        t.flipY = false;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.needsUpdate = true;
        return t;
      }),
    );
  }
  return textures.get(url);
}

const draco = new DRACOLoader().setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/");
const loader = new GLTFLoader().setDRACOLoader(draco);
/* In testa: il gestore WebP di GLTFLoader risponderebbe prima e farebbe le copie. */
loader.pluginCallbacks.unshift((parser) => ({
  name: "shared_textures",
  loadTexture(index) {
    const def = parser.json.textures[index];
    const source = def.extensions?.EXT_texture_webp?.source ?? def.source;
    const uri = parser.json.images?.[source]?.uri;
    if (!uri || uri.startsWith("data:")) return null;
    return sharedTexture(new URL(uri, new URL(parser.options.path, location.href)).href);
  },
}));

const cache = new Map();

export function loadModel(file) {
  if (!cache.has(file)) cache.set(file, loader.loadAsync(file).then((g) => g.scene));
  return cache.get(file);
}
