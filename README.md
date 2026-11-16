# Codex Prime

Des outils et des connaissances sur l'intelligence artificielle et le **vibe coding**, rassemblés pour les **cours adultes de Paris**.

Le vibe coding consiste à décrire en langage naturel ce que l'on veut et à laisser une IA écrire le code. Ce site aide des personnes débutantes à comprendre ce que cela permet, avec quels outils, et avec quelles précautions.

## Pour qui

Les personnes qui suivent les cours adultes de Paris. Aucune connaissance en programmation n'est nécessaire.

## Ce que contient le site

| Page | Contenu |
|---|---|
| `index.html` | Accueil : accroche, deux grandes cartes vers les pages, trois conseils pour démarrer |
| `connaissances.html` | Glossaire du vocabulaire de base (prompt, agent, MCP, hallucination…) et trois réflexes à garder |
| `contact.html` | Formulaire de contact (maquette, pas encore actif) |
| `aide.html` | Aide pour lire et utiliser le site |
| `info-site.html` | Objet du site, technique, plan du site |
| `accessibilite.html` | Déclaration d'accessibilité (état « non conforme ») |
| `donnees-personnelles.html` | Cookies, traceurs et données personnelles |
| `mentions-legales.html` | Mentions légales |
| `outils.html` | 34 ressources et outils d'IA pour créer un site (prompts, composants, animations, inspiration…), à filtrer par catégorie sans JavaScript. Fiches modifiables et commentaires via le Worker (voir plus bas). Avertissement sur les sources et leur fiabilité |

Chaque page a le même pied de page, avec les liens vers Contact, Aide, Info site, Accessibilité, Cookies et données personnelles, et Mentions légales. La page « Cookies et données personnelles » est marquée « en construction » : les informations sur le traitement des données (responsable, finalité, droits) sont à ajouter avant d'activer le formulaire de contact.

C'est un site statique, sans framework ni dépendance : du HTML et du CSS.

## Structure du dépôt

```
index.html            accueil
connaissances.html    glossaire
outils.html           liste de 25 ressources filtrable par catégorie
contact.html          formulaire de contact (maquette)
aide.html             aide
info-site.html        informations sur le site
accessibilite.html    déclaration d'accessibilité
donnees-personnelles.html   cookies et données personnelles
mentions-legales.html mentions légales
css/style.css         style commun à toutes les pages
js/outils.js          fiches et commentaires de la page Outils (sans framework)
worker/               Worker Cloudflare « codex-prime-api » : index.js, wrangler.jsonc, package.json, tests
CLAUDE.md             consignes pour travailler sur le dépôt avec Claude
```

## Voir le site en local

Rien à installer. Dans le dossier du dépôt :

```
python3 -m http.server 8000 --bind 127.0.0.1
```

Puis ouvrir http://127.0.0.1:8000/ dans le navigateur. (Sous Windows, essayer `python` ou `py` à la place de `python3`.)

## Publier avec Cloudflare Pages

1. Dans le tableau de bord Cloudflare : **Workers & Pages**, puis **Create**, puis l'onglet **Pages**, puis **Import an existing Git repository**.
2. Choisir ce dépôt et la branche `main`.
3. Laisser le champ « Build command » vide et mettre `/` comme dossier de sortie (« Build output directory »).
4. Chaque fusion sur `main` republie ensuite le site automatiquement.

## Fiches et commentaires (Worker + R2)

La page `outils.html` marche **sans JavaScript** : la liste et le filtre sont en HTML et CSS. Le script `js/outils.js` ajoute, quand le Worker répond, les boutons « Modifier la fiche » et « Ajouter un commentaire ».

