const { getDb } = require('../db/database');

/**
 * Log an audit event
 * @param {string} action - The action performed
 * @param {object} options - { userId, ip, details, severity }
 */
function logAudit(action, { userId = null, ip = null, details = null, severity = 'info' } = {}) {
  try {
    const db = getDb();
    const detailsStr = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null;
    // Fire and forget — don't block the caller
    db.prepare(
      'INSERT INTO audit_logs (user_id, action, ip_address, details, severity) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, action, ip, detailsStr, severity).catch(err => {
      console.error('Audit log error:', err.message);
    });
  } catch (err) {
    // Don't let logging errors crash the app
    console.error('Audit log error:', err.message);
  }
}

// Helper to extract IP from request
function getIp(req) {
  return req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
}

module.exports = { logAudit, getIp };
