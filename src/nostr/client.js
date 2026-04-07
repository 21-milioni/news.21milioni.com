import { SimplePool, nip19 } from "nostr-tools";
import { CacheManager } from "../cache/cacheManager.js";

const cache = new CacheManager();

export function resolveIdentity(input, fallbackRelays) {
  if (input.startsWith("npub")) {
    const decoded = nip19.decode(input);
    if (decoded.type !== "npub") {
      throw new Error("Invalid npub input");
    }
    return { npub: input, pubkey: decoded.data, relays: fallbackRelays };
  }

  if (input.startsWith("nprofile")) {
    const decoded = nip19.decode(input);
    if (decoded.type !== "nprofile") {
      throw new Error("Invalid nprofile input");
    }
    const data = decoded.data;
    const npub = nip19.npubEncode(data.pubkey);
    return { npub, pubkey: data.pubkey, relays: data.relays?.length ? data.relays : fallbackRelays };
  }

  throw new Error("Input must be npub or nprofile");
}

export async function fetchProfileMetadata(pool, relays, pubkey) {
  const cacheKey = `profile-${pubkey}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`Using cached profile for ${pubkey}`);
    return cached;
  }

  console.log(`Fetching profile for ${pubkey}...`);
  const filter = { kinds: [0], authors: [pubkey], limit: 10 };
  const events = await pool.querySync(relays, filter);
  const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
  if (!latest || !latest.content) {
    return {};
  }

  try {
    const metadata = JSON.parse(latest.content);
    cache.set(cacheKey, metadata);
    return metadata;
  } catch {
    return {};
  }
}

function collectDeletedIds(events) {
  const deleted = new Set();
  for (const event of events) {
    if (event.kind !== 5) continue;
    for (const tag of event.tags) {
      if (tag[0] === "e" && tag[1]) {
        deleted.add(tag[1]);
      }
    }
  }
  return deleted;
}

export async function fetchArticles(pool, config, pubkey) {
  const cacheKey = `articles-${pubkey}-${JSON.stringify(config.fetch)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`Using cached articles for ${pubkey}`);
    return cached;
  }

  console.log(`Fetching articles for ${pubkey}...`);
  const relays = config.relays;
  const filters = [];

  const baseFilter = {
    authors: [pubkey],
    kinds: [30023],
    since: config.fetch.since,
    until: config.fetch.until
  };
  filters.push(baseFilter);

  if (config.fetch.include_kind1) {
    filters.push({ authors: [pubkey], kinds: [1], since: config.fetch.since, until: config.fetch.until });
  }

  const deletionFilter = {
    authors: [pubkey],
    kinds: [5],
    since: config.fetch.since,
    until: config.fetch.until
  };

  const [events, deletions] = await Promise.all([
    Promise.all(filters.map(f => pool.querySync(relays, f))).then(results => results.flat()),
    pool.querySync(relays, deletionFilter)
  ]);

  const deletedIds = collectDeletedIds(deletions);
  const deduped = new Map();
  const replaceableByD = new Map();
  for (const event of events) {
    if (!event.content || !event.content.trim()) continue;
    if (deletedIds.has(event.id)) continue;

    // Kind 30023 (NIP-23) are parameterized replaceable events:
    // deduplicate by d-tag, keeping only the newest version
    if (event.kind === 30023) {
      const dTag = event.tags.find(t => t[0] === "d")?.[1] || "";
      const key = `30023:${event.pubkey}:${dTag}`;
      const existing = replaceableByD.get(key);
      if (!existing || event.created_at > existing.created_at) {
        replaceableByD.set(key, event);
      }
    } else if (!deduped.has(event.id)) {
      deduped.set(event.id, event);
    }
  }

  for (const event of replaceableByD.values()) {
    deduped.set(event.id, event);
  }

  const result = Array.from(deduped.values());
  cache.set(cacheKey, result);
  return result;
}

export async function fetchComments(pool, relays, articles) {
  if (articles.length === 0) return new Map();

  const articleEventIds = articles.map(a => a.id);
  const articleIdSet = new Set(articleEventIds);

  // Build addressable coordinates for kind 30023 articles: "30023:<pubkey>:<d-tag>"
  const coordToId = new Map();
  const articleCoords = [];
  for (const article of articles) {
    if (article.kind === 30023 && article.pubkey) {
      const coord = `30023:${article.pubkey}:${article.dTag || ""}`;
      coordToId.set(coord, article.id);
      articleCoords.push(coord);
    }
  }

  // Query both #e (event ID) and #a (addressable coordinate) in parallel
  // Support kind 1 (short text note) and kind 1111 (NIP-22 Comment)
  const commentKinds = [1, 1111];
  const queries = [];
  if (articleEventIds.length > 0) {
    queries.push(pool.querySync(relays, { kinds: commentKinds, "#e": articleEventIds }));
  }
  if (articleCoords.length > 0) {
    queries.push(pool.querySync(relays, { kinds: commentKinds, "#a": articleCoords }));
  }

  const results = await Promise.all(queries);
  // Deduplicate events (a comment may match both filters)
  const uniqueEvents = [...new Map(results.flat().map(e => [e.id, e])).values()];

  const commentsByArticle = new Map();

  // Group comments by article event ID, checking e tags then a tags
  for (const event of uniqueEvents) {
    let articleId = null;

    const eTag = event.tags.find(tag => tag[0] === "e" && articleIdSet.has(tag[1]));
    if (eTag) {
      articleId = eTag[1];
    } else {
      const aTag = event.tags.find(tag => tag[0] === "a" && coordToId.has(tag[1]));
      if (aTag) {
        articleId = coordToId.get(aTag[1]);
      }
    }

    if (articleId) {
      if (!commentsByArticle.has(articleId)) {
        commentsByArticle.set(articleId, []);
      }
      commentsByArticle.get(articleId).push(event);
    }
  }

  // Fetch author profiles for all comment authors
  const authorPubkeys = [...new Set(uniqueEvents.map(e => e.pubkey))];
  const profiles = new Map();
  
  if (authorPubkeys.length > 0) {
    const profileFilter = {
      kinds: [0],
      authors: authorPubkeys
    };
    const profileEvents = await pool.querySync(relays, profileFilter);
    
    for (const event of profileEvents) {
      try {
        const metadata = JSON.parse(event.content);
        profiles.set(event.pubkey, metadata);
      } catch {
        // Ignore invalid profiles
      }
    }
  }

  // Convert to Comment objects
  const result = new Map();
  for (const [articleId, events] of commentsByArticle.entries()) {
    const comments = events
      .sort((a, b) => a.created_at - b.created_at) // Oldest first
      .map(event => {
        const profile = profiles.get(event.pubkey);
        return {
          id: event.id,
          pubkey: event.pubkey,
          content: event.content,
          created_at: event.created_at,
          author_name: profile?.display_name || profile?.name,
          author_picture: profile?.picture
        };
      });
    result.set(articleId, comments);
  }

  return result;
}
