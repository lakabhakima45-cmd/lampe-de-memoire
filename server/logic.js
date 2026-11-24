// La lampe de mémoire · logique métier (côté serveur)
// Mots-clés, langue, spam, doublons, choix du valideur. Aucune dépendance.

const DICT = [
  ['rennes', 'rennes'], ['رين', 'rennes'], ['ravensbr', 'ravensbrück'], ['resistan', 'résistantes'],
  ['femme', 'femmes'], ['women', 'femmes'], ['mujer', 'femmes'], ['نساء', 'femmes'],
  ['grand-mere', 'famille'], ['grand mere', 'famille'], ['grand-pere', 'famille'], ['grandmother', 'famille'],
  ['abuela', 'famille'], ['جدت', 'famille'], ['famille', 'famille'], ['family', 'famille'],
  ['lettre', 'lettre'], ['letter', 'lettre'], ['carta', 'lettre'], ['رسالة', 'lettre'],
  ['photo', 'photo'], ['foto', 'photo'], ['صورة', 'photo'], ['document', 'document'], ['archive', 'archives'],
  ['deport', 'déportation'], ['train', 'déportation'], ['depart', 'déportation'],
  ['otage', 'otages'], ['hostage', 'otages'], ['rehen', 'otages'], ['رهائن', 'otages'],
  ['fusill', 'fusillés'], ['paris', 'paris'], ['occupation', 'occupation'],
  ['traduction', 'traduction'], ['translat', 'traduction'], ['casemate', 'casemate'], ['crayon', 'casemate'],
];

const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function extractKeywords(text) {
  const n = norm(text);
  const k = new Set();
  for (const [stem, kw] of DICT) if (n.includes(stem)) k.add(kw);
  (n.match(/\b19[34]\d\b/g) || []).forEach(y => k.add(y));
  return [...k];
}

function detectLang(text) {
  if (/[؀-ۿ]/.test(text)) return 'ar';
  const w = norm(text).split(/[^a-z]+/);
  const count = list => w.filter(x => list.includes(x)).length;
  if (count(['the', 'and', 'my', 'was', 'her', 'his', 'have', 'this', 'of']) >= 2) return 'en';
  if (count(['und', 'die', 'der', 'meine', 'war', 'ich']) >= 2) return 'de';
  if (count(['mi', 'una', 'fue', 'abuela', 'con', 'esta', 'tengo', 'carta', 'y', 'su', 'era']) >= 2) return 'es';
  return 'fr';
}

function detectSpam(text) {
  const t = String(text).trim();
  if (t.length < 15) return 'trop court';
  if (/https?:\/\/|www\./i.test(t)) return 'contient un lien';
  if (/(.)\1{5,}/.test(t)) return 'caractères répétés';
  return null;
}

const words = t => new Set(norm(t).split(/[^a-z0-9؀-ۿ]+/).filter(w => w.length > 2));
function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let i = 0; A.forEach(w => { if (B.has(w)) i++; });
  return i / (A.size + B.size - i);
}

// La règle de choix du valideur.
// Pour chaque valideur : score = nombre de mots-clés communs avec ses spécialités,
// +1 s'il lit la langue de la contribution (hors français), +1 pour un archiviste si c'est un document.
// Un valideur indisponible ou qui ne lit pas la langue est écarté.
// À score égal, on choisit celui qui a le moins de contributions à traiter.
// Si personne n'a de score positif : le référent du mémorial (l'administrateur).
function route(contrib, validators, load = {}) {
  const scores = validators.map(v => {
    if (!v.dispo) return { id: v.id, nom: v.nom, score: -1, why: 'indisponible' };
    if (!v.langs.includes(contrib.lang)) return { id: v.id, nom: v.nom, score: -1, why: 'ne lit pas la langue' };
    const common = contrib.keywords.filter(k => v.spec.includes(k));
    let score = common.length;
    if (contrib.lang !== 'fr') score += 1;
    if (contrib.type === 'document' && v.role === 'archiviste') score += 1;
    return { id: v.id, nom: v.nom, score, why: common.length ? 'mots communs : ' + common.join(', ') : 'aucun mot commun' };
  });
  const best = scores.filter(s => s.score > 0).sort((a, b) => b.score - a.score || (load[a.id] || 0) - (load[b.id] || 0))[0];
  return { chosen: best ? best.id : 'referent', scores };
}

const priority = c => (c.type === 'document' || c.file_name ? 2 : 0) + (c.type === 'correction' ? 1 : 0);

module.exports = { extractKeywords, detectLang, detectSpam, similarity, route, priority, norm };
