CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  x_id TEXT UNIQUE,
  x_username TEXT UNIQUE,
  x_display_name TEXT,
  x_profile_image TEXT,
  x_followers_count INTEGER,
  x_access_token TEXT,
  consented INTEGER DEFAULT 0,
  consented_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  category TEXT,
  site_domain TEXT,
  site_name TEXT,
  code TEXT,
  product_type TEXT,
  description TEXT,
  verification_status TEXT DEFAULT 'pending',
  verification_details TEXT,
  verified_at TIMESTAMP,
  copy_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  max_uses_per_year INTEGER,
  uses_this_year INTEGER DEFAULT 0,
  year_tracked INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS follows (
  id SERIAL PRIMARY KEY,
  follower_id TEXT REFERENCES users(id),
  following_id TEXT REFERENCES users(id),
  UNIQUE(follower_id, following_id)
);

CREATE TABLE IF NOT EXISTS imported_follows (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  x_username TEXT,
  x_display_name TEXT,
  x_id TEXT,
  is_on_platform INTEGER DEFAULT 0,
  platform_user_id TEXT,
  import_source TEXT DEFAULT 'unknown',
  invite_opted_out INTEGER DEFAULT 0,
  invited_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, x_username)
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  reporter_id TEXT REFERENCES users(id),
  referral_id TEXT REFERENCES referral_codes(id),
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(reporter_id, referral_id)
);

CREATE TABLE IF NOT EXISTS interactions (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  target_user_id TEXT REFERENCES users(id),
  interaction_type TEXT CHECK(interaction_type IN ('like', 'comment')),
  count INTEGER DEFAULT 0,
  UNIQUE(user_id, target_user_id, interaction_type)
);

CREATE TABLE IF NOT EXISTS site_suggestions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  domain TEXT NOT NULL,
  site_name TEXT,
  category TEXT,
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'hold')),
  score INTEGER DEFAULT 0,
  screening_details TEXT,
  review_notes TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS affiliate_links (
  id TEXT PRIMARY KEY,
  site_domain TEXT NOT NULL,
  site_name TEXT,
  category TEXT,
  network TEXT,
  affiliate_url TEXT NOT NULL,
  commission_type TEXT CHECK(commission_type IN ('cpa', 'cps', 'revenue_share', 'hybrid')),
  commission_value TEXT,
  cookie_days INTEGER DEFAULT 30,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(site_domain, network)
);

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id SERIAL PRIMARY KEY,
  affiliate_link_id TEXT REFERENCES affiliate_links(id),
  referral_code_id TEXT REFERENCES referral_codes(id),
  user_id TEXT REFERENCES users(id),
  site_domain TEXT NOT NULL,
  action TEXT CHECK(action IN ('copy', 'click', 'conversion')) DEFAULT 'copy',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_domain ON affiliate_clicks(site_domain);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_date ON affiliate_clicks(created_at);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_link ON affiliate_clicks(affiliate_link_id);

CREATE TABLE IF NOT EXISTS x_relationships (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  target_x_id TEXT NOT NULL,
  target_x_username TEXT NOT NULL,
  checked_at TIMESTAMP DEFAULT NOW(),
  i_follow INTEGER DEFAULT 0,
  follows_me INTEGER DEFAULT 0,
  UNIQUE(user_id, target_x_username)
);

CREATE INDEX IF NOT EXISTS idx_x_relationships_user ON x_relationships(user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  ip_address TEXT,
  details TEXT,
  severity TEXT DEFAULT 'info',
  created_at TIMESTAMP DEFAULT NOW()
);
