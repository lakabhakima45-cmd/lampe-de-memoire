// Tests du serveur : parcours complet d'une contribution (node --test)
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server/server');

test('parcours complet : envoi, choix du valideur, validation, publication', async t => {
  const app = createApp({ dbFile: ':memory:', secret: 'test' });
  await new Promise(ok => app.server.listen(0, ok));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.server.close());
  let cookie = '';
  const call = async (path, method = 'GET', body) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body && JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, data: await r.json().catch(() => null) };
  };

  await t.test('les 9 messages du mur sont servis', async () => { const r = await call('/api/messages'); assert.equal(r.status, 200); assert.equal(r.data.length, 9); });
  let id;
  await t.test('une contribution est enregistrée « en attente » et confiée à Mme Durand', async () => {
    const r = await call('/api/contributions', 'POST', { msg: 'rennes', type: 'souvenir', text: 'Ma grand-mère faisait partie de ce groupe de femmes de Rennes, en 1944.' });
    assert.equal(r.status, 201); assert.equal(r.data.status, 'en attente'); assert.equal(r.data.assigned, 'Mme Durand'); id = r.data.id;
  });
  await t.test('un e-mail sans accord est refusé (RGPD)', async () => { const r = await call('/api/contributions', 'POST', { msg: 'rennes', type: 'souvenir', text: 'Un autre souvenir de ma famille à Rennes.', email: 'a@b.fr' }); assert.equal(r.status, 400); });
  await t.test('un doublon est regroupé', async () => { const r = await call('/api/contributions', 'POST', { msg: 'rennes', type: 'souvenir', text: 'Ma grand-mère faisait partie de ce groupe de femmes de Rennes, en 1944 !' }); assert.equal(r.data.status, 'doublon'); });
  await t.test('le spam est écarté', async () => { const r = await call('/api/contributions', 'POST', { msg: 'rennes', type: 'commentaire', text: 'http://promo.example' }); assert.equal(r.data.status, 'spam'); });
  await t.test('rien n’est publié avant la validation', async () => { const r = await call('/api/messages'); assert.equal(r.data.find(m => m.id === 'rennes').contributions.length, 0); });
  await t.test('la file historien demande une connexion', async () => { assert.equal((await call('/api/queue')).status, 401); });
  await t.test('un mauvais mot de passe est refusé', async () => { assert.equal((await call('/api/login', 'POST', { id: 'durand', password: 'faux' })).status, 401); });
  await t.test('un autre valideur ne peut pas valider la contribution', async () => {
    await call('/api/login', 'POST', { id: 'benali', password: 'memoire2026' });
    assert.equal((await call(`/api/contributions/${id}/validate`, 'POST', { label: 'famille' })).status, 403);
  });
  await t.test('Mme Durand la voit dans sa file et la valide', async () => {
    await call('/api/login', 'POST', { id: 'durand', password: 'memoire2026' });
    const q = await call('/api/queue'); assert.ok(q.data.some(c => c.id === id));
    assert.equal((await call(`/api/contributions/${id}/validate`, 'POST', { label: 'famille' })).status, 200);
  });
  await t.test('elle est publiée avec l’étiquette « Témoignage de famille »', async () => { const r = await call('/api/messages'); const c = r.data.find(m => m.id === 'rennes').contributions; assert.equal(c.length, 1); assert.equal(c[0].label, 'famille'); });
  await t.test('création de compte : mot de passe faible refusé', async () => { assert.equal((await call('/api/register', 'POST', { nom: 'Mme Test', id: 'mtest', email: 'm@test.fr', password: 'abc' })).data.code, 'weak'); });
  await t.test('création de compte : le compte attend l’approbation', async () => {
    assert.equal((await call('/api/register', 'POST', { nom: 'Mme Test', id: 'mtest', email: 'm@test.fr', password: 'memoire2026x', role: 'historien', spec: 'Rennes, 1944', langs: 'fr' })).status, 201);
    assert.equal((await call('/api/register', 'POST', { nom: 'Autre', id: 'mtest', email: 'a@test.fr', password: 'memoire2026x' })).data.code, 'exists');
    assert.equal((await call('/api/login', 'POST', { id: 'mtest', password: 'memoire2026x' })).data.code, 'pending');
  });
  await t.test('après 5 erreurs, la connexion est bloquée 10 minutes', async () => {
    for (let i = 0; i < 5; i++) await call('/api/login', 'POST', { id: 'keller', password: 'faux' });
    assert.equal((await call('/api/login', 'POST', { id: 'keller', password: 'memoire2026' })).status, 429);
  });
  await t.test('l’administration est réservée à l’administrateur', async () => { assert.equal((await call('/api/admin/validators')).status, 403); });
  await t.test('l’administrateur approuve le compte, qui peut alors se connecter et changer son mot de passe', async () => {
    await call('/api/login', 'POST', { id: 'admin', password: 'memoire2026' });
    assert.ok((await call('/api/admin/pending')).data.some(u => u.id === 'mtest'));
    assert.equal((await call('/api/admin/validators/mtest/approve', 'POST')).status, 200);
    assert.equal((await call('/api/login', 'POST', { id: 'mtest', password: 'memoire2026x' })).status, 200);
    assert.equal((await call('/api/me/password', 'POST', { old: 'faux', password: 'nouveau2027' })).status, 401);
    assert.equal((await call('/api/me/password', 'POST', { old: 'memoire2026x', password: 'nouveau2027' })).status, 200);
    assert.equal((await call('/api/login', 'POST', { id: 'mtest', password: 'nouveau2027' })).status, 200);
  });
  await t.test('1000 contributions simulées en moins d’une seconde', async () => {
    await call('/api/login', 'POST', { id: 'admin', password: 'memoire2026' });
    const r = await call('/api/admin/simulate', 'POST'); assert.equal(r.status, 200); assert.ok(r.data.ms < 1000); assert.equal(r.data.repartition.reduce((a, b) => a + b.n, 0), r.data.a_verifier);
  });
});
