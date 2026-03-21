/**
 * Verification Agent — automated security checks for referral code submissions
 *
 * Runs checks:
 * 1. URL reachability & SSL validation
 * 2. Redirect chain analysis (ensures final domain is trusted)
 * 3. Google Safe Browsing lookup (if API key configured)
 * 4. Description coherence validation
 * 5. Category-description matching
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { TRUSTED_REFERRAL_DOMAINS } = require('./validation');

const SAFE_BROWSING_API_KEY = process.env.GOOGLE_SAFE_BROWSING_KEY || null;

// Category keywords for description validation
const CATEGORY_KEYWORDS = {
  credit_cards: ['card', 'credit', 'points', 'miles', 'rewards', 'bonus', 'annual', 'apr', 'cashback', 'cash back', 'sign up', 'signup'],
  banks: ['bank', 'account', 'checking', 'savings', 'deposit', 'direct deposit', 'bonus', 'apy', 'interest'],
  shopping: ['shop', 'discount', 'off', 'order', 'save', 'coupon', 'cashback', 'cash back', 'purchase'],
  travel: ['travel', 'stay', 'trip', 'booking', 'ride', 'flight', 'hotel', 'off', 'credit', 'discount'],
  food_delivery: ['food', 'order', 'delivery', 'off', 'free', 'first', 'meal', 'discount'],
  crypto: ['crypto', 'bitcoin', 'btc', 'stock', 'trade', 'invest', 'free', 'bonus', 'buy', 'sell'],
  subscriptions: ['free', 'month', 'premium', 'trial', 'subscription', 'plan', 'off', 'discount'],
};

// Suspicious description patterns
const SUSPICIOUS_DESC_PATTERNS = [
  /send.*money/i,
  /wire.*transfer/i,
  /social\s*security/i,
  /ssn/i,
  /bank\s*detail/i,
  /routing\s*number/i,
  /act\s*now/i,
  /limited\s*time.*hurry/i,
  /guaranteed.*income/i,
  /double.*your.*money/i,
  /nigerian/i,
  /prince/i,
  /lottery/i,
  /won\s*(a|the)\s*(prize|lottery)/i,
];

/**
 * Pre-submission screening — fast checks before allowing submission
 * Returns { approved: boolean, reason?: string, warnings?: string[] }
 */
async function preScreen(code, description, siteDomain, category) {
  const checks = [];
  const warnings = [];

  // 1. Check description coherence
  if (description) {
    const descCheck = validateDescription(description, category);
    checks.push(descCheck);
    if (!descCheck.passed) {
      return { approved: false, reason: descCheck.reason };
    }
    if (descCheck.warning) warnings.push(descCheck.warning);
  }

  // 2. If code is a URL, do a quick reachability check
  const urlMatch = code.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    const urlCheck = await checkUrlSafety(urlMatch[0], siteDomain);
    checks.push(urlCheck);
    if (!urlCheck.passed) {
      return { approved: false, reason: urlCheck.reason };
    }
    if (urlCheck.warning) warnings.push(urlCheck.warning);
  } else {
    // 3. Non-URL code: must be a URL for sites that use referral links
    // Most credit card, bank, and financial sites use referral links, not plain codes
    const urlOnlySites = [
      'chase.com', 'americanexpress.com', 'capitalone.com', 'discover.com', 'citi.com',
      'sofi.com', 'wealthfront.com', 'betterment.com', 'coinbase.com', 'robinhood.com',
      'nordvpn.com', 'expressvpn.com', 'surfshark.com', 'onepeloton.com',
      't-mobile.com', 'digitalocean.com', 'tesla.com', 'lemonade.com'
    ];

    if (urlOnlySites.includes(siteDomain)) {
      return {
        approved: false,
        reason: `${siteDomain} uses referral links, not plain text codes. Please paste your full referral URL (starts with https://).`
      };
    }

    // For other sites, warn that plain text codes are harder to verify
    warnings.push('Plain text codes cannot be automatically verified. Consider using a referral link if available.');
  }

  return { approved: true, warnings, checks };
}

