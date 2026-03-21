// ---- API Helper ----
function apiRequest(endpoint, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "API_REQUEST", endpoint, method, body },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.error) {
          reject(new Error(response.error));
          return;
        }
        // Token expired or invalid — clear state and show login
        if (response && response.status === 401) {
          currentUser = null;
          clearToken().then(() => showSection("login"));
          reject(new Error("Session expired. Please sign in again."));
          return;
        }
        resolve(response);
      }
    );
  });
}

function getToken() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "AUTH_GET_TOKEN" }, (res) => {
      resolve(res ? res.token : null);
    });
  });
}

function setToken(token) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "AUTH_SET_TOKEN", token }, () => {
      resolve();
    });
  });
}

function clearToken() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "AUTH_CLEAR_TOKEN" }, () => {
      resolve();
    });
  });
}

function getCurrentSite() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_CURRENT_SITE" }, (res) => {
      resolve(res ? res.site : null);
    });
  });
}

// ---- Supported categories for display ----
const CATEGORY_LABELS = {
  credit_cards: "Credit Cards",
  banks: "Banks",
  shopping: "Shopping",
  travel: "Travel",
  food_delivery: "Food Delivery",
  crypto: "Crypto",
  subscriptions: "Subscriptions",
  fintech: "Fintech",
  investing: "Investing",
  insurance: "Insurance",
  health_fitness: "Health & Fitness",
  education: "Education",
  vpn_security: "VPN & Security",
  telecom: "Telecom",
  cloud_tech: "Cloud & Tech",
  energy_auto: "Energy & Auto"
};

// ---- DOM References ----
const loginSection = document.getElementById("login-section");
const consentSection = document.getElementById("consent-section");
const mainSection = document.getElementById("main-section");
const addSection = document.getElementById("add-section");
const networkSection = document.getElementById("network-section");
const profileSection = document.getElementById("profile-section");
const bottomNav = document.getElementById("bottom-nav");

const loginBtn = document.getElementById("login-btn");
const loginStatus = document.getElementById("login-status");
const logoutBtn = document.getElementById("logout-btn");

const consentShare = document.getElementById("consent-share");
const consentReceive = document.getElementById("consent-receive");
const consentTerms = document.getElementById("consent-terms");
const consentBtn = document.getElementById("consent-btn");

const siteName = document.getElementById("site-name");
const categoryBadge = document.getElementById("category-badge");
const codesList = document.getElementById("codes-list");
const notOnSite = document.getElementById("not-on-site");
const supportedCategories = document.getElementById("supported-categories");
const emptyState = document.getElementById("empty-state");
const loadingEl = document.getElementById("loading");
const addCodeBtn = document.getElementById("add-code-btn");
const backFromAdd = document.getElementById("back-from-add");
const addForm = document.getElementById("add-form");

const networkStats = document.getElementById("network-stats");
const networkList = document.getElementById("network-list");
const discoverList = document.getElementById("discover-list");
const myNetworkTitle = document.getElementById("my-network-title");
const discoverTitle = document.getElementById("discover-title");
const networkEmpty = document.getElementById("network-empty");
const networkLoading = document.getElementById("network-loading");
const addUsernameInput = document.getElementById("add-username-input");
const addUsernameBtn = document.getElementById("add-username-btn");
const addUsernameError = document.getElementById("add-username-error");
const addUsernameSuccess = document.getElementById("add-username-success");

const suggestSection = document.getElementById("suggest-section");

const profileAvatar = document.getElementById("profile-avatar");
const profileName = document.getElementById("profile-name");
const profileHandle = document.getElementById("profile-handle");
const profileCodes = document.getElementById("profile-codes");
const profileEmpty = document.getElementById("profile-empty");

let currentUser = null;
let currentSiteInfo = null;

// ---- Navigation ----
const allSections = [loginSection, consentSection, mainSection, addSection, networkSection, profileSection, suggestSection];

function showSection(name) {
  allSections.forEach(s => s.classList.add("hidden"));

  switch (name) {
    case "login":
      loginSection.classList.remove("hidden");
      bottomNav.classList.add("hidden");
      break;
    case "consent":
      consentSection.classList.remove("hidden");
      bottomNav.classList.add("hidden");
      break;
    case "main":
      mainSection.classList.remove("hidden");
      bottomNav.classList.remove("hidden");
      break;
    case "add":
      addSection.classList.remove("hidden");
      bottomNav.classList.add("hidden");
      break;
    case "network":
      networkSection.classList.remove("hidden");
      bottomNav.classList.remove("hidden");
      break;
    case "profile":
      profileSection.classList.remove("hidden");
      bottomNav.classList.remove("hidden");
      break;
    case "suggest":
      suggestSection.classList.remove("hidden");
      bottomNav.classList.add("hidden");
      break;
  }
}

// Tab navigation
document.querySelectorAll(".nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    if (target === "codes") {
      showSection("main");
    } else if (target === "network") {
      showSection("network");
      loadNetwork();
    } else if (target === "profile") {
      showSection("profile");
      loadProfile();
    }
  });
});

// ---- Consent ----
function updateConsentBtn() {
  consentBtn.disabled = !(consentShare.checked && consentReceive.checked && consentTerms.checked);
}

consentShare.addEventListener("change", updateConsentBtn);
consentReceive.addEventListener("change", updateConsentBtn);
consentTerms.addEventListener("change", updateConsentBtn);

consentBtn.addEventListener("click", async () => {
  consentBtn.textContent = "Saving...";
  consentBtn.disabled = true;

  try {
    await apiRequest("/users/me/consent", "POST");
    currentUser.consented = 1;
    await initMainView();
  } catch (err) {
    showError(consentSection, "Failed to save consent. Please try again.");
    consentBtn.textContent = "Agree & Continue";
    consentBtn.disabled = false;
  }
});

// ---- Login ----
loginBtn.addEventListener("click", async () => {
  loginBtn.disabled = true;
  loginBtn.textContent = "Opening X...";
  loginStatus.style.display = "block";
  loginStatus.textContent = "Authorizing with X...";

  // Check if server is reachable before attempting OAuth
  chrome.runtime.sendMessage({ type: "X_OAUTH_LOGIN" }, (result) => {
    if (result && result.error) {
      showError(loginSection, result.error);
      resetLoginBtn();
    }
  });

  // Poll for token in case popup stays open
  let attempts = 0;
  const pollInterval = setInterval(async () => {
    attempts++;
    const token = await getToken();
    if (token) {
      clearInterval(pollInterval);
      loginStatus.textContent = "Login successful! Loading...";
      try {
        const res = await apiRequest("/auth/me");
        if (res.status === 200 && res.data && res.data.user) {
          currentUser = res.data.user;
          if (currentUser.consented !== 1) {
            showSection("consent");
          } else {
            await initMainView();
          }
          return;
        }
      } catch (e) {}
      showError(loginSection, "Failed to load profile.");
      resetLoginBtn();
    } else if (attempts > 120) {
      clearInterval(pollInterval);
      showError(loginSection, "Login timed out. Please try again.");
      resetLoginBtn();
    }
  }, 1000);
});

