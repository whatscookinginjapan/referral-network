/**
 * Rank referral codes by quality signals — no social graph required.
 *
 * Factors (weights):
 *   30% — Popularity: copy count (log-scaled, capped)
 *   20% — Trust: follower count of the sharer (log-scaled)
 *   15% — Freshness: newer codes score higher, decay over 90 days
 *   15% — Verification: verified > pending > warning > flagged
 *   10% — Reputation: user's total codes + low report rate + account age
 *   10% — Random: shuffle for fairness / discovery
 *
 * Penalties:
 *   - Codes near/at usage limit get dimmed (returned in results but flagged)
 *   - Codes with reports get score reduction
 */
async function rankReferrals(db, viewerUserId, domain) {
  const codes = await db.prepare(`
    SELECT rc.*, u.x_username, u.x_display_name, u.x_profile_image, u.x_followers_count, u.created_at as user_created_at
    FROM referral_codes rc
    JOIN users u ON rc.user_id = u.id
    WHERE rc.site_domain = ?
  `).all(domain);

  if (codes.length === 0) return [];

  const now = Date.now();
  const currentYear = new Date().getFullYear();

  // Pre-fetch report counts for all codes in one query
  const reportCounts = {};
  if (codes.length > 0) {
    // Build parameterized query for PostgreSQL
    const placeholders = codes.map((_, i) => `$${i + 1}`).join(',');
    const reportRows = await db._pool.query(
      `SELECT referral_id, COUNT(*) as count FROM reports WHERE referral_id IN (${placeholders}) GROUP BY referral_id`,
      codes.map(c => c.id)
    );
    for (const r of reportRows.rows) {
      reportCounts[r.referral_id] = parseInt(r.count);
    }
  }

  // Pre-fetch total code count per user
  const userCodeCounts = {};
  const userIds = [...new Set(codes.map(c => c.user_id))];
  if (userIds.length > 0) {
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');
    const countResult = await db._pool.query(
      `SELECT user_id, COUNT(*) as count FROM referral_codes WHERE user_id IN (${placeholders}) GROUP BY user_id`,
      userIds
    );
    for (const r of countResult.rows) {
      userCodeCounts[r.user_id] = parseInt(r.count);
    }
  }

  const scored = codes.map(code => {
    // --- Popularity (30%) ---
    const copies = code.copy_count || 0;
    const popularity = Math.min(Math.log10(copies + 1) / 3, 1); // log scale, caps at ~1000 copies

    // --- Trust (20%) ---
    const followers = code.x_followers_count || 0;
    const trust = Math.min(Math.log10(followers + 1) / 7, 1); // log scale, caps at ~10M

    // --- Freshness (15%) ---
    const codeAge = code.created_at ? (now - new Date(code.created_at).getTime()) : 0;
    const ageDays = codeAge / (1000 * 60 * 60 * 24);
    const freshness = Math.max(1 - (ageDays / 90), 0); // linear decay over 90 days, floor at 0

    // --- Verification (15%) ---
    const verifyScores = { verified: 1.0, pending: 0.5, warning: 0.2, flagged: 0.0, error: 0.3 };
    const verification = verifyScores[code.verification_status] ?? 0.5;

    // --- Reputation (10%) ---
    const totalCodes = userCodeCounts[code.user_id] || 1;
    const reports = reportCounts[code.id] || 0;
    const userAge = code.user_created_at ? (now - new Date(code.user_created_at).getTime()) / (1000 * 60 * 60 * 24) : 0;
    const reputationAge = Math.min(userAge / 30, 1); // ramps up over 30 days
    const reputationCodes = Math.min(totalCodes / 5, 1); // ramps up to 5 codes
    const reportPenalty = Math.max(1 - (reports * 0.3), 0); // each report reduces by 30%
    const reputation = ((reputationAge + reputationCodes) / 2) * reportPenalty;

    // --- Random (10%) ---
    const random = Math.random();

    // --- Final Score ---
    const final_score =
      0.30 * popularity +
      0.20 * trust +
      0.15 * freshness +
      0.15 * verification +
      0.10 * reputation +
      0.10 * random;

    // --- Usage Limit Check ---
    let usageLimitInfo = null;
    const maxUses = code.max_uses_per_year;
    const usesThisYear = (code.year_tracked === currentYear) ? (code.uses_this_year || 0) : 0;
    if (maxUses) {
      const remaining = Math.max(maxUses - usesThisYear, 0);
      usageLimitInfo = {
        max: maxUses,
        used: usesThisYear,
        remaining,
        exhausted: remaining === 0
      };
    }

    return {
      id: code.id,
      category: code.category,
      site_domain: code.site_domain,
      site_name: code.site_name,
      code: code.code,
      product_type: code.product_type || null,
      description: code.description,
      verification_status: code.verification_status || 'pending',
      created_at: code.created_at,
      score: final_score,
      copy_count: copies,
      success_count: code.success_count || 0,
      usage_limit: usageLimitInfo,
      user: {
        id: code.user_id,
        x_username: code.x_username,
        x_display_name: code.x_display_name,
        x_profile_image: code.x_profile_image,
        x_followers_count: code.x_followers_count,
      },
    };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored;
}

module.exports = { rankReferrals };
