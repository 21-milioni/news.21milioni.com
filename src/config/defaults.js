export const defaultConfig = {
  input: {
    npub_or_nprofile: ""
  },
  relays: [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.primal.net",
    "wss://relay.snort.social",
    "wss://nostr.land",
    "wss://nostr-pub.wellorder.net",
    "wss://offchain.pub",
    "wss://relay.nostr.band"
  ],
  trusted_only: true,
  output_dir: "./dist",
  site: {
    title: "auto",
    description: "auto",
    base_url: ""
  },
  media: {
    download: true,
    max_size_mb: 20,
    allowed_mime: ["image/*", "video/mp4"],
    dedupe: true
  },
  fetch: {
    include_kind1: false
  },
  timeouts: {
    network_ms: 15000
  }
};
