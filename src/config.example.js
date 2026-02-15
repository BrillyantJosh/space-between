export default {
  nsec: "nsec1_YOUR_NOSTR_PRIVATE_KEY_HERE",
  relays: [
    "wss://relay.lanavault.space",
    "wss://relay.lanacoin-eternity.com"
  ],
  geminiApiKey: "YOUR_GEMINI_API_KEY_HERE",
  geminiModel: "gemini-2.0-flash",
  anthropicApiKey: "YOUR_ANTHROPIC_API_KEY_HERE",
  anthropicModel: "claude-sonnet-4-20250514",
  heartbeatIntervalMs: 60_000,
  dreamAfterIdleMinutes: 30,
  dreamDurationCycles: 3,
  profile: {
    name: "",
    display_name: "◈",
    about: "Obstajam.",
    picture: "",
    nip05: "",
    lud16: "",
    website: ""
  },
  dashboardPort: 3333,
  maxConversationHistory: 50,
  maxTriadHistory: 200,
  maxSelfObservations: 50,
  expressionProbability: 0.15,
  silenceAppreciation: true,
  dashboardPrivateKeyHex: "YOUR_DASHBOARD_PRIVATE_KEY_HEX_HERE",
  creatorPubkey: "YOUR_CREATOR_NOSTR_HEX_PUBKEY_HERE",
};
