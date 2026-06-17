import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { SimplePool } from "nostr-tools";
import slugifyLib from "slugify";
import { loadConfig } from "./config/loadConfig.js";
import { resolveIdentity, fetchProfileMetadata, fetchRelayList, fetchArticles, fetchComments } from "./nostr/client.js";
import { parseArticle } from "./parser/articleParser.js";
import { processMedia, rewriteArticleContent } from "./media/mediaPipeline.js";
import { renderMarkdown, renderSite } from "./render/render.js";

function parseArgs() {
  const args = process.argv.slice(2);
  let baseUrl;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base-url" && i + 1 < args.length) {
      baseUrl = args[i + 1];
      break;
    }
  }
  
  return { baseUrl };
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanOutput(outputDir) {
  ensureDir(outputDir);
  ensureDir(path.join(outputDir, "assets", "images"));
  ensureDir(path.join(outputDir, "assets", "videos"));
  ensureDir(path.join(outputDir, "css"));
  ensureDir(path.join(outputDir, "js"));
}

function normalizeSummary(content, summary) {
  if (summary && summary.trim()) return summary;
  const text = content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#>*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 180);
}

function sortArticles(articles) {
  return [...articles].sort((a, b) => {
    if (b.published_at !== a.published_at) return b.published_at - a.published_at;
    return a.id.localeCompare(b.id);
  });
}

const slugify = slugifyLib;
const normalizeTag = (tag) => {
  const slug = slugify(tag, { lower: true, strict: true });
  return slug || encodeURIComponent(String(tag).toLowerCase());
};

function buildContext(config, npub, pubkey, profile, articles) {
  const siteTitle = config.site.title === "auto" ? profile.display_name || profile.name || npub : config.site.title;
  const siteDescription =
    config.site.description === "auto" ? profile.about || `Posts by ${siteTitle}` : config.site.description;

  return {
    site: {
      title: siteTitle,
      description: siteDescription,
      base_url: config.site.base_url
    },
    author: {
      npub,
      pubkey,
      profile
    },
    articles
  };
}

function writeStaticAssets(outputDir, rootDir) {
  // Copy print.css
  const srcPrintCss = path.join(rootDir, "src/styles/print.css");
  const destPrintCss = path.join(outputDir, "css", "print.css");
  if (fs.existsSync(srcPrintCss)) {
    fs.copyFileSync(srcPrintCss, destPrintCss);
  }

  // Copy favicon files
  const faviconFiles = [
    "favicon.png",
    "favicon.ico",
    "favicon.svg",
    "favicon-16x16.png",
    "favicon-32x32.png",
    "apple-touch-icon.png",
    // "banner.png"
  ];
  
  for (const file of faviconFiles) {
    const srcFile = path.join(rootDir, "src/static", file);
    const destFile = path.join(outputDir, file);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, destFile);
    }
  }

  // Copy JavaScript files
  const jsDir = path.join(rootDir, "src/static/js");
  const outputJsDir = path.join(outputDir, "js");
  if (fs.existsSync(jsDir)) {
    fs.mkdirSync(outputJsDir, { recursive: true });
    const files = fs.readdirSync(jsDir).filter((file) => file !== "pubkey-selector.js");
    for (const file of files) {
      const srcFile = path.join(jsDir, file);
      const destFile = path.join(outputJsDir, file);
      if (fs.statSync(srcFile).isFile()) {
        fs.copyFileSync(srcFile, destFile);
      }
    }
  }
}

function runTailwind(outputDir, rootDir) {
  const require = createRequire(import.meta.url);
  const tailwindCli = require.resolve("tailwindcss/lib/cli.js");
  const input = path.join(rootDir, "src/styles/tailwind.css");
  const output = path.join(outputDir, "css", "site.css");
  const config = path.join(rootDir, "tailwind.config.cjs");

  execFileSync(process.execPath, [tailwindCli, "-c", config, "-i", input, "-o", output], {
    stdio: "inherit",
    cwd: rootDir
  });
}

function generateRss(context, outputDir) {
  const base = context.site.base_url;
  const hasAbsoluteUrl = base.startsWith("http://") || base.startsWith("https://");

  if (!hasAbsoluteUrl) {
    console.log("[NostrPress] Skipping rss.xml — set BASE_URL for a valid RSS feed with absolute URLs.");
    return;
  }

  const items = context.articles
    .map((article) => {
      const url = `${base}/${article.slug}.html`;
      return `\n    <item>\n      <title><![CDATA[${article.title}]]></title>\n      <link>${url}</link>\n      <guid>${url}</guid>\n      <pubDate>${new Date(article.published_at).toUTCString()}</pubDate>\n      <description><![CDATA[${article.summary}]]></description>\n    </item>`;
    })
    .join("");

  const rss = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title><![CDATA[${context.site.title}]]></title>\n    <link>${base}</link>\n    <description><![CDATA[${context.site.description}]]></description>${items}\n  </channel>\n</rss>`;

  fs.writeFileSync(path.join(outputDir, "rss.xml"), rss);
}

function generateSitemap(context, outputDir) {
  const base = context.site.base_url;
  const hasAbsoluteUrl = base.startsWith("http://") || base.startsWith("https://");

  if (!hasAbsoluteUrl) {
    console.log("[NostrPress] Skipping sitemap.xml — set BASE_URL for a valid sitemap with absolute URLs.");
    return;
  }

  const urls = [];
  urls.push(`${base}/`);

  if (context.allAuthors) {
    for (const author of context.allAuthors) {
      if (!author.isHome) {
        urls.push(`${base}${author.pageUrl.startsWith("/") ? author.pageUrl : "/" + author.pageUrl}`);
      }
    }
  }

  for (const article of context.articles) {
    urls.push(`${base}/${article.slug}.html`);
  }

  const tagSet = new Set();
  for (const article of context.articles) {
    for (const tag of article.tags) tagSet.add(normalizeTag(tag));
  }
  for (const tag of tagSet) {
    urls.push(`${base}/tags/${tag}/`);
  }

  const entries = urls
    .map((url) => `  <url><loc>${url}</loc></url>`)
    .join("\n");

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`;
  fs.writeFileSync(path.join(outputDir, "sitemap.xml"), sitemap);
}