/**
 * Post-submission verification — thorough async checks after the code is saved
 * Updates the referral_codes table with verification results
 */
async function verifyReferral(db, referralId) {
  const referral = await db.prepare('SELECT * FROM referral_codes WHERE id = ?').get(referralId);
  if (!referral) return;

  const results = {
    checks: [],
    score: 100, // Start at 100, deduct for issues
    timestamp: new Date().toISOString()
  };

  try {
    // 1. URL checks
    const urlMatch = referral.code.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      const urlResult = await deepUrlCheck(urlMatch[0], referral.site_domain);
      results.checks.push(urlResult);
      results.score -= urlResult.deduction || 0;

      // 2. Safe Browsing check
      if (SAFE_BROWSING_API_KEY) {
        const sbResult = await checkSafeBrowsing(urlMatch[0]);
        results.checks.push(sbResult);
        results.score -= sbResult.deduction || 0;
      }
    } else {
      // Non-URL code: harder to verify automatically
      // Deduct points since we can't verify the code is real
      results.checks.push({
        name: 'no_url',
        passed: true,
        deduction: 20,
        details: 'Plain text code — cannot verify URL validity'
      });
      results.score -= 20;
    }

    // 3. Description analysis
    if (referral.description) {
      const descResult = analyzeDescription(referral.description, referral.category);
      results.checks.push(descResult);
      results.score -= descResult.deduction || 0;
    } else {
      // No description provided — mild penalty
      results.checks.push({
        name: 'no_description',
        passed: true,
        deduction: 10,
        details: 'No description provided'
      });
      results.score -= 10;
    }

    // 4. User trust score (based on account age, report history)
    const userResult = await checkUserTrust(db, referral.user_id);
    results.checks.push(userResult);
    results.score -= userResult.deduction || 0;

    // Determine status
    results.score = Math.max(0, results.score);
    let status;
    if (results.score >= 80) {
      status = 'verified';
    } else if (results.score >= 50) {
      status = 'warning';
    } else {
      status = 'flagged';
    }

    // Update database
    await db.prepare(`
      UPDATE referral_codes
      SET verification_status = ?, verification_details = ?, verified_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, JSON.stringify(results), referralId);

    console.log(`[VerificationAgent] Referral ${referralId}: status=${status}, score=${results.score}`);
    return { status, score: results.score, results };

  } catch (err) {
    console.error('[VerificationAgent] Error:', err);
    await db.prepare(`
      UPDATE referral_codes
      SET verification_status = 'error', verification_details = ?, verified_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify({ error: err.message }), referralId);
  }
}

/**
 * Check URL safety — reachability, SSL, and redirect chain
 */
async function checkUrlSafety(url, expectedDomain) {
  try {
    const parsed = new URL(url);

    // Must be HTTPS for financial sites
    if (parsed.protocol !== 'https:') {
      return {
        name: 'url_protocol',
        passed: false,
        reason: 'Referral URL must use HTTPS for security.',
        deduction: 30
      };
    }

    // Check initial domain against trusted list first (skip redirect check if already trusted)
    const initialDomain = parsed.hostname.replace(/^www\./, '');
    const trustedForSite = TRUSTED_REFERRAL_DOMAINS[expectedDomain] || [expectedDomain];
    const initiallyTrusted = trustedForSite.some(d =>
      initialDomain === d || initialDomain.endsWith('.' + d)
    );
    if (initiallyTrusted) {
      return { name: 'url_safety', passed: true, deduction: 0 };
    }

    // Not initially trusted — follow redirects and check final domain
    const finalUrl = await followRedirects(url);
    if (finalUrl) {
      const finalParsed = new URL(finalUrl);
      const finalDomain = finalParsed.hostname.replace(/^www\./, '');

      const trustedDomains = TRUSTED_REFERRAL_DOMAINS[expectedDomain] || [expectedDomain];
      const isTrusted = trustedDomains.some(d =>
        finalDomain === d || finalDomain.endsWith('.' + d)
      );

      if (!isTrusted) {
        return {
          name: 'url_redirect',
          passed: false,
          reason: `URL redirects to "${finalDomain}" which is not a trusted domain for ${expectedDomain}.`,
          deduction: 50
        };
      }
    }

    return { name: 'url_safety', passed: true, deduction: 0 };
  } catch (err) {
    // URL verification failure should not block submission — many legit sites
    // block server-side requests (bot protection, CORS, etc.)
    return {
      name: 'url_safety',
      passed: true,
      warning: 'URL could not be fully verified (site may block automated checks). It will be reviewed.',
      deduction: 10
    };
  }
}