function resetLoginBtn() {
  loginBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="margin-right:8px;">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
    Sign in with X
  `;
  loginBtn.disabled = false;
  loginStatus.style.display = "none";
}

// ---- Logout ----
logoutBtn.addEventListener("click", async () => {
  await clearToken();
  currentUser = null;
  showSection("login");
});

// ---- Init ----
async function init() {
  const token = await getToken();
  if (token) {
    try {
      const res = await apiRequest("/auth/me");
      if (res.status === 200 && res.data && res.data.user) {
        currentUser = res.data.user;
        if (currentUser.consented !== 1) {
          showSection("consent");
        } else {
          await initMainView();
        }
        return;
      }
    } catch (e) {
      // token invalid
    }
    await clearToken();
  }
  showSection("login");
}

async function initMainView() {
  showSection("main");
  currentSiteInfo = await getCurrentSite();

  if (currentSiteInfo) {
    siteName.textContent = currentSiteInfo.siteName;
    categoryBadge.textContent = CATEGORY_LABELS[currentSiteInfo.category] || currentSiteInfo.category;
    categoryBadge.className = "badge badge-" + currentSiteInfo.category;
    addCodeBtn.classList.remove("hidden");
    notOnSite.classList.add("hidden");
    loadCodes(currentSiteInfo.domain);
  } else {
    siteName.textContent = "Referral Network";
    categoryBadge.classList.add("hidden");
    addCodeBtn.classList.add("hidden");
    codesList.classList.add("hidden");
    emptyState.classList.add("hidden");
    notOnSite.classList.remove("hidden");
    renderSupportedCategories();
  }
}

function renderSupportedCategories() {
  supportedCategories.innerHTML = "";
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    const badge = document.createElement("span");
    badge.className = "badge badge-" + key;
    badge.textContent = label;
    supportedCategories.appendChild(badge);
  }
}

// ---- Load Codes ----
async function loadCodes(domain) {
  codesList.innerHTML = "";
  emptyState.classList.add("hidden");
  loadingEl.classList.remove("hidden");
  codesList.classList.remove("hidden");

  try {
    const res = await apiRequest(`/referrals?domain=${encodeURIComponent(domain)}`);
    loadingEl.classList.add("hidden");

    const data = res.data || {};
    const networkCodes = data.networkCodes || [];
    const otherCodes = data.otherCodes || [];
    const allCodes = data.referrals || [...networkCodes, ...otherCodes];

    if (allCodes.length === 0) {
      emptyState.classList.remove("hidden");
      return;
    }

    // Group codes by user
    function groupByUser(codes) {
      const map = new Map();
      for (const code of codes) {
        const uid = code.user?.id || 'unknown';
        if (!map.has(uid)) map.set(uid, { user: code.user, codes: [] });
        map.get(uid).codes.push(code);
      }
      return Array.from(map.values());
    }

    // "From Your Network" section
    if (networkCodes.length > 0) {
      const header = document.createElement("div");
      header.className = "codes-section-header";
      header.innerHTML = '<span class="section-icon">&#9733;</span> From Your Network';
      codesList.appendChild(header);

      const grouped = groupByUser(networkCodes);
      grouped.forEach(group => {
        const row = createUserRow(group.user, group.codes, true);
        codesList.appendChild(row);
      });
    }

    // "Other Codes" section
    if (otherCodes.length > 0) {
      if (networkCodes.length > 0) {
        const header = document.createElement("div");
        header.className = "codes-section-header other";
        header.textContent = "Other Codes";
        codesList.appendChild(header);
      }

      const grouped = groupByUser(otherCodes);
      grouped.forEach(group => {
        const row = createUserRow(group.user, group.codes, false);
        codesList.appendChild(row);
      });
    }

    // Fallback
    if (networkCodes.length === 0 && otherCodes.length === 0 && allCodes.length > 0) {
      const grouped = groupByUser(allCodes);
      grouped.forEach(group => {
        codesList.appendChild(createUserRow(group.user, group.codes, false));
      });
    }

    // Build filter bar with product type chips + search
    const filterBar = document.getElementById("codes-filter-bar");
    const productTypeFilters = document.getElementById("product-type-filters");
    const codesSearch = document.getElementById("codes-search");

    // Filter both user rows and individual code rows within them
    function applyFilter(mode, value) {
      // mode: 'all', 'product', or 'search'
      codesList.querySelectorAll(".user-row").forEach(row => {
        const codeRows = row.querySelectorAll(".code-row");
        let anyCodeVisible = false;

        codeRows.forEach(cr => {
          let show = true;
          if (mode === 'product') {
            const crPt = (cr.dataset.productType || '').toLowerCase();
            show = crPt === value;
          } else if (mode === 'search') {
            show = cr.textContent.toLowerCase().includes(value);
          }
          cr.style.display = show ? "" : "none";
          if (show) anyCodeVisible = true;
        });

        // Also check user row text for search
        if (mode === 'search') {
          const headerText = row.querySelector('.user-row-header')?.textContent?.toLowerCase() || '';
          if (headerText.includes(value)) anyCodeVisible = true;
        }

        row.style.display = (mode === 'all' || anyCodeVisible) ? "" : "none";
      });

      // Update section headers
      codesList.querySelectorAll(".codes-section-header").forEach(h => {
        let next = h.nextElementSibling;
        let anyVisible = false;
        while (next && !next.classList.contains("codes-section-header")) {
          if (next.classList.contains("user-row") && next.style.display !== "none") anyVisible = true;
          next = next.nextElementSibling;
        }
        h.style.display = anyVisible ? "" : "none";
      });
    }

    if (allCodes.length > 0) {
      filterBar.classList.remove("hidden");

      const productTypes = [...new Set(allCodes.map(c => c.product_type).filter(Boolean))].sort();

      productTypeFilters.innerHTML = "";
      if (productTypes.length > 0) {
        const allChip = document.createElement("button");
        allChip.className = "filter-chip active";
        allChip.textContent = "All";
        allChip.addEventListener("click", () => {
          productTypeFilters.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
          allChip.classList.add("active");
          applyFilter('all');
        });
        productTypeFilters.appendChild(allChip);

        for (const pt of productTypes) {
          const chip = document.createElement("button");
          chip.className = "filter-chip";
          chip.textContent = pt;
          chip.addEventListener("click", () => {
            productTypeFilters.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            applyFilter('product', pt.toLowerCase());
          });
          productTypeFilters.appendChild(chip);
        }
      }

      if (codesSearch) {
        codesSearch.value = "";
        codesSearch.addEventListener("input", () => {
          const query = codesSearch.value.toLowerCase().trim();
          productTypeFilters.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
          const allChipEl = productTypeFilters.querySelector(".filter-chip");
          if (allChipEl) allChipEl.classList.add("active");
          applyFilter('search', query);
        });
      }
    } else {
      filterBar.classList.add("hidden");
    }
  } catch (err) {
    loadingEl.classList.add("hidden");
    emptyState.classList.remove("hidden");
    emptyState.querySelector("p").textContent = "Could not load codes. Check server connection.";
  }
}

function createUserRow(user, codes, isNetwork) {
  const container = document.createElement("div");
  container.className = "user-row" + (isNetwork ? " network-code" : "");

  const displayName = user?.x_display_name || user?.x_username || "User";
  const username = user?.x_username || "unknown";
  const followers = user?.x_followers_count || 0;
  const profilePic = user?.x_profile_image || "";
  const initial = displayName.charAt(0).toUpperCase();
  const isOwnUser = currentUser && (user?.id === currentUser.id);

  const safeProfilePic = sanitizeImageUrl(profilePic);
  const avatarContent = safeProfilePic
    ? `<img src="${safeProfilePic}" alt="${escapeAttr(displayName)}">`
    : initial;

  // Code count for collapsed view
  const productTypes = codes.map(c => c.product_type).filter(Boolean);
  const ptSummary = `<span class="code-count-chip">${codes.length} code${codes.length !== 1 ? 's' : ''}</span>`;

  // Store product types as data for filtering
  container.dataset.productTypes = productTypes.map(p => p.toLowerCase()).join(',');

  // User header row (always visible, clickable to expand)
  const headerEl = document.createElement("div");
  headerEl.className = "user-row-header";
  headerEl.innerHTML = `
    <div class="user-row-avatar">${avatarContent}</div>
    <div class="user-row-info">
      <div class="user-row-name">${escapeHtml(displayName)}${isOwnUser ? ' <span class="own-code-tag">You</span>' : ''}</div>
      <div class="user-row-meta">@${escapeHtml(username)} · ${formatNumber(followers)} followers</div>
    </div>
    <div class="user-row-products">${ptSummary}</div>
    <div class="user-row-toggle">&#9660;</div>
  `;
  container.appendChild(headerEl);

  // Codes panel (hidden by default)
  const codesPanel = document.createElement("div");
  codesPanel.className = "user-row-codes hidden";

  codes.forEach(code => {
    const codeRow = document.createElement("div");
    codeRow.className = "code-row";
    if (code.product_type) codeRow.dataset.productType = code.product_type.toLowerCase();

    const copies = code.copy_count || 0;
    const successes = code.success_count || 0;
    const isOwnCode = currentUser && (code.user?.id === currentUser.id);
    const codeValue = code.code || '';
    const isUrl = /^https?:\/\//i.test(codeValue);

    // Usage limit
    const usageLimit = code.usage_limit;
    let usageBadge = '';
    if (usageLimit) {
      if (usageLimit.exhausted) usageBadge = '<span class="usage-limit exhausted">Limit reached</span>';
      else if (usageLimit.remaining <= 3) usageBadge = `<span class="usage-limit low">${usageLimit.remaining} left</span>`;
    }

    // Display: product type as label, site name, and if URL make it a link
    // Stats inline
    const statsInline = [];
    if (copies > 0) statsInline.push(`${formatNumber(copies)} copied`);
    if (successes > 0) statsInline.push(`${formatNumber(successes)} used`);
    const statsText = statsInline.length > 0 ? `<span class="code-row-stats">${statsInline.join(' · ')}</span>` : '';

    // Verified badge: small circle with checkmark
    const verified = code.verification_status === 'verified'
      ? '<span class="verified-badge-circle" title="Verified code"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#00ba7c"/><path d="M9 12l2 2 4-4" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'
      : '';

    // Code row header
    const codeHeader = document.createElement("div");
    codeHeader.className = "code-row-header";

    // Left side: [Product Type] + verified + stats
    let leftHtml = '';
    if (code.product_type) {
      leftHtml += `<span class="code-product-type-sm">${escapeHtml(code.product_type)}</span>`;
    }
    leftHtml += verified;
    leftHtml += usageBadge + statsText;

    codeHeader.innerHTML = `
      <div class="code-row-left">
        ${leftHtml}
      </div>
      <div class="code-row-right">
        ${isUrl
          ? `<a href="${escapeAttr(codeValue)}" target="_blank" class="referral-link-btn">Use Referral &rarr;</a>`
          : `<span class="code-text-inline">${escapeHtml(codeValue)}</span><button class="copy-btn" data-code="${escapeAttr(codeValue)}">Copy</button>`
        }
        <span class="code-row-expand">&#9660;</span>
      </div>
    `;
    codeRow.appendChild(codeHeader);

    // Expandable detail panel
    const detailPanel = document.createElement("div");
    detailPanel.className = "code-row-detail hidden";
    const statsHtml = (copies > 0 || successes > 0)
      ? `<div class="code-stats">${copies > 0 ? `<span>${formatNumber(copies)} copied</span>` : ''}${successes > 0 ? `<span>${formatNumber(successes)} used</span>` : ''}</div>`
      : '';
    detailPanel.innerHTML = `
      ${code.description ? `<div class="code-description">${escapeHtml(code.description)}</div>` : '<div class="code-description" style="color:#536471;">No description</div>'}
      ${statsHtml}
      <div class="code-disclosure">The code sharer may receive a reward. Referral Network may earn a commission if you sign up.</div>
      <div class="code-actions">
        ${isOwnCode
          ? `<button class="btn btn-small btn-outline edit-own-btn" data-id="${code.id}">Edit</button>
             <button class="btn btn-small btn-danger delete-own-btn" data-id="${code.id}">Delete</button>`
          : `<button class="used-btn" data-id="${code.id}">I used this</button>
             <button class="report-btn" data-id="${code.id}">Report</button>`
        }
      </div>
      ${isOwnCode ? `
      <div class="edit-form hidden" data-id="${code.id}">
        <div class="form-group" style="margin-top:8px;">
          <label style="font-size:11px;color:#71767b;">Product Type</label>
          <input type="text" class="input-field edit-product-type" value="${escapeAttr(code.product_type || '')}" placeholder="e.g., Sapphire Preferred" maxlength="100">
        </div>
        <div class="form-group">
          <label style="font-size:11px;color:#71767b;">Code / Link</label>
          <input type="text" class="input-field edit-code" value="${escapeAttr(codeValue)}" placeholder="Referral code or link">
        </div>
        <div class="form-group">
          <label style="font-size:11px;color:#71767b;">Description</label>
          <textarea class="input-field textarea edit-description" rows="2" placeholder="Description">${escapeHtml(code.description || '')}</textarea>
        </div>
        <div class="code-actions">
          <button class="btn btn-small btn-primary save-edit-btn">Save</button>
          <button class="btn btn-small btn-outline cancel-edit-btn">Cancel</button>
        </div>
      </div>` : ''}
    `;
    codeRow.appendChild(detailPanel);

    // Toggle detail on click
    codeHeader.querySelector(".code-row-expand").addEventListener("click", (e) => {
      e.stopPropagation();
      detailPanel.classList.toggle("hidden");
      e.target.textContent = detailPanel.classList.contains("hidden") ? "\u25BC" : "\u25B2";
    });

    // Copy button (only for plain text codes)
    const copyBtn = codeHeader.querySelector(".copy-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(copyBtn.dataset.code).then(() => {
          copyBtn.textContent = "Copied!";
          copyBtn.classList.add("copied");
          setTimeout(() => { copyBtn.textContent = "Copy"; copyBtn.classList.remove("copied"); }, 2000);
        });
        if (code.id) apiRequest(`/referrals/${code.id}/copy`, "POST").catch(() => {});
        if (currentSiteInfo) {
          try {
            apiRequest("/affiliates/track", "POST", { site_domain: currentSiteInfo.domain, referral_code_id: code.id, action: "copy" }).catch(() => {});
            const affRes = await apiRequest(`/affiliates/link?domain=${encodeURIComponent(currentSiteInfo.domain)}`);
            if (affRes.data?.affiliate?.affiliate_url) {
              chrome.runtime.sendMessage({ type: "OPEN_AFFILIATE_LINK", url: affRes.data.affiliate.affiliate_url });
            }
          } catch (e) {}
        }
      });
    }

    // Track clicks on referral links — disable after click to prevent spam
    const refLink = codeHeader.querySelector(".referral-link-btn");
    if (refLink) {
      let linkClicked = false;
      refLink.addEventListener("click", (e) => {
        if (linkClicked) {
          e.preventDefault();
          return;
        }
        linkClicked = true;
        refLink.classList.add("referral-link-used");
        refLink.textContent = "Opened ✓";

        if (code.id) apiRequest(`/referrals/${code.id}/copy`, "POST").catch(() => {});
        if (currentSiteInfo) {
          apiRequest("/affiliates/track", "POST", { site_domain: currentSiteInfo.domain, referral_code_id: code.id, action: "click" }).catch(() => {});
        }

        // Re-enable after 30 seconds
        setTimeout(() => {
          linkClicked = false;
          refLink.classList.remove("referral-link-used");
          refLink.innerHTML = "Use Referral &rarr;";
        }, 30000);
      });
    }

    // Used button
    const usedBtn = detailPanel.querySelector(".used-btn");
    if (usedBtn) {
      usedBtn.addEventListener("click", async () => {
        usedBtn.textContent = "Thanks!"; usedBtn.disabled = true; usedBtn.style.color = "#00ba7c";
        try { await apiRequest(`/referrals/${code.id}/used`, "POST"); } catch (e) {}
      });
    }

    // Report button
    const reportBtn = detailPanel.querySelector(".report-btn");
    if (reportBtn) {
      reportBtn.addEventListener("click", async () => {
        if (!confirm("Report this referral code as suspicious?")) return;
        reportBtn.textContent = "Reported"; reportBtn.disabled = true; reportBtn.style.color = "#f4212e";
        try { await apiRequest(`/referrals/${code.id}/report`, "POST", { reason: "suspicious" }); } catch (e) {}
      });
    }

    // Delete button
    const deleteBtn = detailPanel.querySelector(".delete-own-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        if (!confirm("Delete this referral code?")) return;
        deleteBtn.textContent = "Deleting..."; deleteBtn.disabled = true;
        try {
          await apiRequest(`/referrals/${code.id}`, "DELETE");
          codeRow.remove();
          if (codesPanel.children.length === 0) container.remove();
        } catch (e) { deleteBtn.textContent = "Delete"; deleteBtn.disabled = false; }
      });
    }

    // Edit button
    const editBtn = detailPanel.querySelector(".edit-own-btn");
    const editForm = detailPanel.querySelector(".edit-form");
    if (editBtn && editForm) {
      editBtn.addEventListener("click", () => {
        editForm.classList.toggle("hidden");
        editBtn.textContent = editForm.classList.contains("hidden") ? "Edit" : "Editing...";
      });

      const cancelBtn = editForm.querySelector(".cancel-edit-btn");
      cancelBtn.addEventListener("click", () => {
        editForm.classList.add("hidden");
        editBtn.textContent = "Edit";
      });

      const saveBtn = editForm.querySelector(".save-edit-btn");
      saveBtn.addEventListener("click", async () => {
        const newProductType = editForm.querySelector(".edit-product-type").value.trim();
        const newCode = editForm.querySelector(".edit-code").value.trim();
        const newDescription = editForm.querySelector(".edit-description").value.trim();

        if (!newCode) {
          showError(mainSection, "Code cannot be empty.");
          return;
        }

        saveBtn.textContent = "Saving...";
        saveBtn.disabled = true;

        try {
          await apiRequest(`/referrals/${code.id}`, "PUT", {
            code: newCode,
            product_type: newProductType,
            description: newDescription
          });

          // Reload codes to reflect changes
          editForm.classList.add("hidden");
          editBtn.textContent = "Edit";
          if (currentSiteInfo) loadCodes(currentSiteInfo.domain);
        } catch (err) {
          showError(mainSection, err.message || "Failed to save changes.");
        }

        saveBtn.textContent = "Save";
        saveBtn.disabled = false;
      });
    }

    codesPanel.appendChild(codeRow);
  });

  container.appendChild(codesPanel);

  // Toggle codes panel on header click
  headerEl.addEventListener("click", () => {
    codesPanel.classList.toggle("hidden");
    headerEl.querySelector(".user-row-toggle").textContent = codesPanel.classList.contains("hidden") ? "\u25BC" : "\u25B2";
  });

  return container;
}

function createCodeCard(code) {
  const card = document.createElement("div");
  card.className = "code-card";

  const user = code.user || {};
  const displayName = user.x_display_name || user.displayName || user.display_name || user.x_username || "User";
  const username = user.x_username || user.username || "unknown";
  const followers = user.x_followers_count || user.followersCount || user.followers_count || 0;
  const profilePic = user.x_profile_image || user.profileImageUrl || user.profile_image_url || "";
  const initial = displayName.charAt(0).toUpperCase();
  const copies = code.copy_count || 0;
  const successes = code.success_count || 0;

  const safeProfilePic = sanitizeImageUrl(profilePic);
  const avatarContent = safeProfilePic
    ? `<img src="${safeProfilePic}" alt="${escapeAttr(displayName)}">`
    : initial;

  // Usage limit warning
  const usageLimit = code.usage_limit;
  let usageLimitHtml = '';
  if (usageLimit) {
    if (usageLimit.exhausted) {
      usageLimitHtml = '<span class="usage-limit exhausted">Limit reached</span>';
    } else if (usageLimit.remaining <= 3) {
      usageLimitHtml = `<span class="usage-limit low">${usageLimit.remaining} uses left</span>`;
    }
  }

  // Stats line
  const statsHtml = `<div class="code-stats">${copies > 0 ? `<span>${formatNumber(copies)} copied</span>` : ''}${successes > 0 ? `<span>${formatNumber(successes)} used</span>` : ''}${usageLimitHtml}</div>`;

  // Check if this is the current user's own code
  const isOwnCode = currentUser && (code.user?.id === currentUser.id);

  const productType = code.product_type || '';

  // Store product type as data attribute for filtering
  if (productType) card.dataset.productType = productType.toLowerCase();

  card.innerHTML = `
    <div class="code-card-header">
      <div class="code-avatar">${avatarContent}</div>
      <div class="code-user-info">
        <div class="code-display-name">${escapeHtml(displayName)}${isOwnCode ? ' <span class="own-code-tag">Your code</span>' : ''}</div>
        <div class="code-username">@${escapeHtml(username)} · <span>${formatNumber(followers)}</span> followers</div>
      </div>
    </div>
    <div class="code-body">
      ${productType ? `<div class="code-product-type">${escapeHtml(productType)}</div>` : ''}
      ${renderVerificationBadge(code.verification_status)}
      <div class="code-value">
        <span class="code-text">${escapeHtml(code.code || code.referralCode || "")}</span>
        <button class="copy-btn" data-code="${escapeAttr(code.code || code.referralCode || "")}">Copy</button>
      </div>
      ${code.description ? `<div class="code-description">${escapeHtml(code.description)}</div>` : ""}
      ${statsHtml}
      <div class="code-disclosure">The code sharer may receive a reward. Referral Network may earn a commission if you sign up.</div>
      <div class="code-actions">
        ${isOwnCode
          ? `<button class="btn btn-small btn-danger delete-own-btn" data-id="${code.id}">Delete</button>`
          : `<button class="used-btn" data-id="${code.id}" title="I successfully used this code">I used this</button>
             <button class="report-btn" data-id="${code.id}" title="Report suspicious code">Report</button>`
        }
      </div>
    </div>
  `;

  const copyBtn = card.querySelector(".copy-btn");
  copyBtn.addEventListener("click", async () => {
    navigator.clipboard.writeText(copyBtn.dataset.code).then(() => {
      copyBtn.textContent = "Copied!";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.textContent = "Copy";
        copyBtn.classList.remove("copied");
      }, 2000);
    });

    // Track copy count + affiliate
    if (code.id) {
      apiRequest(`/referrals/${code.id}/copy`, "POST").catch(() => {});
    }
    if (currentSiteInfo) {
      try {
        apiRequest("/affiliates/track", "POST", {
          site_domain: currentSiteInfo.domain,
          referral_code_id: code.id || null,
          action: "copy"
        }).catch(() => {});

        const affRes = await apiRequest(`/affiliates/link?domain=${encodeURIComponent(currentSiteInfo.domain)}`);
        if (affRes.data && affRes.data.affiliate && affRes.data.affiliate.affiliate_url) {
          chrome.runtime.sendMessage({
            type: "OPEN_AFFILIATE_LINK",
            url: affRes.data.affiliate.affiliate_url
          });
        }
      } catch (e) {}
    }
  });

  // "I used this" button (only on other people's codes)
  const usedBtn = card.querySelector(".used-btn");
  if (usedBtn) {
    usedBtn.addEventListener("click", async () => {
      usedBtn.textContent = "Thanks!";
      usedBtn.disabled = true;
      usedBtn.style.color = "#00ba7c";
      try {
        await apiRequest(`/referrals/${code.id}/used`, "POST");
      } catch (e) {}
    });
  }

  // Report button (only on other people's codes)
  const reportBtn = card.querySelector(".report-btn");
  if (reportBtn) {
    reportBtn.addEventListener("click", async () => {
      if (!confirm("Report this referral code as suspicious or phishing?")) return;
      reportBtn.textContent = "Reporting...";
      reportBtn.disabled = true;
      try {
        const res = await apiRequest(`/referrals/${code.id}/report`, "POST", { reason: "suspicious" });
        reportBtn.textContent = "Reported";
        reportBtn.style.color = "#f4212e";
        if (res.data && res.data.message) {
          showError(mainSection, res.data.message);
        }
      } catch (err) {
        reportBtn.textContent = "Report";
        reportBtn.disabled = false;
      }
    });
  }

  // Delete button (only on your own codes)
  const deleteOwnBtn = card.querySelector(".delete-own-btn");
  if (deleteOwnBtn) {
    deleteOwnBtn.addEventListener("click", async () => {
      if (!confirm("Delete this referral code?")) return;
      deleteOwnBtn.textContent = "Deleting...";
      deleteOwnBtn.disabled = true;
      try {
        await apiRequest(`/referrals/${code.id}`, "DELETE");
        card.remove();
        // Check if codes list is now empty
        if (codesList.querySelectorAll(".code-card").length === 0) {
          emptyState.classList.remove("hidden");
        }
      } catch (err) {
        deleteOwnBtn.textContent = "Delete";
        deleteOwnBtn.disabled = false;
        showError(mainSection, err.message || "Failed to delete code.");
      }
    });
  }

  return card;
}

// ---- Add Code ----
addCodeBtn.addEventListener("click", () => {
  showSection("add");
});

backFromAdd.addEventListener("click", () => {
  showSection("main");
});

// Auto-detect product type when user pastes a referral URL
const referralCodeInput = document.getElementById("referral-code");
const productTypeInput = document.getElementById("referral-product-type");
let detectTimer = null;

referralCodeInput.addEventListener("input", () => {
  // Debounce: wait 500ms after user stops typing
  if (detectTimer) clearTimeout(detectTimer);
  detectTimer = setTimeout(async () => {
    const code = referralCodeInput.value.trim();
    // Only auto-detect if it looks like a URL and product type is empty
    if (/^https?:\/\//i.test(code) && !productTypeInput.value.trim() && currentSiteInfo) {
      try {
        const res = await apiRequest("/referrals/detect-product", "POST", {
          code,
          site_domain: currentSiteInfo.domain
        });
        if (res.data && res.data.product_type && !productTypeInput.value.trim()) {
          productTypeInput.value = res.data.product_type;
          productTypeInput.style.borderColor = "#1DA1F2";
          setTimeout(() => { productTypeInput.style.borderColor = ""; }, 2000);
        }
      } catch (e) {}
    }
  }, 500);
});

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = document.getElementById("referral-code").value.trim();
  const productType = document.getElementById("referral-product-type").value.trim();
  const description = document.getElementById("referral-description").value.trim();

  if (!code || !currentSiteInfo) return;

  const submitBtn = document.getElementById("submit-code-btn");
  submitBtn.textContent = "Screening...";
  submitBtn.disabled = true;

  try {
    // Pre-screen first
    const screenRes = await apiRequest("/referrals/pre-screen", "POST", {
      code,
      description,
      site_domain: currentSiteInfo.domain,
      category: currentSiteInfo.category
    });

    if (screenRes.data && !screenRes.data.approved) {
      showError(addSection, screenRes.data.reason || "Code did not pass safety screening.");
      submitBtn.textContent = "Submit Code";
      submitBtn.disabled = false;
      return;
    }

    // Show warnings if any
    if (screenRes.data && screenRes.data.warnings && screenRes.data.warnings.length > 0) {
      showError(addSection, "Note: " + screenRes.data.warnings[0]);
    }

    // Submit
    submitBtn.textContent = "Submitting...";
    await apiRequest("/referrals", "POST", {
      code,
      product_type: productType || null,
      description,
      site_domain: currentSiteInfo.domain,
      site_name: currentSiteInfo.siteName,
      category: currentSiteInfo.category
    });

    document.getElementById("referral-code").value = "";
    document.getElementById("referral-product-type").value = "";
    document.getElementById("referral-description").value = "";
    showSection("main");
    loadCodes(currentSiteInfo.domain);
  } catch (err) {
    const msg = err.message || "Failed to submit code.";
    showError(addSection, msg);
  }

  submitBtn.textContent = "Submit Code";
  submitBtn.disabled = false;
});

// ---- Import / Invite ----
const bulkImportBtn = document.getElementById("bulk-import-btn");
const viewImportedBtn = document.getElementById("view-imported-btn");
const importPanel = document.getElementById("import-panel");
const importedPanel = document.getElementById("imported-panel");
const backFromImport = document.getElementById("back-from-import");
const backFromImported = document.getElementById("back-from-imported");
const importTextarea = document.getElementById("import-textarea");
const importFile = document.getElementById("import-file");
const importSubmitBtn = document.getElementById("import-submit-btn");
const importResult = document.getElementById("import-result");

bulkImportBtn.addEventListener("click", () => {
  importPanel.classList.remove("hidden");
  myNetworkTitle.classList.add("hidden");
  networkList.classList.add("hidden");
  discoverTitle.classList.add("hidden");
  discoverList.classList.add("hidden");
  networkEmpty.classList.add("hidden");
});

backFromImport.addEventListener("click", () => {
  importPanel.classList.add("hidden");
  loadNetwork();
});

viewImportedBtn.addEventListener("click", () => {
  importedPanel.classList.remove("hidden");
  myNetworkTitle.classList.add("hidden");
  networkList.classList.add("hidden");
  discoverTitle.classList.add("hidden");
  discoverList.classList.add("hidden");
  networkEmpty.classList.add("hidden");
  loadImported();
});

backFromImported.addEventListener("click", () => {
  importedPanel.classList.add("hidden");
  loadNetwork();
});

importSubmitBtn.addEventListener("click", async () => {
  const text = importTextarea.value.trim();
  const files = importFile.files;

  // Check file sizes
  if (files) {
    for (const f of files) {
      if (f.size > 5 * 1024 * 1024) {
        importResult.textContent = "File too large. Maximum 5MB per file.";
        importResult.style.background = "rgba(244,33,46,0.1)";
        importResult.style.color = "#f4212e";
        importResult.classList.remove("hidden");
        importSubmitBtn.textContent = "Import";
        importSubmitBtn.disabled = false;
        return;
      }
    }
  }

  if (!text && (!files || files.length === 0)) return;

  importSubmitBtn.textContent = "Importing...";
  importSubmitBtn.disabled = true;
  importResult.classList.add("hidden");

  let totalImported = 0;
  let totalAutoConnected = 0;
  let totalAlreadyExists = 0;
  let errors = [];

  try {
    // Handle text paste
    if (text) {
      const importSourceSelect = document.getElementById("import-source-select");
      const usernames = text.split(/[,\n]+/).map(u => u.trim()).filter(Boolean);
      const body = {
        usernames,
        import_source: importSourceSelect ? importSourceSelect.value : 'manual'
      };

      const res = await apiRequest("/users/me/import", "POST", body);
      const data = res.data || {};
      totalImported += data.imported || 0;
      totalAutoConnected += data.autoConnected || 0;
      totalAlreadyExists += data.alreadyExists || 0;
    }

    // Handle file uploads (supports multiple: following.js + follower.js)
    if (files && files.length > 0) {
      for (const file of files) {
        const content = await readFileAsText(file);
        const fileName = file.name.toLowerCase();

        // Detect source from filename
        let fileSource = 'unknown';
        if (fileName.includes('following')) {
          fileSource = 'following';
        } else if (fileName.includes('follower')) {
          fileSource = 'followers';
        }

        // Parse the X archive format
        let parsed;
        try {
          // X archive files start with "window.YTD.<type>.part0 = "
          const jsonStr = content.replace(/^window\.YTD\.\w+\.part\d+\s*=\s*/, '');
          parsed = JSON.parse(jsonStr);
        } catch (e) {
          try {
            parsed = JSON.parse(content);
          } catch (e2) {
            errors.push(`Could not parse ${file.name}`);
            continue;
          }
        }

        const body = {
          followingData: parsed,
          import_source: fileSource
        };

        const res = await apiRequest("/users/me/import", "POST", body);
        const data = res.data || {};
        totalImported += data.imported || 0;
        totalAutoConnected += data.autoConnected || 0;
        totalAlreadyExists += data.alreadyExists || 0;
      }
    }

    importResult.style.background = "rgba(29,161,242,0.1)";
    importResult.style.color = "#1DA1F2";
    let msg = `Imported ${totalImported} users. ${totalAutoConnected} auto-connected. ${totalAlreadyExists} already existed.`;
    if (errors.length > 0) {
      msg += " Errors: " + errors.join(", ");
    }
    importResult.textContent = msg;
    importResult.classList.remove("hidden");
    importTextarea.value = "";
    importFile.value = "";

    // Show the manage button
    viewImportedBtn.classList.remove("hidden");
  } catch (err) {
    importResult.textContent = "Import failed: " + (err.message || "Unknown error");
    importResult.style.background = "rgba(244,33,46,0.1)";
    importResult.style.color = "#f4212e";
    importResult.classList.remove("hidden");
  }

  importSubmitBtn.textContent = "Import";
  importSubmitBtn.disabled = false;
});

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

async function loadImported() {
  const onPlatformEl = document.getElementById("imported-on-platform");
  const notOnPlatformEl = document.getElementById("imported-not-on-platform");
  const onPlatformTitle = document.getElementById("on-platform-title");
  const notOnPlatformTitle = document.getElementById("not-on-platform-title");
  const importedStats = document.getElementById("imported-stats");

  onPlatformEl.innerHTML = "";
  notOnPlatformEl.innerHTML = "";

  try {
    const res = await apiRequest("/users/me/imported");
    const data = res.data || {};
    const onPlatform = data.onPlatform || [];
    const notOnPlatform = data.notOnPlatform || [];

    importedStats.innerHTML = `<span>${data.total || 0}</span> imported | <span>${onPlatform.length}</span> on platform | <span>${data.invitable || 0}</span> invitable`;

    if (onPlatform.length > 0) {
      onPlatformTitle.style.display = "";
      onPlatform.forEach(u => {
        const el = document.createElement("div");
        const borderClass = {
          mutual: 'rel-border-mutual',
          following: 'rel-border-following',
          follower: 'rel-border-follower'
        }[u.relationship] || '';
        el.className = "imported-user " + borderClass;

        const relTags = {
          mutual: '<span class="rel-tag rel-mutual">Mutual</span>',
          following: '<span class="rel-tag rel-following">Following</span>',
          follower: '<span class="rel-tag rel-follower">Follower</span>',
          none: '<span class="rel-tag" style="color:#71767b;">Added</span>'
        };
        const relTag = relTags[u.relationship] || relTags.none;

        el.innerHTML = `
          <span class="username">@${escapeHtml(u.x_username)}${u.x_display_name && u.x_display_name !== u.x_username ? ' <span style="color:#71767b;">(' + escapeHtml(u.x_display_name) + ')</span>' : ''}</span>
          ${relTag}
        `;
        onPlatformEl.appendChild(el);
      });
    } else {
      onPlatformTitle.style.display = "none";
    }

    if (notOnPlatform.length > 0) {
      notOnPlatformTitle.style.display = "";
      notOnPlatform.forEach(u => {
        const el = document.createElement("div");
        const source = u.import_source || 'unknown';
        const sourceTag = {
          mutual: { tag: '<span class="rel-tag rel-mutual">Mutual</span>', border: 'rel-border-mutual' },
          following: { tag: '<span class="rel-tag rel-following">You Follow</span>', border: 'rel-border-following' },
          followers: { tag: '<span class="rel-tag rel-follower">Follows You</span>', border: 'rel-border-follower' },
          manual: { tag: '<span class="rel-tag" style="color:#71767b;">Added</span>', border: 'rel-border-imported' },
          unknown: { tag: '<span class="rel-tag" style="color:#71767b;">Imported</span>', border: 'rel-border-imported' }
        }[source] || { tag: '<span class="rel-tag" style="color:#71767b;">Imported</span>', border: 'rel-border-imported' };

        el.className = "imported-user " + sourceTag.border;
        const isOptedOut = u.invite_opted_out;
        const wasInvited = u.invited_at;

        let actionHtml;
        if (isOptedOut) {
          actionHtml = `<button class="opt-out-btn opt-in" data-id="${u.id}">Re-enable</button>`;
        } else if (wasInvited) {
          actionHtml = `<span class="status">Invited</span>
            <button class="opt-out-btn" data-id="${u.id}">Skip</button>`;
        } else {
          const dmText = encodeURIComponent('Hey! I\'m using Referral Network to share referral codes. Join me: https://whatscookinginjapan.github.io/referral-network/');
          const dmUrl = u.x_id
            ? `https://x.com/messages/compose?recipient_id=${encodeURIComponent(u.x_id)}&text=${dmText}`
            : `https://x.com/${encodeURIComponent(u.x_username)}`;
          actionHtml = `
            <a class="invite-link" href="${dmUrl}" target="_blank" data-id="${u.id}">DM Invite</a>
            <button class="opt-out-btn" data-id="${u.id}">Skip</button>`;
        }

        el.innerHTML = `
          <span class="username">@${escapeHtml(u.x_username)}${u.x_display_name && u.x_display_name !== u.x_username ? ' <span style="color:#71767b;">(' + escapeHtml(u.x_display_name) + ')</span>' : ''} ${sourceTag.tag}</span>
          ${actionHtml}
        `;

        // Invite link click — mark as invited
        const inviteLink = el.querySelector(".invite-link");
        if (inviteLink) {
          inviteLink.addEventListener("click", async () => {
            await apiRequest("/users/me/imported/mark-invited", "POST", { ids: [u.id] });
          });
        }

        // Opt out / opt in
        const optBtn = el.querySelector(".opt-out-btn");
        if (optBtn) {
          optBtn.addEventListener("click", async () => {
            const endpoint = isOptedOut
              ? `/users/me/imported/${u.id}/opt-in`
              : `/users/me/imported/${u.id}/opt-out`;
            await apiRequest(endpoint, "POST");
            loadImported();
          });
        }

        notOnPlatformEl.appendChild(el);
      });
    } else {
      notOnPlatformTitle.style.display = "none";
    }
  } catch (err) {
    importedStats.textContent = "Could not load imported data.";
  }
}

