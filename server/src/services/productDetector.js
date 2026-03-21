/**
 * Auto-detect product/card type from referral URLs
 *
 * Parses referral URLs from major sites and extracts the specific
 * product being referred (e.g., "Sapphire Preferred" from a Chase URL).
 */

// Chase: referyourchasecard.com path codes
// The first digits identify the card family, the letter suffix varies by offer version
// We match the numeric prefix to catch all offer variants
const CHASE_PATH_PREFIXES = [
  // Sapphire
  { prefix: '6', product: 'Sapphire Preferred' },
  { prefix: '19', product: 'Sapphire Reserve' },
  // Freedom
  { prefix: '18', product: 'Freedom Unlimited' },
  { prefix: '2', product: 'Freedom Flex', exact: ['2q', '2Q'] },
  { prefix: '2', product: 'Freedom Unlimited' },
  { prefix: '20', product: 'Freedom Rise' },
  // Ink Business
  { prefix: '21', product: 'Ink Business Preferred', exact: ['21a', '21d', '21e', '21A', '21D', '21E'] },
  { prefix: '21s', product: 'Ink Business Cash' },
  { prefix: '21o', product: 'Ink Business Unlimited' },
  { prefix: '21w', product: 'Ink Business' },
  // Hotel & Airline
  { prefix: '210', product: 'IHG One Rewards' },
  { prefix: '215', product: 'United' },
  { prefix: '220', product: 'Southwest' },
  { prefix: '225', product: 'Marriott Bonvoy' },
  { prefix: '24', product: 'Aeroplan' },
];

function matchChasePath(pathCode) {
  // Try exact matches first for specificity
  for (const entry of CHASE_PATH_PREFIXES) {
    if (entry.exact && entry.exact.includes(pathCode)) return entry.product;
  }
  // Then try prefix matches (longest prefix first — already sorted by specificity above)
  // Sort by prefix length descending so longer prefixes match first
  const sorted = [...CHASE_PATH_PREFIXES].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const entry of sorted) {
    if (pathCode.startsWith(entry.prefix)) return entry.product;
  }
  return null;
}

// Amex: URL keyword detection from mgmee.americanexpress.com or refer.amex.us
const AMEX_KEYWORDS = [
  { pattern: /platinum/i, product: 'Platinum Card' },
  { pattern: /gold/i, product: 'Gold Card' },
  { pattern: /green/i, product: 'Green Card' },
  { pattern: /blue.?cash.?preferred/i, product: 'Blue Cash Preferred' },
  { pattern: /blue.?cash.?everyday/i, product: 'Blue Cash Everyday' },
  { pattern: /blue.?business.?plus/i, product: 'Blue Business Plus' },
  { pattern: /blue.?business.?cash/i, product: 'Blue Business Cash' },
  { pattern: /delta.?skymiles.?reserve/i, product: 'Delta SkyMiles Reserve' },
  { pattern: /delta.?skymiles.?platinum/i, product: 'Delta SkyMiles Platinum' },
  { pattern: /delta.?skymiles.?gold/i, product: 'Delta SkyMiles Gold' },
  { pattern: /delta.?skymiles.?blue/i, product: 'Delta SkyMiles Blue' },
  { pattern: /delta.?reserve/i, product: 'Delta SkyMiles Reserve' },
  { pattern: /delta.?platinum/i, product: 'Delta SkyMiles Platinum' },
  { pattern: /delta.?gold/i, product: 'Delta SkyMiles Gold' },
  { pattern: /delta/i, product: 'Delta SkyMiles' },
  { pattern: /hilton.?honors.?aspire/i, product: 'Hilton Honors Aspire' },
  { pattern: /hilton.?honors.?surpass/i, product: 'Hilton Honors Surpass' },
  { pattern: /hilton.?honors/i, product: 'Hilton Honors' },
  { pattern: /hilton.?aspire/i, product: 'Hilton Honors Aspire' },
  { pattern: /hilton.?surpass/i, product: 'Hilton Honors Surpass' },
  { pattern: /hilton/i, product: 'Hilton Honors' },
  { pattern: /marriott.?bonvoy.?brilliant/i, product: 'Marriott Bonvoy Brilliant' },
  { pattern: /marriott.?bonvoy.?bevy/i, product: 'Marriott Bonvoy Bevy' },
  { pattern: /marriott.?bonvoy/i, product: 'Marriott Bonvoy' },
  { pattern: /business.?platinum/i, product: 'Business Platinum' },
  { pattern: /business.?gold/i, product: 'Business Gold' },
  { pattern: /centurion/i, product: 'Centurion' },
  { pattern: /everyday.?preferred/i, product: 'EveryDay Preferred' },
  { pattern: /everyday/i, product: 'EveryDay' },
];

// Amex XLINK/XL parameter mapping
const AMEX_XLINK_MAP = {
  'MYCP': 'Membership Rewards Card',
  'MYCG': 'Gold Card',
  'MYCA': 'Platinum Card',
};

