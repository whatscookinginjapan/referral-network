const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const authMiddleware = require('../middleware/auth');
const { rankReferrals } = require('../services/ranking');
const { validateReferralCode, isRateLimited, isDuplicate } = require('../services/validation');
const { preScreen, verifyReferral } = require('../services/verificationAgent');
const { logAudit, getIp } = require('../services/auditLog');
const { detectProductType } = require('../services/productDetector');

const router = express.Router();

// GET /api/referrals?domain=chase.com
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { domain } = req.query;

    if (!domain) {
      return res.status(400).json({ error: 'domain query parameter is required' });
    }

    const ranked = await rankReferrals(db, req.user.id, domain);

    // Filter out codes with 3+ reports (auto-hidden)
    const filtered = [];
    for (const code of ranked) {
      const reportCount = await db.prepare(
        'SELECT COUNT(*) as count FROM reports WHERE referral_id = ?'
      ).get(code.id);
      if (!reportCount || reportCount.count < 3) {
        filtered.push(code);
      }
    }

    // Split into network codes (from users I follow) and other codes
    const myNetworkRows = await db.prepare('SELECT following_id FROM follows WHERE follower_id = ?')
      .all(req.user.id);
    const myNetworkIds = new Set(myNetworkRows.map(r => r.following_id));

    const networkCodes = filtered.filter(c => myNetworkIds.has(c.user?.id));
    const otherCodes = filtered.filter(c => !myNetworkIds.has(c.user?.id));

    return res.json({ networkCodes, otherCodes, referrals: filtered });
  } catch (err) {
    console.error('Get referrals error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/referrals/detect-product — auto-detect product type from URL
router.post('/detect-product', authMiddleware, (req, res) => {
  try {
    const { code, site_domain } = req.body;
    if (!code || !site_domain) {
      return res.json({ product_type: null });
    }
    const detected = detectProductType(code, site_domain);
    return res.json({ product_type: detected });
  } catch (err) {
    return res.json({ product_type: null });
  }
});

// POST /api/referrals/pre-screen — validate before submission (called by the popup)
router.post('/pre-screen', authMiddleware, async (req, res) => {
  try {
    const { code, description, site_domain, category } = req.body;

    if (!code || !site_domain) {
      return res.status(400).json({ error: 'code and site_domain are required' });
    }

    // Run static validation
    const validation = validateReferralCode(code, description, site_domain);
    if (!validation.valid) {
      return res.json({ approved: false, reason: validation.reason });
    }

    // Run pre-screening agent (includes URL check + description check)
    const screening = await preScreen(code, description, site_domain, category);

    return res.json({
      approved: screening.approved,
      reason: screening.reason || null,
      warnings: [...(validation.warnings || []), ...(screening.warnings || [])],
      checks: screening.checks || []
    });
  } catch (err) {
    console.error('Pre-screen error:', err);
    return res.status(500).json({ error: 'Pre-screening failed' });
  }
});

// POST /api/referrals
router.post('/', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { category, site_domain, site_name, code, description, product_type } = req.body;

    if (!category || !site_domain || !site_name || !code) {
      return res.status(400).json({ error: 'category, site_domain, site_name, and code are required' });
    }

    // Rate limiting
    const rateCheck = await isRateLimited(db, req.user.id);
    if (rateCheck.limited) {
      return res.status(429).json({ error: rateCheck.reason });
    }

    // Validate for phishing/XSS
    const validation = validateReferralCode(code, description, site_domain);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.reason });
    }

    // Pre-screen with agent
    const screening = await preScreen(code, description, site_domain, category);
    if (!screening.approved) {
      logAudit('referral_rejected', { userId: req.user.id, ip: getIp(req), details: { reason: screening.reason, code: code.substring(0, 50) }, severity: 'warning' });
      return res.status(400).json({ error: screening.reason });
    }

    // Check for duplicates
    const duplicate = await isDuplicate(db, code, site_domain, req.user.id, product_type);
    if (duplicate) {
      if (duplicate.type === 'same_code') {
        return res.status(409).json({ error: `This code was already submitted by @${duplicate.owner}` });
      }
      if (duplicate.type === 'own_product') {
        const ptLabel = duplicate.productType ? ` for "${duplicate.productType}"` : '';
        return res.status(409).json({
          error: `You already have a code${ptLabel} on this site ("${duplicate.existingCode}"). Delete it first or update it.`,
          existing_id: duplicate.existingId
        });
      }
    }

    const id = uuidv4();
    // Auto-detect product type from URL if not provided
    let cleanProductType = product_type ? product_type.trim().substring(0, 100) : null;
    if (!cleanProductType) {
      const detected = detectProductType(code, site_domain);
      if (detected) cleanProductType = detected;
    }

    await db.prepare(
      'INSERT INTO referral_codes (id, user_id, category, site_domain, site_name, code, product_type, description, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, req.user.id, category, site_domain, site_name, code, cleanProductType, description || null, 'pending');

    const referral = await db.prepare('SELECT * FROM referral_codes WHERE id = ?').get(id);
    logAudit('referral_created', { userId: req.user.id, ip: getIp(req), details: { referralId: id, domain: site_domain } });

    // Run deep verification in background
    verifyReferral(db, id).catch(err => {
      console.error('[VerificationAgent] Background verify error:', err);
    });

    return res.status(201).json({
      referral,
      warnings: [...(validation.warnings || []), ...(screening.warnings || [])]
    });
  } catch (err) {
    console.error('Create referral error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/referrals/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = await db.prepare('SELECT * FROM referral_codes WHERE id = ?').get(id);

    if (!existing) {
      return res.status(404).json({ error: 'Referral code not found' });
    }

    if (existing.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only update your own referral codes' });
    }

    const { category, site_domain, site_name, code, description, product_type } = req.body;

    // Validate new code if changed
    if (code) {
      const validation = validateReferralCode(code, description || existing.description, site_domain || existing.site_domain);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.reason });
      }
    }

    await db.prepare(`
      UPDATE referral_codes
      SET category = COALESCE(?, category),
          site_domain = COALESCE(?, site_domain),
          site_name = COALESCE(?, site_name),
          code = COALESCE(?, code),
          product_type = COALESCE(?, product_type),
          description = COALESCE(?, description)
      WHERE id = ?
    `).run(
      category || null,
      site_domain || null,
      site_name || null,
      code || null,
      product_type !== undefined ? product_type : null,
      description !== undefined ? description : null,
      id
    );

    const updated = await db.prepare('SELECT * FROM referral_codes WHERE id = ?').get(id);
    return res.json({ referral: updated });
  } catch (err) {
    console.error('Update referral error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/referrals/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = await db.prepare('SELECT * FROM referral_codes WHERE id = ?').get(id);

    if (!existing) {
      return res.status(404).json({ error: 'Referral code not found' });
    }

    if (existing.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own referral codes' });
    }

    await db.prepare('DELETE FROM referral_codes WHERE id = ?').run(id);
    logAudit('referral_deleted', { userId: req.user.id, ip: getIp(req), details: { referralId: id } });
    return res.json({ message: 'Referral code deleted' });
  } catch (err) {
    console.error('Delete referral error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/referrals/:id/report — report a suspicious referral code
router.post('/:id/report', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { reason } = req.body;

    const existing = await db.prepare('SELECT * FROM referral_codes WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Referral code not found' });
    }

    // Can't report your own
    if (existing.user_id === req.user.id) {
      return res.status(400).json({ error: 'You cannot report your own referral code' });
    }

    await db.prepare(
      'INSERT INTO reports (reporter_id, referral_id, reason) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'
    ).run(req.user.id, id, reason || 'suspicious');

    // Check if this code now has 3+ reports -> auto-hide
    const reportCount = await db.prepare(
      'SELECT COUNT(*) as count FROM reports WHERE referral_id = ?'
    ).get(id);

    logAudit('referral_reported', { userId: req.user.id, ip: getIp(req), details: { referralId: id, totalReports: reportCount.count } });
    return res.json({
      success: true,
      message: reportCount.count >= 3
        ? 'This code has been flagged and hidden from other users.'
        : 'Report submitted. Thank you for helping keep the community safe.'
    });
  } catch (err) {
    console.error('Report error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/referrals/:id/copy — track that a code was copied/clicked
// Deduplicated: same user can only increment once per code per hour
router.post('/:id/copy', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const codeId = req.params.id;

    // Check if this user already clicked this code in the last hour
    const recent = await db.prepare(`
      SELECT COUNT(*) as count FROM affiliate_clicks
      WHERE user_id = ? AND referral_code_id = ? AND action IN ('copy', 'click')
        AND created_at > NOW() - INTERVAL '1 hour'
    `).get(userId, codeId);

    if (recent && recent.count > 0) {
      return res.json({ success: true, deduplicated: true });
    }

    await db.prepare('UPDATE referral_codes SET copy_count = COALESCE(copy_count, 0) + 1 WHERE id = ?')
      .run(codeId);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/referrals/:id/used — user confirms they successfully used this code
// Deduplicated: same user can only confirm once per code
router.post('/:id/used', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const codeId = req.params.id;
    const currentYear = new Date().getFullYear();

    // Check if this user already confirmed this code
    const alreadyUsed = await db.prepare(`
      SELECT COUNT(*) as count FROM affiliate_clicks
      WHERE user_id = ? AND referral_code_id = ? AND action = 'conversion'
    `).get(userId, codeId);

    if (alreadyUsed && alreadyUsed.count > 0) {
      return res.json({ success: true, deduplicated: true });
    }

    // Log the conversion
    await db.prepare(`
      INSERT INTO affiliate_clicks (referral_code_id, user_id, site_domain, action)
      VALUES (?, ?, (SELECT site_domain FROM referral_codes WHERE id = ?), 'conversion')
    `).run(codeId, userId, codeId);

    // Increment success count
    await db.prepare('UPDATE referral_codes SET success_count = COALESCE(success_count, 0) + 1 WHERE id = ?')
      .run(codeId);

    // Track yearly usage (reset if new year)
    const code = await db.prepare('SELECT year_tracked, uses_this_year FROM referral_codes WHERE id = ?')
      .get(req.params.id);

    if (code) {
      if (code.year_tracked === currentYear) {
        await db.prepare('UPDATE referral_codes SET uses_this_year = COALESCE(uses_this_year, 0) + 1 WHERE id = ?')
          .run(req.params.id);
      } else {
        await db.prepare('UPDATE referral_codes SET uses_this_year = 1, year_tracked = ? WHERE id = ?')
          .run(currentYear, req.params.id);
      }
    }

    logAudit('referral_used', { userId: req.user.id, ip: getIp(req), details: { referralId: req.params.id } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/referrals/:id/usage-limit — set max uses per year for a code (owner only)
router.put('/:id/usage-limit', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { max_uses_per_year } = req.body;
    const code = await db.prepare('SELECT * FROM referral_codes WHERE id = ?').get(req.params.id);

    if (!code) return res.status(404).json({ error: 'Code not found' });
    if (code.user_id !== req.user.id) return res.status(403).json({ error: 'Not your code' });

    await db.prepare('UPDATE referral_codes SET max_uses_per_year = ? WHERE id = ?')
      .run(max_uses_per_year || null, req.params.id);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
