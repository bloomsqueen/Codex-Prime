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
| `outils.html` | Comparatif de 15 outils d'IA (9 du dépôt [awesome-vibecoding](https://github.com/Scap-Mehdi/awesome-vibecoding), 6 ressources d'un post sur X), avec un avertissement sur les sources et leur fiabilité |

C'est un site statique, sans framework ni dépendance : du HTML et du CSS.

## Structure du dépôt

```
index.html            accueil
connaissances.html    glossaire
outils.html           comparatif d'outils d'IA
css/style.css         style commun à toutes les pages
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
