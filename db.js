// db.js - open database and run migrations
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data.db');
const MIG_FILE = path.join(__dirname, 'migrations.sql');

const db = new Database(DB_FILE);

// Run migrations if file exists
function migrate() {
  if (!fs.existsSync(MIG_FILE)) {
    console.log('No migrations.sql found — skipping migrate.');
    return;
  }
  const sql = fs.readFileSync(MIG_FILE, 'utf8');
  db.exec(sql);
  console.log('Migrations applied.');
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

module.exports = { db, migrate, nowSeconds };

// If run directly: perform migrate
if (require.main === module) {
  migrate();
}
