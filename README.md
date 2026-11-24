# La lampe de mémoire

**Révéler plutôt que montrer.** Un mur dans le noir qu'on éclaire avec le doigt ou la souris pour découvrir les messages laissés par les prisonniers de la casemate n°17 du Fort de Romainville. Chaque message a une fiche (histoire, audio, étiquette de vérité). Les visiteurs peuvent ajouter une information : le serveur choisit le bon valideur grâce aux mots-clés, et rien n'est publié sans vérification.

Projet de Master, Université Paris 8.

---

## Ce qu'il y a dans le site

| Page | Adresse | Pour qui |
|---|---|---|
| Accueil | `/` | tout le monde |
| Le mur (la lampe, les fiches, le formulaire) | `/mur` | visiteurs, élèves, familles |
| L'histoire du lieu | `/histoire` | tout le monde |
| Comment ça marche (validation, rôles) | `/fonctionnement` | tout le monde |
| Le projet (démarche, choix techniques) | `/projet` | tout le monde |
| Accessibilité (RGAA) | `/accessibilite` | tout le monde |
| Mentions légales et RGPD | `/mentions` | tout le monde |
| Espace historien (connexion, file à vérifier) | `/historien/` | historiens, archiviste, modérateur |
| Administration (valideurs, journal, simulation) | `/historien/admin` | administrateur |

Tout le site existe en **4 langues** : français, anglais, espagnol, arabe (de droite à gauche), y compris le nom du site. En haut de chaque page, une **barre d'accessibilité** : lien vers la déclaration RGAA, choix de la langue, taille du texte (A− / A+) et contraste renforcé.

## Architecture

```
navigateur (front-end)                serveur (back-end)                  base de données
HTML + CSS + JavaScript   ── API ──►  Node.js (server/server.js)  ──►   SQLite (data/lampe.db)
public/                   ◄─ JSON ──  logique : server/logic.js          users, contributions,
  index.html, mur.html…                 · mots-clés, langue                notifications, journal,
  assets/i18n.js (langues)              · spam, doublons                   outbox (e-mails)
  assets/wall.js (lampe)                · choix du valideur
```

- **Aucune dépendance à installer** : seulement Node.js 22 (qui contient déjà le serveur web et SQLite).
- Mots de passe chiffrés (scrypt), session signée dans un cookie `HttpOnly`.
- Les fichiers envoyés (photos, PDF) sont rangés dans `data/uploads/`, visibles seulement par les valideurs connectés.

## Lancer le site sur son ordinateur

1. Installer **Node.js 22** (ou plus) : https://nodejs.org
2. Ouvrir un terminal dans ce dossier, puis :
   ```
   npm start
   ```
3. Ouvrir **http://localhost:3000**

Dans l'**Espace historien**, chacun peut **créer son propre compte** (identifiant, e-mail, mot de passe d'au moins 8 caractères avec une lettre et un chiffre). Le compte est activé quand l'**administrateur l'approuve** dans la page Administration. Après 5 mots de passe faux, la connexion est bloquée 10 minutes. Chacun peut changer son mot de passe une fois connecté.

Comptes de démonstration (fictifs) pour les tests. Le mot de passe est `memoire2026` pour tous :

| Identifiant | Rôle | Spécialités |
|---|---|---|
| `durand` | Historienne | déportation, Ravensbrück, résistantes, femmes, Rennes, 1944 · lit fr, de |
| `benali` | Historien | Occupation, otages, fusillés, Paris, 1941–1943 · lit fr, ar |
| `keller` | Archiviste | lettre, photo, document, archives, famille · lit fr, de, en |
| `rossi` | Modérateur | traduction, casemate · lit fr, en, it, es |
| `admin` | Administrateur (référent du mémorial) | reçoit ce qui ne correspond à personne |

## Les tests

```
npm test
```

29 tests automatiques : mots-clés, choix du valideur (français, anglais, arabe, espagnol), valideur indisponible, égalité de score, spam, doublons, RGPD (e-mail sans accord refusé), connexion, création de compte et approbation, mot de passe faible refusé, blocage après 5 erreurs, changement de mot de passe, droits (un valideur ne peut pas valider la contribution d'un autre), publication seulement après validation, 1000 contributions simulées.

## La règle de choix du valideur (server/logic.js)

Pour chaque valideur **disponible** qui **lit la langue** du texte :
- score = nombre de mots-clés communs avec ses spécialités ;
- +1 s'il lit une autre langue que le français ;
- +1 pour un archiviste si la contribution est un document.

On choisit le meilleur score ; à égalité, celui qui a le moins de contributions à traiter. Si personne n'a de score positif, la contribution va au référent du mémorial.

## L'API

| Méthode | Adresse | Rôle |
|---|---|---|
| GET | `/api/messages` | messages du mur + contributions publiées |
| POST | `/api/contributions` | envoyer une contribution |
| POST | `/api/register` | demande de compte valideur (activé par l'admin) |
| POST | `/api/login` · `/api/logout` | connexion des valideurs (blocage après 5 erreurs) |
| POST | `/api/me/password` | changer son mot de passe |
| GET / POST | `/api/admin/pending` · `/api/admin/validators/:id/approve` · `/reject` | approuver les comptes (admin) |
| GET | `/api/queue` | contributions à vérifier pour le valideur connecté |
| POST | `/api/contributions/:id/validate` · `/refuse` · `/ask` | décision du valideur |
| GET/POST/PATCH | `/api/admin/validators` | gérer les valideurs (admin) |
| GET | `/api/admin/journal` · `/stats` · `/outbox` | suivi (admin) |
| POST | `/api/admin/simulate` · `/digest` | simulation de 1000 contributions, résumé e-mail du jour (admin) |

## Mettre le site en ligne (Render, gratuit)

1. Mettre ce dossier sur **GitHub** (nouveau dépôt, envoyer tous les fichiers).
2. Sur https://render.com : **New > Web Service**, choisir le dépôt.
3. Réglages :
   - Runtime : **Node**
   - Build command : `npm install` (rien n'est installé, mais Render le demande)
   - Start command : `npm start`
   - Variables d'environnement : `SESSION_SECRET` = une longue phrase secrète ; `DEMO_PASSWORD` = un autre mot de passe que celui de la démo
4. Render donne une adresse du type `https://lampe-de-memoire.onrender.com`.

⚠️ En version gratuite, le disque de Render est effacé à chaque redémarrage : les contributions repartent à zéro. Pour les garder, il faut un disque persistant (Render Disk, ou Railway avec un volume) et la variable `DB_FILE=/chemin/du/disque/lampe.db`.

## Ce qu'il faudrait pour un vrai mémorial

- Vraie photo du mur de la casemate n°17 (avec l'autorisation du mémorial) et positions réelles des graffitis.
- Fiches historiques réelles, écrites et vérifiées par des historiens.
- Envoi réel des e-mails (aujourd'hui ils sont préparés dans la table `outbox`) via un service d'envoi.
- Audit d'accessibilité RGAA par un expert, et suppression automatique des e-mails après réponse.

Les messages du mur sont des exemples d'illustration, sauf « 17 18 », qui est réel. Les valideurs sont fictifs.