// ---- Network ----
addUsernameBtn.addEventListener("click", addUserByUsername);
addUsernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addUserByUsername();
});

async function addUserByUsername() {
  const username = addUsernameInput.value.trim().replace(/^@/, "");
  if (!username) return;

  addUsernameError.classList.add("hidden");
  addUsernameSuccess.classList.add("hidden");
  addUsernameBtn.textContent = "Adding...";
  addUsernameBtn.disabled = true;

  try {
    const res = await apiRequest("/users/me/network/add", "POST", { username });
    if (res.data && res.data.success) {
      addUsernameSuccess.textContent = `Connected with @${res.data.user?.x_username || username}!`;
      addUsernameSuccess.classList.remove("hidden");
      addUsernameInput.value = "";
      loadNetwork();
    } else if (res.data && res.data.error) {
      addUsernameError.textContent = res.data.error;
      addUsernameError.classList.remove("hidden");
    }
  } catch (err) {
    addUsernameError.textContent = err.message || "Failed to add user.";
    addUsernameError.classList.remove("hidden");
  }

  addUsernameBtn.textContent = "Add";
  addUsernameBtn.disabled = false;
  setTimeout(() => {
    addUsernameSuccess.classList.add("hidden");
    addUsernameError.classList.add("hidden");
  }, 4000);
}

