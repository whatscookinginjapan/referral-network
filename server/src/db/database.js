const { Pool, types } = require('pg');
const fs = require('fs');
const path = require('path');

// Parse PostgreSQL INT8 (bigint/count) as JavaScript numbers instead of strings
types.setTypeParser(20, (val) => parseInt(val, 10));

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * PostgreSQL database wrapper with prepare/run/get/all API.
 * All methods return Promises — callers must await them.
 */
class DatabaseWrapper {
  constructor(pool) {
    this._pool = pool;
  }

  prepare(sql) {
    const pool = this._pool;
    // Convert ? placeholders to PostgreSQL $1, $2, etc.
    let paramIndex = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);

    return {
      async run(...params) {
        await pool.query(pgSql, params);
      },
      async get(...params) {
        const result = await pool.query(pgSql, params);
        return result.rows[0] || undefined;
      },
      async all(...params) {
        const result = await pool.query(pgSql, params);
        return result.rows;
      }
    };
  }

  async exec(sql) {
    await this._pool.query(sql);
  }

  transaction(fn) {
    const pool = this._pool;
    return async (...args) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Create a transaction-scoped wrapper
        const txWrapper = {
          prepare(sql) {
            let paramIndex = 0;
            const pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
            return {
              async run(...params) { await client.query(pgSql, params); },
              async get(...params) {
                const r = await client.query(pgSql, params);
                return r.rows[0] || undefined;
              },
              async all(...params) {
                const r = await client.query(pgSql, params);
                return r.rows;
              }
            };
          }
        };
        const result = await fn.call(txWrapper, ...args);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    };
  }

}

let dbWrapper = null;

async function initDb() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false }
  });

  dbWrapper = new DatabaseWrapper(pool);

  // Execute schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await dbWrapper.exec(schema);

  // Migrations — add columns that may not exist in older databases
  const migrations = [
    { sql: "ALTER TABLE imported_follows ADD COLUMN import_source TEXT DEFAULT 'unknown'", col: 'import_source', table: 'imported_follows' },
    { sql: 'ALTER TABLE referral_codes ADD COLUMN product_type TEXT', col: 'product_type', table: 'referral_codes' },
    { sql: 'ALTER TABLE referral_codes ADD COLUMN copy_count INTEGER DEFAULT 0', col: 'copy_count', table: 'referral_codes' },
    { sql: 'ALTER TABLE referral_codes ADD COLUMN success_count INTEGER DEFAULT 0', col: 'success_count', table: 'referral_codes' },
    { sql: 'ALTER TABLE referral_codes ADD COLUMN max_uses_per_year INTEGER', col: 'max_uses_per_year', table: 'referral_codes' },
    { sql: 'ALTER TABLE referral_codes ADD COLUMN uses_this_year INTEGER DEFAULT 0', col: 'uses_this_year', table: 'referral_codes' },
    { sql: 'ALTER TABLE referral_codes ADD COLUMN year_tracked INTEGER', col: 'year_tracked', table: 'referral_codes' },
  ];
  for (const m of migrations) {
    try { await pool.query(m.sql); } catch (e) { /* column already exists */ }
  }

  console.log('Database initialized successfully (PostgreSQL)');
  return dbWrapper;
}

function getDb() {
  if (!dbWrapper) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return dbWrapper;
}

module.exports = { initDb, getDb };
