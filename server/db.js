// La lampe de mémoire · base de données SQLite (intégrée à Node.js 22, rien à installer)
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 32).toString('hex') };
}
function checkPassword(password, salt, hash) {
  const h = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, nom TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('historien','archiviste','moderateur','admin')),
      spec TEXT NOT NULL DEFAULT '[]', langs TEXT NOT NULL DEFAULT '["fr"]',
      niveau TEXT NOT NULL DEFAULT 'confirmé', dispo INTEGER NOT NULL DEFAULT 1,
      email TEXT, salt TEXT NOT NULL, pass_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      msg TEXT NOT NULL, type TEXT NOT NULL, text TEXT NOT NULL,
      file_name TEXT, file_path TEXT, email TEXT, consent INTEGER NOT NULL DEFAULT 0,
      lang TEXT, keywords TEXT, spam TEXT, dup_of INTEGER, dups INTEGER NOT NULL DEFAULT 0,
      assigned_to TEXT, scores TEXT, prio INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'en attente', label TEXT, reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), decided_at TEXT, decided_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_contrib_assigned ON contributions(assigned_to, status);
    CREATE INDEX IF NOT EXISTS idx_contrib_msg ON contributions(msg, status);
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, contribution_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), seen INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT (datetime('now')),
      actor TEXT NOT NULL, action TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, to_user TEXT NOT NULL, subject TEXT NOT NULL,
      body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('active')) db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
  if (!cols.includes('created_at')) db.exec('ALTER TABLE users ADD COLUMN created_at TEXT');
  return db;
}

// Comptes de démonstration (fictifs). Mot de passe commun, à changer en production.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'memoire2026';
const SEED_USERS = [
  { id: 'durand', nom: 'Mme Durand', role: 'historien', spec: ['déportation', 'ravensbrück', 'résistantes', 'femmes', 'rennes', '1944'], langs: ['fr', 'de'], niveau: 'expert' },
  { id: 'benali', nom: 'M. Benali', role: 'historien', spec: ['occupation', 'otages', 'fusillés', 'paris', '1941', '1942', '1943'], langs: ['fr', 'ar'], niveau: 'confirmé' },
  { id: 'keller', nom: 'Mme Keller', role: 'archiviste', spec: ['lettre', 'photo', 'document', 'archives', 'famille'], langs: ['fr', 'de', 'en'], niveau: 'expert' },
  { id: 'rossi', nom: 'M. Rossi', role: 'moderateur', spec: ['traduction', 'casemate'], langs: ['fr', 'en', 'it', 'es'], niveau: 'modérateur' },
  { id: 'admin', nom: 'Référent du mémorial', role: 'admin', spec: [], langs: ['fr', 'en', 'es', 'ar', 'de'], niveau: 'référent' },
];

function seed(db) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (n > 0) return false;
  const ins = db.prepare('INSERT INTO users (id, nom, role, spec, langs, niveau, salt, pass_hash) VALUES (?,?,?,?,?,?,?,?)');
  for (const u of SEED_USERS) {
    const { salt, hash } = hashPassword(DEMO_PASSWORD);
    ins.run(u.id, u.nom, u.role, JSON.stringify(u.spec), JSON.stringify(u.langs), u.niveau, salt, hash);
  }
  return true;
}

const userRow = r => r && ({ id: r.id, nom: r.nom, role: r.role, spec: JSON.parse(r.spec), langs: JSON.parse(r.langs), niveau: r.niveau, dispo: !!r.dispo, active: r.active !== 0, email: r.email || '' });
const contribRow = r => r && ({ ...r, keywords: JSON.parse(r.keywords || '[]'), scores: JSON.parse(r.scores || '[]'), consent: !!r.consent });

module.exports = { open, seed, hashPassword, checkPassword, userRow, contribRow, DEMO_PASSWORD };
