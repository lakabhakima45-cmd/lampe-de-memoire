// Tests de la logique (node --test)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../server/logic');
const V = [
  { id: 'durand', nom: 'Mme Durand', role: 'historien', spec: ['déportation', 'ravensbrück', 'résistantes', 'femmes', 'rennes', '1944'], langs: ['fr', 'de'], dispo: true },
  { id: 'benali', nom: 'M. Benali', role: 'historien', spec: ['occupation', 'otages', 'fusillés', 'paris', '1941', '1942', '1943'], langs: ['fr', 'ar'], dispo: true },
  { id: 'keller', nom: 'Mme Keller', role: 'archiviste', spec: ['lettre', 'photo', 'document', 'archives', 'famille'], langs: ['fr', 'de', 'en'], dispo: true },
  { id: 'rossi', nom: 'M. Rossi', role: 'moderateur', spec: ['traduction', 'casemate'], langs: ['fr', 'en', 'it', 'es'], dispo: true },
];
const mk = (text, type = 'souvenir') => ({ text, type, lang: L.detectLang(text), keywords: L.extractKeywords(text) });

test('mots-clés trouvés dans « les femmes de Rennes en 1944 »', () => {
  const k = L.extractKeywords('les femmes de Rennes en 1944');
  for (const w of ['femmes', 'rennes', '1944']) assert.ok(k.includes(w));
});
test('un souvenir sur Rennes 1944 va à la spécialiste de la déportation', () => assert.equal(L.route(mk('Ma grand-mère faisait partie des femmes de Rennes en 1944.'), V).chosen, 'durand'));
test('une correction sur Paris 1943 va à l’historien de l’Occupation', () => assert.equal(L.route(mk('Il faut lire Paris 1943, des otages sont partis.', 'correction'), V).chosen, 'benali'));
test('un texte anglais avec photo et lettre va à l’archiviste', () => assert.equal(L.route(mk('My grandmother was here, I have a photo and a letter of her.'), V).chosen, 'keller'));
test('un texte arabe va à un valideur qui lit l’arabe', () => assert.equal(L.route(mk('جدتي كانت هنا سنة 1943 مع الرهائن'), V).chosen, 'benali'));
test('un texte espagnol va à un valideur qui lit l’espagnol', () => assert.equal(L.route(mk('Mi abuela fue deportada, tengo una carta suya.'), V).chosen, 'rossi'));
test('sans mot-clé, la contribution va au référent', () => assert.equal(L.route(mk('Très beau travail, merci beaucoup pour ce site.', 'commentaire'), V).chosen, 'referent'));
test('un valideur indisponible n’est jamais choisi', () => {
  const V2 = V.map(v => v.id === 'durand' ? { ...v, dispo: false } : v);
  assert.notEqual(L.route(mk('Les femmes de Rennes en 1944 sont parties pour Ravensbrück.'), V2).chosen, 'durand');
});
test('à score égal, le valideur le moins chargé est choisi', () => {
  const V2 = [{ ...V[0], id: 'a' }, { ...V[0], id: 'b' }];
  assert.equal(L.route(mk('Rennes 1944'), V2, { a: 5, b: 1 }).chosen, 'b');
});
test('spam : lien, texte trop court, caractères répétés', () => {
  assert.equal(L.detectSpam('Allez voir http://promo.example maintenant'), 'contient un lien');
  assert.equal(L.detectSpam('super'), 'trop court');
  assert.equal(L.detectSpam('aaaaaaaaaaaaaaaaaaaa!'), 'caractères répétés');
  assert.equal(L.detectSpam('Ma grand-mère était à Rennes en 1944.'), null);
});
test('deux textes presque identiques sont des doublons', () => assert.ok(L.similarity('Le départ pour Ravensbrück a été repoussé, ma tante en parlait souvent.', 'Le départ pour Ravensbrück a été repoussé, ma tante en parlait.') > 0.6));