**Fonctionnement**
- Chaque ligne a un identifiant fixe (`outil-001` à `outil-034`, attribut `data-outil-id`), indépendant du nom, de l'adresse et de la position.
- Le Worker (`worker/index.js`) stocke dans R2 : `outils/<outilId>.json` (une fiche par outil), `commentaires/<outilId>/<commentaireId>.json` (un objet par commentaire) et `meta/init.json` (marque l'initialisation).
- **Champs d'une fiche** : `nom`, `url` (http ou https), `categorie`, `famille` (inspiration, design-system, prompts, composants, animation, effets, outils-ia), `description`, `acces`, `dateVerification` (date), `libre` (oui, non ou non renseigné), `tags` (liste). Le serveur ajoute `outilId`, `version`, `creeLe`, `modifieLe`. Les champs et leurs limites sont définis une seule fois, dans `SCHEMA` (`worker/index.js`) : la page construit son formulaire à partir de là.
- **Commentaire** : `texte` (1 à 1000 caractères), `auteur` (pseudo facultatif, 40 caractères).
- **Initialisation unique** : tant que R2 est vide, une personne connectée clique sur « Initialiser les fiches depuis la liste ». Les fiches sont créées d'après le HTML, en « création seule » : une fiche existante n'est jamais écrasée, et l'initialisation ne peut pas être refaite.
- **Conflits** : chaque fiche a une `version`. Une modification faite sur une version périmée est refusée (409), rien n'est écrasé. L'écriture est aussi conditionnelle côté R2.
- **Affichage** : tous les textes passent par `textContent`, jamais par `innerHTML`.

**Protection de la modification**
- La lecture est publique. L'écriture (`/api/ecriture/*`) exige une connexion par **Cloudflare Access**.
- Le Worker vérifie lui-même le jeton signé d'Access (signature, émetteur, audience, expiration). Il vérifie aussi l'origine de la requête et le type JSON. Une règle Access seule ne suffit donc pas, et Turnstile ou CORS non plus.
- **Tant que `ACCESS_TEAM_DOMAIN` et `ACCESS_AUD` sont vides dans `worker/wrangler.jsonc`, toute modification est refusée** et les boutons sont désactivés.
- Aucun mot de passe, aucun jeton ni aucun secret dans le JavaScript ou dans ce dépôt.

**À faire vous-même dans Cloudflare** (je ne demande aucune clé)
1. Créer le bucket R2 (par défaut `codex-prime-data`, à changer dans `wrangler.jsonc` si besoin). R2 peut demander un moyen de paiement : à vérifier dans votre compte.
2. Déployer le Worker : `cd worker && npm install && npx wrangler login && npx wrangler deploy`.
3. Faire répondre le Worker sur **la même adresse que le site**, par exemple `exemple.fr/api/*` (route du Worker). Cela suppose que le site soit sur un domaine de votre compte Cloudflare : une adresse en `pages.dev` ne convient pas. Sans cela, il faudrait ajouter CORS et gérer le cookie de connexion : ce n'est pas prévu.
4. Créer une application **Cloudflare Access** qui protège `exemple.fr/api/ecriture/*`, avec la liste des personnes autorisées.
5. Recopier dans `wrangler.jsonc` le domaine d'équipe (`monequipe.cloudflareaccess.com`) et l'« Application Audience (AUD) Tag » de l'application Access, puis redéployer. Ce ne sont pas des secrets.
6. Ouvrir la page Outils, se connecter, cliquer sur « Initialiser les fiches depuis la liste ».
7. Prévoir une limite de débit (règle Cloudflare) si les commentaires doivent un jour être ouverts au public. Ce n'est pas fait ici.

**Tester**
- `cd worker && npm install && npm test` : tests du Worker avec un faux R2 et un faux Access (jetons signés pour de vrai).
- `npm run essai-local` : sert le site et le Worker sur http://127.0.0.1:8100/ avec stockage en mémoire et connexion simulée (`/__connexion`). C'est une simulation : elle ne prouve rien sur Cloudflare lui-même.
- `npm run verifier` : construit le Worker sans le déployer (vérifie la configuration).

**Limites connues**
- Un seul niveau d'accès : toute personne autorisée peut tout modifier et commenter. Pas de suppression de fiche ni de commentaire depuis le site.
- Au plus 200 commentaires par outil. Lecture par pages de 40 objets pour rester sous les limites de sous-requêtes du plan gratuit (à vérifier selon votre plan).
- Les pages « Cookies et données personnelles » et « Mentions légales » devront être complétées (durée de conservation, responsable…) avant d'ouvrir les commentaires au public.

## Accessibilité

Le design utilise trois couleurs seulement (papier rose pâle ou violet nuit, encre violette, rose vif). Le site vise une lecture confortable pour toutes et tous : contrastes d'au moins 7:1, texte redimensionnable, navigation au clavier avec lien d'évitement, focus visible, pas de défilement horizontal à 320 px, prise en charge du mode sombre, du contraste renforcé et du mouvement réduit. Toute nouvelle page doit respecter ces règles.

## Contribuer

Le projet est en construction. Pour proposer une page, une correction ou une ressource, ouvrir une issue. Toute ressource citée doit indiquer sa source, sa date, et ce qui n'a pas pu être vérifié.

## Historique

La page `outils.html` vient du dépôt [pomodoro-spotify](https://github.com/bloomsqueen/pomodoro-spotify), où elle a été écrite avant d'être déplacée ici. Son historique y reste consultable.

## Idées pour la suite

Ce sont des propositions, pas des décisions :

- une page « Programme des cours » (dates, supports, exercices) ;
- une page d'exercices guidés pour un premier petit projet ;
- un glossaire enrichi à partir des questions posées en cours.

## Licence

À définir par le propriétaire du dépôt. En l'absence de licence, le contenu reste protégé par défaut et ne peut pas être réutilisé librement.
