const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const authMiddleware = require('../middleware/auth');
const { adminMiddleware } = require('../middleware/auth');
const { logAudit, getIp } = require('../services/auditLog');

const router = express.Router();

// GET /api/affiliates/link?domain=chase.com — get affiliate link for a domain
router.get('/link', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { domain } = req.query;

    if (!domain) {
      return res.status(400).json({ error: 'domain is required' });
    }

    const link = await db.prepare(
      'SELECT id, site_domain, site_name, affiliate_url, network FROM affiliate_links WHERE site_domain = ? AND is_active = 1 LIMIT 1'
    ).get(domain);

    if (!link) {
      return res.json({ affiliate: null });
    }

    return res.json({ affiliate: link });
  } catch (err) {
    console.error('Get affiliate link error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/affiliates/track — track a copy/click event
// Deduplicated: same user + same code + same action = max once per hour
router.post('/track', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { site_domain, referral_code_id, action } = req.body;

    if (!site_domain) {
      return res.status(400).json({ error: 'site_domain is required' });
    }

    const validActions = ['copy', 'click', 'conversion'];
    const trackAction = validActions.includes(action) ? action : 'copy';

    // Deduplicate: check if same user already tracked this action recently
    const recent = await db.prepare(`
      SELECT COUNT(*) as count FROM affiliate_clicks
      WHERE user_id = ? AND site_domain = ? AND action = ?
        AND COALESCE(referral_code_id, '') = COALESCE(?, '')
        AND created_at > NOW() - INTERVAL '1 hour'
    `).get(req.user.id, site_domain, trackAction, referral_code_id || '');

    if (recent && recent.count > 0) {
      return res.json({ success: true, deduplicated: true });
    }

    // Find active affiliate link for this domain
    const link = await db.prepare(
      'SELECT id FROM affiliate_links WHERE site_domain = ? AND is_active = 1 LIMIT 1'
    ).get(site_domain);

    await db.prepare(`
      INSERT INTO affiliate_clicks (affiliate_link_id, referral_code_id, user_id, site_domain, action)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      link ? link.id : null,
      referral_code_id || null,
      req.user.id,
      site_domain,
      trackAction
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('Track affiliate error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/affiliates/stats — affiliate performance stats (admin only)
router.get('/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const db = getDb();

    // Total clicks by domain
    const byDomain = await db.prepare(`
      SELECT site_domain, action, COUNT(*) as count
      FROM affiliate_clicks
      GROUP BY site_domain, action
      ORDER BY count DESC
      LIMIT 100
    `).all();

    // Clicks today
    const today = await db.prepare(`
      SELECT COUNT(*) as count FROM affiliate_clicks
      WHERE DATE(created_at) = CURRENT_DATE
    `).get();

    // Clicks this month
    const thisMonth = await db.prepare(`
      SELECT COUNT(*) as count FROM affiliate_clicks
      WHERE to_char(created_at, 'YYYY-MM') = to_char(NOW(), 'YYYY-MM')
    `).get();

    // Active affiliate links
    const activeLinks = await db.prepare(
      'SELECT COUNT(*) as count FROM affiliate_links WHERE is_active = 1'
    ).get();

    return res.json({
      byDomain,
      today: today?.count || 0,
      thisMonth: thisMonth?.count || 0,
      activeLinks: activeLinks?.count || 0
    });
  } catch (err) {
    console.error('Affiliate stats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/affiliates/links — add a new affiliate link (admin only)
router.post('/links', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { site_domain, site_name, category, network, affiliate_url, commission_type, commission_value, cookie_days } = req.body;

    if (!site_domain || !affiliate_url || !network) {
      return res.status(400).json({ error: 'site_domain, affiliate_url, and network are required' });
    }

    const id = uuidv4();
    await db.prepare(`
      INSERT INTO affiliate_links (id, site_domain, site_name, category, network, affiliate_url, commission_type, commission_value, cookie_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (site_domain, network) DO UPDATE SET
        site_name = EXCLUDED.site_name,
        category = EXCLUDED.category,
        affiliate_url = EXCLUDED.affiliate_url,
        commission_type = EXCLUDED.commission_type,
        commission_value = EXCLUDED.commission_value,
        cookie_days = EXCLUDED.cookie_days
    `).run(id, site_domain, site_name || null, category || null, network, affiliate_url, commission_type || null, commission_value || null, cookie_days || 30);

    logAudit('affiliate_link_added', { userId: req.user.id, ip: getIp(req), details: { site_domain, network } });
    return res.status(201).json({ id, site_domain, network });
  } catch (err) {
    console.error('Add affiliate link error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/affiliates/links — list all affiliate links
router.get('/links', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const links = await db.prepare(
      'SELECT * FROM affiliate_links ORDER BY is_active DESC, site_domain ASC LIMIT ? OFFSET ?'
    ).all(limit, offset);
    return res.json({ links });
  } catch (err) {
    console.error('List affiliate links error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/affiliates/links/:id — deactivate an affiliate link (admin only)
router.delete('/links/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const db = getDb();
    await db.prepare('UPDATE affiliate_links SET is_active = 0 WHERE id = ?').run(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    console.error('Deactivate affiliate link error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
