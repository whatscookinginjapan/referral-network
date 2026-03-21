const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const key = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  // Derive a 32-byte key from the passphrase
  return crypto.scryptSync(key, 'referral-network-salt', 32);
}

function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decrypt(encryptedStr) {
  if (!encryptedStr) return null;
  // Handle unencrypted legacy tokens (they won't have the : delimiter pattern)
  if (!encryptedStr.includes(':')) return encryptedStr;
  try {
    const key = getKey();
    const parts = encryptedStr.split(':');
    if (parts.length !== 3) return encryptedStr; // Legacy unencrypted
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    // If decryption fails, return original (might be legacy unencrypted)
    console.error('Decryption failed, may be legacy unencrypted token');
    return encryptedStr;
  }
}

module.exports = { encrypt, decrypt };
