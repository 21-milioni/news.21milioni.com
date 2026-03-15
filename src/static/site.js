(async () => {
  // --- PARTE 1: Utility per i link esterni
  console.log("[NostrPress] Client-side script avviato");

  // Funzione per convertire npub in HEX (utilizza la libreria nostr-tools)

  // Logica simile a resolveIdentity di client.js
  const getPubkeyHex = (input) => {
    try {
      if (!input) return null;
      
      // Se è già un HEX (64 caratteri)
      if (/^[0-9a-fA-F]{64}$/.test(input)) {
        return input;
      }

      // Se è un npub, usa la logica di nip19 (come nel tuo client.js)
      if (input.startsWith('npub')) {
        const decoded = window.NostrTools.nip19.decode(input);
        console.log("[NostrPress] NPUB decodificato con successo");
        return decoded.data;
      }
      
      return null;
    } catch (e) {
      console.error("[NostrPress] Errore nel processare l'identità:", e);
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
    if (!container) return;

    // Recupera la NPUB che abbiamo iniettato nel layout
    const npubFromEnv = window.NOSTR_CONFIG?.npub;
    console.log("[NostrPress] NPUB recuperata dall'ambiente:", npubFromEnv);

    const pubkey = getPubkeyHex(npubFromEnv);
    const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];

    if (!pubkey) {
      console.error("[NostrPress] Pubkey non valida o mancante. Controlla la variabile NPUB su Netlify.");
      container.innerHTML = "<p>Errore di configurazione: NPUB non trovata.</p>";
      return;
    }

    try {
      if (!window.NostrTools) {
        throw new Error("Libreria NostrTools non caricata correttamente.");
      }

      console.log("[NostrPress] Connessione ai relay in corso...");
      const pool = new window.NostrTools.SimplePool();
      
      // Recuperiamo gli articoli (Kind 30023)
      console.log(`[NostrPress] Fetching articoli per pubkey: ${pubkey}...`);

      // Filtro identico a quello di fetchArticles in client.js
      const filter = {
        authors: [pubkey],
        kinds: [30023],
        limit: 10
      };

      const events = await pool.querySync(relays, filter);
      console.log(`[NostrPress] Eventi ricevuti: ${events.length}`);

      if (events.length === 0) {
        container.innerHTML = "<p>Nessun articolo trovato.</p>";
        return;
      }

      // Ordina per data (come nel tuo sistema di build)
      const articles = events.sort((a, b) => b.created_at - a.created_at);

      container.innerHTML = '';
      articles.forEach(article => {
        const title = article.tags.find(t => t[0] === 'title')?.[1] || "Senza titolo";
        const summary = article.tags.find(t => t[0] === 'summary')?.[1] || article.content.substring(0, 150) + "...";
        const slug = article.tags.find(t => t[0] === 'd')?.[1];

        container.insertAdjacentHTML('beforeend', `
          <article class="p-6 border rounded-2xl bg-white mb-6 shadow-sm hover:shadow-md transition">
            <h2 class="text-2xl font-bold mb-2">${title}</h2>
            <p class="text-slate-600 mb-4">${summary}</p>
            <a href="/${slug}.html" class="text-blue-600 font-medium">Leggi tutto →</a>
          </article>
        `);
      });

    } catch (err) {
      console.error("[NostrPress] Errore durante il caricamento:", err);
      container.innerHTML = "<p>Errore nel caricamento dei contenuti live.</p>";
    }
  };

  await loadNostrContent();
})();