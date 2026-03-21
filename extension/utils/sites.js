const REFERRAL_SITES = {
  credit_cards: [
    { domain: "chase.com", name: "Chase" },
    { domain: "americanexpress.com", name: "American Express" },
    { domain: "capitalone.com", name: "Capital One" },
    { domain: "discover.com", name: "Discover" },
    { domain: "citi.com", name: "Citi" }
  ],
  banks: [
    { domain: "marcus.com", name: "Marcus by Goldman Sachs" },
    { domain: "sofi.com", name: "SoFi" },
    { domain: "ally.com", name: "Ally" },
    { domain: "chime.com", name: "Chime" }
  ],
  shopping: [
    { domain: "amazon.com", name: "Amazon" },
    { domain: "rakuten.com", name: "Rakuten" },
    { domain: "honey.com", name: "Honey" },
    { domain: "target.com", name: "Target" }
  ],
  travel: [
    { domain: "airbnb.com", name: "Airbnb" },
    { domain: "uber.com", name: "Uber" },
    { domain: "lyft.com", name: "Lyft" },
    { domain: "hotels.com", name: "Hotels.com" }
  ],
  food_delivery: [
    { domain: "doordash.com", name: "DoorDash" },
    { domain: "ubereats.com", name: "Uber Eats" },
    { domain: "grubhub.com", name: "Grubhub" },
    { domain: "instacart.com", name: "Instacart" }
  ],
  crypto: [
    { domain: "coinbase.com", name: "Coinbase" },
    { domain: "robinhood.com", name: "Robinhood" },
    { domain: "webull.com", name: "Webull" }
  ],
  subscriptions: [
    { domain: "spotify.com", name: "Spotify" },
    { domain: "netflix.com", name: "Netflix" },
    { domain: "youtube.com", name: "YouTube" }
  ]
};

function getAllDomains() {
  const domains = [];
  for (const category of Object.keys(REFERRAL_SITES)) {
    for (const site of REFERRAL_SITES[category]) {
      domains.push(site.domain);
    }
  }
  return domains;
}

function findSiteByDomain(hostname) {
  const cleanHost = hostname.replace(/^www\./, "");
  for (const [category, sites] of Object.entries(REFERRAL_SITES)) {
    for (const site of sites) {
      if (cleanHost === site.domain || cleanHost.endsWith("." + site.domain)) {
        return { domain: site.domain, name: site.name, category };
      }
    }
  }
  return null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { REFERRAL_SITES, getAllDomains, findSiteByDomain };
}
