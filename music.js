// La colonna sonora: una sola canzone per tutto il viaggio, in un player
// Spotify invisibile comandato con la sua iFrame API. Si suona il pezzo tra
// start e end, e arrivati in fondo si riparte. Chi non è collegato sente
// l'anteprima di 30 secondi: lì start/end non si applicano.
const PREVIEW_MAX_MS = 31000;

export function createMusic({ container, song, onChange }) {
  let controller = null;
  let unlocked = false;
  let heardAt = 0;
  const state = { playing: false, everStarted: false, duration: 0 };

  const isPreview = () => state.duration > 0 && state.duration <= PREVIEW_MAX_MS;

  function onUpdate(data) {
    heardAt = performance.now();
    state.duration = data.duration;
    state.playing = !data.isPaused && !data.isBuffering && data.position < data.duration;
    if (state.playing) state.everStarted = true;
    onChange({ ...state, preview: isPreview() });

    const end = song.end && !isPreview() ? song.end * 1000 : data.duration;
    const finished = data.duration > 0 && data.position >= end - 400;
    if (state.everStarted && unlocked && finished) {
      if (isPreview()) controller.restart?.();
      else controller.seek(song.start);
    }
  }

  /* Il primo avvio può arrivare prima che il player sia pronto: si riprova
     finché non risponde. */
  function start(attempt = 0) {
    if (!controller) return;
    const sentAt = performance.now();
    if (attempt === 0) controller.play();
    else controller.resume();
    setTimeout(() => {
      if (heardAt < sentAt && attempt < 6) start(attempt + 1);
    }, 1200);
  }

  window.onSpotifyIframeApiReady = (api) => {
    api.createController(container, { uri: song.uri, width: 300, height: 152 }, (c) => {
      controller = c;
      c.addListener("playback_update", (e) => onUpdate(e.data));
      c.loadUri(song.uri, false, song.start);
      if (unlocked) start();
    });
  };

  const script = document.createElement("script");
  script.src = "https://open.spotify.com/embed/iframe-api/v1";
  script.async = true;
  document.body.appendChild(script);

  return {
    /* Va chiamata dentro un gesto dell'utente: i browser bloccano il resto. */
    unlock() {
      if (unlocked) return;
      unlocked = true;
      start();
    },
    toggle() {
      if (!unlocked) {
        this.unlock();
        return;
      }
      if (state.playing) controller?.pause();
      else start(1);
    },
  };
}
