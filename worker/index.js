// Il muro condiviso. Conserva file già cifrati nel telefono con la chiave del
// QR: qui non passa mai né la chiave né una foto in chiaro.
//
// POST   /photos       carica (serve il pass ricavato dal QR), fino a CLOSES_AT
// GET    /photos       elenco
// GET    /photos/:id   il file cifrato
// DELETE /photos/:id   chi l'ha caricata (col suo gettone) o l'amministratore
const MAX_BYTES = 1_500_000;
const MAX_PHOTOS = 300;
const UPLOADS_PER_HOUR = 12;
const ID = /^[0-9]{13}-[a-f0-9]{16}$/;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (text) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
const randomHex = (bytes) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

/* Si confrontano le impronte, così il tempo di risposta non rivela il segreto. */
async function same(a, b) {
  if (!a || !b) return false;
  return (await sha256(a)) === (await sha256(b));
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  const headers = { Vary: "Origin" };
  if (allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

const isOpen = (env) => Date.now() < Date.parse(env.CLOSES_AT);

async function listPhotos(env) {
  const ids = [];
  let cursor;
  do {
    const page = await env.WALL.list({ prefix: "photo:", cursor });
    for (const k of page.keys) ids.push(k.name.slice(6));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return ids;
}

async function rateLimited(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const hour = Math.floor(Date.now() / 3600000);
  /* L'indirizzo non si conserva: solo un'impronta che vale un'ora. */
  const key = `rate:${(await sha256(`${env.UPLOAD_PASS_HASH}:${hour}:${ip}`)).slice(0, 24)}`;
  const used = Number((await env.WALL.get(key)) ?? 0);
  if (used >= UPLOADS_PER_HOUR) return true;
  await env.WALL.put(key, String(used + 1), { expirationTtl: 7200 });
  return false;
}

async function upload(request, env, json) {
  if (!isOpen(env)) return json({ error: "closed" }, 403);

  const pass = (request.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  if ((await sha256(pass)) !== env.UPLOAD_PASS_HASH) return json({ error: "forbidden" }, 403);

  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_BYTES) return json({ error: "too_large" }, 413);
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES || body.byteLength < 1024) return json({ error: "bad_size" }, 413);

  if (await rateLimited(request, env)) return json({ error: "slow_down" }, 429);
  if ((await listPhotos(env)).length >= MAX_PHOTOS) return json({ error: "full" }, 507);

  const id = `${Date.now()}-${randomHex(8)}`;
  const secret = randomHex(16);
  await env.WALL.put(`photo:${id}`, body, { metadata: { secret: await sha256(secret) } });
  return json({ id, secret }, 201);
}

async function remove(request, env, id, json) {
  const { value, metadata } = await env.WALL.getWithMetadata(`photo:${id}`, "arrayBuffer");
  if (!value) return json({ error: "not_found" }, 404);
  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  const owner = metadata?.secret && (await sha256(token)) === metadata.secret;
  if (!owner && !(await same(token, env.ADMIN_TOKEN))) return json({ error: "forbidden" }, 403);
  await env.WALL.delete(`photo:${id}`);
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const { pathname } = new URL(request.url);
    if (pathname === "/photos") {
      if (request.method === "GET") return json({ open: isOpen(env), closesAt: env.CLOSES_AT, photos: await listPhotos(env) });
      if (request.method === "POST") return upload(request, env, json);
    }

    const match = /^\/photos\/([^/]+)$/.exec(pathname);
    if (match && ID.test(match[1])) {
      if (request.method === "DELETE") return remove(request, env, match[1], json);
      if (request.method === "GET") {
        const data = await env.WALL.get(`photo:${match[1]}`, "arrayBuffer");
        if (!data) return json({ error: "not_found" }, 404);
        return new Response(data, { headers: { ...cors, "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } });
      }
    }
    return json({ error: "not_found" }, 404);
  },
};