async function loadNetwork() {
  networkList.innerHTML = "";
  discoverList.innerHTML = "";
  networkEmpty.classList.add("hidden");
  myNetworkTitle.classList.add("hidden");
  discoverTitle.classList.add("hidden");
  networkLoading.classList.remove("hidden");

  try {
    const res = await apiRequest("/users/me/network");
    networkLoading.classList.add("hidden");

    const data = res.data || {};
    const network = data.network || [];
    const discover = data.discover || [];

    networkStats.innerHTML = `<span>${network.length}</span> connection${network.length !== 1 ? 's' : ''} in your network`;

    if (network.length > 0) {
      myNetworkTitle.classList.remove("hidden");
      network.forEach((user) => {
        networkList.appendChild(createNetworkCard(user, true));
      });
    }

    if (discover.length > 0) {
      discoverTitle.classList.remove("hidden");
      discover.forEach((user) => {
        discoverList.appendChild(createNetworkCard(user, false));
      });
    }

    if (network.length === 0 && discover.length === 0) {
      networkEmpty.classList.remove("hidden");
    }

    // Check if there are imports to manage
    try {
      const impRes = await apiRequest("/users/me/imported");
      if (impRes.data && impRes.data.total > 0) {
        viewImportedBtn.classList.remove("hidden");
      }
    } catch (e) {}
  } catch (err) {
    networkLoading.classList.add("hidden");
    networkEmpty.classList.remove("hidden");
    networkEmpty.querySelector("p").textContent = "Could not load network.";
  }
}

