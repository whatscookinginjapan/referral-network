const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { id: decoded.id, x_username: decoded.x_username };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const ADMIN_IDS = (process.env.ADMIN_USER_IDS || '').split(',').filter(Boolean);

function adminMiddleware(req, res, next) {
  if (!ADMIN_IDS.includes(req.user.id)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = authMiddleware;
module.exports.adminMiddleware = adminMiddleware;
