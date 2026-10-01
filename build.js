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

(async () => {
  const raw = loadOrCreateKey();
  const key = await LaureaCrypto.importKey(raw);

  const numbers = fs
    .readdirSync(srcDir)
    .filter((f) => /^\d+\.jpeg$/.test(f))
    .map((f) => parseInt(f, 10))
    .sort((a, b) => a - b);

  // I .bin di una build precedente vanno tolti: una foto cancellata non deve restare online.
  for (const f of fs.readdirSync(outDir)) {
    if (/^\d+\.bin$/.test(f)) fs.unlinkSync(path.join(outDir, f));
  }

  for (const n of numbers) {
    const sealed = await LaureaCrypto.seal(key, fs.readFileSync(path.join(srcDir, `${n}.jpeg`)));
    fs.writeFileSync(path.join(outDir, `${n}.bin`), sealed);
  }

  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ photos: numbers }) + "\n");

  console.log(`${numbers.length} foto cifrate in photos/ (prima: ${numbers[0]}, ultima: ${numbers[numbers.length - 1]})`);
  console.log(`URL del QR: ${SITE_URL}#${LaureaCrypto.toB64url(raw)}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
