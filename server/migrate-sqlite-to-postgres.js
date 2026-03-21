#!/usr/bin/env node
/**
 * One-time migration: SQLite (referral.db) → PostgreSQL (DATABASE_URL)
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node migrate-sqlite-to-postgres.js
 *
 * Requires: npm install better-sqlite3 (temporary, remove after migration)
 */

const { Pool } = require('pg');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Set DATABASE_URL env var first.');
  process.exit(1);
}

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  console.error('Install better-sqlite3 first: npm install better-sqlite3');
  process.exit(1);
}

const DB_PATH = path.join(__dirname, 'data', 'referral.db');

const TABLES_IN_ORDER = [
  'users',
  'referral_codes',
  'follows',
  'imported_follows',
  'reports',
  'interactions',
  'site_suggestions',
  'affiliate_links',
  'affiliate_clicks',
  'x_relationships',
  'audit_logs',
];

async function migrate() {
  const sqlite = new Database(DB_PATH, { readonly: true });
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: false,
  });

  // Run schema first
  const fs = require('fs');
  const schema = fs.readFileSync(path.join(__dirname, 'src', 'db', 'schema.sql'), 'utf-8');
  await pool.query(schema);
  console.log('Schema created in Postgres.');

  for (const table of TABLES_IN_ORDER) {
    // Check if table exists in SQLite
    const exists = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(table);

    if (!exists) {
      console.log(`Skipping ${table} — not in SQLite.`);
      continue;
    }

    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
    if (rows.length === 0) {
      console.log(`Skipping ${table} — empty.`);
      continue;
    }

    const columns = Object.keys(rows[0]);
    // Filter out columns that are auto-generated SERIAL ids
    const serialTables = ['follows', 'imported_follows', 'reports', 'interactions', 'affiliate_clicks', 'x_relationships', 'audit_logs'];
    const insertCols = serialTables.includes(table)
      ? columns.filter(c => c !== 'id')
      : columns;

    const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(', ');
    const insertSql = `INSERT INTO ${table} (${insertCols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let inserted = 0;
      for (const row of rows) {
        const values = insertCols.map(c => row[c]);
        try {
          await client.query(insertSql, values);
          inserted++;
        } catch (err) {
          console.warn(`  Row error in ${table}: ${err.message}`);
        }
      }
      await client.query('COMMIT');
      console.log(`Migrated ${table}: ${inserted}/${rows.length} rows.`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Failed ${table}: ${err.message}`);
    } finally {
      client.release();
    }
  }

  sqlite.close();
  await pool.end();
  console.log('\nDone! You can now delete data/referral.db and uninstall better-sqlite3.');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
