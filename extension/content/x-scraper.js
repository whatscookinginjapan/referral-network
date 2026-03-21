// DEPRECATED: This file is no longer loaded by the extension.
// X following data is now fetched via the official X API through the server endpoint GET /api/users/me/following.
// This file is kept for reference only.
//
// X.com Following/Followers page scraper for Referral Network
// Runs on x.com/*/following and x.com/*/followers pages

(function () {
  const hostname = window.location.hostname;
  if (!hostname.match(/^(www\.)?(x\.com|twitter\.com)$/)) return;

  console.log("[Referral Network] X scraper loaded on", window.location.href);

  function checkAndInit() {
    const path = window.location.pathname;
    const match = path.match(/^\/([^/]+)\/(following|followers|verified_followers)$/);
    if (match) {
      console.log("[Referral Network] Detected following page:", match[1], match[2]);
      setTimeout(() => initScraper(match[1], match[2]), 1500);
    } else {
      removeUI();
    }
  }

  // Check on initial load
  checkAndInit();

  // Watch for SPA navigation (X is a single-page app)
  let lastPath = window.location.pathname;
  const observer = new MutationObserver(() => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      checkAndInit();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function removeUI() {
    const existing = document.getElementById("rn-scraper-bar");
    if (existing) existing.remove();
  }

  function initScraper(username, listType) {
    // Don't reinitialize if already present
    if (document.getElementById("rn-scraper-bar")) return;

    const collectedUsers = new Map();
    let isScanning = false;
    let scrollInterval = null;

    // Create the floating import bar
    const bar = document.createElement("div");
    bar.id = "rn-scraper-bar";
    bar.innerHTML = `
      <div style="
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-top: 2px solid #1DA1F2;
        padding: 12px 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 -4px 20px rgba(0,0,0,0.5);
      ">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="
            width:32px; height:32px; border-radius:50%; background:#1DA1F2;
            display:flex; align-items:center; justify-content:center;
            font-size:16px; font-weight:700; color:white;
          ">R</div>
          <div>
            <div style="color:#e7e9ea; font-size:14px; font-weight:600;">
              Referral Network — Import ${listType === 'following' ? 'Following' : 'Followers'}
            </div>
            <div id="rn-scan-status" style="color:#71767b; font-size:12px;">
              Ready to scan @${username}'s ${listType}
            </div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span id="rn-count" style="
            background:#1DA1F2; color:white; padding:4px 12px;
            border-radius:12px; font-size:13px; font-weight:600;
          ">0 found</span>
          <button id="rn-scan-btn" style="
            background:#1DA1F2; color:white; border:none; padding:8px 20px;
            border-radius:20px; font-size:13px; font-weight:700; cursor:pointer;
            transition: background 0.2s;
          ">Scan & Scroll</button>
          <button id="rn-import-btn" style="
            background:#00ba7c; color:white; border:none; padding:8px 20px;
            border-radius:20px; font-size:13px; font-weight:700; cursor:pointer;
            display:none; transition: background 0.2s;
          ">Import All</button>
          <button id="rn-close-btn" style="
            background:none; border:1px solid #536471; color:#71767b; padding:6px 12px;
            border-radius:20px; font-size:12px; cursor:pointer;
          ">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(bar);

    const scanBtn = document.getElementById("rn-scan-btn");
    const importBtn = document.getElementById("rn-import-btn");
    const closeBtn = document.getElementById("rn-close-btn");
    const countEl = document.getElementById("rn-count");
    const statusEl = document.getElementById("rn-scan-status");

    // Close bar
    closeBtn.addEventListener("click", () => bar.remove());

    // Scan button — scrapes visible users and auto-scrolls
    scanBtn.addEventListener("click", () => {
      if (isScanning) {
        stopScanning();
        return;
      }

      isScanning = true;
      scanBtn.textContent = "Stop Scanning";
      scanBtn.style.background = "#f4212e";
      statusEl.textContent = "Scanning... scrolling to load more users";

      // Scrape what's visible now
      scrapeVisibleUsers();

      // Auto-scroll to load more
      let noNewUsersCount = 0;
      let lastCount = collectedUsers.size;

      scrollInterval = setInterval(() => {
        // Scroll down
        window.scrollBy(0, 800);

        // Scrape new users
        scrapeVisibleUsers();

        // Check if we got new users
        if (collectedUsers.size === lastCount) {
          noNewUsersCount++;
        } else {
          noNewUsersCount = 0;
          lastCount = collectedUsers.size;
        }

        countEl.textContent = `${collectedUsers.size} found`;

        // Stop if no new users after 5 scroll attempts (likely reached the end)
        if (noNewUsersCount >= 5) {
          stopScanning();
          statusEl.textContent = `Scan complete! Found ${collectedUsers.size} users. Click "Import All" to add them.`;
        }
      }, 600);
    });

    function stopScanning() {
      isScanning = false;
      if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
      }
      scanBtn.textContent = "Scan & Scroll";
      scanBtn.style.background = "#1DA1F2";

      if (collectedUsers.size > 0) {
        importBtn.style.display = "inline-block";
        statusEl.textContent = `Found ${collectedUsers.size} users. Click "Import All" to add them.`;
      }
    }

    function scrapeVisibleUsers() {
      // X.com renders user cells in the following/followers list
      // Each user cell contains a link to their profile and their display name

      // Strategy 1: Look for user cells by data-testid
      const userCells = document.querySelectorAll('[data-testid="UserCell"]');
      for (const cell of userCells) {
        extractUserFromCell(cell);
      }

      // Strategy 2: Look for profile links in the list area
      // Following pages have links like /username with display names
      if (userCells.length === 0) {
        // Fallback: find all profile-like links
        const links = document.querySelectorAll('a[href^="/"][role="link"]');
        for (const link of links) {
          const href = link.getAttribute("href");
          if (href && href.match(/^\/[a-zA-Z0-9_]+$/) && !href.match(/^\/(home|explore|notifications|messages|settings|i|search)/)) {
            const uname = href.slice(1);
            // Try to get display name from nearby elements
            const nameEl = link.querySelector('span') || link;
            const displayName = nameEl?.textContent?.trim() || uname;
            if (uname && uname.length > 0 && uname.length < 30) {
              collectedUsers.set(uname.toLowerCase(), {
                username: uname,
                displayName: displayName
              });
            }
          }
        }
      }

      countEl.textContent = `${collectedUsers.size} found`;
    }

    function extractUserFromCell(cell) {
      // Inside UserCell, look for the username (starts with @) and display name
      const allText = cell.querySelectorAll('span');
      let username = null;
      let displayName = null;

      for (const span of allText) {
        const text = span.textContent.trim();
        if (text.startsWith('@') && !username) {
          username = text.slice(1);
        }
      }

      // Get display name from the first link that's a profile link
      const profileLinks = cell.querySelectorAll('a[href^="/"]');
      for (const link of profileLinks) {
        const href = link.getAttribute("href");
        if (href && href.match(/^\/[a-zA-Z0-9_]+$/) && !href.match(/^\/(home|explore|notifications|messages|settings|i|search)/)) {
          if (!username) {
            username = href.slice(1);
          }
          // Display name is usually in a span with dir="auto" inside the first link
          const nameSpan = link.querySelector('span');
          if (nameSpan && !nameSpan.textContent.startsWith('@')) {
            displayName = nameSpan.textContent.trim();
          }
        }
      }

      if (username) {
        collectedUsers.set(username.toLowerCase(), {
          username: username,
          displayName: displayName || username
        });
      }
    }

    // Import button — sends collected users to the extension
    importBtn.addEventListener("click", async () => {
      importBtn.textContent = "Importing...";
      importBtn.disabled = true;

      const usernames = Array.from(collectedUsers.values()).map(u => u.username);

      try {
        chrome.runtime.sendMessage({
          type: "IMPORT_FOLLOWING",
          usernames: usernames
        }, (response) => {
          if (response && response.success) {
            importBtn.textContent = "Imported!";
            importBtn.style.background = "#00ba7c";
            statusEl.textContent = `Imported ${response.imported} users. ${response.autoConnected} auto-connected!`;

            setTimeout(() => {
              importBtn.textContent = "Import All";
              importBtn.disabled = false;
            }, 3000);
          } else {
            importBtn.textContent = "Import Failed";
            statusEl.textContent = response?.error || "Failed to import. Is the server running?";
            importBtn.disabled = false;
          }
        });
      } catch (err) {
        importBtn.textContent = "Import Failed";
        importBtn.disabled = false;
        statusEl.textContent = "Error: " + err.message;
      }
    });
  }
})();
