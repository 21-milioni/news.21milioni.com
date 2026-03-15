(async () => {
  // --- PARTE 1: Utility per i link esterni (quella che avevi già) ---
  const handleExternalLinks = () => {
    document.querySelectorAll("a").forEach((link) => {
      const href = link.getAttribute("href") || "";
      if (href.startsWith("http")) {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      }
    });
  };

  // --- PARTE 2: Caricamento dinamico da Nostr ---
  const loadNostrContent = async () => {
    // Cerchiamo il contenitore dove iniettare i post
    const container = document.getElementById('articles-container');
    if (!container) return; // Se non siamo nella home o in una pagina con lista, esci

    const pubkey = "IL_TUO_NPUB_IN_FORMATO_HEX"; // Deve essere HEX, non npub...
    const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];

    try {
      // Importiamo nostr-tools dinamicamente se non presente
      if (!window.NostrTools) {
        console.error("NostrTools non trovato. Assicurati di averlo incluso nel layout.");
        return;
      }

      const pool = new window.NostrTools.SimplePool();
      
      // Recuperiamo gli articoli (Kind 30023 = Long-form content)
      let articles = await pool.querySync(relays, {
        authors: [pubkey],
        kinds: [30023],
        limit: 10
      });

      if (articles.length === 0) {
        container.innerHTML = "<p>Nessun articolo trovato.</p>";
        return;
      }

      // Puliamo il contenitore (rimuove eventuali scheletri di caricamento)
      container.innerHTML = '';

      // Renderizziamo ogni articolo trovato
      articles.forEach(article => {
        const title = article.tags.find(t => t[0] === 'title')?.[1] || "Senza Titolo";
        const summary = article.tags.find(t => t[0] === 'summary')?.[1] || article.content.substring(0, 150) + "...";
        const slug = article.tags.find(t => t[0] === 'd')?.[1];

        const html = `
          <article class="p-6 border rounded-2xl bg-white shadow-sm hover:shadow-md transition">
            <h2 class="text-2xl font-bold mb-2">${title}</h2>
            <p class="text-slate-600 mb-4">${summary}</p>
            <a href="/article.html?id=${article.id}&slug=${slug}" class="text-blue-600 font-medium">Leggi tutto →</a>
          </article>
        `;
        container.insertAdjacentHTML('beforeend', html);
      });

    } catch (error) {
      console.error("Errore nel caricamento da Nostr:", error);
      container.innerHTML = "<p>Errore nel caricamento degli articoli.</p>";
    }
  };

  // Eseguiamo le funzioni
  handleExternalLinks();
  await loadNostrContent();
})();