// ---- Network Search ----
const networkSearchInput = document.getElementById("network-search");
if (networkSearchInput) {
  networkSearchInput.addEventListener("input", () => {
    const query = networkSearchInput.value.toLowerCase().trim();
    // Filter My Connections
    networkList.querySelectorAll(".network-card").forEach(card => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(query) ? "" : "none";
    });
    // Filter Discover
    discoverList.querySelectorAll(".network-card").forEach(card => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(query) ? "" : "none";
    });
    // Show/hide section titles based on visible cards
    const visibleNetwork = networkList.querySelectorAll('.network-card:not([style*="display: none"])').length;
    const visibleDiscover = discoverList.querySelectorAll('.network-card:not([style*="display: none"])').length;
    myNetworkTitle.style.display = visibleNetwork > 0 ? "" : "none";
    discoverTitle.style.display = visibleDiscover > 0 ? "" : "none";
  });
}

// ---- Imported Search ----
const importedSearchInput = document.getElementById("imported-search");
if (importedSearchInput) {
  importedSearchInput.addEventListener("input", () => {
    const query = importedSearchInput.value.toLowerCase().trim();
    const onPlatformEl = document.getElementById("imported-on-platform");
    const notOnPlatformEl = document.getElementById("imported-not-on-platform");
    const onPlatformTitle = document.getElementById("on-platform-title");
    const notOnPlatformTitle = document.getElementById("not-on-platform-title");

    // Filter on-platform users
    let visibleOn = 0;
    onPlatformEl.querySelectorAll(".imported-user").forEach(el => {
      const text = el.textContent.toLowerCase();
      const show = text.includes(query);
      el.style.display = show ? "" : "none";
      if (show) visibleOn++;
    });
    onPlatformTitle.style.display = visibleOn > 0 ? "" : "none";

    // Filter not-on-platform users
    let visibleNot = 0;
    notOnPlatformEl.querySelectorAll(".imported-user").forEach(el => {
      const text = el.textContent.toLowerCase();
      const show = text.includes(query);
      el.style.display = show ? "" : "none";
      if (show) visibleNot++;
    });
    notOnPlatformTitle.style.display = visibleNot > 0 ? "" : "none";
  });
}

