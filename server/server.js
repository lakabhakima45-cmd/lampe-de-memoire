// La lampe de mémoire · serveur (back-end)
// Node.js 22+, sans dépendance : node:http + node:sqlite.
// Lancer :  node server/server.js   puis ouvrir http://localhost:3000
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const L = require('./logic');
const D = require('./db');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(ROOT, 'data', 'uploads');
const MESSAGES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'messages.json'), 'utf8'));
const LABELS = ['verifie', 'ia', 'inconnu', 'famille'];
const TYPES = ['commentaire', 'correction', 'souvenir', 'document', 'lecture'];
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf' };

function createApp({ dbFile = process.env.DB_FILE || path.join(ROOT, 'data', 'lampe.db'), secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex') } = {}) {
  const db = D.open(dbFile);
  D.seed(db);
  fs.mkdirSync(UPLOADS, { recursive: true });

  // ---------- helpers
  const log = (actor, action) => db.prepare('INSERT INTO journal (actor, action) VALUES (?, ?)').run(actor, action);
  const validators = () => db.prepare("SELECT * FROM users WHERE role != 'admin' AND active = 1").all().map(D.userRow);
  const fails = new Map(); // tentatives de connexion ratées : id -> [heures]
  const strong = p => typeof p === 'string' && p.length >= 8 && /[a-zA-Z]/.test(p) && /\d/.test(p);
  const userById = id => D.userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  const pendingLoad = () => Object.fromEntries(db.prepare("SELECT assigned_to AS id, COUNT(*) AS n FROM contributions WHERE status = 'en attente' GROUP BY assigned_to").all().map(r => [r.id, r.n]));

  const sign = v => crypto.createHmac('sha256', secret).update(v).digest('base64url');
  function makeSession(uid) { const exp = Date.now() + 8 * 3600e3; const v = `${uid}.${exp}`; return `${v}.${sign(v)}`; }
  function readSession(req) {
    const m = /(?:^|;\s*)lampe_session=([^;]+)/.exec(req.headers.cookie || '');
    if (!m) return null;
    const [uid, exp, sig] = decodeURIComponent(m[1]).split('.');
    if (!uid || !sig || sign(`${uid}.${exp}`) !== sig || Date.now() > +exp) return null;
    const u = userById(uid); return u && u.active ? u : null;
  }

  function send(res, status, body, headers = {}) {
    const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
    res.writeHead(status, { 'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(isJson ? JSON.stringify(body) : body);
  }
  const bad = (res, msg, code = 400) => send(res, code, { error: msg });

  function readBody(req, limit = 3 * 1024 * 1024) {
    return new Promise((ok, ko) => {
      let size = 0; const chunks = [];
      req.on('data', c => { size += c.length; if (size > limit) { ko(Object.assign(new Error('Trop volumineux'), { code: 413 })); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { ko(Object.assign(new Error('JSON invalide'), { code: 400 })); } });
      req.on('error', ko);
    });
  }

  // ---------- the contribution pipeline (server side)
  function createContribution(input, actor = 'visiteur') {
    const msg = String(input.msg || ''); const type = String(input.type || 'commentaire'); const text = String(input.text || '').slice(0, 4000);
    if (!MESSAGES.find(m => m.id === msg)) throw Object.assign(new Error('Message inconnu'), { code: 400 });
    if (!TYPES.includes(type)) throw Object.assign(new Error('Type inconnu'), { code: 400 });
    const email = String(input.email || '').trim().slice(0, 200);
    if (email && !input.consent) throw Object.assign(new Error('Pour laisser un e-mail, il faut accepter qu’il soit gardé pour vous répondre.'), { code: 400 });
    const c = { msg, type, text, file_name: input.file_name ? String(input.file_name).slice(0, 120) : null, email: email || null, consent: input.consent ? 1 : 0 };
    c.lang = L.detectLang(text);
    c.keywords = L.extractKeywords(text + ' ' + (c.file_name || ''));
    c.spam = L.detectSpam(text);
    c.prio = L.priority(c);
    c.status = 'en attente'; c.dup_of = null; c.assigned_to = null; c.scores = [];
    if (c.spam) c.status = 'spam';
    else {
      const twin = db.prepare("SELECT id, text FROM contributions WHERE msg = ? AND status = 'en attente' ORDER BY id DESC LIMIT 200").all(msg).find(o => L.similarity(o.text, text) > 0.6);
      if (twin) { c.status = 'doublon'; c.dup_of = twin.id; db.prepare('UPDATE contributions SET dups = dups + 1 WHERE id = ?').run(twin.id); }
      else { const r = L.route(c, validators(), pendingLoad()); c.assigned_to = r.chosen === 'referent' ? 'admin' : r.chosen; c.scores = r.scores; }
    }
    // optional picture / PDF (base64), kept out of the public folder
    if (c.status === 'en attente' && input.file_data && c.file_name) {
      const m = /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,(.+)$/.exec(String(input.file_data));
      if (m) { const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'application/pdf': '.pdf' }[m[1]]; const name = crypto.randomBytes(8).toString('hex') + ext; fs.writeFileSync(path.join(UPLOADS, name), Buffer.from(m[3], 'base64')); c.file_path = name; }
    }
    const info = db.prepare(`INSERT INTO contributions (msg, type, text, file_name, file_path, email, consent, lang, keywords, spam, dup_of, assigned_to, scores, prio, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(c.msg, c.type, c.text, c.file_name, c.file_path || null, c.email, c.consent, c.lang, JSON.stringify(c.keywords), c.spam, c.dup_of, c.assigned_to, JSON.stringify(c.scores), c.prio, c.status);
    c.id = Number(info.lastInsertRowid);
    if (c.assigned_to) db.prepare('INSERT INTO notifications (user_id, contribution_id) VALUES (?, ?)').run(c.assigned_to, c.id);
    log(actor, c.status === 'en attente' ? `Contribution n°${c.id} (${c.type}) → ${userById(c.assigned_to).nom}` : `Contribution n°${c.id} : ${c.status}`);
    return c;
  }

  function digest() { // the daily e-mail summary, written to the outbox
    const rows = db.prepare("SELECT n.user_id, COUNT(*) AS n FROM notifications n JOIN contributions c ON c.id = n.contribution_id WHERE n.seen = 0 AND c.status = 'en attente' GROUP BY n.user_id").all();
    for (const r of rows) {
      const u = userById(r.user_id);
      db.prepare('INSERT INTO outbox (to_user, subject, body) VALUES (?,?,?)').run(u.id, `${r.n} contribution(s) à vérifier`, `Bonjour ${u.nom},\n\n${r.n} nouvelle(s) contribution(s) vous attendent dans l’espace historien de La lampe de mémoire.\n\nMerci pour votre aide.`);
    }
    log('système', `Résumé quotidien : ${rows.length} e-mail(s) préparé(s)`);
    return rows.length;
  }

  function simulate(n = 1000) { // in a throw-away in-memory database
    const t0 = Date.now(); const vals = validators(); const load = {}; const pend = []; let spam = 0, dup = 0, prio = 0;
    let seed = 11; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647; const pk = a => a[Math.floor(r() * a.length)];
    const P = ['ma grand-mère', 'mon arrière-grand-père', 'une voisine', 'ma tante', 'un ancien déporté', 'notre famille'], A = ['était à Rennes en 1944', 'a été otage à Paris en 1942', 'a gardé une lettre', 'avait une photo de la casemate', 'est partie pour Ravensbrück', 'parlait souvent du fort', 'a retrouvé un document d’archives'], C = ['au printemps', 'après la guerre', 'pendant des années', 'à ses enfants'];
    for (let i = 0; i < n; i++) {
      const text = r() < 0.1 ? pk(['super', 'http://promo.example', 'aaaaaaaaaaaa']) : r() < 0.15 && pend.length ? pend[Math.floor(r() * pend.length)].text : `${pk(P)} ${pk(A)} ${pk(C)}, ${pk(P)} ${pk(A)}.`;
      const c = { msg: pk(MESSAGES).id, type: pk(['souvenir', 'commentaire', 'correction', 'document']), text, lang: L.detectLang(text), keywords: L.extractKeywords(text) };
      if (L.detectSpam(text)) { spam++; continue; }
      if (pend.some(o => o.msg === c.msg && L.similarity(o.text, text) > 0.6)) { dup++; continue; }
      const rt = L.route(c, vals, load); const to = rt.chosen === 'referent' ? 'admin' : rt.chosen; load[to] = (load[to] || 0) + 1; c.to = to; if (L.priority(c)) prio++; pend.push(c);
    }
    return { total: n, spam, doublons: dup, a_verifier: pend.length, prioritaires: prio, repartition: Object.entries(load).map(([id, k]) => ({ nom: (userById(id) || { nom: id }).nom, n: k })).sort((a, b) => b.n - a.n), ms: Date.now() - t0 };
  }

  // ---------- routes
  async function api(req, res, url) {
    const me = readSession(req);
    const need = (...roles) => { if (!me) { bad(res, 'Connexion nécessaire', 401); return false; } if (roles.length && !roles.includes(me.role)) { bad(res, 'Accès refusé', 403); return false; } return true; };
    const p = url.pathname, M = req.method;
    let m;

    if (p === '/api/messages' && M === 'GET') {
      const pub = db.prepare("SELECT id, msg, type, text, label, decided_at FROM contributions WHERE status = 'publiée' ORDER BY decided_at").all();
      return send(res, 200, MESSAGES.map(x => ({ ...x, contributions: pub.filter(c => c.msg === x.id) })));
    }
    if (p === '/api/contributions' && M === 'POST') {
      const c = createContribution(await readBody(req));
      const u = c.assigned_to && userById(c.assigned_to);
      return send(res, 201, { id: c.id, status: c.status, lang: c.lang, keywords: c.keywords, spam: c.spam, dup: !!c.dup_of, assigned: u ? u.nom : null, scores: c.scores });
    }
    if (p === '/api/login' && M === 'POST') {
      const { id, password } = await readBody(req);
      const uid = String(id || '').toLowerCase().trim();
      const recent = (fails.get(uid) || []).filter(t => Date.now() - t < 10 * 60e3);
      if (recent.length >= 5) return send(res, 429, { error: 'Trop d’essais. Réessayez dans 10 minutes.', code: 'locked' });
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
      if (!row || !D.checkPassword(String(password || ''), row.salt, row.pass_hash)) { fails.set(uid, [...recent, Date.now()]); return send(res, 401, { error: 'Identifiant ou mot de passe incorrect', code: 'bad' }); }
      fails.delete(uid);
      if (!row.active) return send(res, 403, { error: 'Compte en attente d’approbation', code: 'pending' });
      log(row.nom, 'Connexion');
      return send(res, 200, D.userRow(row), { 'Set-Cookie': `lampe_session=${encodeURIComponent(makeSession(row.id))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}` });
    }
    if (p === '/api/register' && M === 'POST') {
      const b = await readBody(req);
      const id = String(b.id || '').toLowerCase().trim(), nom = String(b.nom || '').trim().slice(0, 60), email = String(b.email || '').trim().slice(0, 200);
      if (!/^[a-z0-9._-]{3,20}$/.test(id)) return send(res, 400, { error: 'Identifiant invalide', code: 'badid' });
      if (!nom) return send(res, 400, { error: 'Nom obligatoire', code: 'noname' });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: 'E-mail invalide', code: 'bademail' });
      if (!strong(b.password)) return send(res, 400, { error: 'Mot de passe trop faible', code: 'weak' });
      if (db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return send(res, 409, { error: 'Identifiant déjà utilisé', code: 'exists' });
      const role = ['historien', 'archiviste', 'moderateur'].includes(b.role) ? b.role : 'historien';
      const spec = [...new Set(String(b.spec || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).concat(L.extractKeywords(String(b.spec || ''))))].slice(0, 20);
      const langs = String(b.langs || 'fr').split(',').map(s => s.trim().toLowerCase()).filter(s => /^[a-z]{2}$/.test(s)).slice(0, 8);
      const { salt, hash } = D.hashPassword(b.password);
      db.prepare('INSERT INTO users (id, nom, role, spec, langs, niveau, email, salt, pass_hash, active) VALUES (?,?,?,?,?,?,?,?,?,0)').run(id, nom, role, JSON.stringify(spec), JSON.stringify(langs.length ? langs : ['fr']), 'confirmé', email, salt, hash);
      log(nom, 'Demande de compte valideur');
      db.prepare('INSERT INTO outbox (to_user, subject, body) VALUES (?,?,?)').run('admin', 'Nouveau compte à approuver', `${nom} (${id}) demande un compte ${role}.`);
      return send(res, 201, { ok: true });
    }
    if (p === '/api/me/password' && M === 'POST') {
      if (!need()) return; const b = await readBody(req);
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id);
      if (!D.checkPassword(String(b.old || ''), row.salt, row.pass_hash)) return send(res, 401, { error: 'Ancien mot de passe incorrect', code: 'bad' });
      if (!strong(b.password)) return send(res, 400, { error: 'Mot de passe trop faible', code: 'weak' });
      const { salt, hash } = D.hashPassword(b.password); db.prepare('UPDATE users SET salt = ?, pass_hash = ? WHERE id = ?').run(salt, hash, me.id);
      log(me.nom, 'Mot de passe changé'); return send(res, 200, { ok: true });
    }
    if (p === '/api/logout' && M === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': 'lampe_session=; Path=/; Max-Age=0' });
    if (p === '/api/me' && M === 'GET') return me ? send(res, 200, me) : bad(res, 'Non connecté', 401);

    // ---- espace historien
    if (p === '/api/queue' && M === 'GET') {
      if (!need()) return;
      const rows = db.prepare("SELECT * FROM contributions WHERE status = 'en attente' AND assigned_to = ? ORDER BY prio DESC, id ASC").all(me.id).map(D.contribRow);
      db.prepare('UPDATE notifications SET seen = 1 WHERE user_id = ?').run(me.id);
      return send(res, 200, rows.map(c => ({ ...c, message: (MESSAGES.find(x => x.id === c.msg) || {}).i18n?.fr.title, email: c.email ? '•••' : null })));
    }
    if (p === '/api/notifications' && M === 'GET') { if (!need()) return; return send(res, 200, { unseen: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND seen = 0').get(me.id).n }); }
    if ((m = /^\/api\/contributions\/(\d+)\/(validate|refuse|ask)$/.exec(p)) && M === 'POST') {
      if (!need()) return;
      const id = +m[1], act = m[2]; const c = D.contribRow(db.prepare('SELECT * FROM contributions WHERE id = ?').get(id));
      if (!c) return bad(res, 'Contribution introuvable', 404);
      if (c.assigned_to !== me.id && me.role !== 'admin') return bad(res, 'Cette contribution est confiée à un autre valideur', 403);
      if (c.status !== 'en attente') return bad(res, 'Déjà traitée', 409);
      const b = await readBody(req);
      if (act === 'validate') {
        const label = LABELS.includes(b.label) ? b.label : 'verifie'; const text = b.text ? String(b.text).slice(0, 4000) : c.text;
        db.prepare("UPDATE contributions SET status = 'publiée', label = ?, text = ?, decided_at = datetime('now'), decided_by = ? WHERE id = ?").run(label, text, me.id, id);
        log(me.nom, `n°${id} ${b.text && b.text !== c.text ? 'corrigée puis ' : ''}validée · ${label}`);
        if (c.email) db.prepare('INSERT INTO outbox (to_user, subject, body) VALUES (?,?,?)').run('contributeur', 'Votre contribution est publiée', 'Merci ! Votre information a été vérifiée et publiée sur La lampe de mémoire.');
      } else if (act === 'refuse') {
        db.prepare("UPDATE contributions SET status = 'refusée', reason = ?, decided_at = datetime('now'), decided_by = ? WHERE id = ?").run(String(b.reason || 'non précisée').slice(0, 500), me.id, id);
        log(me.nom, `n°${id} refusée`);
      } else {
        log(me.nom, `n°${id} : demande d’informations au contributeur`);
        if (c.email) db.prepare('INSERT INTO outbox (to_user, subject, body) VALUES (?,?,?)').run('contributeur', 'Une question sur votre contribution', String(b.question || 'Pouvez-vous nous en dire plus ?').slice(0, 1000));
        return send(res, 200, { ok: true, emailed: !!c.email });
      }
      return send(res, 200, { ok: true });
    }

    // ---- administration
    if (p === '/api/admin/validators' && M === 'GET') { if (!need('admin')) return; const load = pendingLoad(); return send(res, 200, validators().map(v => ({ ...v, a_traiter: load[v.id] || 0 })).concat([{ ...userById('admin'), a_traiter: load.admin || 0 }])); }
    if (p === '/api/admin/pending' && M === 'GET') { if (!need('admin')) return; return send(res, 200, db.prepare('SELECT * FROM users WHERE active = 0 ORDER BY created_at').all().map(D.userRow)); }
    if ((m = /^\/api\/admin\/validators\/([a-z0-9._-]+)\/(approve|reject)$/.exec(p)) && M === 'POST') {
      if (!need('admin')) return; const v = userById(m[1]); if (!v || v.active) return bad(res, 'Introuvable', 404);
      if (m[2] === 'approve') db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(v.id); else db.prepare('DELETE FROM users WHERE id = ? AND active = 0').run(v.id);
      log(me.nom, `Compte ${v.nom} ${m[2] === 'approve' ? 'approuvé' : 'refusé'}`); return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/validators' && M === 'POST') {
      if (!need('admin')) return; const b = await readBody(req);
      const id = L.norm(b.nom || '').replace(/[^a-z0-9]+/g, '').slice(0, 20); if (!id || userById(id)) return bad(res, 'Nom vide ou déjà utilisé');
      const role = ['historien', 'archiviste', 'moderateur'].includes(b.role) ? b.role : 'historien';
      const spec = String(b.spec || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean); const langs = String(b.langs || 'fr').split(',').map(s => s.trim()).filter(Boolean);
      const pass = b.password && String(b.password).length >= 8 ? String(b.password) : D.DEMO_PASSWORD; const { salt, hash } = D.hashPassword(pass);
      db.prepare('INSERT INTO users (id, nom, role, spec, langs, niveau, salt, pass_hash) VALUES (?,?,?,?,?,?,?,?)').run(id, String(b.nom).slice(0, 60), role, JSON.stringify(spec), JSON.stringify(langs), 'confirmé', salt, hash);
      log(me.nom, `Nouveau valideur : ${b.nom}`); return send(res, 201, userById(id));
    }
    if ((m = /^\/api\/admin\/validators\/([a-z0-9._-]+)$/.exec(p)) && M === 'PATCH') {
      if (!need('admin')) return; const v = userById(m[1]); if (!v) return bad(res, 'Introuvable', 404); const b = await readBody(req);
      if ('dispo' in b) db.prepare('UPDATE users SET dispo = ? WHERE id = ?').run(b.dispo ? 1 : 0, v.id);
      if (b.spec) db.prepare('UPDATE users SET spec = ? WHERE id = ?').run(JSON.stringify(String(b.spec).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)), v.id);
      log(me.nom, `${v.nom} : ${'dispo' in b ? (b.dispo ? 'disponible' : 'indisponible') : 'spécialités modifiées'}`); return send(res, 200, userById(v.id));
    }
    if (p === '/api/admin/journal' && M === 'GET') { if (!need('admin')) return; return send(res, 200, db.prepare('SELECT * FROM journal ORDER BY id DESC LIMIT 200').all()); }
    if (p === '/api/admin/outbox' && M === 'GET') { if (!need('admin')) return; return send(res, 200, db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 50').all()); }
    if (p === '/api/admin/stats' && M === 'GET') { if (!need('admin')) return; return send(res, 200, db.prepare('SELECT status, COUNT(*) AS n FROM contributions GROUP BY status').all()); }
    if (p === '/api/admin/digest' && M === 'POST') { if (!need('admin')) return; return send(res, 200, { emails: digest() }); }
    if (p === '/api/admin/simulate' && M === 'POST') { if (!need('admin')) return; const s = simulate(1000); log(me.nom, `Simulation : 1000 contributions en ${s.ms} ms`); return send(res, 200, s); }
    if ((m = /^\/api\/uploads\/([a-f0-9]{16}\.(png|jpg|webp|pdf))$/.exec(p)) && M === 'GET') {
      if (!need()) return; const f = path.join(UPLOADS, m[1]); if (!fs.existsSync(f)) return bad(res, 'Introuvable', 404);
      res.writeHead(200, { 'Content-Type': MIME['.' + m[2]] || 'application/octet-stream' }); return fs.createReadStream(f).pipe(res);
    }
    return bad(res, 'Route inconnue', 404);
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    if (!path.extname(rel)) rel += '.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { const nf = path.join(PUBLIC, '404.html'); res.writeHead(404, { 'Content-Type': MIME['.html'] }); return fs.createReadStream(nf).pipe(res); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return bad(res, 'Méthode non permise', 405);
      serveStatic(req, res, url);
    } catch (e) { if (!res.headersSent) bad(res, e.message || 'Erreur', e.code && Number.isInteger(e.code) ? e.code : 500); }
  });
  return { server, db, createContribution, simulate, digest };
}

if (require.main === module) {
  const port = +process.env.PORT || 3000;
  const { server } = createApp();
  server.listen(port, () => console.log(`La lampe de mémoire : http://localhost:${port}  (comptes de démo, mot de passe : ${D.DEMO_PASSWORD})`));
}
module.exports = { createApp };
