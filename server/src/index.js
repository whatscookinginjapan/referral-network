const path = require('path');
const os = require('os');

// Load .env — try secure local path first, then project .env, then skip (Railway sets env vars directly)
const secureEnvPath = path.join(os.homedir(), '.config', 'referral-network', '.env');
const localEnvPath = path.join(__dirname, '..', '.env');

const fs = require('fs');
if (fs.existsSync(secureEnvPath)) {
  require('dotenv').config({ path: secureEnvPath });
  console.log('Loaded secrets from ~/.config/referral-network/.env');
} else if (fs.existsSync(localEnvPath)) {
  require('dotenv').config({ path: localEnvPath });
  console.log('WARNING: Loading secrets from project .env (consider moving to ~/.config/referral-network/.env)');
} else {
  // Log all available env var keys (not values) for debugging
  const envKeys = Object.keys(process.env).sort();
  console.log('Available env vars:', envKeys.join(', '));
  if (process.env.DATABASE_URL) {
    console.log('Using environment variables from platform');
  } else {
    console.error('ERROR: No .env file found and no DATABASE_URL set. Create a .env or set environment variables.');
    process.exit(1);
  }
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { initDb } = require('./db/database');
const { seedMockData } = require('./services/mockTwitter');
const SEED_MOCK = process.env.SEED_MOCK === 'true';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
// TODO: In production, restrict chrome-extension:// origin to the specific
// published extension ID, e.g. 'chrome-extension://YOUR_EXTENSION_ID_HERE'
app.use(cors({
  origin: ['http://localhost:3000', 'https://referral-network-staging.up.railway.app', 'https://referral-network-production.up.railway.app', /^chrome-extension:\/\//],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(compression());
app.use(express.json({ limit: '50mb' }));

// Global rate limiter
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
}));

// Auth-specific rate limiter
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many auth requests, try again later' }
});
app.use('/api/auth', authLimiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Initialize database, seed data, then start server
async function start() {
  const db = await initDb();
  if (SEED_MOCK) {
    await seedMockData(db);
  }

  // Mount routes after DB is ready
  const authRoutes = require('./routes/auth');
  const referralRoutes = require('./routes/referrals');
  const userRoutes = require('./routes/users');
  const suggestionRoutes = require('./routes/suggestions');
  const affiliateRoutes = require('./routes/affiliates');

  app.use('/api/auth', authRoutes);
  app.use('/api/referrals', referralRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/suggestions', suggestionRoutes);
  app.use('/api/affiliates', affiliateRoutes);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
