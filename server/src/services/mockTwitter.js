const { v4: uuidv4 } = require('uuid');

function generateMockUsers() {
  return [
    // Large accounts (100k-1M followers)
    {
      id: uuidv4(),
      x_username: 'techsavvysam',
      x_display_name: 'Sam Chen',
      x_profile_image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sam',
      x_followers_count: 842000,
    },
    {
      id: uuidv4(),
      x_username: 'financewithjess',
      x_display_name: 'Jessica Park',
      x_profile_image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jessica',
      x_followers_count: 530000,
    },
    {
      id: uuidv4(),
      x_username: 'travelking_mike',
      x_display_name: 'Mike Torres',
      x_profile_image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=mike',
      x_followers_count: 310000,
    },
    // Medium accounts (10k-100k followers)
    {
      id: uuidv4(),
      x_username: 'dealguru_nina',
      x_display_name: 'Nina Patel',
      x_profile_image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=nina',
      x_followers_count: 87000,
    },
    {
      id: uuidv4(),
      x_username: 'cryptodave',
      x_display_name: 'Dave Kim',
      x_profile_image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=dave',
      x_followers_count: 62000,
    },
    {
      id: uuidv4(),
      x_username: 'foodie_rachel',
      x_display_name: 'Rachel Wong',
      x_profile_image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=rachel',
      x_followers_count: 45000,
    },
    {
      id: uuidv4(),
      x_username: 'points_maximizer',
      x_display_name: 'Alex Rivera',
      x_profile_image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
      x_followers_count: 33000,
    },
    {
      id: uuidv4(),
      x_username: 'budgetboss_li',
      x_display_name: 'Li Zhang',
      x_profile_image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=li',
      x_followers_count: 18000,
    },
    // Small accounts (100-10k followers)
    {
      id: uuidv4(),
      x_username: 'savvy_shopper_em',
      x_display_name: 'Emily Brooks',
      x_profile_image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=emily',
      x_followers_count: 8200,
    },
    {
      id: uuidv4(),
      x_username: 'nomad_jordan',
      x_display_name: 'Jordan Hayes',
      x_profile_image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jordan',
      x_followers_count: 3400,
    },
    {
      id: uuidv4(),
      x_username: 'cashback_carly',
      x_display_name: 'Carly Simmons',
      x_profile_image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=carly',
      x_followers_count: 1100,
    },
    {
      id: uuidv4(),
      x_username: 'newbie_investor_t',
      x_display_name: 'Tyler Okafor',
      x_profile_image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=tyler',
      x_followers_count: 340,
    },
  ];
}

function generateMockFollows(users) {
  const follows = [];
  const followRate = 0.4;

  for (const follower of users) {
    for (const following of users) {
      if (follower.id === following.id) continue;
      if (Math.random() < followRate) {
        follows.push({ follower_id: follower.id, following_id: following.id });
      }
    }
  }

  return follows;
}

function generateMockInteractions(users, follows) {
  const interactions = [];
  const followSet = new Set(follows.map(f => `${f.follower_id}:${f.following_id}`));

  for (const user of users) {
    for (const target of users) {
      if (user.id === target.id) continue;
      // Only create interactions between users who follow each other
      if (!followSet.has(`${user.id}:${target.id}`)) continue;

      // Likes
      if (Math.random() < 0.6) {
        interactions.push({
          user_id: user.id,
          target_user_id: target.id,
          interaction_type: 'like',
          count: Math.floor(Math.random() * 50) + 1,
        });
      }

      // Comments
      if (Math.random() < 0.3) {
        interactions.push({
          user_id: user.id,
          target_user_id: target.id,
          interaction_type: 'comment',
          count: Math.floor(Math.random() * 20) + 1,
        });
      }
    }
  }

  return interactions;
}