function createNetworkCard(user, isConnected) {
  const card = document.createElement("div");
  card.className = "network-card";

  const displayName = user.x_display_name || user.x_username || "User";
  const username = user.x_username || "unknown";
  const followers = user.x_followers_count || 0;
  const profilePic = user.x_profile_image || "";
  const referralCount = user.referral_count || 0;
  const initial = displayName.charAt(0).toUpperCase();

  const safeProfilePic = sanitizeImageUrl(profilePic);
  const avatarContent = safeProfilePic
    ? `<img src="${safeProfilePic}" alt="${escapeAttr(displayName)}">`
    : initial;

  const actionBtn = isConnected
    ? `<button class="btn btn-small btn-outline network-remove-btn" data-id="${user.id}">Remove</button>`
    : `<button class="btn btn-small btn-primary network-connect-btn" data-username="${escapeAttr(username)}">Connect</button>`;

  // Relationship tag
  const relationship = user.relationship || '';
  const relTags = {
    mutual: '<span class="rel-tag rel-mutual">Mutual</span>',
    following: '<span class="rel-tag rel-following">Following</span>',
    follower: '<span class="rel-tag rel-follower">Follower</span>'
  };
  const relTag = relTags[relationship] || '';

  card.innerHTML = `
    <div class="network-avatar">${avatarContent}</div>
    <div class="network-user-info">
      <div class="network-display-name">${escapeHtml(displayName)} ${relTag}</div>
      <div class="network-username">@${escapeHtml(username)}</div>
    </div>
    <div class="network-meta">
      <div class="network-followers"><span>${formatNumber(followers)}</span> followers</div>
      ${referralCount > 0 ? `<div class="network-codes-count">${referralCount} code${referralCount !== 1 ? 's' : ''}</div>` : ''}
      ${actionBtn}
    </div>
  `;

  // Connect button
  const connectBtn = card.querySelector(".network-connect-btn");
  if (connectBtn) {
    connectBtn.addEventListener("click", async () => {
      connectBtn.textContent = "...";
      connectBtn.disabled = true;
      try {
        await apiRequest("/users/me/network/add", "POST", { username });
        loadNetwork();
      } catch (e) {
        connectBtn.textContent = "Connect";
        connectBtn.disabled = false;
      }
    });
  }

  // Remove button
  const removeBtn = card.querySelector(".network-remove-btn");
  if (removeBtn) {
    removeBtn.addEventListener("click", async () => {
      removeBtn.textContent = "...";
      removeBtn.disabled = true;
      try {
        await apiRequest(`/users/me/network/${user.id}`, "DELETE");
        loadNetwork();
      } catch (e) {
        removeBtn.textContent = "Remove";
        removeBtn.disabled = false;
      }
    });
  }

  return card;
}

