# Codex Prime

Site statique qui rassemble des outils et des connaissances sur l'IA et le vibe coding pour les **cours adultes de Paris**. Le `README.md` décrit le projet et son contenu.

## Public et ton
- Lecteurs : adultes en formation, souvent débutants, qui ne programment pas.
- Écris en français simple, sans jargon. Définis tout terme technique à sa première apparition.
- Phrases courtes. Pas de ton promotionnel.

## Contenu
- Cite ses sources et leur date. Dis clairement ce que tu n'as pas pu vérifier.
- N'affirme rien sur les cours (dates, programme, intervenants) sans que le propriétaire l'ait fourni.
- Une page = un sujet. Ajoute chaque nouvelle page à la navigation de toutes les pages et au tableau du `README.md`.

## Technique
- HTML et CSS simples, sans framework, sans outil de build, sans dépendance. Pas de JavaScript sauf nécessité claire.
- Un seul style commun : `css/style.css`.
- Publication avec Cloudflare Pages : pas de commande de build, dossier de sortie `/`.
- Lancer en local : `python3 -m http.server 8000 --bind 127.0.0.1`, puis http://127.0.0.1:8000/.

## Accessibilité (obligatoire pour chaque page)
- `lang="fr"`, un seul `h1`, titres dans l'ordre, repères (`header`, `nav`, `main`, `footer`).
- Lien d'évitement « Aller au contenu » en premier, `aria-current="page"` sur la page courante.
- Contraste du texte d'au moins 7:1, en clair et en sombre. L'information ne passe jamais par la couleur seule.
- Liens toujours soulignés, focus clavier visible, aucune perte de contenu à 320 px de large.
- Vérifier chaque page en clair, en sombre et sur mobile avant de la proposer.

## Conventions
- Commits courts, au présent, en français.
- Ne pas ouvrir de pull request sans demande.
