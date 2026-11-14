// La colonna sonora: un player Spotify invisibile comandato con la sua iFrame
// API. Suona una canzone alla volta (setSong la cambia, a ogni capitolo), tra
// start e end, e arrivati in fondo riparte. Chi non è collegato sente
// l'anteprima di 30 secondi: lì start/end non si applicano.
const PREVIEW_MAX_MS = 31000;

export function createMusic({ container, song, onChange }) {
  let controller = null;
  let unlocked = false;
  let waiters = [];
  let lastPosition = -1;
  let heard = false;
  let current = song;
  /* Chi mette in pausa a mano non si vede ripartire la musica al capitolo dopo. */
  let userPaused = false;
  /* Una canzone appena caricata non è mai partita: "resume" non la avvia. */
  let fresh = true;
  /* Ogni avvio ha il suo numero: quelli vecchi smettono di riprovare. */
  let run = 0;
  const state = { playing: false, everStarted: false, duration: 0 };

  const isPreview = () => state.duration > 0 && state.duration <= PREVIEW_MAX_MS;
  /* Chi non è collegato sente solo anteprime di 30 secondi: un inizio a 0:53
     cadrebbe oltre la fine e la canzone risulterebbe già finita. Lo si scopre
     dalla prima canzone e da lì le altre partono da capo. */
  let previewOnly = false;
  const startAt = (song) => (previewOnly ? 0 : song.start);

  function onUpdate(data) {
    state.duration = data.duration;
    if (isPreview()) previewOnly = true;
    state.playing = !data.isPaused && !data.isBuffering && data.position < data.duration;
    if (state.playing) {
      state.everStarted = true;
      state.everStartedHere = true;
      fresh = false;
    }
    document.documentElement.dataset.music = state.playing ? "playing" : "paused";
    /* "In riproduzione" arriva prima del suono: vale solo se la canzone avanza. */
    if (state.playing && data.position > lastPosition && lastPosition >= 0) {
      heard = true;
      waiters.forEach((go) => go());
      waiters = [];
    }
    lastPosition = state.playing ? data.position : -1;
    onChange({ ...state, preview: isPreview() });

    const end = current.end && !isPreview() ? current.end * 1000 : data.duration;
    const finished = data.duration > 0 && data.position >= end - 400;
    if (state.everStarted && unlocked && finished) {
      if (isPreview()) controller.restart?.();
      else controller.seek(current.start);
    }
  }

  /* Il primo avvio può arrivare prima che il player sia pronto: si riprova
     finché non risponde. */
  function start(attempt = 0, mine = ++run) {
    if (!controller || mine !== run) return;
    if (fresh) controller.play();
    else controller.resume();
    setTimeout(() => {
      /* Un aggiornamento del player non basta: può dire solo "in pausa". */
      if (mine !== run || state.playing || userPaused || attempt >= 8) return;
      /* Una canzone appena cambiata che non è ancora partita va avviata con
         "play": "resume" su di lei non fa niente. */
      if (!state.everStartedHere) fresh = true;
      start(attempt + 1, mine);
    }, 1200);
  }

  window.onSpotifyIframeApiReady = (api) => {
    api.createController(container, { uri: current.uri, width: 300, height: 80 }, (c) => {
      controller = c;
      c.addListener("playback_update", (e) => onUpdate(e.data));
      c.loadUri(current.uri, false, startAt(current));
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
    /* Cambia canzone. Se la musica andava, continua con quella nuova. */
    setSong(next) {
      if (!next || next.uri === current.uri) return;
      current = next;
      document.documentElement.dataset.song = current.uri;
      lastPosition = -1;
      fresh = true;
      /* Quello che il player diceva valeva per la canzone di prima. */
      state.playing = false;
      state.everStartedHere = false;
      state.duration = 0;
      run++;
      if (!controller) return;
      controller.loadUri(current.uri, false, startAt(current));
      /* Il player ci mette un attimo a caricare: "play" subito andrebbe perso. */
      const mine = run;
      if (unlocked && !userPaused) setTimeout(() => start(0, mine), 500);
    },
    /* La musica si è sentita davvero? */
    get heard() {
      return heard;
    },
    /* Si risolve quando la musica si sente davvero, o dopo maxMs: senza Spotify
       il viaggio deve partire lo stesso. */
    whenPlaying(maxMs) {
      return new Promise((go) => {
        waiters.push(go);
        setTimeout(go, maxMs);
      });
    },
    toggle() {
      if (!unlocked) {
        this.unlock();
        return;
      }
      userPaused = state.playing;
      if (state.playing) {
        run++;
        controller?.pause();
      } else start();
    },
  };
}
