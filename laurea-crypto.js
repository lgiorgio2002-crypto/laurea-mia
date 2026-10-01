// Cifratura condivisa da build.js (Node) e dalla pagina (browser).
// Una sola chiave AES-GCM a 128 bit, che viaggia nel QR dopo il "#": il
// browser non invia mai quella parte dell'indirizzo al server.
// Ogni file cifrato è: IV (12 byte) seguito dal ciphertext.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("node:crypto").webcrypto);
  else root.LaureaCrypto = factory(root.crypto);
})(this, function (c) {
  var KEY_BYTES = 16;
  var IV_BYTES = 12;

  function toB64url(u8) {
    var s = "";
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  // Restituisce i byte della chiave, oppure null se la stringa non è una chiave.
  function fromB64url(s) {
    if (typeof s !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(s)) return null;
    var b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "==");
    var u = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u.length === KEY_BYTES ? u : null;
  }

  function newKey() {
    return c.getRandomValues(new Uint8Array(KEY_BYTES));
  }

  function importKey(raw) {
    return c.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  function seal(key, bytes) {
    var iv = c.getRandomValues(new Uint8Array(IV_BYTES));
    return c.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, bytes).then(function (ct) {
      var out = new Uint8Array(IV_BYTES + ct.byteLength);
      out.set(iv, 0);
      out.set(new Uint8Array(ct), IV_BYTES);
      return out;
    });
  }

  // Chiave sbagliata o file manomesso: null, mai un'eccezione.
  function open(key, sealed) {
    if (sealed.length <= IV_BYTES) return Promise.resolve(null);
    return c.subtle
      .decrypt({ name: "AES-GCM", iv: sealed.subarray(0, IV_BYTES) }, key, sealed.subarray(IV_BYTES))
      .then(function (pt) { return new Uint8Array(pt); }, function () { return null; });
  }

  return { toB64url: toB64url, fromB64url: fromB64url, newKey: newKey, importKey: importKey, seal: seal, open: open };
});
