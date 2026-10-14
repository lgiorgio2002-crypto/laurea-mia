// Uso: node build.js
// Cifra le foto di private/photos/ (mai pubblicate) in photos/N.bin, che sono
// le uniche a finire online, e scrive photos/manifest.json con l'ordine.
// Da rilanciare dopo ogni modifica alle foto.
//
// La chiave sta in secret.key, creata alla prima esecuzione. Dopo la stampa
// del QR non deve cambiare MAI: se andasse persa, si recupera scansionando il
// QR stampato (è la parte dopo il "#").
const fs = require("fs");
const path = require("path");
const LaureaCrypto = require("./laurea-crypto.js");

const SITE_URL = "https://lgiorgio2002-crypto.github.io/laurea-mia/";
const keyFile = path.join(__dirname, "secret.key");
const srcDir = path.join(__dirname, "private", "photos");
const outDir = path.join(__dirname, "photos");

function loadOrCreateKey() {
  if (fs.existsSync(keyFile)) {
    const raw = LaureaCrypto.fromB64url(fs.readFileSync(keyFile, "utf8").trim());
    if (!raw) throw new Error("secret.key non è valida. Non rigenerarla: recupera la chiave dal QR stampato.");
    return raw;
  }
  const raw = LaureaCrypto.newKey();
  fs.writeFileSync(keyFile, LaureaCrypto.toB64url(raw) + "\n");
  console.log("Creata secret.key con una chiave nuova.");
  return raw;
}

// Chi ha la chiave del QR decifra il file così com'è, metadati compresi:
// una foto con EXIF pubblicherebbe a tutti loro GPS, telefono e ora di scatto.
function metadataIn(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return ["non è un JPEG"];
  const found = [];
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = buf.readUInt16BE(i + 2);
    if (marker === 0xe1) {
      const head = buf.subarray(i + 4, i + 4 + 32).toString("latin1");
      if (head.startsWith("Exif")) found.push("EXIF");
      else if (head.includes("ns.adobe.com/xap")) found.push("XMP");
    }
    if (marker === 0xfe) found.push("commento");
    i += 2 + length;
  }
  return found;
}

function sameBytes(a, b) {
  return a && a.length === b.length && Buffer.from(a).equals(b);
}

(async () => {
  const files = fs.readdirSync(srcDir);
  const ignored = files.filter((f) => !/^\d+\.jpeg$/.test(f));
  if (ignored.length) {
    console.log(`Attenzione, ignorati (servono nomi come 32.jpeg, estensione minuscola): ${ignored.join(", ")}`);
  }

  const numbers = files
    .filter((f) => /^\d+\.jpeg$/.test(f))
    .map((f) => parseInt(f, 10))
    .sort((a, b) => a - b);

  const plain = new Map(numbers.map((n) => [n, fs.readFileSync(path.join(srcDir, `${n}.jpeg`))]));

  // Controllo prima di scrivere qualunque cosa: se fallisce, online non cambia nulla.
  const dirty = numbers
    .map((n) => [n, metadataIn(plain.get(n))])
    .filter(([, found]) => found.length);
  if (dirty.length) {
    for (const [n, found] of dirty) console.error(`  ${n}.jpeg contiene: ${found.join(", ")}`);
    throw new Error("Build fermato: togli i metadati da queste foto prima di pubblicarle.");
  }

  const raw = loadOrCreateKey();
  const key = await LaureaCrypto.importKey(raw);

  // I .bin delle foto cancellate vanno tolti: una foto rimossa non deve restare online.
  for (const f of fs.readdirSync(outDir)) {
    const m = /^(\d+)\.bin$/.exec(f);
    if (m && !plain.has(parseInt(m[1], 10))) fs.unlinkSync(path.join(outDir, f));
  }

  // Una foto invariata tiene il suo .bin: ricifrarla darebbe byte diversi
  // (IV nuovo) e git la vedrebbe cambiata a ogni build.
  let written = 0;
  for (const n of numbers) {
    const target = path.join(outDir, `${n}.bin`);
    if (fs.existsSync(target)) {
      const current = await LaureaCrypto.open(key, new Uint8Array(fs.readFileSync(target)));
      if (sameBytes(current, plain.get(n))) continue;
    }
    fs.writeFileSync(target, await LaureaCrypto.seal(key, plain.get(n)));
    written += 1;
  }

  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ photos: numbers }) + "\n");

  console.log(`${numbers.length} foto (dalla ${numbers[0]} alla ${numbers[numbers.length - 1]}): ${written} cifrate ora, ${numbers.length - written} invariate`);
  console.log(`URL del QR: ${SITE_URL}#${LaureaCrypto.toB64url(raw)}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
