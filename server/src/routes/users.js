const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const authMiddleware = require('../middleware/auth');
const { logAudit, getIp } = require('../services/auditLog');

const router = express.Router();

// POST /api/users/me/consent
router.post('/me/consent', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    await db.prepare(
      'UPDATE users SET consented = 1, consented_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(req.user.id);
    logAudit('user_consent', { userId: req.user.id, ip: getIp(req) });
    return res.json({ success: true });
  } catch (err) {
    console.error('Consent error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/me/referrals
router.get('/me/referrals', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const referrals = await db.prepare(
      'SELECT * FROM referral_codes WHERE user_id = ? ORDER BY created_at DESC'
    ).all(req.user.id);
    return res.json({ referrals });
  } catch (err) {
    console.error('Get user referrals error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/me/network
router.get('/me/network', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const myId = req.user.id;

    // People I follow on the platform
    const iFollow = await db.prepare(`
      SELECT u.id, u.x_username, u.x_display_name, u.x_profile_image, u.x_followers_count,
        (SELECT COUNT(*) FROM referral_codes WHERE user_id = u.id) as referral_count
      FROM follows f
      JOIN users u ON f.following_id = u.id
      WHERE f.follower_id = ? AND u.consented = 1
    `).all(myId);

    // People who follow me on the platform
    const followMe = await db.prepare(`
      SELECT u.id
      FROM follows f
      JOIN users u ON f.follower_id = u.id
      WHERE f.following_id = ? AND u.consented = 1
    `).all(myId);

    const followMeIds = new Set(followMe.map(u => u.id));
    const iFollowIds = new Set(iFollow.map(u => u.id));

    // Build network with relationship tags
    // Start with people I follow — tag as mutual or following
    const networkMap = new Map();
    for (const user of iFollow) {
      user.relationship = followMeIds.has(user.id) ? 'mutual' : 'following';
      networkMap.set(user.id, user);
    }

    // Add people who follow me but I don't follow back — tag as follower
    const followersOnly = await db.prepare(`
      SELECT u.id, u.x_username, u.x_display_name, u.x_profile_image, u.x_followers_count,
        (SELECT COUNT(*) FROM referral_codes WHERE user_id = u.id) as referral_count
      FROM follows f
      JOIN users u ON f.follower_id = u.id
      WHERE f.following_id = ? AND u.consented = 1 AND f.follower_id NOT IN (
        SELECT following_id FROM follows WHERE follower_id = ?
      )
    `).all(myId, myId);

    for (const user of followersOnly) {
      user.relationship = 'follower';
      networkMap.set(user.id, user);
    }

    const network = Array.from(networkMap.values());
    // Sort: mutual first, then following, then follower, then by follower count
    const relOrder = { mutual: 0, following: 1, follower: 2 };
    network.sort((a, b) => (relOrder[a.relationship] - relOrder[b.relationship]) || (b.x_followers_count - a.x_followers_count));

    // Total connections
    const totalConnections = network.length;

    // All platform users (for discovery)
    const allUsers = await db.prepare(`
      SELECT id, x_username, x_display_name, x_profile_image, x_followers_count,
        (SELECT COUNT(*) FROM referral_codes WHERE user_id = users.id) as referral_count
      FROM users
      WHERE consented = 1 AND id != ?
      ORDER BY x_followers_count DESC
    `).all(myId);

    // Mark which ones are already in my network
    const discover = allUsers.filter(u => !networkMap.has(u.id));

    return res.json({
      network,
      discover,
      totalConnections,
      activeCount: network.length
    });
  } catch (err) {
    console.error('Get user network error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users/me/network/add — add a user to my network by username
router.post('/me/network/add', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'username is required' });
    }

    const cleanUsername = username.replace(/^@/, '').trim().toLowerCase();

    // Find the target user
    const targetUser = await db.prepare(
      'SELECT * FROM users WHERE LOWER(x_username) = ?'
    ).get(cleanUsername);

    if (!targetUser) {
      return res.status(404).json({ error: `@${cleanUsername} is not on Referral Network yet. Invite them to join!` });
    }

    if (targetUser.id === req.user.id) {
      return res.status(400).json({ error: "You can't add yourself" });
    }

    // Create one-directional follow (I follow them)
    await db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
      .run(req.user.id, targetUser.id);

    logAudit('network_add', { userId: req.user.id, ip: getIp(req), details: { targetUsername: cleanUsername } });
    return res.json({
      success: true,
      user: {
        id: targetUser.id,
        x_username: targetUser.x_username,
        x_display_name: targetUser.x_display_name,
        x_profile_image: targetUser.x_profile_image,
        x_followers_count: targetUser.x_followers_count
      }
    });
  } catch (err) {
    console.error('Add to network error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/users/me/network/:userId — remove a user from my network
router.delete('/me/network/:userId', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { userId } = req.params;

    await db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?')
      .run(req.user.id, userId);
    await db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?')
      .run(userId, req.user.id);

    return res.json({ success: true });
  } catch (err) {
    console.error('Remove from network error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users/me/import — bulk import following list
router.post('/me/import', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { usernames, followingData, import_source } = req.body;
    // import_source: 'following' (X archive/known following list), 'manual' (pasted usernames), or default 'unknown'
    const source = ['following', 'followers', 'manual'].includes(import_source) ? import_source : 'unknown';

    let imported = 0;
    let alreadyExists = 0;
    let autoConnected = 0;

    // Handle array of usernames (manual paste)
    const usernameList = [];
    if (usernames && Array.isArray(usernames)) {
      for (const u of usernames) {
        const clean = u.replace(/^@/, '').trim().toLowerCase();
        if (clean) usernameList.push({ username: clean, displayName: clean });
      }
    }

    // Handle X archive following.js data — these are definitively people you follow
    const archiveSource = followingData ? 'following' : source;
    if (followingData && Array.isArray(followingData)) {
      for (const entry of followingData) {
        const following = entry.following || entry;
        const username = (following.userLink || '').split('/').pop() || following.accountId || '';
        if (username) {
          usernameList.push({
            username: username.toLowerCase(),
            displayName: following.name || username,
            xId: following.accountId || null
          });
        }
      }
    }

    const effectiveSource = followingData ? 'following' : source;

    for (const { username, displayName, xId } of usernameList) {
      // Check if already imported
      const existing = await db.prepare(
        'SELECT * FROM imported_follows WHERE user_id = ? AND x_username = ?'
      ).get(req.user.id, username);

      if (existing) {
        // Always update with newer data
        if (effectiveSource !== 'unknown') {
          const currentSource = existing.import_source || 'unknown';

          // Determine merged source:
          // If already 'following' and new is 'followers' (or vice versa) -> 'mutual'
          // If same source -> keep it
          // If current is 'unknown' -> use new source
          // If new is more specific -> override
          let mergedSource = effectiveSource;
          if (currentSource !== 'unknown' && currentSource !== effectiveSource) {
            const sources = new Set([currentSource, effectiveSource]);
            if (sources.has('following') && sources.has('followers')) {
              mergedSource = 'mutual';
            }
          }

          await db.prepare('UPDATE imported_follows SET import_source = ?, x_display_name = COALESCE(?, x_display_name), x_id = COALESCE(?, x_id) WHERE id = ?')
            .run(mergedSource, displayName || null, xId || null, existing.id);
        }
        alreadyExists++;
        continue;
      }

      // Check if this user is already on the platform
      const platformUser = await db.prepare(
        'SELECT * FROM users WHERE LOWER(x_username) = ? AND consented = 1'
      ).get(username);

      await db.prepare(`
        INSERT INTO imported_follows (user_id, x_username, x_display_name, x_id, is_on_platform, platform_user_id, import_source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
      `).run(
        req.user.id, username, displayName, xId || null,
        platformUser ? 1 : 0, platformUser ? platformUser.id : null,
        effectiveSource
      );

      // Auto-connect if they're on the platform (one-directional: I follow them)
      // The reverse direction is only set when we know they follow us back
      if (platformUser) {
        await db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
          .run(req.user.id, platformUser.id);
        autoConnected++;
      }

      imported++;
    }

    logAudit('bulk_import', { userId: req.user.id, ip: getIp(req), details: { imported, autoConnected, total: usernameList.length } });
    return res.json({
      success: true,
      imported,
      alreadyExists,
      autoConnected,
      total: usernameList.length
    });
  } catch (err) {
    console.error('Import error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/me/imported — get imported follows with status
router.get('/me/imported', authMiddleware, async (req, res) => {
  try {
    const db = getDb();

    // Refresh on-platform status
    const allImported = await db.prepare(
      'SELECT * FROM imported_follows WHERE user_id = ? ORDER BY is_on_platform DESC, x_username ASC'
    ).all(req.user.id);

    // Re-check platform status for non-platform users
    for (const imp of allImported) {
      if (!imp.is_on_platform) {
        const platformUser = await db.prepare(
          'SELECT * FROM users WHERE LOWER(x_username) = ? AND consented = 1'
        ).get(imp.x_username);
        if (platformUser) {
          await db.prepare('UPDATE imported_follows SET is_on_platform = 1, platform_user_id = ? WHERE id = ?')
            .run(platformUser.id, imp.id);
          imp.is_on_platform = 1;
          imp.platform_user_id = platformUser.id;

          // Auto-connect (one-directional: I follow them, since they're from my import list)
          await db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
            .run(req.user.id, platformUser.id);
        }
      }
    }

    const myId = req.user.id;

    // Build follow sets for relationship detection
    const iFollowRows = await db.prepare('SELECT following_id FROM follows WHERE follower_id = ?').all(myId);
    const iFollowIds = new Set(iFollowRows.map(r => r.following_id));
    const followMeRows = await db.prepare('SELECT follower_id FROM follows WHERE following_id = ?').all(myId);
    const followMeIds = new Set(followMeRows.map(r => r.follower_id));

    const onPlatform = allImported.filter(u => u.is_on_platform).map(u => {
      const pid = u.platform_user_id;
      const iFollow = iFollowIds.has(pid);
      const followsMe = followMeIds.has(pid);
      const relationship = (iFollow && followsMe) ? 'mutual'
        : iFollow ? 'following'
        : followsMe ? 'follower'
        : 'none';
      return { ...u, relationship };
    });

    const notOnPlatform = allImported.filter(u => !u.is_on_platform);
    const invitable = notOnPlatform.filter(u => !u.invite_opted_out);

    return res.json({
      onPlatform,
      notOnPlatform,
      invitable: invitable.length,
      total: allImported.length
    });
  } catch (err) {
    console.error('Get imported error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users/me/imported/:id/opt-out — opt out of inviting a specific user
router.post('/me/imported/:id/opt-out', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    await db.prepare('UPDATE imported_follows SET invite_opted_out = 1 WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users/me/imported/:id/opt-in — re-enable inviting a specific user
router.post('/me/imported/:id/opt-in', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    await db.prepare('UPDATE imported_follows SET invite_opted_out = 0 WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users/me/imported/mark-invited — mark users as invited (after DM sent)
router.post('/me/imported/mark-invited', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    for (const id of ids) {
      await db.prepare('UPDATE imported_follows SET invited_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .run(id, req.user.id);
    }
    return res.json({ success: true, count: ids.length });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/me/following — fetch following list from X API
router.get('/me/following', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const user = await db.prepare('SELECT x_id, x_access_token FROM users WHERE id = ?').get(userId);

    if (!user || !user.x_access_token) {
      return res.status(400).json({ error: 'X account not connected. Please log out and log in again.' });
    }

    if (!user.x_id) {
      return res.status(400).json({ error: 'X user ID not found. Please log out and log in again.' });
    }

    const { decrypt } = require('../services/encryption');
    let accessToken;
    try {
      accessToken = decrypt(user.x_access_token);
    } catch (decryptErr) {
      console.error('Failed to decrypt X access token:', decryptErr);
      return res.status(400).json({ error: 'X access token is invalid. Please log out and log in again.' });
    }

    let allFollowing = [];
    let paginationToken = null;
    const maxPages = 50; // Up to 5,000 contacts
    let page = 0;

    do {
      let url = `https://api.twitter.com/2/users/${user.x_id}/following?max_results=100&user.fields=username,name,profile_image_url,public_metrics`;
      if (paginationToken) {
        url += `&pagination_token=${paginationToken}`;
      }

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (response.status === 429) {
        return res.status(429).json({ error: 'X API rate limit reached. Please try again in 15 minutes.' });
      }

      // Check content type before parsing — X API sometimes returns HTML on errors
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.error(`X API returned non-JSON (${response.status}): content-type=${contentType}`);
        if (response.status === 401 || response.status === 403) {
          return res.status(401).json({ error: 'X access token expired or invalid. Please log out and log in again.' });
        }
        return res.status(502).json({ error: 'X API returned an unexpected response. Please try again later.' });
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        if (response.status === 401 || response.status === 403) {
          return res.status(401).json({ error: errData.detail || 'X access token expired. Please log out and log in again.' });
        }
        return res.status(response.status).json({
          error: errData.detail || errData.title || 'Failed to fetch following from X'
        });
      }

      const data = await response.json();
      if (data.data) {
        allFollowing = allFollowing.concat(data.data.map(u => ({
          x_id: u.id,
          x_username: u.username,
          x_display_name: u.name,
          x_profile_image: u.profile_image_url,
          x_followers_count: u.public_metrics?.followers_count || 0
        })));
      }

      paginationToken = data.meta?.next_token || null;
      page++;
    } while (paginationToken && page < maxPages);

    res.json({
      following: allFollowing,
      total: allFollowing.length,
      hasMore: !!paginationToken
    });
  } catch (err) {
    console.error('Fetch following error:', err);
    res.status(500).json({ error: 'Failed to fetch following list: ' + (err.message || 'Unknown error') });
  }
});

// GET /api/users/me/followers — fetch followers list from X API
router.get('/me/followers', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const user = await db.prepare('SELECT x_id, x_access_token FROM users WHERE id = ?').get(userId);

    if (!user || !user.x_access_token) {
      return res.status(400).json({ error: 'X account not connected. Please log out and log in again.' });
    }

    if (!user.x_id) {
      return res.status(400).json({ error: 'X user ID not found. Please log out and log in again.' });
    }

    const { decrypt } = require('../services/encryption');
    let accessToken;
    try {
      accessToken = decrypt(user.x_access_token);
    } catch (decryptErr) {
      console.error('Failed to decrypt X access token:', decryptErr);
      return res.status(400).json({ error: 'X access token is invalid. Please log out and log in again.' });
    }

    let allFollowers = [];
    let paginationToken = null;
    const maxPages = 50; // Up to 5,000 contacts
    let page = 0;

    do {
      let url = `https://api.twitter.com/2/users/${user.x_id}/followers?max_results=100&user.fields=username,name,profile_image_url,public_metrics`;
      if (paginationToken) {
        url += `&pagination_token=${paginationToken}`;
      }

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (response.status === 429) {
        return res.status(429).json({ error: 'X API rate limit reached. Please try again in 15 minutes.' });
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.error(`X API returned non-JSON (${response.status}): content-type=${contentType}`);
        if (response.status === 401 || response.status === 403) {
          return res.status(401).json({ error: 'X access token expired. Please log out and log in again.' });
        }
        return res.status(502).json({ error: 'X API returned an unexpected response. Please try again later.' });
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        if (response.status === 401 || response.status === 403) {
          return res.status(401).json({ error: errData.detail || 'X access token expired. Please log out and log in again.' });
        }
        return res.status(response.status).json({
          error: errData.detail || errData.title || 'Failed to fetch followers from X'
        });
      }

      const data = await response.json();
      if (data.data) {
        allFollowers = allFollowers.concat(data.data.map(u => ({
          x_id: u.id,
          x_username: u.username,
          x_display_name: u.name,
          x_profile_image: u.profile_image_url,
          x_followers_count: u.public_metrics?.followers_count || 0
        })));
      }

      paginationToken = data.meta?.next_token || null;
      page++;
    } while (paginationToken && page < maxPages);

    res.json({
      followers: allFollowers,
      total: allFollowers.length,
      hasMore: !!paginationToken
    });
  } catch (err) {
    console.error('Fetch followers error:', err);
    res.status(500).json({ error: 'Failed to fetch followers list' });
  }
});

// POST /api/users/me/sync-x — sync following + followers from X API with correct relationship direction
router.post('/me/sync-x', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const user = await db.prepare('SELECT x_id, x_access_token FROM users WHERE id = ?').get(userId);

    if (!user || !user.x_access_token) {
      return res.status(400).json({ error: 'X account not connected. Please log out and log in again.' });
    }
    if (!user.x_id) {
      return res.status(400).json({ error: 'X user ID not found. Please log out and log in again.' });
    }

    const { decrypt } = require('../services/encryption');
    let accessToken;
    try {
      accessToken = decrypt(user.x_access_token);
    } catch (e) {
      return res.status(400).json({ error: 'X access token is invalid. Please log out and log in again.' });
    }

    // Helper to fetch paginated X API endpoint
    async function fetchAllFromX(endpoint) {
      const results = [];
      let paginationToken = null;
      let page = 0;
      const maxPages = 50;

      do {
        let url = `https://api.twitter.com/2/users/${user.x_id}/${endpoint}?max_results=100&user.fields=username,name,profile_image_url,public_metrics`;
        if (paginationToken) url += `&pagination_token=${paginationToken}`;

        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (response.status === 429) {
          return { data: results, error: 'Rate limited', partial: true };
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          if (response.status === 401 || response.status === 403) {
            return { data: [], error: 'X access token expired. Please log out and log in again.' };
          }
          return { data: results, error: 'X API error', partial: true };
        }

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          if (response.status === 401 || response.status === 403) {
            return { data: [], error: errData.detail || 'X access token expired. Please log out and log in again.' };
          }
          return { data: results, error: errData.detail || 'X API error', partial: true };
        }

        const data = await response.json();
        if (data.data) {
          results.push(...data.data.map(u => ({
            x_id: u.id,
            x_username: u.username,
            x_display_name: u.name,
            x_profile_image: u.profile_image_url,
            x_followers_count: u.public_metrics?.followers_count || 0
          })));
        }

        paginationToken = data.meta?.next_token || null;
        page++;
      } while (paginationToken && page < maxPages);

      return { data: results, error: null, partial: !!paginationToken };
    }

    // Fetch both lists from X API
    const followingResult = await fetchAllFromX('following');
    if (followingResult.error && followingResult.data.length === 0) {
      return res.status(400).json({ error: followingResult.error });
    }

    const followersResult = await fetchAllFromX('followers');

    const xFollowing = followingResult.data;
    const xFollowers = followersResult.data;

    // Build sets for relationship detection
    const followingUsernames = new Set(xFollowing.map(u => u.x_username.toLowerCase()));
    const followerUsernames = new Set(xFollowers.map(u => u.x_username.toLowerCase()));

    // Merge all unique users
    const allUsersMap = new Map();
    for (const u of [...xFollowing, ...xFollowers]) {
      const key = u.x_username.toLowerCase();
      if (!allUsersMap.has(key)) allUsersMap.set(key, u);
    }

    let imported = 0;
    let autoConnected = 0;
    let alreadyExists = 0;
    let followsCreated = 0;

    // Clear existing follows for this user to rebuild with correct direction
    await db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(userId, userId);

    // Cache all X relationships and create platform follows
    for (const [username, xUser] of allUsersMap) {
      const iFollow = followingUsernames.has(username);
      const followsMe = followerUsernames.has(username);

      // Cache X relationship (so future code views are free — no API call needed)
      await db.prepare(`
        INSERT INTO x_relationships (user_id, target_x_id, target_x_username, i_follow, follows_me, checked_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, target_x_username) DO UPDATE SET
          target_x_id = EXCLUDED.target_x_id,
          i_follow = EXCLUDED.i_follow,
          follows_me = EXCLUDED.follows_me,
          checked_at = EXCLUDED.checked_at
      `).run(userId, xUser.x_id || '', username, iFollow ? 1 : 0, followsMe ? 1 : 0);

      // Import to imported_follows
      const existing = await db.prepare(
        'SELECT * FROM imported_follows WHERE user_id = ? AND x_username = ?'
      ).get(userId, username);

      if (!existing) {
        const platformUser = await db.prepare(
          'SELECT * FROM users WHERE LOWER(x_username) = ? AND consented = 1'
        ).get(username);

        await db.prepare(`
          INSERT INTO imported_follows (user_id, x_username, x_display_name, x_id, is_on_platform, platform_user_id)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT DO NOTHING
        `).run(userId, username, xUser.x_display_name, xUser.x_id || null,
          platformUser ? 1 : 0, platformUser ? platformUser.id : null);
        imported++;
      } else {
        alreadyExists++;
      }

      // Create directional follows for platform users
      const platformUser = await db.prepare(
        'SELECT * FROM users WHERE LOWER(x_username) = ? AND consented = 1'
      ).get(username);

      if (platformUser) {
        if (iFollow) {
          await db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
            .run(userId, platformUser.id);
          followsCreated++;
        }
        if (followsMe) {
          await db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
            .run(platformUser.id, userId);
          followsCreated++;
        }
        autoConnected++;
      }
    }

    logAudit('x_sync', {
      userId, ip: getIp(req),
      details: { following: xFollowing.length, followers: xFollowers.length, imported, autoConnected }
    });

    res.json({
      success: true,
      following: xFollowing.length,
      followers: xFollowers.length,
      imported,
      alreadyExists,
      autoConnected,
      followsCreated,
      partial: followingResult.partial || followersResult.partial
    });
  } catch (err) {
    console.error('X sync error:', err);
    res.status(500).json({ error: 'Failed to sync with X: ' + (err.message || 'Unknown error') });
  }
});

// DELETE /api/users/me — account deletion (GDPR/CCPA compliance)
router.delete('/me', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;

    // Use a transaction to ensure atomicity
    const deleteAccount = db.transaction(async function () {
      await this.prepare('DELETE FROM referral_codes WHERE user_id = ?').run(userId);
      await this.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(userId, userId);
      await this.prepare('DELETE FROM imported_follows WHERE user_id = ?').run(userId);
      await this.prepare('DELETE FROM reports WHERE reporter_id = ?').run(userId);
      await this.prepare('DELETE FROM interactions WHERE user_id = ? OR target_user_id = ?').run(userId, userId);
      await this.prepare('DELETE FROM users WHERE id = ?').run(userId);
    });

    await deleteAccount();

    logAudit('account_deleted', { userId, ip: getIp(req) });
    return res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    console.error('Delete account error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/me/export — data export (GDPR/CCPA compliance)
router.get('/me/export', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;

    const user = await db.prepare(
      'SELECT id, x_id, x_username, x_display_name, x_profile_image, x_followers_count, consented, consented_at, created_at FROM users WHERE id = ?'
    ).get(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const referralCodes = await db.prepare(
      'SELECT id, category, site_domain, site_name, code, description, verification_status, created_at FROM referral_codes WHERE user_id = ?'
    ).all(userId);

    const following = await db.prepare(
      'SELECT u.id, u.x_username, u.x_display_name FROM follows f JOIN users u ON f.following_id = u.id WHERE f.follower_id = ?'
    ).all(userId);

    const followers = await db.prepare(
      'SELECT u.id, u.x_username, u.x_display_name FROM follows f JOIN users u ON f.follower_id = u.id WHERE f.following_id = ?'
    ).all(userId);

    const importedFollows = await db.prepare(
      'SELECT x_username, x_display_name, x_id, is_on_platform, invited_at, created_at FROM imported_follows WHERE user_id = ?'
    ).all(userId);

    return res.json({
      user,
      referralCodes,
      following,
      followers,
      importedFollows
    });
  } catch (err) {
    console.error('Export data error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