// ---- Profile ----
async function loadProfile() {
  if (!currentUser) return;

  const displayName = currentUser.x_display_name || currentUser.displayName || currentUser.display_name || currentUser.x_username || "User";
  const username = currentUser.x_username || currentUser.username || "unknown";
  const initial = displayName.charAt(0).toUpperCase();

  profileAvatar.textContent = initial;
  profileName.textContent = displayName;
  profileHandle.textContent = "@" + username;

  profileCodes.innerHTML = "";
  profileEmpty.classList.add("hidden");

  try {
    const res = await apiRequest("/users/me/referrals");
    const codes = res.data && Array.isArray(res.data) ? res.data : (res.data && res.data.referrals ? res.data.referrals : []);

    if (codes.length === 0) {
      profileEmpty.classList.remove("hidden");
      return;
    }

    codes.forEach((code) => {
      const card = createProfileCodeCard(code);
      profileCodes.appendChild(card);
    });
  } catch (err) {
    profileEmpty.classList.remove("hidden");
    profileEmpty.querySelector("p").textContent = "Could not load your codes.";
  }

  // Load suggestions
  loadSuggestions();
}

function createProfileCodeCard(code) {
  const card = document.createElement("div");
  card.className = "code-card";

  const sName = code.siteName || code.site_name || code.site_domain || "";
  const category = code.category || "";
  const codeValue = code.code || code.referralCode || "";
  const isUrl = /^https?:\/\//i.test(codeValue);
  const productType = code.product_type || '';
  const verifiedBadge = code.verification_status === 'verified'
    ? '<span class="verified-badge-circle" title="Verified code"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#00ba7c"/><path d="M9 12l2 2 4-4" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'
    : '';

  card.innerHTML = `
    <div class="profile-code-row">
      <div class="profile-code-info">
        <span class="profile-code-site">${escapeHtml(sName)}</span>
        ${productType ? `<span class="code-product-type-sm">${escapeHtml(productType)}</span>` : ''}
        ${verifiedBadge}
      </div>
      <div class="profile-code-actions">
        ${isUrl
          ? `<a href="${escapeAttr(codeValue)}" target="_blank" class="profile-ref-link" title="${escapeAttr(codeValue)}">Link &rarr;</a>`
          : `<span class="code-text-inline">${escapeHtml(codeValue)}</span><button class="copy-btn" data-code="${escapeAttr(codeValue)}">Copy</button>`
        }
        <button class="profile-action-btn edit-btn" data-id="${code.id || code._id || ""}" title="Edit">&#9998;</button>
        <button class="profile-action-btn delete-btn" data-id="${code.id || code._id || ""}" title="Delete">&times;</button>
      </div>
    </div>
    <div class="profile-code-detail">
      ${code.description ? `<div class="code-description">${escapeHtml(code.description)}</div>` : ''}
      <div class="edit-form hidden" data-id="${code.id || code._id || ""}">
        <div class="form-group" style="margin-top:8px;">
          <label style="font-size:11px;color:#71767b;">Product Type</label>
          <input type="text" class="input-field edit-product-type" value="${escapeAttr(productType)}" placeholder="e.g., Sapphire Preferred" maxlength="100">
        </div>
        <div class="form-group">
          <label style="font-size:11px;color:#71767b;">Code / Link</label>
          <input type="text" class="input-field edit-code" value="${escapeAttr(codeValue)}" placeholder="Referral code or link">
        </div>
        <div class="form-group">
          <label style="font-size:11px;color:#71767b;">Description</label>
          <textarea class="input-field textarea edit-description" rows="2" placeholder="Description">${escapeHtml(code.description || '')}</textarea>
        </div>
        <div class="code-actions">
          <button class="btn btn-small btn-primary save-edit-btn">Save</button>
          <button class="btn btn-small btn-outline cancel-edit-btn">Cancel</button>
        </div>
      </div>
    </div>
  `;

  const copyBtn = card.querySelector(".copy-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(copyBtn.dataset.code).then(() => {
        copyBtn.textContent = "Copied!";
        copyBtn.classList.add("copied");
        setTimeout(() => {
          copyBtn.textContent = "Copy";
          copyBtn.classList.remove("copied");
        }, 2000);
      });
    });
  }

  const deleteBtn = card.querySelector(".delete-btn");
  deleteBtn.addEventListener("click", async () => {
    const id = deleteBtn.dataset.id;
    if (!id) return;
    deleteBtn.textContent = "Deleting...";
    deleteBtn.disabled = true;
    try {
      await apiRequest(`/referrals/${id}`, "DELETE");
      card.remove();
      if (profileCodes.children.length === 0) {
        profileEmpty.classList.remove("hidden");
      }
    } catch (err) {
      deleteBtn.textContent = "Delete";
      deleteBtn.disabled = false;
    }
  });

  // Edit button
  const editBtn = card.querySelector(".edit-btn");
  const editForm = card.querySelector(".edit-form");
  if (editBtn && editForm) {
    editBtn.addEventListener("click", () => {
      editForm.classList.toggle("hidden");
      editBtn.textContent = editForm.classList.contains("hidden") ? "Edit" : "Editing...";
    });

    editForm.querySelector(".cancel-edit-btn").addEventListener("click", () => {
      editForm.classList.add("hidden");
      editBtn.textContent = "Edit";
    });

    editForm.querySelector(".save-edit-btn").addEventListener("click", async () => {
      const newProductType = editForm.querySelector(".edit-product-type").value.trim();
      const newCode = editForm.querySelector(".edit-code").value.trim();
      const newDescription = editForm.querySelector(".edit-description").value.trim();

      if (!newCode) return;

      const saveBtn = editForm.querySelector(".save-edit-btn");
      saveBtn.textContent = "Saving...";
      saveBtn.disabled = true;

      try {
        await apiRequest(`/referrals/${code.id || code._id}`, "PUT", {
          code: newCode,
          product_type: newProductType,
          description: newDescription
        });
        editForm.classList.add("hidden");
        editBtn.textContent = "Edit";
        loadProfile(); // Reload to reflect changes
      } catch (err) {
        showError(profileSection, err.message || "Failed to save.");
      }

      saveBtn.textContent = "Save";
      saveBtn.disabled = false;
    });
  }

  return card;
}

