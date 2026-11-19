// La cabina fotografica oltre il traguardo. La foto non lascia mai il telefono:
// resta in IndexedDB su questo dispositivo, e con il pulsante di salvataggio
// finisce nel rullino. Nessun upload, e il canvas esportato non ha metadati.
const DB_NAME = "laurea-booth";
const STORE = "photos";
const RECORD = "selfie";
const SHARE = "share";
const PHOTO_W = 1080;
const PHOTO_H = 1350;
const COUNTDOWN_MS = 800;

function withStore(mode, run) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => {
        open.result.close();
        resolve(req.result);
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

const saveBlob = (blob) => withStore("readwrite", (s) => s.put(blob, RECORD));
const loadBlob = () => withStore("readonly", (s) => s.get(RECORD));
const saveShare = (share) => withStore("readwrite", (s) => (share ? s.put(share, SHARE) : s.delete(SHARE)));
const loadShare = () => withStore("readonly", (s) => s.get(SHARE));

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.alt = "La tua foto al traguardo";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

const toJpeg = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));

/* Riempie il formato senza deformare, come fa object-fit: cover. */
function drawCover(ctx, source, sw, sh, dw, dh) {
  const scale = Math.max(dw / sw, dh / sh);
  const w = dw / scale;
  const h = dh / scale;
  ctx.drawImage(source, (sw - w) / 2, (sh - h) / 2, w, h, 0, 0, dw, dh);
}

export function createBooth({ onPhoto, onSkip, wall }) {
  const arrive = document.getElementById("arrive");
  const cameraButton = document.getElementById("cameraButton");
  const skipButton = document.getElementById("skipButton");
  const booth = document.getElementById("booth");
  const video = document.getElementById("boothVideo");
  const shutter = document.getElementById("boothShutter");
  const close = document.getElementById("boothClose");
  const dots = document.getElementById("boothCount");
  const flash = document.getElementById("flash");
  const after = document.getElementById("after");
  const save = document.getElementById("afterSave");
  const retake = document.getElementById("afterRetake");
  const fileInput = document.getElementById("boothFile");
  const sharePanel = document.getElementById("share");
  const shareButton = document.getElementById("shareButton");
  const unshareButton = document.getElementById("unshareButton");

  let stream = null;
  let current = null;
  let arrived = false;
  let shooting = false;
  /* Chi ha scelto di non lasciare una foto non se la vede richiedere. */
  let skipped = false;
  /* share: la foto pubblicata e il gettone per toglierla. stale: quella
     pubblicata non è più l'ultima scattata. */
  let share = null;
  let stale = false;
  let sending = false;

  function stopCamera() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    booth.hidden = true;
    shooting = false;
    dots.dataset.count = "";
  }

  function sync() {
    arrive.hidden = !arrived || !!current || skipped;
    after.hidden = !arrived || !current;
    const live = share && !stale;
    const canPublish = wall?.open && current && !live;
    sharePanel.hidden = !arrived || !wall || !(canPublish || share);
    shareButton.hidden = !canPublish;
    unshareButton.hidden = !share;
    shareButton.disabled = unshareButton.disabled = sending;
  }

  async function publish() {
    if (sending || !wall || !current) return;
    sending = true;
    sync();
    try {
      /* Una persona, una foto: quella nuova prende il posto della vecchia. */
      if (share) await wall.unpublish(share);
      share = await wall.publish(current);
      stale = false;
      await saveShare(share).catch(() => {});
    } catch {
      shareButton.classList.remove("is-wrong");
      void shareButton.offsetWidth;
      shareButton.classList.add("is-wrong");
    }
    sending = false;
    sync();
  }

  async function unpublish() {
    if (sending || !share) return;
    sending = true;
    sync();
    try {
      await wall.unpublish(share);
      share = null;
      stale = false;
      await saveShare(null).catch(() => {});
    } catch {}
    sending = false;
    sync();
  }

  async function finish(canvas) {
    const blob = await toJpeg(canvas);
    current = blob;
    stale = !!share;
    sync();
    const image = await blobToImage(blob);
    onPhoto(image, { celebrate: true });
    /* Se il browser nega lo spazio la festa c'è lo stesso: si perde solo il ritorno. */
    saveBlob(blob).catch(() => {});
  }

  async function openBooth() {
    if (!navigator.mediaDevices?.getUserMedia) {
      fileInput.click();
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1600 } },
        audio: false,
      });
      video.srcObject = stream;
      booth.hidden = false;
      await video.play();
      shutter.focus();
    } catch {
      /* Permesso negato o browser interno di un'app: resta la fotocamera del
         telefono, aperta dal selettore di file. */
      stopCamera();
      fileInput.click();
    }
  }

  async function shoot() {
    if (shooting || !stream) return;
    shooting = true;
    for (const n of [3, 2, 1]) {
      dots.dataset.count = n;
      await new Promise((r) => setTimeout(r, COUNTDOWN_MS));
      if (!stream) return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_W;
    canvas.height = PHOTO_H;
    const ctx = canvas.getContext("2d");
    /* Come nello specchio del mirino. */
    ctx.translate(PHOTO_W, 0);
    ctx.scale(-1, 1);
    drawCover(ctx, video, video.videoWidth, video.videoHeight, PHOTO_W, PHOTO_H);

    flash.classList.remove("is-on");
    void flash.offsetWidth;
    flash.classList.add("is-on");
    stopCamera();
    finish(canvas);
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try {
      const img = await blobToImage(file);
      const canvas = document.createElement("canvas");
      canvas.width = PHOTO_W;
      canvas.height = PHOTO_H;
      drawCover(canvas.getContext("2d"), img, img.naturalWidth, img.naturalHeight, PHOTO_W, PHOTO_H);
      URL.revokeObjectURL(img.src);
      finish(canvas);
    } catch {}
  });

  /* La cartolina: la foto nella sua cornice, pronta per il rullino. */
  async function card() {
    const image = await blobToImage(current);
    const m = 54;
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_W + m * 2;
    canvas.height = PHOTO_H + m + 190;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff8e1";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, m, m, PHOTO_W, PHOTO_H);
    URL.revokeObjectURL(image.src);
    return toJpeg(canvas);
  }

  async function saveCard() {
    if (!current) return;
    const blob = await card();
    const file = new File([blob], "grazie.jpg", { type: "image/jpeg" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }

  cameraButton.addEventListener("click", openBooth);
  skipButton.addEventListener("click", () => {
    skipped = true;
    sync();
    onSkip?.();
  });
  retake.addEventListener("click", openBooth);
  shutter.addEventListener("click", shoot);
  close.addEventListener("click", stopCamera);
  save.addEventListener("click", saveCard);
  shareButton.addEventListener("click", publish);
  unshareButton.addEventListener("click", unpublish);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !booth.hidden) stopCamera();
  });

  /* Chi torna ritrova la sua foto al centro della festa. */
  Promise.all([loadBlob(), loadShare()])
    .then(async ([blob, saved]) => {
      if (saved) {
        share = saved;
        wall?.ignore(saved.id);
      }
      if (!blob) return;
      current = blob;
      sync();
      onPhoto(await blobToImage(blob), { celebrate: false });
    })
    .catch(() => {});

  return {
    setArrived(value) {
      if (value === arrived) return;
      arrived = value;
      sync();
    },
    /* Il muro ha risposto: ora si sa se accetta foto. */
    refresh: sync,
  };
}
