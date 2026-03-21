// Minimal content script for referral-eligible sites
// Only notifies the service worker — no DOM modification on sensitive financial sites
(function () {
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
      { domain: "target.com", name: "Target" },
      { domain: "fetchrewards.com", name: "Fetch Rewards" },
      { domain: "ibotta.com", name: "Ibotta" }
    ],
    travel: [
      { domain: "airbnb.com", name: "Airbnb" },
      { domain: "uber.com", name: "Uber" },
      { domain: "lyft.com", name: "Lyft" },
      { domain: "hotels.com", name: "Hotels.com" },
      { domain: "turo.com", name: "Turo" },
      { domain: "getaround.com", name: "Getaround" }
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
    ],
    fintech: [
      { domain: "cash.app", name: "Cash App" },
      { domain: "venmo.com", name: "Venmo" },
      { domain: "paypal.com", name: "PayPal" }
    ],
    investing: [
      { domain: "wealthfront.com", name: "Wealthfront" },
      { domain: "betterment.com", name: "Betterment" },
      { domain: "acorns.com", name: "Acorns" },
      { domain: "m1finance.com", name: "M1 Finance" },
      { domain: "public.com", name: "Public.com" }
    ],
    insurance: [
      { domain: "lemonade.com", name: "Lemonade" },
      { domain: "rootinsurance.com", name: "Root Insurance" }
    ],
    health_fitness: [
      { domain: "onepeloton.com", name: "Peloton" },
      { domain: "classpass.com", name: "ClassPass" },
      { domain: "tonal.com", name: "Tonal" }
    ],
    education: [
      { domain: "skillshare.com", name: "Skillshare" },
      { domain: "masterclass.com", name: "MasterClass" },
      { domain: "audible.com", name: "Audible" }
    ],
    vpn_security: [
      { domain: "nordvpn.com", name: "NordVPN" },
      { domain: "expressvpn.com", name: "ExpressVPN" },
      { domain: "surfshark.com", name: "Surfshark" }
    ],
    telecom: [
      { domain: "t-mobile.com", name: "T-Mobile" },
      { domain: "mintmobile.com", name: "Mint Mobile" },
      { domain: "visible.com", name: "Visible" },
      { domain: "fi.google.com", name: "Google Fi" },
      { domain: "usmobile.com", name: "US Mobile" }
    ],
    cloud_tech: [
      { domain: "digitalocean.com", name: "DigitalOcean" },
      { domain: "dropbox.com", name: "Dropbox" },
      { domain: "notion.so", name: "Notion" }
    ],
    energy_auto: [
      { domain: "tesla.com", name: "Tesla" },
      { domain: "arcadia.com", name: "Arcadia" }
    ]
  };

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

  const siteInfo = findSiteByDomain(window.location.hostname);
  if (!siteInfo) return;

  // Only notify service worker — no DOM injection on sensitive sites
  chrome.runtime.sendMessage({
    type: "PAGE_DETECTED",
    domain: siteInfo.domain,
    siteName: siteInfo.name,
    category: siteInfo.category
  });
})();
