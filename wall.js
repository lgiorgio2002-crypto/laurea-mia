// Il muro condiviso, lato pagina. Le foto si cifrano qui, prima di uscire dal
// telefono, con la stessa chiave del QR: il Worker conserva solo byte illeggibili.
export async function createWall({ api, rawKey, key, onGuest }) {
  const base = api.replace(/\/$/, "");
  const seen = new Set();
  let open = false;
  let busy = false;

  /* Stesso calcolo di worker/admin.js. Solo chi ha il QR può caricare. */
  const salt = new TextEncoder().encode("laurea-wall:");
  const material = new Uint8Array(salt.length + rawKey.length);
  material.set(salt);
  material.set(rawKey, salt.length);
  const pass = window.LaureaCrypto.toB64url(new Uint8Array(await crypto.subtle.digest("SHA-256", material)));

  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch(`${base}/photos`);
      if (!res.ok) return;
      const data = await res.json();
      open = data.open;
      for (const id of data.photos) {
        if (seen.has(id)) continue;
        seen.add(id);
        const file = await fetch(`${base}/photos/${id}`);
        if (!file.ok) continue;
        const plain = await window.LaureaCrypto.open(key, new Uint8Array(await file.arrayBuffer()));
        /* Un file che non si decifra non viene da un QR: si ignora. */
        if (!plain) continue;
        const img = new Image();
        img.alt = "Una foto al traguardo";
        img.src = URL.createObjectURL(new Blob([plain], { type: "image/jpeg" }));
        await img.decode();
        onGuest(img);
      }
    } catch {
    } finally {
      busy = false;
    }
  }

  return {
    refresh,
    get open() {
      return open;
    },
    /* La propria foto sta già al centro: non deve tornare come ospite. */
    ignore(id) {
      seen.add(id);
    },
    async publish(blob) {
      const sealed = await window.LaureaCrypto.seal(key, new Uint8Array(await blob.arrayBuffer()));
      const res = await fetch(`${base}/photos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${pass}`, "Content-Type": "application/octet-stream" },
        body: sealed,
      });
      if (!res.ok) throw new Error(`upload ${res.status}`);
      const share = await res.json();
      seen.add(share.id);
      return share;
    },
    async unpublish({ id, secret }) {
      const res = await fetch(`${base}/photos/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${secret}` } });
      if (!res.ok && res.status !== 404) throw new Error(`delete ${res.status}`);
    },
  };
}
