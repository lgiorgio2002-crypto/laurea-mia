// I modelli dei luoghi, fatti in Blender: .gltf con la geometria compressa
// Draco e le texture in models/tex/, condivise fra tutti i modelli così il
// browser ne scarica ognuna una volta sola. Caricati una volta, poi clonati.
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

const draco = new DRACOLoader().setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/");
const loader = new GLTFLoader().setDRACOLoader(draco);
const cache = new Map();

export function loadModel(file) {
  if (!cache.has(file)) cache.set(file, loader.loadAsync(file).then((g) => g.scene));
  return cache.get(file);
}
