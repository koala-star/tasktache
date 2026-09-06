(() => {
  "use strict";

  const appRoot = document.getElementById("app-root");
  const toastRegion = document.getElementById("toast-region");
  const srStatus = document.getElementById("sr-status");
  const PREFERENCES_KEY = "blindify:preferences:v1";
  const PLAYER_COLOURS = ["#a987e5", "#ef9db8", "#67b8d2", "#65b796", "#daa947", "#d58269"];

  const defaultPreferences = {
    volume: 0.78,
    youtubeApiKey: "",
    config: {
      trackCount: "10",
      clipSeconds: 10,
      startMode: "random"
    },
    players: [
      { id: "player-1", name: "Joueur 1", colour: PLAYER_COLOURS[0] },
      { id: "player-2", name: "Joueur 2", colour: PLAYER_COLOURS[1] }
    ]
  };

  const preferences = loadPreferences();
  const state = {
    screen: "home",
    source: null,
    selection: [],
    config: { ...defaultPreferences.config, ...preferences.config },
    players: sanitisePlayers(preferences.players || defaultPreferences.players),
    volume: clamp(Number(preferences.volume ?? defaultPreferences.volume), 0, 1),
    youtubeApiKey: String(preferences.youtubeApiKey || ""),
    youtube: {
      apiOpen: false,
      searchKind: "video",
      query: "",
      results: [],
      loading: false,
      error: "",
      nextPageToken: "",
      requestId: 0,
      playlist: null,
      playlistLoading: false,
      hostTrack: null
    },
    library: {
      query: "",
      results: [],
      loading: false,
      error: "",
      hasSearched: false,
      nextIndex: 0,
      requestId: 0
    },
    preview: {
      audio: null,
      id: null
    },
    game: null
  };

  const playback = {
    audio: null,
    countdownTimer: null,
    countdownDelay: null,
    tickTimer: null,
    endTimer: null,
    startedAt: 0,
    elapsed: 0,
    currentRoundId: null
  };

  const youtubeRuntime = {
    apiPromise: null,
    player: null,
    mount: null,
    playerReady: null
  };

  let youtubeSearchDebounce = null;
  let librarySearchDebounce = null;

  function loadPreferences() {
    try {
      const raw = localStorage.getItem(PREFERENCES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      console.warn("Impossible de lire les préférences Blindify.", error);
      return {};
    }
  }

  function savePreferences() {
    const preferencesToStore = {
      volume: state.volume,
      youtubeApiKey: state.youtubeApiKey,
      config: state.config,
      players: state.players.map(({ id, name, colour }) => ({ id, name, colour }))
    };
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferencesToStore));
    } catch (error) {
      console.warn("Impossible d’enregistrer les préférences Blindify.", error);
    }
  }

  function sanitisePlayers(players) {
    const candidatePlayers = Array.isArray(players) ? players : [];
    const cleaned = candidatePlayers
      .map((player, index) => ({
        id: String(player.id || `player-${index + 1}`),
        name: String(player.name || `Joueur ${index + 1}`).trim().slice(0, 30),
        colour: String(player.colour || PLAYER_COLOURS[index % PLAYER_COLOURS.length]),
        score: 0
      }))
      .filter((player) => player.name);
    return cleaned.length ? cleaned : defaultPreferences.players.map((player) => ({ ...player, score: 0 }));
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function uid(prefix = "id") {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDuration(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return "—";
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${remainder}`;
  }

  function parseIsoDuration(value) {
    const match = String(value || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
    if (!match) return 0;
    return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  }

  function shuffle(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const otherIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[otherIndex]] = [result[otherIndex], result[index]];
    }
    return result;
  }

  function sourceLabel(source) {
    return ({ youtube: "YouTube", local: "Mes fichiers", library: "Bibliothèque" })[source] || "Musique";
  }

  function sourceIcon(source) {
    return ({ youtube: "🎬", local: "💾", library: "🎧" })[source] || "🎵";
  }

  function announce(message) {
    srStatus.textContent = "";
    window.setTimeout(() => {
      srStatus.textContent = message;
    }, 20);
  }

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast${type === "error" ? " toast--error" : type === "success" ? " toast--success" : ""}`;
    toast.innerHTML = `<span>${type === "error" ? "⚠" : type === "success" ? "✓" : "✦"}</span><span>${escapeHTML(message)}</span>`;
    toastRegion.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }

  function friendlyError(area, error) {
    console.warn(`Blindify ${area}:`, error);
    const status = Number(error?.status || 0);
    if (status === 403 || status === 429) return "La limite du fournisseur est atteinte ou l’accès n’est pas autorisé. Réessayez plus tard.";
    if (status === 401) return "La clé fournie n’est pas autorisée. Vérifiez sa configuration puis réessayez.";
    if (status === 404) return "Cet élément n’est plus disponible auprès du fournisseur.";
    if (!navigator.onLine) return "Vous semblez hors ligne. Vérifiez votre connexion puis réessayez.";
    return area === "YouTube"
      ? "La recherche YouTube est momentanément indisponible. Vérifiez votre clé API ou réessayez."
      : "Le catalogue musical est momentanément indisponible. Réessayez dans quelques instants.";
  }

  function currentSourceTracks() {
    return state.selection.filter((track) => track.source === state.source);
  }

  function isTrackSelected(trackId) {
    return state.selection.some((track) => track.id === trackId);
  }

  function findTrack(trackId) {
    return state.selection.find((track) => track.id === trackId) || null;
  }

  function strictPlayableTracks() {
    return state.selection.filter((track) => track.strictPlayable && track.playbackUrl);
  }

  function render() {
    if (state.screen !== "source" || state.source !== "youtube") {
      youtubeRuntime.mount = null;
      youtubeRuntime.player = null;
      youtubeRuntime.playerReady = null;
    }

    const views = {
      home: renderHome,
      source: renderSourceWorkspace,
      setup: renderSetup,
      game: renderGame,
      reveal: renderReveal,
      final: renderFinal
    };
    appRoot.innerHTML = (views[state.screen] || renderHome)();

    if (state.screen === "source" && state.source === "youtube" && state.youtube.hostTrack) {
      window.setTimeout(() => queueYoutubeHost(state.youtube.hostTrack, false), 0);
    }
  }

  function brand() {
    return `<button class="brand" data-action="go-home" aria-label="Retour à l’accueil Blindify">
      <span class="brand-mark" aria-hidden="true">♪</span>
      <span class="brand-word">BLINDIFY</span>
    </button>`;
  }

  function appHeader({ action = "go-home", label = "Accueil" } = {}) {
    return `<header class="app-header">
      ${brand()}
      <div class="header-actions">
        <button class="ghost-button" data-action="${action}"><span aria-hidden="true">←</span><span class="header-label">${escapeHTML(label)}</span></button>
        ${state.selection.length ? `<button class="secondary-button" data-action="open-setup"><span aria-hidden="true">♫</span>${state.selection.length} sélectionné${state.selection.length > 1 ? "s" : ""}</button>` : ""}
      </div>
    </header>`;
  }

  function renderHome() {
    return `<main class="home-screen">
      <header class="home-header">
        ${brand()}
        <div class="header-actions">
          ${state.selection.length ? `<button class="secondary-button" data-action="open-setup">Reprendre la sélection <span aria-hidden="true">→</span></button>` : ""}
        </div>
      </header>
      <section class="home-hero">
        <div>
          <p class="eyebrow">Le blind test musical, repensé</p>
          <h1 class="home-title">Le blind test<br /><em>musical ultime.</em></h1>
          <p class="hero-copy">Créez des manches à votre rythme, rassemblez vos proches et laissez la musique faire le reste.</p>
        </div>
        <div class="hero-note" aria-hidden="true"><div class="hero-note__disc">♪</div></div>
      </section>
      <section aria-labelledby="source-choice-title">
        <div class="section-heading">
          <div><h2 id="source-choice-title">Choisissez votre musique</h2></div>
          <p>Trois façons de jouer, un seul écran.</p>
        </div>
        <div class="source-grid">
          ${sourceCard("youtube", "🎬", "YouTube", "Utilisez vos vidéos ou playlists YouTube avec le lecteur officiel.", "Mode hôte officiel")}
          ${sourceCard("local", "💾", "Mes fichiers", "Jouez vos propres morceaux directement depuis cet appareil.", "100 % local")}
          ${sourceCard("library", "🎧", "Bibliothèque musicale", "Recherchez des morceaux et ajoutez les aperçus disponibles.", "Catalogue & aperçus")}
        </div>
      </section>
      <footer class="home-footer">Conçu pour les soirées, les salons et les grands écrans. Aucun téléchargement de musique.</footer>
    </main>`;
  }

  function sourceCard(source, icon, title, description, tag) {
    return `<button class="source-card source-card--${source}" data-action="choose-source" data-source="${source}">
      <div class="source-card__top"><span class="source-card__icon" aria-hidden="true">${icon}</span><span class="source-card__arrow" aria-hidden="true">→</span></div>
      <h3>${title}</h3><p>${description}</p><span class="source-card__tag">${tag}</span>
    </button>`;
  }

  function renderSourceWorkspace() {
    const sourceContent = state.source === "local" ? renderLocalSource() : state.source === "library" ? renderLibrarySource() : renderYoutubeSource();
    const title = state.source === "local" ? "Mes fichiers" : state.source === "library" ? "Bibliothèque musicale" : "YouTube";
    const subtitle = state.source === "local"
      ? "Vos fichiers restent sur cet appareil : aucune musique n’est envoyée sur un serveur."
      : state.source === "library"
        ? "Recherchez dans le catalogue puis ajoutez uniquement les aperçus proposés par le fournisseur."
        : "Recherchez avec la YouTube Data API et pilotez le lecteur IFrame officiel, sans extraction ni téléchargement.";
    return `<main class="app-shell">
      ${appHeader({ label: "Accueil" })}
      <section class="page-shell">
        <div class="page-intro">
          <div class="page-intro__copy"><p class="eyebrow">Composer la partie</p><h1 class="page-title">${title}</h1><p class="page-subtitle">${subtitle}</p></div>
          <div class="step-indicator"><b>1</b> AJOUTER DES MORCEAUX</div>
        </div>
        <div class="workspace-grid">
          <section class="surface workspace-main">${sourceContent}</section>
          ${renderSelectionPanel()}
        </div>
      </section>
    </main>`;
  }

  function renderSourceHero(icon, tone, title, description) {
    return `<div class="source-hero"><div class="source-orb source-orb--${tone}" aria-hidden="true">${icon}</div><div class="source-hero__content"><h2>${title}</h2><p>${description}</p></div></div>`;
  }

  function renderSelectionPanel() {
    const tracks = state.selection;
    return `<aside class="selection-panel" aria-label="Ma sélection">
      <div class="selection-panel__header"><div><h2>Ma sélection</h2><p class="selection-count">${tracks.length} morceau${tracks.length !== 1 ? "x" : ""}</p></div>${tracks.length ? `<span aria-hidden="true">✦</span>` : ""}</div>
      <div class="selection-list">
        ${tracks.length ? tracks.map((track, index) => `<div class="selection-track">
          <span class="selection-track__number">${String(index + 1).padStart(2, "0")}</span>
          <div class="selection-track__main"><div class="selection-track__title">${escapeHTML(track.title)}</div><div class="selection-track__artist">${escapeHTML(track.artist || sourceLabel(track.source))}</div></div>
          <div class="selection-track__tools">
            <button class="tiny-button" data-action="move-track" data-id="${escapeHTML(track.id)}" data-direction="up" aria-label="Monter ${escapeHTML(track.title)}">↑</button>
            <button class="tiny-button" data-action="move-track" data-id="${escapeHTML(track.id)}" data-direction="down" aria-label="Descendre ${escapeHTML(track.title)}">↓</button>
            <button class="tiny-button tiny-button--danger" data-action="remove-track" data-id="${escapeHTML(track.id)}" aria-label="Supprimer ${escapeHTML(track.title)}">×</button>
          </div>
        </div>`).join("") : `<div class="selection-empty"><div><span class="selection-empty__icon">♫</span>Ajoutez des morceaux pour préparer votre partie.</div></div>`}
      </div>
      <div class="selection-panel__footer">
        ${tracks.length ? `<div class="selection-actions"><button class="ghost-button ghost-button--small" data-action="shuffle-selection">↯ Mélanger</button><button class="ghost-button ghost-button--small ghost-button--danger" data-action="clear-selection">Vider</button></div>` : ""}
        <button class="primary-button" data-action="open-setup" ${tracks.length ? "" : "disabled"}>Configurer la partie <span aria-hidden="true">→</span></button>
      </div>
    </aside>`;
  }

  function renderLocalSource() {
    const localTracks = currentSourceTracks();
    return `${renderSourceHero("💾", "files", "Jouez depuis cet appareil", "Ajoutez plusieurs fichiers ou glissez-les ici. Blindify les lit avec une URL locale et ne les téléverse jamais.")}
      <div class="notice notice--mint"><span class="notice__icon">🔒</span><span><strong>Vos fichiers restent privés.</strong> Après un rechargement de page, le navigateur vous demandera simplement de les sélectionner à nouveau.</span></div>
      <input id="local-file-input" class="sr-only" type="file" multiple accept="audio/*" />
      <div class="drop-zone" id="drop-zone" data-drop-zone="true">
        <div><span class="drop-zone__icon" aria-hidden="true">♪</span><h3>Déposez vos morceaux ici</h3><p>ou choisissez-les depuis votre appareil. Les formats pris en charge par votre navigateur seront proposés.</p><div class="drop-zone__actions"><button class="primary-button" data-action="open-file-dialog">Choisir des fichiers</button></div><p class="format-note">MP3 · WAV · M4A · AAC · OGG · FLAC selon le navigateur</p></div>
      </div>
      ${localTracks.length ? `<section class="file-list"><div class="file-list__header"><h3>${localTracks.length} fichier${localTracks.length > 1 ? "s" : ""} ajouté${localTracks.length > 1 ? "s" : ""}</h3><button class="ghost-button ghost-button--small ghost-button--danger" data-action="clear-local">Tout supprimer</button></div>${localTracks.map((track) => `<div class="file-item"><span class="file-item__icon">♫</span><div><div class="file-item__title">${escapeHTML(track.title)}</div><div class="file-item__meta">${escapeHTML(track.artist || "Artiste inconnu")} · ${formatDuration(track.duration)}</div></div><button class="tiny-button tiny-button--danger" data-action="remove-track" data-id="${escapeHTML(track.id)}" aria-label="Supprimer ${escapeHTML(track.title)}">×</button></div>`).join("")}</section>` : ""}`;
  }

  function renderLibrarySource() {
    const library = state.library;
    return `${renderSourceHero("🎧", "library", "Bibliothèque musicale", "Cherchez un artiste, une chanson, un album ou un genre. Un seul aperçu peut être lu à la fois.")}
      <div class="notice"><span class="notice__icon">ℹ</span><span>Blindify affiche uniquement les aperçus retournés par le fournisseur. Avant un déploiement public, vérifiez que cet usage est couvert dans votre territoire.</span></div>
      <div class="search-bar"><span class="search-bar__icon" aria-hidden="true">⌕</span><input id="library-search" autocomplete="off" value="${escapeHTML(library.query)}" placeholder="Rechercher un artiste ou une chanson" aria-label="Rechercher dans la bibliothèque musicale" /><button class="primary-button" data-action="search-library">Rechercher</button></div>
      ${library.error ? `<div class="error-state">${escapeHTML(library.error)}</div>` : ""}
      ${renderLibraryResults()}`;
  }

  function renderLibraryResults() {
    const library = state.library;
    if (library.loading && !library.results.length) return `<div class="results-meta"><span>Recherche en cours…</span></div>${renderSkeletons()}`;
    if (!library.hasSearched) return `<div class="empty-state"><div><span class="empty-state__icon">✦</span><h3>Votre prochain morceau est à portée de recherche</h3><p>Essayez un titre, un artiste, un album ou même un genre musical.</p></div></div>`;
    if (!library.results.length) return `<div class="empty-state"><div><span class="empty-state__icon">⌕</span><h3>Aucun résultat</h3><p>Essayez une autre orthographe, un artiste ou une requête plus générale.</p></div></div>`;
    return `<div class="results-meta"><span><b>${library.results.length}</b> résultat${library.results.length > 1 ? "s" : ""}${library.loading ? " · chargement…" : ""}</span></div><div class="result-grid">${library.results.map(renderLibraryResultCard).join("")}</div>${library.nextIndex ? `<div style="text-align:center; margin-top:16px;"><button class="ghost-button" data-action="load-more-library" ${library.loading ? "disabled" : ""}>${library.loading ? "Chargement…" : "Afficher plus de résultats"}</button></div>` : ""}`;
  }

  function renderLibraryResultCard(track) {
    const selected = isTrackSelected(track.id);
    const previewing = state.preview.id === track.id;
    return `<article class="track-result">
      <div class="track-result__cover">${track.cover ? `<img src="${escapeHTML(track.cover)}" alt="Pochette de ${escapeHTML(track.title)}" />` : "♫"}</div>
      <div class="track-result__content"><div class="track-result__title">${escapeHTML(track.title)}</div><div class="track-result__artist">${escapeHTML(track.artist || "Artiste inconnu")}</div><div class="track-result__album">${escapeHTML(track.album || "Album non renseigné")}</div><div class="track-result__footer"><span class="track-result__duration">${formatDuration(track.catalogDuration || track.duration)}</span><div class="track-result__buttons">${track.previewUrl ? `<button class="mini-action ${previewing ? "is-active" : ""}" data-action="toggle-preview" data-id="${escapeHTML(track.id)}">${previewing ? "■ Arrêter" : "▶ Aperçu"}</button>` : `<span class="mini-action" title="Aperçu indisponible">Sans aperçu</span>`}<button class="mini-action ${selected ? "is-added" : ""}" data-action="add-library-track" data-id="${escapeHTML(track.id)}" ${selected || !track.previewUrl ? "disabled" : ""}>${selected ? "✓ Ajouté" : "＋ Ajouter"}</button></div></div></div>
    </article>`;
  }

  function renderYoutubeSource() {
    const youtube = state.youtube;
    const keyConfigured = Boolean(state.youtubeApiKey);
    return `${renderSourceHero("🎬", "youtube", "YouTube, en mode hôte", "Recherche et lecture via les APIs officielles YouTube. Aucun téléchargement ni extraction audio.")}
      <div class="notice notice--warning"><span class="notice__icon">⚖</span><span><strong>Lecture YouTube visible.</strong> Le lecteur officiel et son attribution ne peuvent pas être masqués ; les vidéos YouTube sont donc disponibles en préparation / mode hôte, pas dans les manches strictement sans indice sur le même écran.</span></div>
      <section class="api-card"><div class="api-card__header"><div><h3>Recherche YouTube Data API</h3><p>${keyConfigured ? "Clé publique configurée sur cet appareil." : "Configurez une clé publique restreinte par référent pour activer la recherche."}</p></div><button class="ghost-button ghost-button--small" data-action="toggle-youtube-api">${youtube.apiOpen ? "Fermer" : keyConfigured ? "Modifier" : "Configurer"}</button></div>${youtube.apiOpen ? `<div class="api-form"><input id="youtube-api-key" class="text-input" type="password" autocomplete="off" value="${escapeHTML(state.youtubeApiKey)}" placeholder="Clé API publique restreinte par référent" aria-label="Clé publique YouTube Data API" /><button class="primary-button" data-action="save-youtube-api">Enregistrer</button></div><p class="format-note" style="text-align:left; margin-bottom:0;">N’ajoutez jamais une clé serveur ou un secret OAuth dans le navigateur.</p>` : ""}</section>
      ${keyConfigured ? `<div class="tabs" role="tablist"><button class="tab" role="tab" aria-selected="${youtube.searchKind === "video"}" data-action="youtube-kind" data-kind="video">Vidéos</button><button class="tab" role="tab" aria-selected="${youtube.searchKind === "playlist"}" data-action="youtube-kind" data-kind="playlist">Playlists</button></div><div class="search-bar"><span class="search-bar__icon" aria-hidden="true">⌕</span><input id="youtube-search" autocomplete="off" value="${escapeHTML(youtube.query)}" placeholder="Rechercher une ${youtube.searchKind === "video" ? "vidéo musicale" : "playlist"}" aria-label="Rechercher sur YouTube" /><button class="primary-button" data-action="search-youtube">Rechercher</button></div>${youtube.error ? `<div class="error-state">${escapeHTML(youtube.error)}</div>` : ""}${renderYoutubeResults()}` : `<div class="empty-state"><div><span class="empty-state__icon">◌</span><h3>Configurez la recherche officielle</h3><p>Ajoutez une clé API publique limitée à votre domaine pour chercher des vidéos et playlists YouTube sans exposer de secret.</p></div></div>`}
      ${renderYoutubeHost()}`;
  }

  function renderYoutubeResults() {
    const youtube = state.youtube;
    if (youtube.loading && !youtube.results.length) return `<div class="results-meta"><span>Recherche YouTube en cours…</span></div>${renderSkeletons()}`;
    if (!youtube.results.length) return youtube.query ? `<div class="empty-state"><div><span class="empty-state__icon">⌕</span><h3>Aucun résultat</h3><p>Essayez une autre recherche ou vérifiez que votre clé API est bien autorisée.</p></div></div>` : "";
    return `<div class="results-meta"><span><b>${youtube.results.length}</b> résultat${youtube.results.length > 1 ? "s" : ""}${youtube.loading ? " · chargement…" : ""}</span>${youtube.nextPageToken ? `<button class="ghost-button ghost-button--small" data-action="load-more-youtube">Plus de résultats</button>` : ""}</div><div class="result-grid">${youtube.results.map(renderYoutubeResultCard).join("")}</div>${youtube.playlist ? renderPlaylistDetails() : ""}`;
  }

  function renderYoutubeResultCard(track) {
    const selected = isTrackSelected(track.id);
    const playlist = track.kind === "playlist";
    return `<article class="track-result"><div class="track-result__cover">${track.cover ? `<img src="${escapeHTML(track.cover)}" alt="Miniature de ${escapeHTML(track.title)}" />` : "▶"}</div><div class="track-result__content"><div class="track-result__title">${escapeHTML(track.title)}</div><div class="track-result__artist">${escapeHTML(track.artist || (playlist ? "Playlist YouTube" : "YouTube"))}</div><div class="track-result__album">${playlist ? "Playlist" : track.duration ? `Durée ${formatDuration(track.duration)}` : "Vidéo YouTube"}</div><div class="track-result__footer"><span class="track-result__duration">${playlist ? "playlist" : formatDuration(track.duration)}</span><div class="track-result__buttons">${playlist ? `<button class="mini-action" data-action="open-playlist" data-id="${escapeHTML(track.id)}">Voir les morceaux</button>` : `<button class="mini-action" data-action="youtube-host-track" data-id="${escapeHTML(track.id)}">▶ Tester</button>`}<button class="mini-action ${selected ? "is-added" : ""}" data-action="add-youtube-track" data-id="${escapeHTML(track.id)}" ${selected || playlist ? "disabled" : ""}>${selected ? "✓ Ajouté" : playlist ? "Playlist" : "＋ Ajouter"}</button></div></div></div></article>`;
  }

  function renderPlaylistDetails() {
    const playlist = state.youtube.playlist;
    if (state.youtube.playlistLoading) return `<div class="playlist-details"><div class="playlist-details__header"><h3>Chargement de la playlist…</h3></div>${renderSkeletons()}</div>`;
    return `<div class="playlist-details"><div class="playlist-details__header"><div><h3>${escapeHTML(playlist.title)}</h3><p class="selection-count">${playlist.items.length} morceau${playlist.items.length > 1 ? "x" : ""} récupéré${playlist.items.length > 1 ? "s" : ""}</p></div><button class="secondary-button secondary-button--small" data-action="add-playlist">＋ Tout ajouter</button></div><div class="playlist-list">${playlist.items.map((track) => `<div class="playlist-row"><span class="playlist-row__name">${escapeHTML(track.title)}</span><div class="track-result__buttons"><button class="mini-action" data-action="youtube-host-playlist-track" data-id="${escapeHTML(track.id)}">▶</button><button class="mini-action ${isTrackSelected(track.id) ? "is-added" : ""}" data-action="add-playlist-track" data-id="${escapeHTML(track.id)}" ${isTrackSelected(track.id) ? "disabled" : ""}>${isTrackSelected(track.id) ? "✓" : "＋"}</button></div></div>`).join("")}</div></div>`;
  }

  function renderYoutubeHost() {
    const track = state.youtube.hostTrack;
    if (!track) return "";
    return `<section class="youtube-host"><div class="youtube-host__header"><div><h3>Lecteur YouTube officiel — écran hôte</h3><p>La vidéo et l’attribution restent visibles conformément aux règles YouTube. Le segment testé utilise le début et la durée choisis pour votre partie.</p></div><button class="tiny-button tiny-button--danger" data-action="close-youtube-host" aria-label="Fermer le lecteur">×</button></div><div class="youtube-player-frame"><div id="yt-player" title="Lecteur YouTube officiel"></div></div><div class="youtube-host__controls"><button class="secondary-button secondary-button--small" data-action="youtube-host-play">▶ Lire le segment</button><button class="ghost-button ghost-button--small" data-action="youtube-host-pause">Ⅱ Pause</button><button class="ghost-button ghost-button--small" data-action="youtube-host-stop">■ Arrêter</button></div></section>`;
  }

  function renderSkeletons() {
    return `<div class="skeleton-grid"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>`;
  }

  function renderSetup() {
    const strictTracks = strictPlayableTracks();
    const youtubeCount = state.selection.filter((track) => track.source === "youtube").length;
    const randomAvailable = strictTracks.some((track) => track.randomStart && track.duration > state.config.clipSeconds + 5);
    const config = state.config;
    return `<main class="app-shell"><header class="app-header">${brand()}<div class="header-actions"><button class="ghost-button" data-action="back-to-source">← <span class="header-label">Modifier la sélection</span></button></div></header><section class="page-shell"><div class="page-intro"><div class="page-intro__copy"><p class="eyebrow">À vous de jouer</p><h1 class="config-title">Réglez la partie.</h1><p class="page-subtitle">Les manches ne révèlent aucune information sur le morceau avant le bouton de révélation.</p></div><div class="step-indicator"><b>2</b> CONFIGURER</div></div><div class="config-layout"><div><section class="config-card"><div class="config-section"><h3>Nombre de morceaux</h3><p>Blindify évite automatiquement tout doublon.</p><div class="chip-row">${["5", "10", "15", "20", "all"].map((count) => `<button class="chip ${String(config.trackCount) === count ? "is-active" : ""}" data-action="set-track-count" data-value="${count}">${count === "all" ? "Tous" : count}</button>`).join("")}</div></div><div class="config-section"><h3>Durée de l’extrait</h3><p>Les aperçus plus courts sont ajustés automatiquement.</p><div class="chip-row">${[5, 10, 15, 20, 30].map((seconds) => `<button class="chip ${Number(config.clipSeconds) === seconds ? "is-active" : ""}" data-action="set-clip-seconds" data-value="${seconds}">${seconds} s</button>`).join("")}</div></div><div class="config-section"><h3>Mode de début</h3><p>Le hasard n’est proposé que lorsque la source permet une position fiable.</p><div class="chip-row"><button class="chip chip--wide ${config.startMode === "start" ? "is-active" : ""}" data-action="set-start-mode" data-value="start">Début du morceau</button><button class="chip chip--wide ${config.startMode === "random" ? "is-active" : ""}" data-action="set-start-mode" data-value="random" ${randomAvailable ? "" : "disabled"}>Position aléatoire</button></div>${!randomAvailable ? `<div class="config-note"><span>ℹ</span><span>Les morceaux sélectionnés ne permettent pas de point de départ aléatoire assez long.</span></div>` : ""}</div><div class="config-section"><h3>Qui joue ?</h3><p>Attribuez les points à chaque manche. Les prénoms restent enregistrés sur cet appareil.</p><div class="players-list">${state.players.map((player) => `<span class="player-chip"><i class="player-dot" style="--dot:${escapeHTML(player.colour)}"></i>${escapeHTML(player.name)}<button data-action="remove-player" data-id="${escapeHTML(player.id)}" aria-label="Retirer ${escapeHTML(player.name)}">×</button></span>`).join("")}</div><div class="player-add"><input id="new-player-name" class="text-input" maxlength="30" autocomplete="off" placeholder="Ajouter un joueur" aria-label="Nom d’un joueur" /><button class="secondary-button" data-action="add-player">Ajouter</button></div></div></section></div><aside class="config-card setup-summary">${renderSetupSummary(strictTracks, youtubeCount)}</aside></div></section></main>`;
  }

  function renderSetupSummary(strictTracks, youtubeCount) {
    const displayedCount = state.config.trackCount === "all" ? strictTracks.length : Math.min(Number(state.config.trackCount), strictTracks.length);
    return `<div class="summary-top"><div class="summary-orb">♫</div><div><h3>Prête à lancer</h3><p>${strictTracks.length} morceau${strictTracks.length !== 1 ? "x" : ""} compatible${strictTracks.length !== 1 ? "s" : ""} avec le mode aveugle</p></div></div>${youtubeCount ? `<div class="notice notice--warning" style="margin:17px 0 0; font-size:.75rem;"><span>⚖</span><span>${youtubeCount} vidéo${youtubeCount > 1 ? "s" : ""} YouTube reste${youtubeCount > 1 ? "nt" : ""} disponible${youtubeCount > 1 ? "s" : ""} en mode hôte, mais n’entre${youtubeCount > 1 ? "nt" : ""} pas dans la partie sans spoiler.</span></div>` : ""}<div class="summary-stats"><div class="summary-stat"><b>${displayedCount || 0}</b><span>manche${displayedCount !== 1 ? "s" : ""}</span></div><div class="summary-stat"><b>${state.config.clipSeconds}s</b><span>par extrait</span></div></div><div class="summary-track-list">${strictTracks.length ? strictTracks.map((track, index) => `<div class="summary-track"><span class="summary-track__n">${String(index + 1).padStart(2, "0")}</span><span class="summary-track__text">${escapeHTML(track.title)} — ${escapeHTML(track.artist || sourceLabel(track.source))}</span></div>`).join("") : `<div class="empty-state" style="min-height:150px;"><div><span class="empty-state__icon">♫</span><h3>Encore un morceau</h3><p>Ajoutez un fichier local ou un aperçu de la bibliothèque pour démarrer.</p></div></div>`}</div><div class="summary-footer"><button class="primary-button" data-action="start-game" ${strictTracks.length ? "" : "disabled"}>Démarrer la partie <span aria-hidden="true">→</span></button></div>`;
  }

  function renderGame() {
    const game = state.game;
    if (!game) return renderHome();
    const roundNumber = game.roundIndex + 1;
    const phaseContent = game.phase === "countdown" ? renderCountdown(game) : game.phase === "answer" ? renderAnswerPrompt() : renderListening(game);
    return `<main class="game-shell"><div class="game-topbar">${brand()}<div class="round-label"><span class="round-label__pill">MANCHE ${String(roundNumber).padStart(2, "0")} / ${String(game.rounds.length).padStart(2, "0")}</span><span>●</span></div></div><section class="game-card"><div class="game-card__eyebrow">BLINDIFY · ÉCOUTEZ BIEN</div>${phaseContent}</section></main>`;
  }

  function renderCountdown(game) {
    const count = game.countdown === 0 ? "♪" : game.countdown;
    return `<div class="game-listening"><div><div class="listening-art"><span aria-hidden="true">♫</span></div><div class="countdown-number" aria-live="assertive">${count}</div><p class="countdown-caption">Préparez-vous… l’extrait arrive.</p></div></div>`;
  }

  function renderListening(game) {
    const duration = getCurrentRound()?.clipLength || state.config.clipSeconds;
    const remaining = game.remaining ?? duration;
    const progress = clamp(((duration - remaining) / Math.max(duration, 1)) * 100, 0, 100);
    return `<div class="game-listening"><div style="width:100%;"><div class="listening-art is-playing"><span aria-hidden="true">♫</span></div><h1 class="listen-title">Écoutez…</h1><div class="timer" data-game-timer>${formatDuration(remaining)}</div><div class="progress-track" aria-label="Progression de l’extrait"><span data-game-progress style="width:${progress}%"></span></div><div class="host-controls"><button class="play-control" data-action="toggle-game-pause" aria-label="${game.paused ? "Reprendre" : "Mettre en pause"}">${game.paused ? "▶" : "Ⅱ"}</button><button class="icon-button" data-action="stop-game-track" aria-label="Arrêter l’extrait">■</button><label class="volume-control" title="Volume"><span aria-hidden="true">◌</span><input data-action="set-volume" type="range" min="0" max="100" value="${Math.round(state.volume * 100)}" aria-label="Volume" /></label></div>${game.needsInteraction ? `<div class="autoplay-help">Le navigateur attend un geste pour lancer le son.<br /><button class="secondary-button secondary-button--small" style="margin-top:9px;" data-action="start-extract">▶ Lancer l’extrait</button></div>` : ""}</div></div>`;
  }

  function renderAnswerPrompt() {
    return `<div class="answer-prompt"><div><div class="answer-prompt__spark" aria-hidden="true">✦</div><h1>Vous avez trouvé ?</h1><p>Notez mentalement vos réponses, puis découvrez le morceau ensemble.</p><button class="primary-button primary-button--wide" data-action="reveal-answer">👀 Révéler la réponse</button></div></div>`;
  }

  function renderReveal() {
    const game = state.game;
    const round = getCurrentRound();
    if (!game || !round) return renderHome();
    const track = round.track;
    const leaderboard = getLeaderboard(true);
    return `<main class="reveal-shell"><div class="game-topbar">${brand()}<div class="round-label"><span class="round-label__pill">MANCHE ${String(game.roundIndex + 1).padStart(2, "0")} / ${String(game.rounds.length).padStart(2, "0")}</span></div></div><section class="reveal-card"><span class="reveal-card__label">🎉 RÉPONSE</span><div class="reveal-main"><div class="reveal-cover">${track.cover ? `<img src="${escapeHTML(track.cover)}" alt="Pochette de ${escapeHTML(track.title)}" />` : "♫"}</div><div><p class="reveal-kicker">${escapeHTML(sourceLabel(track.source))}</p><h1 class="reveal-title">${escapeHTML(track.title)}</h1><p class="reveal-artist">${escapeHTML(track.artist || "Artiste non renseigné")}</p>${track.album ? `<p class="reveal-album">${escapeHTML(track.album)}</p>` : ""}<div class="reveal-pills"><span class="reveal-pill">${formatDuration(round.clipLength)} écoutées</span><span class="reveal-pill">${round.startAt > 0 ? "Extrait aléatoire" : "Début du morceau"}</span></div></div></div><div class="score-area"><div><h3>Qui a trouvé ?</h3><p class="score-area__help">Attribuez 1 point pour le titre, 1 pour l’artiste, 2 pour les deux.</p>${state.players.map((player) => renderScoreRow(player, game.scoreDraft[player.id] ?? 0)).join("")}</div><aside class="live-leaderboard"><div class="live-leaderboard__title"><span>Classement en direct</span><span>🏆</span></div>${leaderboard.map((player, index) => `<div class="leader-row"><span class="leader-row__name">${index < 3 ? ["🥇", "🥈", "🥉"][index] : `${index + 1}.`} ${escapeHTML(player.name)}</span><span class="leader-row__score">${player.score} pt${player.score !== 1 ? "s" : ""}</span></div>`).join("")}</aside></div><div class="reveal-actions"><button class="ghost-button" data-action="back-to-answer">← Retour</button><button class="primary-button" data-action="next-round">${game.roundIndex + 1 >= game.rounds.length ? "Voir le classement final" : "Manche suivante →"}</button></div></section></main>`;
  }

  function renderScoreRow(player, score) {
    const options = [{ value: 0, label: "Aucun" }, { value: 1, label: "Titre" }, { value: "artist", label: "Artiste" }, { value: 2, label: "Les deux" }];
    return `<div class="score-row"><div class="score-row__name"><i class="player-dot" style="--dot:${escapeHTML(player.colour)}"></i>${escapeHTML(player.name)}</div><div class="answer-options">${options.map((option) => {
      const numeric = option.value === "artist" ? 1 : Number(option.value);
      const artistSelected = option.value === "artist" && score === 1 && state.game.scoreDraft?.[`${player.id}:kind`] === "artist";
      const titleSelected = option.value === 1 && score === 1 && state.game.scoreDraft?.[`${player.id}:kind`] !== "artist";
      const active = option.value === "artist" ? artistSelected : option.value === 1 ? titleSelected : score === numeric;
      return `<button class="answer-option ${active ? "is-active" : ""}" data-action="set-player-score" data-id="${escapeHTML(player.id)}" data-score="${numeric}" data-kind="${option.value === "artist" ? "artist" : option.value === 1 ? "title" : ""}">${option.label}</button>`;
    }).join("")}</div><span class="score-row__points">+${score}</span></div>`;
  }

  function renderFinal() {
    const ranking = getLeaderboard(false);
    const podiumOrder = [ranking[1], ranking[0], ranking[2]].filter(Boolean);
    const classForIndex = ["2", "1", "3"];
    const medals = ["🥈", "🥇", "🥉"];
    return `<main class="final-shell"><section class="final-card"><div class="victory-mark">🏆</div><p class="eyebrow" style="justify-content:center;">Partie terminée</p><h1 class="final-title">Classement final</h1><p class="final-subtitle">${state.game?.rounds.length || 0} morceau${(state.game?.rounds.length || 0) !== 1 ? "x" : ""} · quel beau tour de piste.</p>${ranking.length ? `<div class="podium">${podiumOrder.map((player, index) => `<div class="podium-place podium-place--${classForIndex[index]}"><span class="podium-medal">${medals[index]}</span><span class="podium-name">${escapeHTML(player.name)}</span><span class="podium-score">${player.score} pt${player.score !== 1 ? "s" : ""}</span></div>`).join("")}</div><div class="final-list">${ranking.map((player, index) => `<div class="final-row"><span class="final-row__rank">${String(index + 1).padStart(2, "0")}</span><span class="final-row__name">${escapeHTML(player.name)}</span><span class="final-row__score">${player.score} point${player.score !== 1 ? "s" : ""}</span></div>`).join("")}</div>` : ""}<div class="final-actions"><button class="ghost-button" data-action="go-home">Nouvelle sélection</button><button class="primary-button" data-action="play-again">↻ Rejouer avec ces morceaux</button></div></section></main>`;
  }

  function getLeaderboard(includeDraft) {
    const draft = includeDraft && state.game?.scoreDraft ? state.game.scoreDraft : {};
    return state.players
      .map((player) => ({ ...player, score: Number(player.score || 0) + Number(draft[player.id] || 0) }))
      .sort((first, second) => second.score - first.score || first.name.localeCompare(second.name, "fr"));
  }

  function addTrack(track, { silent = false } = {}) {
    if (!track || !track.id) return false;
    if (isTrackSelected(track.id)) {
      if (!silent) showToast("Ce morceau est déjà dans votre sélection.");
      return false;
    }
    state.selection.push(track);
    if (!silent) {
      showToast(`« ${track.title} » a été ajouté.`, "success");
      announce(`${track.title} ajouté à la sélection`);
    }
    return true;
  }

  function removeTrack(trackId) {
    const index = state.selection.findIndex((track) => track.id === trackId);
    if (index < 0) return;
    const [track] = state.selection.splice(index, 1);
    if (track.source === "local" && track.playbackUrl) {
      try { URL.revokeObjectURL(track.playbackUrl); } catch (_) { /* URL already invalid */ }
    }
    if (state.preview.id === trackId) stopPreview();
    if (state.youtube.hostTrack?.id === trackId) state.youtube.hostTrack = null;
    showToast("Morceau retiré de la sélection.");
    render();
  }

  function clearSelection(filterSource = null) {
    const toRemove = state.selection.filter((track) => !filterSource || track.source === filterSource);
    toRemove.forEach((track) => {
      if (track.source === "local" && track.playbackUrl) {
        try { URL.revokeObjectURL(track.playbackUrl); } catch (_) { /* no-op */ }
      }
    });
    state.selection = state.selection.filter((track) => filterSource && track.source !== filterSource);
    if (!filterSource) state.youtube.hostTrack = null;
    stopPreview();
    showToast(filterSource ? "Les fichiers ont été retirés." : "La sélection a été vidée.");
    render();
  }

  function moveTrack(trackId, direction) {
    const index = state.selection.findIndex((track) => track.id === trackId);
    const offset = direction === "up" ? -1 : 1;
    const target = index + offset;
    if (index < 0 || target < 0 || target >= state.selection.length) return;
    [state.selection[index], state.selection[target]] = [state.selection[target], state.selection[index]];
    render();
  }

  function shuffleSelection() {
    state.selection = shuffle(state.selection);
    showToast("L’ordre de la sélection a été mélangé.", "success");
    render();
  }

  function parseFilename(filename) {
    const clean = String(filename || "").replace(/\.[^.]+$/, "").replace(/[._]+/g, " ").trim();
    const parts = clean.split(/\s+-\s+/);
    if (parts.length >= 2) {
      return { artist: parts.shift().trim(), title: parts.join(" — ").trim() };
    }
    return { artist: "", title: clean || "Morceau sans titre" };
  }

  async function addLocalFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const acceptedExtensions = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
    let added = 0;
    let rejected = 0;
    for (const file of files) {
      if (!file.type.startsWith("audio/") && !acceptedExtensions.test(file.name)) {
        rejected += 1;
        continue;
      }
      const localFingerprint = `${file.name}:${file.size}:${file.lastModified}`;
      if (state.selection.some((track) => track.localFingerprint === localFingerprint)) {
        rejected += 1;
        continue;
      }
      const fallback = parseFilename(file.name);
      const objectUrl = URL.createObjectURL(file);
      try {
        const [metadata, duration] = await Promise.all([readAudioMetadata(file), getAudioDuration(objectUrl)]);
        if (duration && duration < 1) {
          URL.revokeObjectURL(objectUrl);
          rejected += 1;
          continue;
        }
        const track = {
          id: `local:${uid("track")}`,
          source: "local",
          title: metadata.title || fallback.title,
          artist: metadata.artist || fallback.artist,
          album: metadata.album || "",
          cover: "",
          duration: Number.isFinite(duration) ? duration : 0,
          playbackUrl: objectUrl,
          randomStart: true,
          strictPlayable: true,
          fileName: file.name,
          localFingerprint
        };
        if (addTrack(track, { silent: true })) added += 1;
        else URL.revokeObjectURL(objectUrl);
      } catch (error) {
        console.warn("Fichier audio ignoré", error);
        URL.revokeObjectURL(objectUrl);
        rejected += 1;
      }
    }
    const input = document.getElementById("local-file-input");
    if (input) input.value = "";
    if (added) showToast(`${added} morceau${added > 1 ? "x" : ""} ajouté${added > 1 ? "s" : ""} à votre sélection.`, "success");
    if (rejected) showToast(`${rejected} fichier${rejected > 1 ? "s" : ""} n’a pas pu être lu.`, "error");
    render();
  }

  function getAudioDuration(url) {
    return new Promise((resolve) => {
      const audio = document.createElement("audio");
      let settled = false;
      const finish = (duration) => {
        if (settled) return;
        settled = true;
        audio.removeAttribute("src");
        resolve(Number.isFinite(duration) ? duration : 0);
      };
      const timeout = window.setTimeout(() => finish(0), 5000);
      audio.preload = "metadata";
      audio.onloadedmetadata = () => { window.clearTimeout(timeout); finish(audio.duration); };
      audio.onerror = () => { window.clearTimeout(timeout); finish(0); };
      audio.src = url;
    });
  }

  async function readAudioMetadata(file) {
    const blank = { title: "", artist: "", album: "" };
    if (!/\.mp3$/i.test(file.name) && file.type !== "audio/mpeg") return blank;
    try {
      const head = new Uint8Array(await file.slice(0, Math.min(file.size, 196608)).arrayBuffer());
      const result = parseId3v2(head);
      if (result.title || result.artist || result.album) return result;
      if (file.size >= 128) {
        const tail = new Uint8Array(await file.slice(-128).arrayBuffer());
        return parseId3v1(tail);
      }
      return blank;
    } catch (error) {
      console.warn("Métadonnées ID3 non disponibles", error);
      return blank;
    }
  }

  function parseId3v2(bytes) {
    const blank = { title: "", artist: "", album: "" };
    if (bytes.length < 10 || String.fromCharCode(...bytes.slice(0, 3)) !== "ID3") return blank;
    const version = bytes[3];
    const tagSize = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    const end = Math.min(bytes.length, 10 + tagSize);
    const values = { ...blank };
    let position = 10;
    while (position + 10 <= end) {
      const frameId = String.fromCharCode(...bytes.slice(position, position + 4));
      if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
      const sizeBytes = bytes.slice(position + 4, position + 8);
      const frameSize = version === 4
        ? ((sizeBytes[0] & 0x7f) << 21) | ((sizeBytes[1] & 0x7f) << 14) | ((sizeBytes[2] & 0x7f) << 7) | (sizeBytes[3] & 0x7f)
        : ((sizeBytes[0] << 24) >>> 0) | (sizeBytes[1] << 16) | (sizeBytes[2] << 8) | sizeBytes[3];
      if (!frameSize || position + 10 + frameSize > end) break;
      if (["TIT2", "TPE1", "TALB"].includes(frameId)) {
        const value = decodeId3Text(bytes.slice(position + 10, position + 10 + frameSize));
        if (frameId === "TIT2") values.title = value;
        if (frameId === "TPE1") values.artist = value;
        if (frameId === "TALB") values.album = value;
      }
      position += 10 + frameSize;
    }
    return values;
  }

  function parseId3v1(bytes) {
    const blank = { title: "", artist: "", album: "" };
    if (bytes.length !== 128 || String.fromCharCode(...bytes.slice(0, 3)) !== "TAG") return blank;
    const decode = (start, end) => new TextDecoder("windows-1252").decode(bytes.slice(start, end)).replace(/\0/g, "").trim();
    return { title: decode(3, 33), artist: decode(33, 63), album: decode(63, 93) };
  }

  function decodeId3Text(bytes) {
    if (!bytes?.length) return "";
    const encoding = bytes[0];
    const body = bytes.slice(1);
    try {
      if (encoding === 1 || encoding === 2) return new TextDecoder("utf-16").decode(body).replace(/\0/g, "").trim();
      if (encoding === 3) return new TextDecoder("utf-8").decode(body).replace(/\0/g, "").trim();
      return new TextDecoder("windows-1252").decode(body).replace(/\0/g, "").trim();
    } catch (_) {
      return "";
    }
  }

  async function youtubeSearch(append = false) {
    const query = state.youtube.query.trim();
    if (!state.youtubeApiKey) {
      state.youtube.error = "Ajoutez d’abord une clé API publique pour rechercher sur YouTube.";
      render();
      return;
    }
    if (!query) {
      state.youtube.error = "Saisissez une recherche pour continuer.";
      render();
      return;
    }
    const requestId = ++state.youtube.requestId;
    state.youtube.loading = true;
    state.youtube.error = "";
    if (!append) {
      state.youtube.results = [];
      state.youtube.nextPageToken = "";
      state.youtube.playlist = null;
    }
    render();
    try {
      const parameters = new URLSearchParams({
        part: "snippet",
        q: query,
        type: state.youtube.searchKind,
        maxResults: "12",
        key: state.youtubeApiKey
      });
      if (append && state.youtube.nextPageToken) parameters.set("pageToken", state.youtube.nextPageToken);
      if (state.youtube.searchKind === "video") {
        parameters.set("videoEmbeddable", "true");
        parameters.set("videoCategoryId", "10");
      }
      const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${parameters.toString()}`);
      if (!response.ok) {
        const error = new Error("YouTube API error");
        error.status = response.status;
        throw error;
      }
      const payload = await response.json();
      if (requestId !== state.youtube.requestId) return;
      let results = (payload.items || []).map((item) => {
        const playlist = state.youtube.searchKind === "playlist";
        const providerId = playlist ? item.id?.playlistId : item.id?.videoId;
        return {
          id: `youtube:${providerId}`,
          source: "youtube",
          kind: playlist ? "playlist" : "video",
          providerId,
          title: item.snippet?.title || "Vidéo sans titre",
          artist: item.snippet?.channelTitle || "YouTube",
          album: "",
          cover: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || "",
          duration: 0,
          playbackUrl: "",
          randomStart: true,
          strictPlayable: false
        };
      }).filter((item) => item.providerId);
      if (state.youtube.searchKind === "video" && results.length) {
        const durations = await fetchYoutubeDurations(results.map((item) => item.providerId));
        results = results.map((item) => ({ ...item, duration: durations[item.providerId] || 0 }));
      }
      if (requestId !== state.youtube.requestId) return;
      state.youtube.results = append ? [...state.youtube.results, ...results] : results;
      state.youtube.nextPageToken = payload.nextPageToken || "";
      state.youtube.loading = false;
      render();
    } catch (error) {
      if (requestId !== state.youtube.requestId) return;
      state.youtube.loading = false;
      state.youtube.error = friendlyError("YouTube", error);
      render();
    }
  }

  async function fetchYoutubeDurations(videoIds) {
    if (!videoIds.length) return {};
    const parameters = new URLSearchParams({ part: "contentDetails", id: videoIds.join(","), key: state.youtubeApiKey });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${parameters.toString()}`);
    if (!response.ok) {
      const error = new Error("YouTube duration error");
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    return Object.fromEntries((payload.items || []).map((item) => [item.id, parseIsoDuration(item.contentDetails?.duration)]));
  }

  async function openYoutubePlaylist(trackId) {
    const result = state.youtube.results.find((track) => track.id === trackId);
    if (!result) return;
    state.youtube.playlistLoading = true;
    state.youtube.playlist = { id: result.providerId, title: result.title, items: [] };
    render();
    try {
      const params = new URLSearchParams({ part: "snippet,contentDetails", playlistId: result.providerId, maxResults: "50", key: state.youtubeApiKey });
      const response = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params.toString()}`);
      if (!response.ok) {
        const error = new Error("Playlist API error");
        error.status = response.status;
        throw error;
      }
      const payload = await response.json();
      let items = (payload.items || []).map((item) => {
        const videoId = item.contentDetails?.videoId;
        return {
          id: `youtube:${videoId}`,
          source: "youtube",
          kind: "video",
          providerId: videoId,
          title: item.snippet?.title || "Vidéo sans titre",
          artist: item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || "YouTube",
          album: result.title,
          cover: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || "",
          duration: 0,
          playbackUrl: "",
          randomStart: true,
          strictPlayable: false
        };
      }).filter((item) => item.providerId && item.title !== "Private video" && item.title !== "Deleted video");
      const durations = await fetchYoutubeDurations(items.map((item) => item.providerId));
      items = items.map((item) => ({ ...item, duration: durations[item.providerId] || 0 }));
      state.youtube.playlist = { id: result.providerId, title: result.title, items };
      state.youtube.playlistLoading = false;
      render();
    } catch (error) {
      state.youtube.playlistLoading = false;
      state.youtube.playlist = null;
      state.youtube.error = friendlyError("YouTube", error);
      render();
    }
  }

  function addYoutubeTrack(trackId) {
    const track = state.youtube.results.find((item) => item.id === trackId) || state.youtube.playlist?.items.find((item) => item.id === trackId);
    if (!track) return;
    addTrack({ ...track });
    render();
  }

  function addYoutubePlaylist() {
    const items = state.youtube.playlist?.items || [];
    let added = 0;
    items.forEach((track) => { if (addTrack({ ...track }, { silent: true })) added += 1; });
    showToast(added ? `${added} morceau${added > 1 ? "x" : ""} ajouté${added > 1 ? "s" : ""} depuis la playlist.` : "Tous les morceaux sont déjà sélectionnés.", added ? "success" : "info");
    render();
  }

  function loadYoutubeIframeApi() {
    if (window.YT?.Player) return Promise.resolve();
    if (youtubeRuntime.apiPromise) return youtubeRuntime.apiPromise;
    youtubeRuntime.apiPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      const previousCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previousCallback === "function") previousCallback();
        resolve();
      };
      if (!existing) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.async = true;
        script.onerror = () => reject(new Error("IFrame API unavailable"));
        document.head.appendChild(script);
      }
      window.setTimeout(() => {
        if (!window.YT?.Player) reject(new Error("IFrame API timeout"));
      }, 12000);
    });
    return youtubeRuntime.apiPromise;
  }

  async function ensureYoutubePlayer() {
    const mount = document.getElementById("yt-player");
    if (!mount) throw new Error("YouTube player mount unavailable");
    if (youtubeRuntime.player && youtubeRuntime.mount === mount) return youtubeRuntime.player;
    await loadYoutubeIframeApi();
    youtubeRuntime.mount = mount;
    youtubeRuntime.player = null;
    youtubeRuntime.playerReady = new Promise((resolve, reject) => {
      const player = new window.YT.Player("yt-player", {
        height: "270",
        width: "480",
        playerVars: { playsinline: 1, controls: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: (event) => {
            youtubeRuntime.player = event.target;
            event.target.setVolume(Math.round(state.volume * 100));
            resolve(event.target);
          },
          onError: (event) => {
            console.warn("Erreur IFrame YouTube", event.data);
            showToast("Cette vidéo ne peut pas être lue ici. Choisissez-en une autre.", "error");
          }
        }
      });
      window.setTimeout(() => reject(new Error("YouTube player timeout")), 12000);
    });
    return youtubeRuntime.playerReady;
  }

  async function queueYoutubeHost(track, autoplay) {
    if (!track?.providerId) return;
    try {
      const player = await ensureYoutubePlayer();
      const clip = Math.max(5, Math.min(Number(state.config.clipSeconds) || 10, track.duration || 30));
      if (autoplay) player.loadVideoById({ videoId: track.providerId, startSeconds: 0, endSeconds: clip });
      else player.cueVideoById({ videoId: track.providerId, startSeconds: 0, endSeconds: clip });
    } catch (error) {
      showToast("Le lecteur YouTube n’a pas pu se charger. Réessayez ou vérifiez votre connexion.", "error");
      console.warn(error);
    }
  }

  async function hostYoutubeAction(action) {
    const track = state.youtube.hostTrack;
    if (!track) return;
    try {
      const player = await ensureYoutubePlayer();
      if (action === "play") {
        const clip = Math.max(5, Math.min(Number(state.config.clipSeconds) || 10, track.duration || 30));
        player.loadVideoById({ videoId: track.providerId, startSeconds: 0, endSeconds: clip });
      }
      if (action === "pause") player.pauseVideo();
      if (action === "stop") player.stopVideo();
    } catch (error) {
      showToast("Le lecteur YouTube ne répond pas pour le moment.", "error");
      console.warn(error);
    }
  }

  async function searchLibrary(append = false) {
    const query = state.library.query.trim();
    if (!query) {
      state.library.error = "Saisissez une recherche pour continuer.";
      state.library.hasSearched = true;
      render();
      return;
    }
    const requestId = ++state.library.requestId;
    state.library.loading = true;
    state.library.error = "";
    state.library.hasSearched = true;
    if (!append) {
      state.library.results = [];
      state.library.nextIndex = 0;
    }
    render();
    try {
      const index = append ? state.library.nextIndex : 0;
      const payload = await deezerRequest(query, index);
      if (requestId !== state.library.requestId) return;
      const tracks = (payload.data || []).map((item) => ({
        id: `deezer:${item.id}`,
        source: "library",
        providerId: String(item.id),
        title: item.title || "Morceau sans titre",
        artist: item.artist?.name || "Artiste non renseigné",
        album: item.album?.title || "",
        cover: item.album?.cover_medium || item.album?.cover || "",
        catalogDuration: Number(item.duration || 0),
        duration: Math.min(30, Number(item.duration || 30)),
        previewDuration: 30,
        playbackUrl: item.preview || "",
        previewUrl: item.preview || "",
        randomStart: false,
        strictPlayable: Boolean(item.preview)
      }));
      state.library.results = append ? [...state.library.results, ...tracks] : tracks;
      state.library.nextIndex = payload.next ? index + tracks.length : 0;
      state.library.loading = false;
      render();
    } catch (error) {
      if (requestId !== state.library.requestId) return;
      state.library.loading = false;
      state.library.error = friendlyError("Bibliothèque", error);
      render();
    }
  }

  async function deezerRequest(query, index) {
    const endpoint = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=20&index=${index}`;
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      const response = await fetch(endpoint, { signal: controller.signal });
      window.clearTimeout(timeout);
      if (!response.ok) {
        const error = new Error("Catalog response error");
        error.status = response.status;
        throw error;
      }
      const payload = await response.json();
      if (payload.error) throw new Error("Catalog provider error");
      return payload;
    } catch (error) {
      if (error.name === "AbortError") throw error;
      return deezerJsonp(endpoint);
    }
  }

  function deezerJsonp(endpoint) {
    return new Promise((resolve, reject) => {
      const callback = `blindifyDeezer_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const cleanup = () => {
        try { delete window[callback]; } catch (_) { window[callback] = undefined; }
        script.remove();
      };
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Catalog JSONP timeout"));
      }, 10000);
      window[callback] = (payload) => {
        window.clearTimeout(timeout);
        cleanup();
        if (payload?.error) reject(new Error("Catalog provider error"));
        else resolve(payload);
      };
      script.onerror = () => {
        window.clearTimeout(timeout);
        cleanup();
        reject(new Error("Catalog JSONP error"));
      };
      script.src = `${endpoint}${endpoint.includes("?") ? "&" : "?"}output=jsonp&callback=${callback}`;
      document.head.appendChild(script);
    });
  }

  function addLibraryTrack(trackId) {
    const track = state.library.results.find((item) => item.id === trackId);
    if (!track) return;
    if (!track.previewUrl) {
      showToast("Cet élément ne propose pas d’aperçu utilisable.", "error");
      return;
    }
    addTrack({ ...track });
    render();
  }

  function stopPreview() {
    if (state.preview.audio) {
      state.preview.audio.pause();
      state.preview.audio.src = "";
    }
    state.preview = { audio: null, id: null };
  }

  async function togglePreview(trackId) {
    const track = state.library.results.find((item) => item.id === trackId);
    if (!track?.previewUrl) return;
    if (state.preview.id === trackId) {
      stopPreview();
      render();
      return;
    }
    stopPreview();
    const audio = new Audio(track.previewUrl);
    audio.preload = "auto";
    audio.volume = state.volume;
    audio.onended = () => {
      if (state.preview.id === trackId) {
        stopPreview();
        if (state.screen === "source" && state.source === "library") render();
      }
    };
    audio.onerror = () => {
      if (state.preview.id === trackId) {
        stopPreview();
        showToast("Cet aperçu ne peut pas être lu pour le moment.", "error");
        render();
      }
    };
    state.preview = { audio, id: trackId };
    try {
      await audio.play();
      render();
    } catch (error) {
      stopPreview();
      showToast("Votre navigateur a bloqué l’aperçu. Touchez à nouveau le bouton pour l’autoriser.", "error");
      render();
    }
  }

  function createRounds() {
    const available = strictPlayableTracks();
    const requested = state.config.trackCount === "all" ? available.length : Number(state.config.trackCount);
    const selected = shuffle(available).slice(0, Math.max(1, Math.min(requested || available.length, available.length)));
    return selected.map((track) => {
      const sourceLimit = track.source === "library" ? Number(track.previewDuration || 30) : Number(track.duration || 0);
      const requestedDuration = Number(state.config.clipSeconds) || 10;
      const clipLength = sourceLimit > 0 ? Math.max(1, Math.min(requestedDuration, Math.floor(sourceLimit))) : requestedDuration;
      const canRandom = state.config.startMode === "random" && track.randomStart && track.duration > clipLength + 6;
      const maxStart = canRandom ? Math.max(0, Math.floor(track.duration - clipLength - 3)) : 0;
      const startAt = canRandom && maxStart > 3 ? Math.floor(Math.random() * (maxStart - 2)) + 2 : 0;
      return { id: uid("round"), track, clipLength, startAt };
    });
  }

  function startGame() {
    const rounds = createRounds();
    if (!rounds.length) {
      showToast("Ajoutez au moins un fichier local ou un aperçu disponible avant de jouer.", "error");
      return;
    }
    stopPreview();
    stopAllPlayback();
    state.players = state.players.map((player) => ({ ...player, score: 0 }));
    state.game = {
      rounds,
      roundIndex: 0,
      phase: "countdown",
      countdown: 3,
      remaining: rounds[0].clipLength,
      paused: false,
      needsInteraction: false,
      scoreDraft: {}
    };
    savePreferences();
    state.screen = "game";
    render();
    scrollToTop();
    announce("La première manche commence dans trois secondes.");
    window.setTimeout(startCountdown, 250);
  }

  function getCurrentRound() {
    return state.game?.rounds?.[state.game.roundIndex] || null;
  }

  function clearCountdownTimers() {
    window.clearInterval(playback.countdownTimer);
    window.clearTimeout(playback.countdownDelay);
    playback.countdownTimer = null;
    playback.countdownDelay = null;
  }

  function clearPlaybackTimers() {
    window.clearInterval(playback.tickTimer);
    window.clearTimeout(playback.endTimer);
    playback.tickTimer = null;
    playback.endTimer = null;
  }

  function stopAllPlayback() {
    clearCountdownTimers();
    clearPlaybackTimers();
    if (playback.audio) {
      playback.audio.pause();
      playback.audio.src = "";
    }
    playback.audio = null;
    playback.currentRoundId = null;
    playback.elapsed = 0;
  }

  function startCountdown() {
    const game = state.game;
    if (!game || state.screen !== "game") return;
    stopAllPlayback();
    game.phase = "countdown";
    game.countdown = 3;
    game.paused = false;
    game.needsInteraction = false;
    game.remaining = getCurrentRound()?.clipLength || state.config.clipSeconds;
    render();
    let value = 3;
    playback.countdownTimer = window.setInterval(() => {
      if (!state.game || state.screen !== "game") {
        clearCountdownTimers();
        return;
      }
      value -= 1;
      if (value > 0) {
        state.game.countdown = value;
        render();
      } else {
        state.game.countdown = 0;
        render();
        clearCountdownTimers();
        playback.countdownDelay = window.setTimeout(() => playCurrentRound(), 620);
      }
    }, 900);
  }

  async function playCurrentRound() {
    const game = state.game;
    const round = getCurrentRound();
    if (!game || !round || state.screen !== "game") return;
    clearCountdownTimers();
    clearPlaybackTimers();
    game.phase = "listening";
    game.paused = false;
    game.needsInteraction = false;
    game.remaining = round.clipLength;
    game.elapsed = 0;
    playback.elapsed = 0;
    playback.currentRoundId = round.id;
    render();
    try {
      const audio = new Audio(round.track.playbackUrl);
      audio.preload = "auto";
      audio.volume = state.volume;
      audio.onended = () => finishClip();
      audio.onerror = () => {
        if (state.game?.phase === "listening") {
          stopAllPlayback();
          state.game.phase = "answer";
          showToast("La lecture a rencontré un problème. Vous pouvez tout de même révéler la réponse.", "error");
          render();
        }
      };
      playback.audio = audio;
      await waitForAudioMetadata(audio, 5000);
      if (round.startAt > 0 && Number.isFinite(audio.duration) && audio.duration > round.startAt) audio.currentTime = round.startAt;
      await audio.play();
      startRoundClock(0);
    } catch (error) {
      console.warn("Lecture bloquée", error);
      if (playback.audio) {
        playback.audio.pause();
        playback.audio.src = "";
      }
      playback.audio = null;
      game.needsInteraction = true;
      game.paused = true;
      render();
      showToast("Votre navigateur attend un geste pour lancer l’extrait.", "error");
    }
  }

  function waitForAudioMetadata(audio, timeoutMs) {
    if (audio.readyState >= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => { cleanup(); resolve(); }, timeoutMs);
      const cleanup = () => {
        audio.removeEventListener("loadedmetadata", onReady);
        audio.removeEventListener("canplay", onReady);
        audio.removeEventListener("error", onError);
      };
      const onReady = () => { window.clearTimeout(timeout); cleanup(); resolve(); };
      const onError = () => { window.clearTimeout(timeout); cleanup(); reject(new Error("Audio metadata error")); };
      audio.addEventListener("loadedmetadata", onReady, { once: true });
      audio.addEventListener("canplay", onReady, { once: true });
      audio.addEventListener("error", onError, { once: true });
      audio.load();
    });
  }

  function startRoundClock(initialElapsed) {
    const game = state.game;
    const round = getCurrentRound();
    if (!game || !round || state.screen !== "game") return;
    clearPlaybackTimers();
    playback.elapsed = initialElapsed;
    playback.startedAt = performance.now() - initialElapsed * 1000;
    const update = () => {
      if (!state.game || state.screen !== "game" || state.game.phase !== "listening") return;
      const elapsed = Math.min(round.clipLength, (performance.now() - playback.startedAt) / 1000);
      playback.elapsed = elapsed;
      state.game.elapsed = elapsed;
      state.game.remaining = Math.max(0, round.clipLength - elapsed);
      updateGameTimerDom(state.game.remaining, round.clipLength);
      if (state.game.remaining <= 0) finishClip();
    };
    update();
    playback.tickTimer = window.setInterval(update, 200);
    playback.endTimer = window.setTimeout(finishClip, Math.max(0, round.clipLength - initialElapsed) * 1000 + 180);
  }

  function updateGameTimerDom(remaining, duration) {
    const timer = document.querySelector("[data-game-timer]");
    const progress = document.querySelector("[data-game-progress]");
    if (timer) timer.textContent = formatDuration(remaining);
    if (progress) progress.style.width = `${clamp(((duration - remaining) / Math.max(duration, 1)) * 100, 0, 100)}%`;
  }

  function toggleGamePause() {
    const game = state.game;
    if (!game || game.phase !== "listening") return;
    if (game.needsInteraction || !playback.audio) {
      playCurrentRound();
      return;
    }
    if (game.paused) {
      playback.audio.play().then(() => {
        game.paused = false;
        game.needsInteraction = false;
        startRoundClock(playback.elapsed);
        render();
      }).catch(() => {
        game.needsInteraction = true;
        render();
      });
    } else {
      playback.audio.pause();
      clearPlaybackTimers();
      game.paused = true;
      render();
    }
  }

  function stopGameTrack() {
    const game = state.game;
    if (!game) return;
    stopAllPlayback();
    game.phase = "answer";
    game.needsInteraction = false;
    render();
  }

  function finishClip() {
    const game = state.game;
    if (!game || state.screen !== "game" || game.phase !== "listening") return;
    stopAllPlayback();
    game.phase = "answer";
    game.needsInteraction = false;
    game.paused = false;
    render();
    announce("L’extrait est terminé. Vous pouvez révéler la réponse.");
  }

  function revealAnswer() {
    if (!state.game) return;
    stopAllPlayback();
    state.game.phase = "reveal";
    state.game.scoreDraft = Object.fromEntries(state.players.map((player) => [player.id, 0]));
    state.screen = "reveal";
    render();
    scrollToTop();
    announce("Réponse révélée. Vous pouvez attribuer les points.");
  }

  function setPlayerScore(playerId, score, kind) {
    if (!state.game) return;
    state.game.scoreDraft[playerId] = Number(score) || 0;
    state.game.scoreDraft[`${playerId}:kind`] = kind || "";
    render();
  }

  function nextRound() {
    const game = state.game;
    if (!game) return;
    state.players = state.players.map((player) => ({ ...player, score: Number(player.score || 0) + Number(game.scoreDraft[player.id] || 0) }));
    if (game.roundIndex + 1 >= game.rounds.length) {
      game.scoreDraft = {};
      state.screen = "final";
      render();
      scrollToTop();
      announce("Partie terminée. Voici le classement final.");
      return;
    }
    game.roundIndex += 1;
    game.phase = "countdown";
    game.countdown = 3;
    game.remaining = game.rounds[game.roundIndex].clipLength;
    game.scoreDraft = {};
    state.screen = "game";
    render();
    scrollToTop();
    window.setTimeout(startCountdown, 220);
  }

  function addPlayer() {
    const input = document.getElementById("new-player-name");
    const name = String(input?.value || "").trim().slice(0, 30);
    if (!name) {
      showToast("Ajoutez un prénom pour créer un joueur.");
      input?.focus();
      return;
    }
    if (state.players.some((player) => player.name.localeCompare(name, "fr", { sensitivity: "accent" }) === 0)) {
      showToast("Ce joueur est déjà présent.");
      return;
    }
    state.players.push({ id: uid("player"), name, colour: PLAYER_COLOURS[state.players.length % PLAYER_COLOURS.length], score: 0 });
    savePreferences();
    render();
  }

  function removePlayer(playerId) {
    if (state.players.length <= 1) {
      showToast("Gardez au moins un joueur pour compter les points.");
      return;
    }
    state.players = state.players.filter((player) => player.id !== playerId);
    savePreferences();
    render();
  }

  function navigateToSource(source = state.source || "local") {
    stopPreview();
    stopAllPlayback();
    state.screen = "source";
    state.source = source;
    render();
    window.scrollTo(0, 0);
  }

  function scrollToTop() {
    window.scrollTo(0, 0);
  }

  appRoot.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target || target.disabled) return;
    const { action } = target.dataset;
    const id = target.dataset.id;
    event.preventDefault();
    switch (action) {
      case "go-home":
        stopPreview();
        stopAllPlayback();
        state.screen = "home";
        render();
        scrollToTop();
        break;
      case "choose-source":
        navigateToSource(target.dataset.source);
        break;
      case "open-file-dialog":
        document.getElementById("local-file-input")?.click();
        break;
      case "remove-track":
        removeTrack(id);
        break;
      case "move-track":
        moveTrack(id, target.dataset.direction);
        break;
      case "shuffle-selection":
        shuffleSelection();
        break;
      case "clear-selection":
        clearSelection();
        break;
      case "clear-local":
        clearSelection("local");
        break;
      case "open-setup":
        stopPreview();
        if (!state.selection.length) return;
        state.screen = "setup";
        render();
        scrollToTop();
        break;
      case "back-to-source":
        navigateToSource(state.source || "local");
        break;
      case "set-track-count":
        state.config.trackCount = target.dataset.value;
        savePreferences();
        render();
        break;
      case "set-clip-seconds":
        state.config.clipSeconds = Number(target.dataset.value);
        savePreferences();
        render();
        break;
      case "set-start-mode":
        state.config.startMode = target.dataset.value;
        savePreferences();
        render();
        break;
      case "add-player":
        addPlayer();
        break;
      case "remove-player":
        removePlayer(id);
        break;
      case "start-game":
        startGame();
        break;
      case "toggle-game-pause":
        toggleGamePause();
        break;
      case "start-extract":
        playCurrentRound();
        break;
      case "stop-game-track":
        stopGameTrack();
        break;
      case "reveal-answer":
        revealAnswer();
        break;
      case "back-to-answer":
        state.screen = "game";
        state.game.phase = "answer";
        render();
        break;
      case "set-player-score":
        setPlayerScore(id, target.dataset.score, target.dataset.kind);
        break;
      case "next-round":
        nextRound();
        break;
      case "play-again":
        state.screen = "setup";
        state.game = null;
        render();
        scrollToTop();
        break;
      case "toggle-youtube-api":
        state.youtube.apiOpen = !state.youtube.apiOpen;
        render();
        break;
      case "save-youtube-api": {
        const key = String(document.getElementById("youtube-api-key")?.value || "").trim();
        state.youtubeApiKey = key;
        state.youtube.apiOpen = false;
        state.youtube.error = "";
        savePreferences();
        showToast(key ? "La clé publique YouTube a été enregistrée sur cet appareil." : "La clé YouTube a été supprimée.", key ? "success" : "info");
        render();
        break;
      }
      case "youtube-kind":
        state.youtube.searchKind = target.dataset.kind;
        state.youtube.results = [];
        state.youtube.playlist = null;
        state.youtube.error = "";
        render();
        break;
      case "search-youtube":
        youtubeSearch(false);
        break;
      case "load-more-youtube":
        youtubeSearch(true);
        break;
      case "open-playlist":
        openYoutubePlaylist(id);
        break;
      case "add-youtube-track":
      case "add-playlist-track":
        addYoutubeTrack(id);
        break;
      case "add-playlist":
        addYoutubePlaylist();
        break;
      case "youtube-host-track": {
        const track = state.youtube.results.find((item) => item.id === id);
        if (track) { state.youtube.hostTrack = track; render(); }
        break;
      }
      case "youtube-host-playlist-track": {
        const track = state.youtube.playlist?.items.find((item) => item.id === id);
        if (track) { state.youtube.hostTrack = track; render(); }
        break;
      }
      case "youtube-host-play":
        hostYoutubeAction("play");
        break;
      case "youtube-host-pause":
        hostYoutubeAction("pause");
        break;
      case "youtube-host-stop":
        hostYoutubeAction("stop");
        break;
      case "close-youtube-host":
        hostYoutubeAction("stop");
        state.youtube.hostTrack = null;
        render();
        break;
      case "search-library":
        searchLibrary(false);
        break;
      case "load-more-library":
        searchLibrary(true);
        break;
      case "toggle-preview":
        togglePreview(id);
        break;
      case "add-library-track":
        addLibraryTrack(id);
        break;
      default:
        break;
    }
  });

  appRoot.addEventListener("input", (event) => {
    const input = event.target;
    if (input.id === "youtube-search") {
      state.youtube.query = input.value;
      window.clearTimeout(youtubeSearchDebounce);
      if (state.youtubeApiKey && input.value.trim().length >= 2) {
        youtubeSearchDebounce = window.setTimeout(() => youtubeSearch(false), 480);
      }
    }
    if (input.id === "library-search") {
      state.library.query = input.value;
      window.clearTimeout(librarySearchDebounce);
      if (input.value.trim().length >= 2) {
        librarySearchDebounce = window.setTimeout(() => searchLibrary(false), 480);
      }
    }
    if (input.dataset.action === "set-volume") {
      state.volume = clamp(Number(input.value) / 100, 0, 1);
      if (playback.audio) playback.audio.volume = state.volume;
      if (state.preview.audio) state.preview.audio.volume = state.volume;
      if (youtubeRuntime.player?.setVolume) youtubeRuntime.player.setVolume(Math.round(state.volume * 100));
      savePreferences();
    }
  });

  appRoot.addEventListener("change", (event) => {
    const input = event.target;
    if (input.id === "local-file-input") addLocalFiles(input.files);
  });

  appRoot.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.target.id === "youtube-search") {
      event.preventDefault();
      youtubeSearch(false);
    }
    if (event.target.id === "library-search") {
      event.preventDefault();
      searchLibrary(false);
    }
    if (event.target.id === "new-player-name") {
      event.preventDefault();
      addPlayer();
    }
  });

  appRoot.addEventListener("dragover", (event) => {
    const zone = event.target.closest("[data-drop-zone]");
    if (!zone) return;
    event.preventDefault();
    zone.classList.add("is-dragover");
  });

  appRoot.addEventListener("dragleave", (event) => {
    const zone = event.target.closest("[data-drop-zone]");
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("is-dragover");
  });

  appRoot.addEventListener("drop", (event) => {
    const zone = event.target.closest("[data-drop-zone]");
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("is-dragover");
    addLocalFiles(event.dataTransfer?.files);
  });

  window.addEventListener("beforeunload", () => {
    stopAllPlayback();
    stopPreview();
    state.selection.filter((track) => track.source === "local").forEach((track) => {
      try { URL.revokeObjectURL(track.playbackUrl); } catch (_) { /* no-op */ }
    });
  });

  render();
})();
