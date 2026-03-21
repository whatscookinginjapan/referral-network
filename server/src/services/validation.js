/**
 * Referral code validation and anti-phishing protection
 */

// Legitimate referral domains — if a code contains a URL, it MUST match one of these
// or the site_domain it's submitted for
const TRUSTED_REFERRAL_DOMAINS = {
  'chase.com': ['chase.com', 'referyourchasecard.com', 'creditcards.chase.com'],
  'americanexpress.com': ['americanexpress.com', 'amex.com', 'refer.amex.us', 'amex.us', 'mgmee.americanexpress.com'],
  'capitalone.com': ['capitalone.com', 'capital.one'],
  'discover.com': ['discover.com', 'discovercard.com'],
  'citi.com': ['citi.com', 'citicards.com', 'citibank.com'],
  'marcus.com': ['marcus.com', 'goldmansachs.com'],
  'sofi.com': ['sofi.com'],
  'ally.com': ['ally.com'],
  'chime.com': ['chime.com'],
  'amazon.com': ['amazon.com', 'amzn.to'],
  'rakuten.com': ['rakuten.com', 'ebates.com'],
  'honey.com': ['honey.com', 'joinhoney.com'],
  'target.com': ['target.com'],
  'airbnb.com': ['airbnb.com', 'abnb.me'],
  'uber.com': ['uber.com', 'ubr.to'],
  'lyft.com': ['lyft.com'],
  'hotels.com': ['hotels.com'],
  'doordash.com': ['doordash.com'],
  'ubereats.com': ['ubereats.com', 'uber.com'],
  'grubhub.com': ['grubhub.com'],
  'instacart.com': ['instacart.com'],
  'coinbase.com': ['coinbase.com', 'cb.com'],
  'robinhood.com': ['robinhood.com'],
  'webull.com': ['webull.com'],
  'spotify.com': ['spotify.com'],
  'netflix.com': ['netflix.com'],
  'youtube.com': ['youtube.com', 'youtu.be'],
  'cash.app': ['cash.app', 'cash.me'],
  'venmo.com': ['venmo.com'],
  'paypal.com': ['paypal.com', 'paypal.me'],
  'wealthfront.com': ['wealthfront.com'],
  'betterment.com': ['betterment.com'],
  'acorns.com': ['acorns.com'],
  'm1finance.com': ['m1finance.com', 'm1.com'],
  'public.com': ['public.com'],
  'lemonade.com': ['lemonade.com'],
  'rootinsurance.com': ['rootinsurance.com', 'joinroot.com'],
  'onepeloton.com': ['onepeloton.com', 'peloton.com'],
  'classpass.com': ['classpass.com'],
  'tonal.com': ['tonal.com'],
  'skillshare.com': ['skillshare.com', 'skl.sh'],
  'masterclass.com': ['masterclass.com'],
  'audible.com': ['audible.com', 'amazon.com'],
  'nordvpn.com': ['nordvpn.com', 'go.nordvpn.net', 'ref.nordvpn.com'],
  'expressvpn.com': ['expressvpn.com', 'refer.expressvpn.com'],
  'surfshark.com': ['surfshark.com'],
  't-mobile.com': ['t-mobile.com', 'tmobile.com', 'refer.t-mobile.com'],
  'mintmobile.com': ['mintmobile.com'],
  'visible.com': ['visible.com'],
  'fi.google.com': ['fi.google.com', 'google.com'],
  'usmobile.com': ['usmobile.com'],
  'digitalocean.com': ['digitalocean.com', 'm.do.co'],
  'dropbox.com': ['dropbox.com', 'db.tt'],
  'notion.so': ['notion.so', 'notion.com'],
  'tesla.com': ['tesla.com', 'ts.la'],
  'arcadia.com': ['arcadia.com'],
  'fetchrewards.com': ['fetchrewards.com'],
  'ibotta.com': ['ibotta.com'],
  'turo.com': ['turo.com'],
  'getaround.com': ['getaround.com'],
};

// Known phishing patterns
const PHISHING_PATTERNS = [
  /bit\.ly/i,
  /tinyurl\.com/i,
  /t\.co\//i,           // Twitter shortlinks can mask anything
  /goo\.gl/i,
  /rb\.gy/i,
  /shorturl/i,
  /0rn\.co/i,
  /login/i,             // "login" in referral URLs is suspicious
  /signin/i,
  /password/i,
  /verify.*account/i,
  /account.*confirm/i,
  /secure.*update/i,
  /<script/i,           // XSS attempt
  /javascript:/i,
  /data:/i,
  /on\w+\s*=/i,         // event handlers
];

// Suspicious TLD patterns (commonly used in phishing)
const SUSPICIOUS_TLDS = [
  '.tk', '.ml', '.ga', '.cf', '.gq',  // Free TLDs popular with phishers
  '.xyz', '.top', '.buzz', '.icu',
  '.click', '.link',
];

/**
 * Validate a referral code submission
 * Returns { valid: boolean, reason?: string, warnings?: string[] }
 */
