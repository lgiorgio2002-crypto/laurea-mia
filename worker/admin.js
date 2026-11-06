// Strumenti per il muro condiviso. Si lanciano dalla cartella del progetto.
//
//   node worker/admin.js pass-hash        impronta del pass da dare al Worker
//   node worker/admin.js download         decifra il muro in private/wall/
//   node worker/admin.js remove <id>      toglie una foto (id = nome del file)
//
// download e remove vogliono WALL_API; remove anche WALL_ADMIN_TOKEN.
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const LaureaCrypto = require("../laurea-crypto.js");

const root = path.join(__dirname, "..");
const raw = LaureaCrypto.fromB64url(fs.readFileSync(path.join(root, "secret.key"), "utf8").trim());
if (!raw) throw new Error("secret.key non è valida.");

/* Lo stesso calcolo della pagina (wall.js): una via sola, dal pass non si
   risale alla chiave. */
const pass = LaureaCrypto.toB64url(createHash("sha256").update("laurea-wall:").update(raw).digest());

const api = () => {
  if (!process.env.WALL_API) throw new Error("Manca WALL_API.");
  return process.env.WALL_API.replace(/\/$/, "");
};

async function download() {
  const key = await LaureaCrypto.importKey(raw);
  const { photos } = await (await fetch(`${api()}/photos`)).json();
  const dir = path.join(root, "private", "wall");
  fs.mkdirSync(dir, { recursive: true });
  let saved = 0;
  for (const id of photos) {
    const res = await fetch(`${api()}/photos/${id}`);
    const plain = await LaureaCrypto.open(key, new Uint8Array(await res.arrayBuffer()));
    if (!plain) {
      console.log(`Illeggibile: ${id}`);
      continue;
    }
    fs.writeFileSync(path.join(dir, `${id}.jpeg`), plain);
    saved += 1;
  }
  console.log(`${saved} foto in private/wall/`);
}

async function remove(id) {
  const res = await fetch(`${api()}/photos/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${process.env.WALL_ADMIN_TOKEN}` },
  });
  console.log(res.ok ? "Tolta." : `Errore ${res.status}`);
}

const [command, arg] = process.argv.slice(2);
(async () => {
  if (command === "pass-hash") process.stdout.write(createHash("sha256").update(pass).digest("hex"));
  else if (command === "download") await download();
  else if (command === "remove" && arg) await remove(arg);
  else console.log("Uso: pass-hash | download | remove <id>");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
