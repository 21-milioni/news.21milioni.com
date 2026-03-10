import { defaultConfig } from "./defaults.js";

export function loadConfig(cliBaseUrl) {
  const npub = process.env.NPUB || "";
  const relays = process.env.RELAYS ? process.env.RELAYS.split(",") : defaultConfig.relays;
  const outputDir = process.env.OUTPUT_DIR || defaultConfig.output_dir;
  
  // Auto-detect base URL from multiple sources with priority:
  // 1. CLI flag (--base-url)
  // 2. BASE_URL (user-defined)
  // 3. URL (Netlify)
  // 4. VERCEL_URL (Vercel — no protocol prefix)
  // 5. CF_PAGES_URL (Cloudflare Pages)
  // 6. Empty (generate blog with root-relative paths; RSS/sitemap omitted)
  let baseUrl =
    cliBaseUrl ||
    process.env.BASE_URL ||
    process.env.URL ||
    process.env.VERCEL_URL ||
    process.env.CF_PAGES_URL ||
    "";

  // Normalize base URL: remove trailing slash to avoid double slashes in URLs
  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }
  // Strip bare "." or "./" that were previously used as a no-op placeholder
  if (baseUrl === "." || baseUrl === "./") {
    baseUrl = "";
  }

  // If a URL was detected without a protocol (e.g. Vercel sets "my-app.vercel.app"),
  // prepend https:// so all generated URLs are valid absolute URLs.
  if (baseUrl && !baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    baseUrl = `https://${baseUrl}`;
  }

  if (baseUrl) {
    console.log(`[NostrPress] Base URL: ${baseUrl}`);
  } else {
    console.log("[NostrPress] No BASE_URL detected — generating blog with root-relative paths. RSS and sitemap require a BASE_URL to contain valid absolute URLs.");
  }
  
  const maxSizeMb = process.env.MAX_SIZE_MB ? Number(process.env.MAX_SIZE_MB) : defaultConfig.media.max_size_mb;

  return {
    ...defaultConfig,
    input: {
      npub_or_nprofile: npub
    },
    relays,
    output_dir: outputDir,
    site: {
      ...defaultConfig.site,
      base_url: baseUrl
    },
    media: {
      ...defaultConfig.media,
      max_size_mb: maxSizeMb
    }
  };
}