function generateMockReferralCodes(users) {
  const codes = [
    // Credit cards
    { category: 'credit_cards', site_domain: 'chase.com', site_name: 'Chase', code: 'CHASE-REF-', description: 'Earn 60,000 bonus points with Chase Sapphire Preferred' },
    { category: 'credit_cards', site_domain: 'americanexpress.com', site_name: 'American Express', code: 'AMEX-REF-', description: 'Get 80,000 Membership Rewards points with Amex Gold' },
    { category: 'credit_cards', site_domain: 'capitalone.com', site_name: 'Capital One', code: 'CAPONE-REF-', description: '75,000 miles bonus with Capital One Venture X' },
    // Banks
    { category: 'banks', site_domain: 'sofi.com', site_name: 'SoFi', code: 'SOFI-REF-', description: 'Get $300 bonus when you set up direct deposit' },
    { category: 'banks', site_domain: 'chase.com', site_name: 'Chase', code: 'CHASE-BANK-', description: '$200 bonus for new Chase checking account' },
    // Shopping
    { category: 'shopping', site_domain: 'amazon.com', site_name: 'Amazon', code: 'AMZ-REF-', description: '$10 off your first order over $50' },
    { category: 'shopping', site_domain: 'rakuten.com', site_name: 'Rakuten', code: 'RAKUTEN-REF-', description: 'Get $30 welcome bonus cashback' },
    // Travel
    { category: 'travel', site_domain: 'airbnb.com', site_name: 'Airbnb', code: 'AIRBNB-REF-', description: '$40 off your first stay' },
    { category: 'travel', site_domain: 'booking.com', site_name: 'Booking.com', code: 'BOOKING-REF-', description: 'Get $25 reward on your first booking' },
    // Food delivery
    { category: 'food_delivery', site_domain: 'doordash.com', site_name: 'DoorDash', code: 'DASH-REF-', description: '$15 off first 3 orders' },
    { category: 'food_delivery', site_domain: 'ubereats.com', site_name: 'Uber Eats', code: 'EATS-REF-', description: '$20 off first order' },
    // Crypto
    { category: 'crypto', site_domain: 'coinbase.com', site_name: 'Coinbase', code: 'CB-REF-', description: 'Get $10 in Bitcoin when you buy or sell $100' },
    { category: 'crypto', site_domain: 'robinhood.com', site_name: 'Robinhood', code: 'RH-REF-', description: 'Get a free stock worth up to $200' },
    // Subscriptions
    { category: 'subscriptions', site_domain: 'spotify.com', site_name: 'Spotify', code: 'SPOT-REF-', description: 'Get 3 months of Premium free' },
    { category: 'subscriptions', site_domain: 'youtube.com', site_name: 'YouTube Premium', code: 'YT-REF-', description: '2 months of YouTube Premium free' },
  ];

  const referralCodes = [];

  // Assign codes to users - each user gets 2-5 codes
  for (const user of users) {
    const numCodes = Math.floor(Math.random() * 4) + 2;
    const shuffled = [...codes].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, numCodes);

    for (const template of selected) {
      referralCodes.push({
        id: uuidv4(),
        user_id: user.id,
        category: template.category,
        site_domain: template.site_domain,
        site_name: template.site_name,
        code: template.code + user.x_username.toUpperCase().slice(0, 6) + Math.floor(Math.random() * 1000),
        description: template.description,
      });
    }
  }

  return referralCodes;
}

async function seedMockData(db) {
  // Check if already seeded
  const existingUsers = await db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (existingUsers.count > 0) {
    console.log('Database already seeded, skipping');
    return;
  }

  const users = generateMockUsers();
  const follows = generateMockFollows(users);
  const interactions = generateMockInteractions(users, follows);
  const referralCodes = generateMockReferralCodes(users);

  const seedAll = db.transaction(async function () {
    for (const u of users) {
      await this.prepare(
        'INSERT INTO users (id, x_username, x_display_name, x_profile_image, x_followers_count) VALUES (?, ?, ?, ?, ?)'
      ).run(u.id, u.x_username, u.x_display_name, u.x_profile_image, u.x_followers_count);
    }

    for (const f of follows) {
      await this.prepare(
        'INSERT INTO follows (follower_id, following_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
      ).run(f.follower_id, f.following_id);
    }

    for (const i of interactions) {
      await this.prepare(
        'INSERT INTO interactions (user_id, target_user_id, interaction_type, count) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING'
      ).run(i.user_id, i.target_user_id, i.interaction_type, i.count);
    }

    for (const r of referralCodes) {
      await this.prepare(
        'INSERT INTO referral_codes (id, user_id, category, site_domain, site_name, code, description) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(r.id, r.user_id, r.category, r.site_domain, r.site_name, r.code, r.description);
    }
  });

  await seedAll();
  console.log(`Seeded: ${users.length} users, ${follows.length} follows, ${interactions.length} interactions, ${referralCodes.length} referral codes`);
}

module.exports = { generateMockUsers, generateMockFollows, generateMockInteractions, seedMockData };
