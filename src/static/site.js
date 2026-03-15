(async () => {{
  // --- PARTE 1: Utility per i link esterni
  console.log("🚀 [NostrPress] Script avviato");

  // Funzione per convertire npub in HEX (utilizza la libreria nostr-tools)
  const decodeNpubToHex = (npub) => {
    try {
      if (!npub) return null;
      if (!npub.startsWith('npub')) {
        console.warn("⚠️ [NostrPress] La stringa fornita non sembra un npub valido:", npub);
        return npub; // Forse è già HEX?
      }
      const { data } = window.NostrTools.nip19.decode(npub);
      console.log("✅ [NostrPress] NPUB decodificato correttamente in HEX");
      return data;
    } catch (e) {
      console.error("❌ [NostrPress] Errore nella decodifica NPUB:", e);
      return null;
    }
  };

  const handleExternalLinks = () => {
    const links = document.querySelectorAll("a");
    console.log(`🔗 [NostrPress] Gestione link esterni per ${links.length} elementi`);
    links.forEach((link) => {
      const href = link.getAttribute("href") || "";
      if (href.startsWith("http")) {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      }
    });
  };

  // --- PARTE 2: Caricamento dinamico da Nostr
  const loadNostrContent = async () => {
    // Cerchiamo il contenitore dove iniettare i post
    const container = document.getElementById('articles-container');
    if (!container) {
      console.log("ℹ️ [NostrPress] Nessun contenitore #articles-container trovato. Salto caricamento.");
      return;
    }

    // Recupera la variabile passata dal layout
    const rawNpub = window.NOSTR_CONFIG?.npub;
    console.log("🔍 [NostrPress] NPUB rilevata dalla configurazione:", rawNpub);

    const pubkeyHex = decodeNpubToHex(rawNpub);
    const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];

    if (!pubkeyHex) {
      console.error("❌ [NostrPress] Impossibile procedere senza una Pubkey HEX valida.");
      container.innerHTML = "<p>Configurazione mancante (NPUB).</p>";
      return;
    }

    try {
      if (!window.NostrTools) {
        throw new Error("Libreria NostrTools non caricata correttamente.");
      }

      console.log("🌐 [NostrPress] Connessione ai relay in corso...");
      const pool = new window.NostrTools.SimplePool();
      
      // Recuperiamo gli articoli (Kind 30023)
      console.log("📡 [NostrPress] Richiesta eventi Kind 30023 per:", pubkeyHex);
      let articles = await pool.querySync(relays, {
        authors: [pubkeyHex],
        kinds: [30023],
        limit: 10
      });

      console.log(`📦 [NostrPress] Ricevuti ${articles.length} articoli`);

      if (articles.length === 0) {
        container.innerHTML = "<p>Nessun articolo trovato su questi relay.</p>";
        return;
      }

      container.innerHTML = '';

      articles.forEach(article => {
        const title = article.tags.find(t => t[0] === 'title')?.[1] || "Senza Titolo";
        const summary = article.tags.find(t => t[0] === 'summary')?.[1] || article.content.substring(0, 150) + "...";
        const slug = article.tags.find(t => t[0] === 'd')?.[1];

        const html = `
          <article class="p-6 border rounded-2xl bg-white shadow-sm hover:shadow-md transition mb-6">
            <h2 class="text-2xl font-bold mb-2">${title}</h2>
            <p class="text-slate-600 mb-4">${summary}</p>
            <a href="/article.html?id=${article.id}&slug=${slug}" class="text-blue-600 font-medium hover:underline">Leggi tutto →</a>
          </article>
        `;
        container.insertAdjacentHTML('beforeend', html);
      });

      console.log("✨ [NostrPress] Rendering completato");

    } catch (error) {
      console.error("❌ [NostrPress] Errore critico:", error);
      container.innerHTML = "<p>Errore nel caricamento degli articoli. Controlla la console.</p>";
    }
  };

  // Esecuzione
  handleExternalLinks();
  await loadNostrContent();
})();