/**
 * Deep URL check — more thorough analysis for post-submission verification
 */
async function deepUrlCheck(url, expectedDomain) {
  const result = {
    name: 'deep_url_check',
    passed: true,
    details: {},
    deduction: 0
  };

  try {
    const parsed = new URL(url);

    // Check SSL
    if (parsed.protocol !== 'https:') {
      result.details.ssl = 'missing';
      result.deduction += 20;
    } else {
      result.details.ssl = 'valid';
    }

    // Check reachability
    const reachable = await checkReachability(url);
    result.details.reachable = reachable;
    if (!reachable) {
      result.deduction += 15;
      result.details.reachability = 'unreachable';
    }

    // Check redirect chain
    const finalUrl = await followRedirects(url);
    if (finalUrl) {
      const finalDomain = new URL(finalUrl).hostname.replace(/^www\./, '');
      result.details.finalDomain = finalDomain;
      result.details.redirected = finalUrl !== url;

      const trustedDomains = TRUSTED_REFERRAL_DOMAINS[expectedDomain] || [expectedDomain];
      const isTrusted = trustedDomains.some(d =>
        finalDomain === d || finalDomain.endsWith('.' + d)
      );
      result.details.domainTrusted = isTrusted;

      if (!isTrusted) {
        result.deduction += 40;
        result.passed = false;
        result.reason = `Final URL domain "${finalDomain}" is not trusted for ${expectedDomain}`;
      }
    }

  } catch (err) {
    result.details.error = err.message;
    result.deduction += 10;
  }

  return result;
}

/**
 * Follow redirect chain and return final URL
 */
function followRedirects(url, maxRedirects = 5) {
  return new Promise((resolve) => {
    let redirectCount = 0;
    let currentUrl = url;

    function follow(targetUrl) {
      if (redirectCount >= maxRedirects) {
        resolve(targetUrl);
        return;
      }

      const parsed = new URL(targetUrl);
      const client = parsed.protocol === 'https:' ? https : http;

      const req = client.request(targetUrl, {
        method: 'HEAD',
        timeout: 5000,
        headers: {
          'User-Agent': 'ReferralNetworkBot/1.0 (Security Check)'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          redirectCount++;
          let nextUrl = res.headers.location;
          // Handle relative redirects
          if (nextUrl.startsWith('/')) {
            nextUrl = `${parsed.protocol}//${parsed.host}${nextUrl}`;
          }
          follow(nextUrl);
        } else {
          resolve(targetUrl);
        }
      });

      req.on('error', () => resolve(targetUrl));
      req.on('timeout', () => { req.destroy(); resolve(targetUrl); });
      req.end();
    }

    follow(currentUrl);
  });
}

/**
 * Check if URL is reachable (returns status code 2xx or 3xx)
 */
