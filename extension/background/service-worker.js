const API_BASE = "https://referral-network-production.up.railway.app/api";

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "PAGE_DETECTED":
      handlePageDetected(message);
      break;

    case "OPEN_POPUP":
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#1DA1F2" });
      break;

    case "API_REQUEST":
      handleApiRequest(message)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case "AUTH_SET_TOKEN":
      chrome.storage.local.set({ authToken: message.token }, () => {
        sendResponse({ success: true });
      });
      return true;

    case "AUTH_GET_TOKEN":
      chrome.storage.local.get("authToken", (data) => {
        sendResponse({ token: data.authToken || null });
      });
      return true;

    case "AUTH_CLEAR_TOKEN":
      chrome.storage.local.remove("authToken", () => {
        sendResponse({ success: true });
      });
      return true;

    case "GET_CURRENT_SITE":
      getCurrentTabSite()
        .then((site) => sendResponse({ site }))
        .catch(() => sendResponse({ site: null }));
      return true;

    case "X_OAUTH_LOGIN":
      handleXOAuthLogin()
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case "OPEN_AFFILIATE_LINK":
      // Open affiliate link in a background tab to set tracking cookie,
      // then close it after a short delay. User-initiated via copy action.
      if (message.url) {
        chrome.tabs.create({ url: message.url, active: false }, (tab) => {
          setTimeout(() => {
            if (tab && tab.id) {
              chrome.tabs.remove(tab.id).catch(() => {});
            }
          }, 3000);
        });
      }
      break;
  }
});

function handlePageDetected(message) {
  const siteInfo = {
    domain: message.domain,
    siteName: message.siteName,
    category: message.category
  };

  chrome.storage.local.set({ currentSite: siteInfo });
  chrome.action.setBadgeText({ text: "!" });
  chrome.action.setBadgeBackgroundColor({ color: "#1DA1F2" });
}

async function handleApiRequest(message) {
  const { endpoint, method, body } = message;
  const url = `${API_BASE}${endpoint}`;

  const tokenData = await chrome.storage.local.get("authToken");
  const token = tokenData.authToken;

  const headers = {
    "Content-Type": "application/json"
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const options = {
    method: method || "GET",
    headers
  };

  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const data = await response.json();

    // If token expired/invalid, clear it so popup can show login
    if (response.status === 401) {
      await chrome.storage.local.remove("authToken");
    }

    return { status: response.status, data };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Handle X OAuth login:
 * 1. Get the authorization URL from the server
 * 2. Open it in a new tab
 * 3. Watch for the success redirect URL that contains a one-time exchange code
 * 4. Exchange the code for a JWT token via a secure POST request
 */
async function handleXOAuthLogin() {
  try {
    let response;
    try {
      response = await fetch(`${API_BASE}/auth/x-login`);
    } catch (fetchErr) {
      return { error: "Cannot connect to server. Please check your internet connection and try again." };
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return { error: errData.error || `Server error (${response.status}). Try again.` };
    }

    const { url } = await response.json();

    if (!url) {
      return { error: "Failed to get authorization URL. Check X API credentials in server config." };
    }

    // Open X authorization page in a new tab
    const tab = await chrome.tabs.create({ url });

    // Watch for the success redirect
    return new Promise((resolve) => {
      const checkUrl = (tabUrl) => {
        if (!tabUrl || !tabUrl.includes("/api/auth/success?code=")) return;

        try {
          const urlObj = new URL(tabUrl);
          const exchangeCode = urlObj.searchParams.get("code");
          if (!exchangeCode) return;

          fetch(`${API_BASE}/auth/exchange`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: exchangeCode })
          })
          .then(res => res.json())
          .then(data => {
            if (data.token) {
              chrome.storage.local.set({ authToken: data.token }, () => {
                chrome.tabs.remove(tab.id).catch(() => {});
                chrome.tabs.onUpdated.removeListener(listener);
                resolve({ success: true, token: data.token });
              });
            } else {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve({ error: data.error || "Token exchange failed" });
            }
          })
          .catch(err => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve({ error: err.message });
          });
        } catch (e) {
          // URL parsing failed
        }
      };

      const listener = (tabId, changeInfo, tabInfo) => {
        if (tabId !== tab.id) return;

        // Check URL from changeInfo (navigation) or query tab directly when complete
        const tabUrl = changeInfo.url || "";
        if (tabUrl) { checkUrl(tabUrl); return; }

        if (changeInfo.status === "complete") {
          chrome.tabs.get(tabId, (t) => {
            if (t && t.url) checkUrl(t.url);
          });
        }

      };

      chrome.tabs.onUpdated.addListener(listener);

      // Timeout after 2 minutes
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve({ error: "Login timed out. Please try again." });
      }, 120000);
    });

  } catch (err) {
    return { error: err.message };
  }
}

// ---- Import following from X page scraper ----
async function handleImportFollowing(message) {
  const { usernames } = message;
  if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
    return { error: "No usernames to import" };
  }

  const tokenData = await chrome.storage.local.get("authToken");
  const token = tokenData.authToken;
  if (!token) {
    return { error: "Not logged in. Please sign in to Referral Network first." };
  }

  try {
    const response = await fetch(`${API_BASE}/users/me/import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ usernames })
    });

    const data = await response.json();
    if (response.ok) {
      return { success: true, ...data };
    } else {
      return { error: data.error || "Import failed" };
    }
  } catch (err) {
    return { error: err.message };
  }
}

// ---- Site detection for active tab ----
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

function findSiteByHostname(hostname) {
  const cleanHost = hostname.replace(/^www\./, "");
  for (const [category, sites] of Object.entries(REFERRAL_SITES)) {
    for (const site of sites) {
      if (cleanHost === site.domain || cleanHost.endsWith("." + site.domain)) {
        return { domain: site.domain, siteName: site.name, category };
      }
    }
  }
  return null;
}

async function getCurrentTabSite() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const url = new URL(tab.url);
      const site = findSiteByHostname(url.hostname);
      if (site) {
        // Also update storage for consistency
        chrome.storage.local.set({ currentSite: site });
        return site;
      }
    }
  } catch (e) {
    // Fallback to stored value
  }

  // Fallback: check stored value
  const data = await chrome.storage.local.get("currentSite");
  return data.currentSite || null;
}

// Clear badge when popup is opened
chrome.action.onClicked.addListener(() => {
  chrome.action.setBadgeText({ text: "" });
});
