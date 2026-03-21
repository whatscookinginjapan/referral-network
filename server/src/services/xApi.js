const crypto = require('crypto');
const { getDb } = require('../db/database');

const X_CLIENT_ID = process.env.X_CLIENT_ID;
const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET;
const CALLBACK_URL = process.env.X_CALLBACK_URL || 'http://localhost:3000/api/auth/callback';

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Build the X OAuth 2.0 authorization URL (PKCE flow)
 */
async function getAuthorizationUrl() {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Store verifier in database (survives server restarts)
  const db = getDb();
  await db.prepare('DELETE FROM oauth_states WHERE created_at < NOW() - INTERVAL \'10 minutes\'').run();
  await db.prepare('INSERT INTO oauth_states (state, code_verifier) VALUES (?, ?)').run(state, codeVerifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: X_CLIENT_ID,
    redirect_uri: CALLBACK_URL,
    scope: 'tweet.read users.read follows.read like.read offline.access',
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  return {
    url: `https://x.com/i/oauth2/authorize?${params.toString()}`,
    state
  };
}

/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(code, state) {
  const db = getDb();
  const pending = await db.prepare('SELECT code_verifier FROM oauth_states WHERE state = ?').get(state);
  if (!pending) {
    throw new Error('Invalid or expired state parameter');
  }

  const { code_verifier: codeVerifier } = pending;
  await db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);

  const basicAuth = Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64');

  const response = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth}`
    },
    body: new URLSearchParams({
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: CALLBACK_URL,
      code_verifier: codeVerifier
    }).toString()
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Token exchange failed:', error);
    throw new Error('Failed to exchange code for token');
  }

  return response.json();
}

/**
 * Fetch the authenticated user's profile from X API v2
 */
async function fetchUserProfile(accessToken) {
  const response = await fetch('https://api.x.com/2/users/me?user.fields=id,name,username,profile_image_url,public_metrics', {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Fetch user profile failed:', error);
    throw new Error('Failed to fetch user profile');
  }

  const { data } = await response.json();
  return {
    x_id: data.id,
    x_username: data.username,
    x_display_name: data.name,
    x_profile_image: data.profile_image_url,
    x_followers_count: data.public_metrics?.followers_count || 0
  };
}

/**
 * Fetch the list of users the authenticated user follows
 * Returns array of user objects
 */
async function fetchFollowing(accessToken, xUserId) {
  const allFollowing = [];
  let paginationToken = null;

  do {
    const params = new URLSearchParams({
      'max_results': '1000',
      'user.fields': 'id,name,username,profile_image_url,public_metrics'
    });
    if (paginationToken) {
      params.set('pagination_token', paginationToken);
    }

    const response = await fetch(
      `https://api.x.com/2/users/${xUserId}/following?${params.toString()}`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Fetch following failed:', error);
      break;
    }

    const result = await response.json();
    if (result.data) {
      allFollowing.push(...result.data);
    }

    paginationToken = result.meta?.next_token || null;
  } while (paginationToken);

  return allFollowing.map(u => ({
    x_id: u.id,
    x_username: u.username,
    x_display_name: u.name,
    x_profile_image: u.profile_image_url,
    x_followers_count: u.public_metrics?.followers_count || 0
  }));
}

/**
 * Fetch recent likes by the authenticated user (to build interaction data)
 * Returns array of tweet objects with author info
 */
async function fetchUserLikes(accessToken, xUserId) {
  try {
    const params = new URLSearchParams({
      'max_results': '100',
      'expansions': 'author_id',
      'user.fields': 'id,username'
    });

    const response = await fetch(
      `https://api.x.com/2/users/${xUserId}/liked_tweets?${params.toString()}`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );

    if (!response.ok) return [];

    const result = await response.json();
    const authorMap = {};
    if (result.includes?.users) {
      for (const u of result.includes.users) {
        authorMap[u.id] = u;
      }
    }

    // Count likes per author
    const likeCounts = {};
    if (result.data) {
      for (const tweet of result.data) {
        const authorId = tweet.author_id || (authorMap[tweet.id]?.id);
        if (authorId) {
          likeCounts[authorId] = (likeCounts[authorId] || 0) + 1;
        }
      }
    }

    return likeCounts;
  } catch (err) {
    console.error('Fetch likes error:', err);
    return {};
  }
}

module.exports = {
  getAuthorizationUrl,
  exchangeCodeForToken,
  fetchUserProfile,
  fetchFollowing,
  fetchUserLikes
};