function checkReachability(url) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;

    const req = client.request(url, {
      method: 'HEAD',
      timeout: 8000,
      headers: {
        'User-Agent': 'ReferralNetworkBot/1.0 (Security Check)'
      }
    }, (res) => {
      resolve(res.statusCode < 400);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/**
 * Google Safe Browsing API check
 */
async function checkSafeBrowsing(url) {
  if (!SAFE_BROWSING_API_KEY) {
    return { name: 'safe_browsing', passed: true, details: 'skipped (no API key)', deduction: 0 };
  }

  try {
    const response = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${SAFE_BROWSING_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: { clientId: 'referral-network', clientVersion: '1.0.0' },
          threatInfo: {
            threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url }]
          }
        })
      }
    );

    const data = await response.json();
    if (data.matches && data.matches.length > 0) {
      return {
        name: 'safe_browsing',
        passed: false,
        reason: 'URL flagged by Google Safe Browsing as potentially dangerous.',
        details: data.matches[0].threatType,
        deduction: 100 // Instant fail
      };
    }

    return { name: 'safe_browsing', passed: true, deduction: 0 };
  } catch (err) {
    return { name: 'safe_browsing', passed: true, details: 'check failed: ' + err.message, deduction: 0 };
  }
}

/**
 * Validate description content and coherence
 */
function validateDescription(description, category) {
  // Check for suspicious patterns
  for (const pattern of SUSPICIOUS_DESC_PATTERNS) {
    if (pattern.test(description)) {
      return {
        name: 'description_safety',
        passed: false,
        reason: 'Description contains suspicious or misleading content.'
      };
    }
  }

  // Check for gibberish (high ratio of non-alpha or very low word variance)
  const words = description.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  if (words.length < 2) {
    return { name: 'description_length', passed: true, warning: 'Description is very short.' };
  }

  const uniqueWords = new Set(words);
  if (words.length > 5 && uniqueWords.size / words.length < 0.3) {
    return {
      name: 'description_quality',
      passed: false,
      reason: 'Description appears to be repetitive or low quality.'
    };
  }

  // Check all-caps screaming
  const upperRatio = (description.match(/[A-Z]/g) || []).length / description.length;
  if (description.length > 20 && upperRatio > 0.7) {
    return {
      name: 'description_caps',
      passed: true,
      warning: 'Description uses excessive capitalization.'
    };
  }

  return { name: 'description_check', passed: true };
}

/**
 * Analyze description for category relevance (post-submission)
 */
function analyzeDescription(description, category) {
  const result = {
    name: 'description_analysis',
    passed: true,
    deduction: 0,
    details: {}
  };

  const lowerDesc = description.toLowerCase();

  // Check for suspicious patterns
  for (const pattern of SUSPICIOUS_DESC_PATTERNS) {
    if (pattern.test(description)) {
      result.deduction += 30;
      result.details.suspicious = true;
      result.passed = false;
      result.reason = 'Description contains suspicious content';
      return result;
    }
  }

  // Check category relevance
  const keywords = CATEGORY_KEYWORDS[category] || [];
  const matchCount = keywords.filter(kw => lowerDesc.includes(kw)).length;
  result.details.categoryRelevance = matchCount > 0 ? 'relevant' : 'unclear';

  if (matchCount === 0 && description.length > 20) {
    result.deduction += 5;
    result.details.note = 'Description does not clearly relate to the category';
  }

  return result;
}

/**
 * Check user trust score based on account history
 */
async function checkUserTrust(db, userId) {
  const result = {
    name: 'user_trust',
    passed: true,
    deduction: 0,
    details: {}
  };

  // Check how many reports this user's codes have received
  const reportCount = await db.prepare(`
    SELECT COUNT(*) as count FROM reports r
    JOIN referral_codes rc ON r.referral_id = rc.id
    WHERE rc.user_id = ?
  `).get(userId);

  result.details.totalReports = reportCount?.count || 0;

  if (reportCount && reportCount.count >= 5) {
    result.deduction += 20;
    result.details.trustLevel = 'low';
  } else if (reportCount && reportCount.count >= 2) {
    result.deduction += 10;
    result.details.trustLevel = 'medium';
  } else {
    result.details.trustLevel = 'high';
  }

  // Check account age
  const user = await db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId);
  if (user) {
    const ageMs = Date.now() - new Date(user.created_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    result.details.accountAgeDays = Math.floor(ageDays);

    if (ageDays < 1) {
      result.deduction += 10;
      result.details.newAccount = true;
    }
  }

  return result;
}

module.exports = {
  preScreen,
  verifyReferral
};