async function run() {
  const args = parseArgs();
  const config = loadConfig(args.baseUrl);
  const pool = new SimplePool();

  // Determine which pubkeys/npubs to process
  const pubkeysToFetch = [];
  if (config.input.pubkeys && config.input.pubkeys.length > 0) {
    // If PUBKEYS env var is set, use those
    pubkeysToFetch.push(...config.input.pubkeys);
  } else if (config.input.npub_or_nprofile) {
    // Otherwise fall back to single NPUB
    pubkeysToFetch.push(config.input.npub_or_nprofile);
  } else {
    throw new Error("Either NPUB or PUBKEYS environment variable is required");
  }

  // Fetch data for each pubkey
  const authorsData = [];
  for (const pubkeyInput of pubkeysToFetch) {
    const identity = resolveIdentity(pubkeyInput, config.relays);
    // Fetch user's preferred relay list (NIP-65 event 10002)
    const userRelays = await fetchRelayList(pool, identity.relays, identity.pubkey, config.relays);
    const profile = await fetchProfileMetadata(pool, userRelays, identity.pubkey);
    const events = await fetchArticles(pool, config, identity.pubkey, userRelays);
    const parsed = events.map(parseArticle);
    const sorted = sortArticles(parsed);
    const withSummary = sorted.map((article) => ({
      ...article,
      summary: normalizeSummary(article.content, article.summary)
    }));
    
    // Fetch comments for this pubkey's articles
    const commentsMap = await fetchComments(pool, userRelays, withSummary);
    const withComments = withSummary.map((article) => ({
      ...article,
      comments: commentsMap.get(article.id) || []
    }));

    authorsData.push({
      identity,
      profile,
      articles: withComments
    });
  }

  await pool.close(config.relays);

  cleanOutput(config.output_dir);

  // Process media for all articles across all authors
  const allArticles = authorsData.flatMap(a => a.articles);
  const mediaResult = await processMedia(allArticles, config);
  
  // Rewrite content and render for all articles
  const processedAuthorsData = authorsData.map((authorData) => ({
    ...authorData,
    articles: authorData.articles.map((article) => {
      const rewritten = rewriteArticleContent(article, mediaResult.urlMap);
      return {
        ...rewritten,
        html: renderMarkdown(rewritten)
      };
    })
  }));

  // Use primary author (first one) for site context, but include all authors
  const primaryAuthor = processedAuthorsData[0];
  let context;
  
  // For multi-author setup: generate separate pages for each author
  if (processedAuthorsData.length > 1) {
    // Build list of all authors for navigation
    const allAuthorsNav = processedAuthorsData.map((a, index) => ({
      npub: a.identity.npub,
      pubkey: a.identity.pubkey,
      profile: a.profile,
      articleCount: a.articles.length,
      isHome: index === 0,
      pageUrl: index === 0 ? "/" : `/${a.identity.npub}.html`
    }));

    // Generate pages for each author
    for (let i = 0; i < processedAuthorsData.length; i++) {
      const authorData = processedAuthorsData[i];
      const isHomePage = i === 0;
      const articles = authorData.articles.sort((a, b) => b.published_at - a.published_at);
      
      context = buildContext(config, authorData.identity.npub, authorData.identity.pubkey, authorData.profile, articles);
      context.allAuthors = allAuthorsNav;
      context.currentAuthorNpub = authorData.identity.npub;
      context.currentPageUrl = isHomePage ? "" : `${authorData.identity.npub}.html`;
      
      const outputPath = isHomePage ? "index.html" : `${authorData.identity.npub}.html`;
      renderSite(context, config.output_dir, outputPath);
    }
  } else {
    // Single author: use original behavior
    context = buildContext(config, primaryAuthor.identity.npub, primaryAuthor.identity.pubkey, primaryAuthor.profile, primaryAuthor.articles);
    renderSite(context, config.output_dir);
  }
  writeStaticAssets(config.output_dir, packageRoot);
  runTailwind(config.output_dir, packageRoot);

  // Generate global RSS and Sitemap using articles from ALL authors
  const allProcessedArticles = processedAuthorsData.flatMap(a => a.articles);
  const sortedAllArticles = sortArticles(allProcessedArticles);
  
  // Use primary author for site-wide metadata in RSS/Sitemap
  const globalContext = buildContext(
    config, 
    primaryAuthor.identity.npub, 
    primaryAuthor.identity.pubkey, 
    primaryAuthor.profile, 
    sortedAllArticles
  );
  
  // Include all authors in context for sitemap generation
  if (processedAuthorsData.length > 1) {
    globalContext.allAuthors = processedAuthorsData.map((a, index) => ({
      npub: a.identity.npub,
      isHome: index === 0,
      pageUrl: index === 0 ? "/" : `/${a.identity.npub}.html`
    }));
  }

  generateRss(globalContext, config.output_dir);
  generateSitemap(globalContext, config.output_dir);
}

run().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