// Capital One URL keywords
const CAPITALONE_KEYWORDS = [
  { pattern: /venture.?x/i, product: 'Venture X' },
  { pattern: /venture.?one/i, product: 'VentureOne' },
  { pattern: /venture/i, product: 'Venture' },
  { pattern: /savor.?one/i, product: 'SavorOne' },
  { pattern: /savor/i, product: 'Savor' },
  { pattern: /quicksilver.?one/i, product: 'QuicksilverOne' },
  { pattern: /quicksilver/i, product: 'Quicksilver' },
  { pattern: /spark/i, product: 'Spark Business' },
];

// Citi URL keywords
const CITI_KEYWORDS = [
  { pattern: /premier/i, product: 'Premier' },
  { pattern: /double.?cash/i, product: 'Double Cash' },
  { pattern: /custom.?cash/i, product: 'Custom Cash' },
  { pattern: /strata.?premier/i, product: 'Strata Premier' },
  { pattern: /diamond.?preferred/i, product: 'Diamond Preferred' },
  { pattern: /aadvantage.?platinum/i, product: 'AAdvantage Platinum Select' },
  { pattern: /aadvantage.?executive/i, product: 'AAdvantage Executive' },
  { pattern: /aadvantage/i, product: 'AAdvantage' },
  { pattern: /costco/i, product: 'Costco Anywhere Visa' },
];

// Discover URL keywords
const DISCOVER_KEYWORDS = [
  { pattern: /chrome/i, product: 'Chrome' },
  { pattern: /miles/i, product: 'Miles' },
  { pattern: /cash.?back/i, product: 'Cash Back' },
  { pattern: /it/i, product: 'it Cash Back' },
  { pattern: /student/i, product: 'Student' },
];

/**
 * Detect product type from a referral code URL
 * @param {string} code - The referral code (may be a URL or plain text)
 * @param {string} siteDomain - The site domain (e.g., 'chase.com')
 * @returns {string|null} - Detected product type or null
 */
function detectProductType(code, siteDomain) {
  if (!code) return null;

  const urlMatch = code.match(/https?:\/\/[^\s]+/i);
  if (!urlMatch) return null; // Plain text code, can't auto-detect

  const url = urlMatch[0];
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const fullPath = parsed.pathname + parsed.search + parsed.hash;
  const fullUrl = url.toLowerCase();

  // --- Chase ---
  if (siteDomain === 'chase.com' || hostname.includes('chase') || hostname.includes('referyourchasecard')) {
    // Extract path segments and try matching each
    const segments = parsed.pathname.split('/').filter(Boolean);
    for (const seg of segments) {
      // Skip segments that are just hashes/codes (all uppercase alphanumeric, long)
      if (/^[A-Z0-9]{8,}$/.test(seg)) continue;
      const matched = matchChasePath(seg);
      if (matched) return matched;
    }
    // Also try matching from URL path pattern like /content/.../21e.html
    const htmlMatch = parsed.pathname.match(/\/(\d+\w*)\.html/);
    if (htmlMatch) {
      const matched = matchChasePath(htmlMatch[1]);
      if (matched) return matched;
    }
  }

  // --- American Express ---
  if (siteDomain === 'americanexpress.com' || hostname.includes('americanexpress') || hostname.includes('amex')) {
    // Check XLINK or XL parameter
    const xlink = parsed.searchParams.get('XLINK') || parsed.searchParams.get('xlink') || parsed.searchParams.get('XL') || parsed.searchParams.get('xl');
    if (xlink && AMEX_XLINK_MAP[xlink.toUpperCase()]) {
      return AMEX_XLINK_MAP[xlink.toUpperCase()];
    }

    // Check URL path/params for card name keywords
    for (const { pattern, product } of AMEX_KEYWORDS) {
      if (pattern.test(fullUrl)) return product;
    }
  }

  // --- Capital One ---
  if (siteDomain === 'capitalone.com' || hostname.includes('capitalone') || hostname.includes('capital.one')) {
    for (const { pattern, product } of CAPITALONE_KEYWORDS) {
      if (pattern.test(fullUrl)) return product;
    }
  }

  // --- Citi ---
  if (siteDomain === 'citi.com' || hostname.includes('citi')) {
    for (const { pattern, product } of CITI_KEYWORDS) {
      if (pattern.test(fullUrl)) return product;
    }
  }

  // --- Discover ---
  if (siteDomain === 'discover.com' || hostname.includes('discover')) {
    for (const { pattern, product } of DISCOVER_KEYWORDS) {
      if (pattern.test(fullUrl)) return product;
    }
  }

  // --- Generic: try to extract from URL path ---
  // Look for common product names in the URL
  const genericPatterns = [
    { pattern: /preferred/i, product: 'Preferred' },
    { pattern: /reserve/i, product: 'Reserve' },
    { pattern: /premium/i, product: 'Premium' },
    { pattern: /business/i, product: 'Business' },
    { pattern: /student/i, product: 'Student' },
    { pattern: /plus/i, product: 'Plus' },
  ];

  for (const { pattern, product } of genericPatterns) {
    if (pattern.test(parsed.pathname)) return product;
  }

  return null;
}

module.exports = { detectProductType };
