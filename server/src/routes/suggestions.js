const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const authMiddleware = require('../middleware/auth');
const { logAudit, getIp } = require('../services/auditLog');

const router = express.Router();

// Known referral site domains (to check for duplicates against existing sites)
const KNOWN_DOMAINS = [
  'chase.com', 'americanexpress.com', 'capitalone.com', 'discover.com', 'citi.com',
  'marcus.com', 'sofi.com', 'ally.com', 'chime.com',
  'amazon.com', 'rakuten.com', 'honey.com', 'target.com', 'fetchrewards.com', 'ibotta.com',
  'airbnb.com', 'uber.com', 'lyft.com', 'hotels.com', 'turo.com', 'getaround.com',
  'doordash.com', 'ubereats.com', 'grubhub.com', 'instacart.com',
  'coinbase.com', 'robinhood.com', 'webull.com',
  'spotify.com', 'netflix.com', 'youtube.com',
  'cash.app', 'venmo.com', 'paypal.com',
  'wealthfront.com', 'betterment.com', 'acorns.com', 'm1finance.com', 'public.com',
  'lemonade.com', 'rootinsurance.com',
  'onepeloton.com', 'classpass.com', 'tonal.com',
  'skillshare.com', 'masterclass.com', 'audible.com',
  'nordvpn.com', 'expressvpn.com', 'surfshark.com',
  't-mobile.com', 'mintmobile.com', 'visible.com', 'fi.google.com', 'usmobile.com',
  'digitalocean.com', 'dropbox.com', 'notion.so',
  'tesla.com', 'arcadia.com'
];

// Suspicious TLDs
const SUSPICIOUS_TLDS = ['.xyz', '.tk', '.ml', '.ga', '.cf', '.gq', '.buzz', '.top', '.icu', '.club'];

/**
 * Extract domain from a URL or domain string
 */
function extractDomain(input) {
  let domain = input.trim().toLowerCase();
  // Try to parse as URL first
  try {
    const url = new URL(domain.startsWith('http') ? domain : 'https://' + domain);
    domain = url.hostname;
  } catch (e) {
    // Not a valid URL, treat as raw domain
  }
  // Remove www. prefix
  domain = domain.replace(/^www\./, '');
  return domain;
}

/**
 * Validate domain format
 */
function isValidDomain(domain) {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/.test(domain);
}

/**
 * Auto-score a suggestion based on heuristics
 */
function scoreSuggestion(domain, siteName, description) {
  let score = 50; // Base score
  const details = [];

  // Domain format check
  if (isValidDomain(domain)) {
    score += 10;
    details.push('valid_domain_format');
  } else {
    score -= 20;
    details.push('invalid_domain_format');
  }

  // Suspicious TLD check
  const hasSuspiciousTld = SUSPICIOUS_TLDS.some(tld => domain.endsWith(tld));
  if (hasSuspiciousTld) {
    score -= 30;
    details.push('suspicious_tld');
  }

  // Well-known TLD bonus
  if (domain.endsWith('.com') || domain.endsWith('.org') || domain.endsWith('.io') || domain.endsWith('.app') || domain.endsWith('.co')) {
    score += 10;
    details.push('trusted_tld');
  }

  // Site name provided
  if (siteName && siteName.trim().length > 1) {
    score += 5;
    details.push('has_site_name');
  }

  // Description quality
  if (description && description.trim().length > 20) {
    score += 15;
    details.push('good_description');
  } else if (description && description.trim().length > 0) {
    score += 5;
    details.push('has_description');
  }

  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, score));

  return { score, details };
}

// POST /api/suggestions — submit a site suggestion
router.post('/', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;

    // Rate limit: 3 suggestions per day per user
    const todayCount = await db.prepare(
      "SELECT COUNT(*) as count FROM site_suggestions WHERE user_id = ? AND DATE(created_at) = CURRENT_DATE"
    ).get(userId);

    if (todayCount && todayCount.count >= 3) {
      return res.status(429).json({ error: 'You can only submit 3 site suggestions per day' });
    }

    const { url, site_name, category, description } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL or domain is required' });
    }

    // Extract and validate domain
    const domain = extractDomain(url);
    if (!isValidDomain(domain)) {
      return res.status(400).json({ error: 'Invalid domain format' });
    }

    // Check if domain already exists in supported sites
    if (KNOWN_DOMAINS.includes(domain)) {
      return res.status(409).json({ error: `${domain} is already a supported site` });
    }

    // Check for duplicate suggestions
    const existingSuggestion = await db.prepare(
      'SELECT * FROM site_suggestions WHERE domain = ? AND status != ?'
    ).get(domain, 'rejected');

    if (existingSuggestion) {
      return res.status(409).json({ error: `${domain} has already been suggested` });
    }

    // Auto-score
    const { score, details } = scoreSuggestion(domain, site_name, description);

    // Determine status based on score
    let status;
    if (score >= 70) {
      status = 'pending';
    } else if (score >= 40) {
      status = 'hold';
    } else {
      status = 'rejected';
    }

    const id = uuidv4();
    await db.prepare(`
      INSERT INTO site_suggestions (id, user_id, domain, site_name, category, description, status, score, screening_details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, domain, site_name || null, category || null, description || null, status, score, JSON.stringify(details));

    const suggestion = await db.prepare('SELECT * FROM site_suggestions WHERE id = ?').get(id);
    logAudit('site_suggestion', { userId, ip: getIp(req), details: { domain, score, status } });

    return res.status(201).json({ suggestion });
  } catch (err) {
    console.error('Create suggestion error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/suggestions/my — user's own suggestions
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const suggestions = await db.prepare(
      'SELECT * FROM site_suggestions WHERE user_id = ? ORDER BY created_at DESC'
    ).all(req.user.id);

    return res.json({ suggestions });
  } catch (err) {
    console.error('Get suggestions error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