function validateReferralCode(code, description, siteDomain) {
  const warnings = [];

  // Basic length checks
  if (code.length > 500) {
    return { valid: false, reason: 'Referral code is too long (max 500 characters)' };
  }

  if (description && description.length > 1000) {
    return { valid: false, reason: 'Description is too long (max 1000 characters)' };
  }

  // Check for XSS/injection in code
  if (/<script|javascript:|data:|on\w+\s*=/i.test(code)) {
    return { valid: false, reason: 'Referral code contains disallowed content' };
  }

  // Check for XSS/injection in description
  if (description && /<script|javascript:|data:|on\w+\s*=/i.test(description)) {
    return { valid: false, reason: 'Description contains disallowed content' };
  }

  // Check if the code contains a URL
  const urlMatch = code.match(/https?:\/\/([^\s/]+)/i);

  // If NOT a URL, validate it looks like a real referral code
  if (!urlMatch) {
    // Must be at least 3 characters
    if (code.trim().length < 3) {
      return { valid: false, reason: 'Referral code is too short (minimum 3 characters).' };
    }
    // Must contain at least some alphanumeric characters (not just symbols/spaces)
    if (!/[a-zA-Z0-9]{3,}/.test(code)) {
      return { valid: false, reason: 'Referral code must contain letters or numbers.' };
    }
    // Reject obvious garbage (e.g., "asdf", "test", "1234" alone)
    const lowered = code.trim().toLowerCase();
    const garbagePatterns = [
      /^test$/i, /^asdf$/i, /^qwerty$/i, /^abc$/i, /^123$/i, /^1234$/i, /^12345$/i,
      /^xxx$/i, /^aaa$/i, /^fake$/i, /^none$/i, /^null$/i, /^undefined$/i, /^n\/a$/i,
    ];
    if (garbagePatterns.some(p => p.test(lowered))) {
      return { valid: false, reason: 'Please enter a valid referral code.' };
    }
  }
  if (urlMatch) {
    const urlDomain = urlMatch[1].toLowerCase().replace(/^www\./, '');

    // Check against trusted domains for this site
    const trustedDomains = TRUSTED_REFERRAL_DOMAINS[siteDomain] || [siteDomain];
    const isDomainTrusted = trustedDomains.some(trusted =>
      urlDomain === trusted || urlDomain.endsWith('.' + trusted)
    );

    if (!isDomainTrusted) {
      // Check if it's a known phishing pattern
      for (const pattern of PHISHING_PATTERNS) {
        if (pattern.test(code)) {
          return {
            valid: false,
            reason: `URL appears suspicious. Referral codes for ${siteDomain} should use official ${siteDomain} links.`
          };
        }
      }

      // Check for suspicious TLDs
      for (const tld of SUSPICIOUS_TLDS) {
        if (urlDomain.endsWith(tld)) {
          return {
            valid: false,
            reason: `URL domain "${urlDomain}" is not recognized as an official referral link for ${siteDomain}.`
          };
        }
      }

      // Not in trusted list but not obviously phishing — flag as warning
      warnings.push(`URL domain "${urlDomain}" is not in the trusted list for ${siteDomain}. It will be reviewed.`);
    }
  }

  // Check description for phishing URLs
  if (description) {
    const descUrls = description.match(/https?:\/\/[^\s]+/gi) || [];
    for (const url of descUrls) {
      for (const pattern of PHISHING_PATTERNS) {
        if (pattern.test(url)) {
          return {
            valid: false,
            reason: 'Description contains a suspicious URL.'
          };
        }
      }
    }
  }

  return { valid: true, warnings };
}

/**
 * Rate limiting check — returns true if the user is submitting too fast
 */
async function isRateLimited(db, userId) {
  // Max 5 referral codes per hour
  const recentCount = await db.prepare(`
    SELECT COUNT(*) as count FROM referral_codes
    WHERE user_id = ? AND created_at > NOW() - INTERVAL '1 hour'
  `).get(userId);

  if (recentCount && recentCount.count >= 5) {
    return { limited: true, reason: 'You can submit up to 5 referral codes per hour. Please try again later.' };
  }

  // Max 20 referral codes total per user
  const totalCount = await db.prepare(
    'SELECT COUNT(*) as count FROM referral_codes WHERE user_id = ?'
  ).get(userId);

  if (totalCount && totalCount.count >= 20) {
    return { limited: true, reason: 'You have reached the maximum of 20 referral codes. Delete some to add more.' };
  }

  return { limited: false };
}

/**
 * Check for duplicate codes — same code for same domain
 */
async function isDuplicate(db, code, siteDomain, userId, productType) {
  // Check if exact same code exists for this domain (by anyone)
  const sameCode = await db.prepare(
    'SELECT u.x_username FROM referral_codes rc JOIN users u ON rc.user_id = u.id WHERE rc.code = ? AND rc.site_domain = ? AND rc.user_id != ?'
  ).get(code, siteDomain, userId);

  if (sameCode) return { type: 'same_code', owner: sameCode.x_username };

  // Check if this user already has a code for the same product type on this domain
  const ownCode = await db.prepare(
    'SELECT id, code, product_type FROM referral_codes WHERE user_id = ? AND site_domain = ? AND (product_type = ? OR (product_type IS NULL AND ? IS NULL))'
  ).get(userId, siteDomain, productType || null, productType || null);

  if (ownCode) return { type: 'own_product', existingCode: ownCode.code, existingId: ownCode.id, productType: ownCode.product_type };

  return null;
}

module.exports = {
  validateReferralCode,
  isRateLimited,
  isDuplicate,
  TRUSTED_REFERRAL_DOMAINS
};
