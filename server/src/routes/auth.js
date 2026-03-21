const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const authMiddleware = require('../middleware/auth');
const xApi = require('../services/xApi');
const { encrypt } = require('../services/encryption');
const { logAudit, getIp } = require('../services/auditLog');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

// One-time exchange codes (code -> jwt, expires after 60s)
const exchangeCodes = new Map();

// Cleanup expired codes every 30s
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of exchangeCodes.entries()) {
    if (now - data.createdAt > 60000) exchangeCodes.delete(code);
  }
}, 30000);

// GET /api/auth/x-login — returns the X OAuth authorization URL
router.get('/x-login', async (req, res) => {
  try {
    const { url, state } = await xApi.getAuthorizationUrl();
    logAudit('login_attempt', { ip: getIp(req) });
    return res.json({ url, state });
  } catch (err) {
    console.error('X login error:', err);
    return res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

// GET /api/auth/callback — X OAuth callback (browser redirect)
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      return res.send(callbackHTML('error', `Authorization denied: ${oauthError}`));
    }

    if (!code || !state) {
      return res.send(callbackHTML('error', 'Missing authorization code or state'));
    }

    // Exchange code for access token
    const tokenData = await xApi.exchangeCodeForToken(code, state);
    const accessToken = tokenData.access_token;

    // Fetch user profile from X
    const profile = await xApi.fetchUserProfile(accessToken);

    const db = getDb();

    // Find or create user
    let user = await db.prepare('SELECT * FROM users WHERE x_id = ?').get(profile.x_id);

    if (user) {
      // Update existing user's profile and token
      await db.prepare(`
        UPDATE users SET
          x_username = ?, x_display_name = ?, x_profile_image = ?,
          x_followers_count = ?, x_access_token = ?
        WHERE x_id = ?
      `).run(
        profile.x_username, profile.x_display_name, profile.x_profile_image,
        profile.x_followers_count, encrypt(accessToken), profile.x_id
      );
      user = await db.prepare('SELECT * FROM users WHERE x_id = ?').get(profile.x_id);
    } else {
      const id = uuidv4();
      await db.prepare(`
        INSERT INTO users (id, x_id, x_username, x_display_name, x_profile_image, x_followers_count, x_access_token)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, profile.x_id, profile.x_username, profile.x_display_name,
        profile.x_profile_image, profile.x_followers_count, encrypt(accessToken));
      user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    }

    // Note: Follow sync via X API requires paid tier.
    // Network connections are managed manually through the app.

    // Generate JWT
    const jwtToken = jwt.sign(
      { id: user.id, x_username: user.x_username },
      JWT_SECRET,
      { expiresIn: '90d' }
    );

    // Generate a one-time exchange code and redirect with it as a query parameter
    const exchangeCode = crypto.randomBytes(32).toString('hex');
    exchangeCodes.set(exchangeCode, { jwt: jwtToken, createdAt: Date.now() });
    logAudit('login_success', { userId: user.id, ip: getIp(req), details: { x_username: user.x_username } });
    // Use X_CALLBACK_URL to determine the base URL, or fall back to request host
    const baseUrl = process.env.X_CALLBACK_URL
      ? process.env.X_CALLBACK_URL.replace('/api/auth/callback', '')
      : `${req.protocol}://${req.get('host')}`;
    return res.redirect(`${baseUrl}/api/auth/success?code=${exchangeCode}`);

  } catch (err) {
    console.error('OAuth callback error:', err.message, err.stack);
    logAudit('login_failed', { ip: getIp(req), details: { error: err.message }, severity: 'warning' });
    return res.send(callbackHTML('error', 'Authentication failed. Please try again.'));
  }
});

// GET /api/auth/success — success page after OAuth (token is in URL hash)
router.get('/success', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head><title>Referral Network - Login Successful</title>
<style>
  body { background: #000; color: #e7e9ea; font-family: -apple-system, sans-serif;
    display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center; }
  .container { max-width: 400px; }
  h1 { color: #1DA1F2; margin-bottom: 12px; }
  p { color: #71767b; }
</style>
</head>
<body>
<div class="container">
  <div style="font-size:48px; margin-bottom:16px;">&#10003;</div>
  <h1>Login Successful!</h1>
  <p>You can close this tab and click the extension icon.</p>
</div>
</body>
</html>`);
});

// POST /api/auth/exchange — exchange one-time code for JWT token
router.post('/exchange', (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Exchange code is required' });
    }

    const data = exchangeCodes.get(code);
    if (!data) {
      logAudit('token_exchange_failed', { ip: getIp(req), severity: 'warning' });
      return res.status(401).json({ error: 'Invalid or expired exchange code' });
    }

    // Delete immediately (single use)
    exchangeCodes.delete(code);

    // Check expiry (60 seconds)
    if (Date.now() - data.createdAt > 60000) {
      return res.status(401).json({ error: 'Exchange code has expired' });
    }

    logAudit('token_exchange', { ip: getIp(req) });
    return res.json({ token: data.jwt });
  } catch (err) {
    console.error('Exchange error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login — mock login (development/testing only)
if (process.env.NODE_ENV === 'development') {
  router.post('/login', async (req, res) => {
    try {
      const db = getDb();
      const { username } = req.body;

      if (!username) {
        return res.status(400).json({ error: 'username is required' });
      }

      let user = await db.prepare('SELECT * FROM users WHERE x_username = ?').get(username);

      if (!user) {
        const id = uuidv4();
        await db.prepare(
          'INSERT INTO users (id, x_username, x_display_name, x_profile_image, x_followers_count) VALUES (?, ?, ?, ?, ?)'
        ).run(id, username, username, `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`, 0);
        user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      }

      const token = jwt.sign(
        { id: user.id, x_username: user.x_username },
        JWT_SECRET,
        { expiresIn: '90d' }
      );

      return res.json({ token, user });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
}

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const user = await db.prepare(
      'SELECT id, x_id, x_username, x_display_name, x_profile_image, x_followers_count, consented, created_at FROM users WHERE id = ?'
    ).get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user });
  } catch (err) {
    console.error('Get me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Sync the user's X follow list and interaction data into the database
 */
async function syncFollowData(userId, accessToken, xUserId) {
  const db = getDb();

  try {
    // Fetch who this user follows
    const following = await xApi.fetchFollowing(accessToken, xUserId);
    console.log(`Syncing ${following.length} follows for user ${xUserId}`);

    for (const f of following) {
      // Upsert followed user
      let followedUser = await db.prepare('SELECT * FROM users WHERE x_id = ?').get(f.x_id);
      if (!followedUser) {
        const fId = uuidv4();
        await db.prepare(`
          INSERT INTO users (id, x_id, x_username, x_display_name, x_profile_image, x_followers_count)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (x_id) DO NOTHING
        `).run(fId, f.x_id, f.x_username, f.x_display_name, f.x_profile_image, f.x_followers_count);
        followedUser = await db.prepare('SELECT * FROM users WHERE x_id = ?').get(f.x_id);
      } else {
        // Update profile data
        await db.prepare(`
          UPDATE users SET x_username = ?, x_display_name = ?, x_profile_image = ?, x_followers_count = ?
          WHERE x_id = ?
        `).run(f.x_username, f.x_display_name, f.x_profile_image, f.x_followers_count, f.x_id);
      }

      if (followedUser) {
        // Insert follow relationship
        await db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
          .run(userId, followedUser.id);
      }
    }

    // Fetch likes to build interaction data
    const likeCounts = await xApi.fetchUserLikes(accessToken, xUserId);
    for (const [targetXId, count] of Object.entries(likeCounts)) {
      const targetUser = await db.prepare('SELECT id FROM users WHERE x_id = ?').get(targetXId);
      if (targetUser) {
        await db.prepare(`
          INSERT INTO interactions (user_id, target_user_id, interaction_type, count)
          VALUES (?, ?, 'like', ?)
          ON CONFLICT(user_id, target_user_id, interaction_type) DO UPDATE SET count = ?
        `).run(userId, targetUser.id, count, count);
      }
    }

    console.log(`Follow sync complete for user ${xUserId}`);
  } catch (err) {
    console.error('Sync follow data error:', err);
  }
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate callback HTML that communicates the auth result back to the extension
 */
function callbackHTML(status, data) {
  if (status === 'success') {
    return `<!DOCTYPE html>
<html>
<head><title>Referral Network - Login Successful</title>
<style>
  body { background: #000; color: #e7e9ea; font-family: -apple-system, sans-serif;
    display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center; }
  .container { max-width: 400px; }
  h1 { color: #1DA1F2; margin-bottom: 12px; }
  p { color: #71767b; }
  .check { font-size: 48px; margin-bottom: 16px; }
</style>
</head>
<body>
<div class="container">
  <div class="check">&#10003;</div>
  <h1>Login Successful!</h1>
  <p>You can close this tab and return to the extension.</p>
  <p id="status" style="margin-top:12px; font-size:13px; color:#536471;">Sending credentials to extension...</p>
</div>
<script>
  // Send the JWT token to the extension via a custom message
  // The extension's service worker listens for this
  const token = ${JSON.stringify(data)};

  // Try to communicate with extension via BroadcastChannel
  try {
    const bc = new BroadcastChannel('referral_network_auth');
    bc.postMessage({ type: 'AUTH_SUCCESS', token: token });
    document.getElementById('status').textContent = 'Credentials sent! You may close this tab.';
  } catch(e) {
    // Fallback: store in localStorage for the extension to pick up
    try {
      localStorage.setItem('referral_network_token', token);
      document.getElementById('status').textContent = 'Credentials saved! You may close this tab.';
    } catch(e2) {}
  }

  // Auto-close after a delay
  setTimeout(() => { window.close(); }, 3000);
</script>
</body>
</html>`;
  } else {
    return `<!DOCTYPE html>
<html>
<head><title>Referral Network - Login Failed</title>
<style>
  body { background: #000; color: #e7e9ea; font-family: -apple-system, sans-serif;
    display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center; }
  .container { max-width: 400px; }
  h1 { color: #f4212e; margin-bottom: 12px; }
  p { color: #71767b; }
</style>
</head>
<body>
<div class="container">
  <h1>Login Failed</h1>
  <p>${escapeHtml(data)}</p>
  <p style="margin-top:16px;"><a href="/" style="color:#1DA1F2;">Try again</a></p>
</div>
</body>
</html>`;
  }
}

module.exports = router;