// ---- Verification Badge ----
function renderVerificationBadge(status) {
  const badges = {
    verified: '<span class="verify-badge verified" title="Verified safe">&#10003; Verified</span>',
    warning: '<span class="verify-badge warning" title="Review recommended">&#9888; Review</span>',
    flagged: '<span class="verify-badge flagged" title="Flagged as suspicious">&#9888; Flagged</span>',
    pending: '<span class="verify-badge pending" title="Verification in progress">&#8987; Checking</span>',
    error: '<span class="verify-badge pending" title="Could not verify">? Unverified</span>'
  };
  return badges[status] || '';
}

// ---- Helpers ----
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sanitizeImageUrl(url) {
  if (!url) return '';
  // Only allow https URLs from trusted image domains
  const trustedDomains = ['pbs.twimg.com', 'abs.twimg.com', 'api.dicebear.com', 'avatars.githubusercontent.com'];
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return '';
    const hostname = parsed.hostname;
    if (!trustedDomains.some(d => hostname === d || hostname.endsWith('.' + d))) return '';
    return escapeAttr(url);
  } catch {
    return '';
  }
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return String(num);
}

function showError(container, message) {
  let el = container.querySelector(".error-msg");
  if (!el) {
    el = document.createElement("div");
    el.className = "error-msg";
    container.appendChild(el);
  }
  el.textContent = message;
  setTimeout(() => el.remove(), 5000);
}

// ---- Suggest Site ----
const suggestSiteBtn = document.getElementById("suggest-site-btn");
const backFromSuggest = document.getElementById("back-from-suggest");
const suggestForm = document.getElementById("suggest-form");

if (suggestSiteBtn) {
  suggestSiteBtn.addEventListener("click", () => {
    showSection("suggest");
  });
}

if (backFromSuggest) {
  backFromSuggest.addEventListener("click", () => {
    showSection("main");
  });
}

if (suggestForm) {
  suggestForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = document.getElementById("suggest-url").value.trim();
    const siteName = document.getElementById("suggest-name").value.trim();
    const category = document.getElementById("suggest-category").value;
    const description = document.getElementById("suggest-description").value.trim();

    if (!url) return;

    const submitBtn = document.getElementById("suggest-submit-btn");
    submitBtn.textContent = "Submitting...";
    submitBtn.disabled = true;

    try {
      const res = await apiRequest("/suggestions", "POST", {
        url,
        site_name: siteName || null,
        category: category || null,
        description: description || null
      });

      if (res.data && res.data.suggestion) {
        document.getElementById("suggest-url").value = "";
        document.getElementById("suggest-name").value = "";
        document.getElementById("suggest-category").value = "";
        document.getElementById("suggest-description").value = "";
        showSection("main");
        showError(mainSection, "Site suggestion submitted! Check your profile for status.");
      } else if (res.data && res.data.error) {
        showError(suggestSection, res.data.error);
      }
    } catch (err) {
      showError(suggestSection, err.message || "Failed to submit suggestion.");
    }

    submitBtn.textContent = "Submit Suggestion";
    submitBtn.disabled = false;
  });
}

async function loadSuggestions() {
  const suggestionsEl = document.getElementById("profile-suggestions");
  const suggestionsEmpty = document.getElementById("suggestions-empty");
  if (!suggestionsEl) return;

  suggestionsEl.innerHTML = "";
  suggestionsEmpty.classList.add("hidden");

  try {
    const res = await apiRequest("/suggestions/my");
    const suggestions = res.data && res.data.suggestions ? res.data.suggestions : [];

    if (suggestions.length === 0) {
      suggestionsEmpty.classList.remove("hidden");
      return;
    }

    suggestions.forEach((s) => {
      const card = document.createElement("div");
      card.className = "code-card";

      const statusClass = {
        pending: "suggestion-pending",
        hold: "suggestion-hold",
        approved: "suggestion-approved",
        rejected: "suggestion-rejected"
      }[s.status] || "suggestion-pending";

      card.innerHTML = `
        <div class="code-card-header">
          <div class="code-user-info">
            <div class="code-display-name">${escapeHtml(s.site_name || s.domain)}</div>
            <div class="code-username">${escapeHtml(s.domain)}</div>
          </div>
          <span class="suggestion-status ${statusClass}">${escapeHtml(s.status)}</span>
        </div>
        ${s.description ? `<div class="code-body" style="margin-left:0;"><div class="code-description">${escapeHtml(s.description)}</div></div>` : ""}
      `;
      suggestionsEl.appendChild(card);
    });
  } catch (err) {
    suggestionsEmpty.classList.remove("hidden");
  }
}

// Import from X API button removed — too expensive ($5/call).
// Users can still add contacts via manual username entry or X archive upload.

// ---- Start ----
init();
