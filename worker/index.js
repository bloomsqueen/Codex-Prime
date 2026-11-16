// Script du Worker « codex-prime » (il sert aussi le site, voir ../wrangler.jsonc) : fiches d'outils et commentaires dans R2.
//
// Lecture : publique.  Écriture : réservée aux personnes connectées par Cloudflare Access.
// Aucun secret dans ce fichier. Le Worker vérifie lui-même le jeton signé par Access
// (en-tête Cf-Access-Jwt-Assertion) : la règle Access ne doit pas être la seule barrière.
// Si ACCESS_TEAM_DOMAIN ou ACCESS_AUD est vide, toute écriture est refusée.
//
// Organisation dans R2 (liaison DATA) :
//   outils/<outilId>.json                       une fiche par outil
//   commentaires/<outilId>/<commentaireId>.json un objet par commentaire
//   meta/init.json                              marque l'initialisation (créée une seule fois)

const FAMILLES = [
  ['inspiration', 'Inspiration'],
  ['design-system', 'Design system'],
  ['prompts', 'Prompts'],
  ['composants', 'Composants UI'],
  ['animation', 'Animation'],
  ['effets', 'Effets et visuels'],
  ['outils-ia', "Outils d'IA"],
];

// Source unique des champs : le Worker valide avec elle, la page construit son formulaire avec elle.
export const SCHEMA = {
  version: 1,
  champs: [
    { nom: 'nom', libelle: 'Nom', type: 'texte', obligatoire: true, max: 80 },
    { nom: 'url', libelle: 'Adresse du site (http ou https)', type: 'url', obligatoire: true, max: 300 },
    { nom: 'categorie', libelle: 'Catégorie affichée', type: 'texte', obligatoire: true, max: 80 },
    {
      nom: 'famille',
      libelle: 'Famille (pour le filtre)',
      type: 'choix',
      obligatoire: true,
      choix: FAMILLES.map(([valeur, libelle]) => ({ valeur, libelle })),
    },
    { nom: 'description', libelle: 'Description', type: 'texte-long', max: 400 },
    { nom: 'acces', libelle: 'Accès et prix', type: 'texte', max: 200 },
    { nom: 'dateVerification', libelle: 'Date de vérification', type: 'date' },
    { nom: 'libre', libelle: 'Code ouvert', type: 'booleen' },
    { nom: 'tags', libelle: 'Mots-clés', type: 'liste', maxElements: 10, maxElement: 30 },
  ],
  commentaire: [
    { nom: 'texte', libelle: 'Commentaire', type: 'texte-long', obligatoire: true, max: 1000 },
    { nom: 'auteur', libelle: 'Pseudo (facultatif)', type: 'texte', max: 40 },
  ],
};

const RE_ID = /^outil-\d{3}$/;
const RE_EQUIPE = /^[a-z0-9-]+\.cloudflareaccess\.com$/i;
const RE_CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const PAGE = 40; // lectures R2 par requête : reste sous la limite de sous-requêtes du plan gratuit
const MAX_COMMENTAIRES_PAR_OUTIL = 200;
const MAX_INIT = 100;
const TAILLE_MAX = 20_000;
const TAILLE_MAX_INIT = 200_000;

// ---------------------------------------------------------------- réponses

const ENTETES = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function json(corps, statut = 200, extra = {}) {
  return new Response(JSON.stringify(corps), { status: statut, headers: { ...ENTETES, ...extra } });
}

function erreur(statut, code, message, extra = {}) {
  return json({ erreur: code, message, ...extra }, statut);
}

// ---------------------------------------------------------------- validation

function texte(valeur, def, erreurs) {
  if (valeur === undefined || valeur === null) valeur = '';
  if (typeof valeur !== 'string') {
    erreurs[def.nom] = 'Ce champ doit être un texte.';
    return undefined;
  }
  let v = valeur.replace(/\r\n?/g, '\n').trim();
  if (def.type !== 'texte-long') v = v.replace(/\n/g, ' ');
  if (RE_CONTROLE.test(v)) {
    erreurs[def.nom] = 'Ce champ contient un caractère non autorisé.';
    return undefined;
  }
  if (def.obligatoire && v === '') {
    erreurs[def.nom] = 'Ce champ est obligatoire.';
    return undefined;
  }
  if (v.length > def.max) {
    erreurs[def.nom] = `Ce champ est limité à ${def.max} caractères (${v.length} saisis).`;
    return undefined;
  }
  return v;
}

function adresse(valeur, def, erreurs) {
  const v = texte(valeur, def, erreurs);
  if (v === undefined) return undefined;
  let u;
  try {
    u = new URL(v);
  } catch {
    erreurs[def.nom] = "Adresse invalide : elle doit commencer par http:// ou https://.";
    return undefined;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    erreurs[def.nom] = 'Seules les adresses http et https sont acceptées.';
    return undefined;
  }
  if (u.username || u.password) {
    erreurs[def.nom] = "L'adresse ne doit pas contenir d'identifiant ni de mot de passe.";
    return undefined;
  }
  if (u.href.length > def.max) {
    erreurs[def.nom] = `L'adresse est limitée à ${def.max} caractères.`;
    return undefined;
  }
  return u.href;
}

function date(valeur, def, erreurs) {
  if (valeur === undefined || valeur === null || valeur === '') return '';
  if (typeof valeur !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valeur)) {
    erreurs[def.nom] = 'La date doit être au format AAAA-MM-JJ.';
    return undefined;
  }
  const d = new Date(`${valeur}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== valeur) {
    erreurs[def.nom] = "Cette date n'existe pas.";
    return undefined;
  }
  return valeur;
}

function booleen(valeur, def, erreurs) {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  if (typeof valeur !== 'boolean') {
    erreurs[def.nom] = 'Ce champ doit être oui, non ou non renseigné.';
    return undefined;
  }
  return valeur;
}

function liste(valeur, def, erreurs) {
  if (valeur === undefined || valeur === null) return [];
  if (!Array.isArray(valeur)) {
    erreurs[def.nom] = 'Ce champ doit être une liste.';
    return undefined;
  }
  const sortie = [];
  for (const brut of valeur) {
    if (typeof brut !== 'string') {
      erreurs[def.nom] = 'Chaque élément de la liste doit être un texte.';
      return undefined;
    }
    const v = brut.replace(/\s+/g, ' ').trim();
    if (v === '') continue;
    if (RE_CONTROLE.test(v) || v.length > def.maxElement) {
      erreurs[def.nom] = `Chaque élément est limité à ${def.maxElement} caractères, sans caractère spécial.`;
      return undefined;
    }
    if (!sortie.includes(v)) sortie.push(v);
  }
  if (sortie.length > def.maxElements) {
    erreurs[def.nom] = `La liste est limitée à ${def.maxElements} éléments.`;
    return undefined;
  }
  return sortie;
}

function choix(valeur, def, erreurs) {
  if (typeof valeur !== 'string' || !def.choix.some((c) => c.valeur === valeur)) {
    erreurs[def.nom] = 'Choisissez une valeur de la liste.';
    return undefined;
  }
  return valeur;
}

const VALIDEURS = {
  texte,
  'texte-long': texte,
  url: adresse,
  date,
  booleen,
  liste,
  choix,
};

// Valide un objet selon une liste de champs. Refuse les champs inconnus.
function valider(entree, defs) {
  const erreurs = {};
  const valeur = {};
  if (entree === null || typeof entree !== 'object' || Array.isArray(entree)) {
    return { erreurs: { _: 'Les données doivent être un objet.' } };
  }
  const connus = new Set(defs.map((d) => d.nom));
  for (const cle of Object.keys(entree)) {
    if (!connus.has(cle)) erreurs[cle] = 'Champ inconnu.';
  }
  for (const def of defs) {
    const v = VALIDEURS[def.type](entree[def.nom], def, erreurs);
    if (v !== undefined) valeur[def.nom] = v;
  }
  return Object.keys(erreurs).length ? { erreurs } : { valeur };
}

// ---------------------------------------------------------------- authentification (Cloudflare Access)

let cacheCles = { equipe: '', cles: null, a: 0 };

async function clesAccess(equipe, forcer = false) {
  const maintenant = Date.now();
  if (!forcer && cacheCles.equipe === equipe && cacheCles.cles && maintenant - cacheCles.a < 600_000) {
    return cacheCles.cles;
  }
  const rep = await fetch(`https://${equipe}/cdn-cgi/access/certs`);
  if (!rep.ok) throw new Error('certs indisponibles');
  const { keys } = await rep.json();
  cacheCles = { equipe, cles: keys, a: maintenant };
  return keys;
}

function base64url(texteB64) {
  const b64 = texteB64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function lireJson(octets) {
  return JSON.parse(new TextDecoder().decode(octets));
}

async function verifierJeton(jeton, env) {
  const parties = jeton.split('.');
  if (parties.length !== 3) return false;
  let entete, charge;
  try {
    entete = lireJson(base64url(parties[0]));
    charge = lireJson(base64url(parties[1]));
  } catch {
    return false;
  }
  if (entete.alg !== 'RS256' || typeof entete.kid !== 'string') return false;

  const maintenant = Math.floor(Date.now() / 1000);
  if (charge.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return false;
  const audiences = Array.isArray(charge.aud) ? charge.aud : [charge.aud];
  if (!audiences.includes(env.ACCESS_AUD)) return false;
  if (typeof charge.exp !== 'number' || charge.exp < maintenant - 30) return false;
  if (typeof charge.nbf === 'number' && charge.nbf > maintenant + 30) return false;

  let cles;
  try {
    cles = await clesAccess(env.ACCESS_TEAM_DOMAIN);
    if (!cles.some((k) => k.kid === entete.kid)) cles = await clesAccess(env.ACCESS_TEAM_DOMAIN, true);
  } catch {
    return false;
  }
  const jwk = cles.find((k) => k.kid === entete.kid);
  if (!jwk) return false;
  try {
    const cle = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cle,
      base64url(parties[2]),
      new TextEncoder().encode(`${parties[0]}.${parties[1]}`),
    );
  } catch {
    return false;
  }
}

function ecritureConfiguree(env) {
  return RE_EQUIPE.test(env.ACCESS_TEAM_DOMAIN || '') && typeof env.ACCESS_AUD === 'string' && env.ACCESS_AUD.length >= 16;
}

// Renvoie null si l'écriture est autorisée, sinon la réponse d'erreur à envoyer.
async function autoriserEcriture(request, env, url) {
  if (!ecritureConfiguree(env)) {
    return erreur(403, 'ecriture_desactivee', "La modification est désactivée : la protection (Cloudflare Access) n'est pas configurée.");
  }
  if (request.method !== 'GET') {
    const origine = request.headers.get('Origin');
    if (origine && origine !== url.origin) return erreur(403, 'origine_refusee', 'Origine non autorisée.');
  }
  const jeton = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jeton || !(await verifierJeton(jeton, env))) {
    return erreur(401, 'non_authentifie', 'Connexion nécessaire pour modifier.');
  }
  return null;
}

// ---------------------------------------------------------------- lecture du corps

async function lireCorps(request, limite = TAILLE_MAX) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.toLowerCase().startsWith('application/json')) {
    return { reponse: erreur(415, 'type_non_supporte', 'Le corps doit être du JSON (application/json).') };
  }
  const annonce = Number(request.headers.get('Content-Length'));
  if (annonce > limite) return { reponse: erreur(413, 'trop_gros', 'Données trop volumineuses.') };
  const brut = await request.text();
  if (brut.length > limite) return { reponse: erreur(413, 'trop_gros', 'Données trop volumineuses.') };
  try {
    return { corps: JSON.parse(brut) };
  } catch {
    return { reponse: erreur(400, 'json_invalide', "Le JSON envoyé n'est pas valide.") };
  }
}

// ---------------------------------------------------------------- stockage R2

const cleFiche = (id) => `outils/${id}.json`;
const prefixeComm = (id) => `commentaires/${id}/`;

async function lireFiche(env, id) {
  const obj = await env.DATA.get(cleFiche(id));
  if (!obj) return null;
  return { fiche: await obj.json(), etag: obj.etag };
}

async function lirePage(env, prefixe, curseur) {
  const liste = await env.DATA.list({ prefix: prefixe, limit: PAGE, cursor: curseur || undefined });
  const objets = await Promise.all(liste.objects.map((o) => env.DATA.get(o.key)));
  const elements = [];
  for (const o of objets) if (o) elements.push(await o.json());
  return { elements, suivant: liste.truncated ? liste.cursor : null };
}

// ---------------------------------------------------------------- routes

async function etat(env) {
  const marque = await env.DATA.head('meta/init.json');
  return json({ initialise: Boolean(marque), ecritureConfiguree: ecritureConfiguree(env), schemaVersion: SCHEMA.version });
}

async function initialiser(request, env) {
  const { corps, reponse } = await lireCorps(request, TAILLE_MAX_INIT);
  if (reponse) return reponse;
  if (await env.DATA.head('meta/init.json')) {
    return erreur(409, 'deja_initialise', 'Les fiches ont déjà été initialisées : rien n\'a été écrit.');
  }
  const entrees = corps && corps.fiches;
  if (!Array.isArray(entrees) || entrees.length === 0 || entrees.length > MAX_INIT) {
    return erreur(400, 'donnees_invalides', `Envoyez entre 1 et ${MAX_INIT} fiches.`);
  }
  const erreurs = {};
  const valides = [];
  const vus = new Set();
  entrees.forEach((e, i) => {
    const { outilId, ...champs } = e && typeof e === 'object' ? e : {};
    if (typeof outilId !== 'string' || !RE_ID.test(outilId) || vus.has(outilId)) {
      erreurs[`fiches[${i}].outilId`] = 'Identifiant absent, invalide ou en double.';
      return;
    }
    vus.add(outilId);
    const r = valider(champs, SCHEMA.champs);
    if (r.erreurs) erreurs[outilId] = r.erreurs;
    else valides.push({ outilId, valeur: r.valeur });
  });
  if (Object.keys(erreurs).length) return erreur(400, 'donnees_invalides', 'Certaines fiches sont invalides : rien n\'a été écrit.', { erreurs });

  const maintenant = new Date().toISOString();
  let crees = 0;
  let ignores = 0;
  for (const { outilId, valeur } of valides) {
    const fiche = { outilId, version: 1, creeLe: maintenant, modifieLe: maintenant, ...valeur };
    // Création seule : si l'objet existe déjà, R2 refuse et on ne touche à rien.
    const ecrit = await env.DATA.put(cleFiche(outilId), JSON.stringify(fiche), {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/json' },
    });
    if (ecrit) crees += 1;
    else ignores += 1;
  }
  await env.DATA.put('meta/init.json', JSON.stringify({ initialiseLe: maintenant, fiches: crees + ignores }), {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'application/json' },
  });
  return json({ crees, ignores }, 201);
}

async function modifierFiche(request, env, id) {
  const { corps, reponse } = await lireCorps(request);
  if (reponse) return reponse;
  if (!corps || typeof corps !== 'object' || !Number.isInteger(corps.versionAttendue) || corps.versionAttendue < 1) {
    return erreur(400, 'donnees_invalides', 'La version attendue de la fiche est obligatoire (entier).');
  }
  const r = valider(corps.champs, SCHEMA.champs);
  if (r.erreurs) return erreur(400, 'donnees_invalides', 'Certains champs sont invalides : rien n\'a été enregistré.', { erreurs: r.erreurs });

  const actuel = await lireFiche(env, id);
  if (!actuel) return erreur(404, 'introuvable', 'Fiche introuvable.');
  if (actuel.fiche.version !== corps.versionAttendue) {
    return erreur(409, 'conflit', "Cette fiche a été modifiée depuis son chargement : rien n'a été écrasé.", { actuelle: actuel.fiche });
  }
  const suivante = {
    outilId: id,
    version: actuel.fiche.version + 1,
    creeLe: actuel.fiche.creeLe,
    modifieLe: new Date().toISOString(),
    ...r.valeur,
  };
  // Écriture conditionnelle : si quelqu'un d'autre a écrit entre-temps, R2 refuse.
  const ecrit = await env.DATA.put(cleFiche(id), JSON.stringify(suivante), {
    onlyIf: { etagMatches: actuel.etag },
    httpMetadata: { contentType: 'application/json' },
  });
  if (!ecrit) {
    const encore = await lireFiche(env, id);
    return erreur(409, 'conflit', "Cette fiche vient d'être modifiée : rien n'a été écrasé.", { actuelle: encore && encore.fiche });
  }
  return json({ fiche: suivante });
}

async function ajouterCommentaire(request, env, id) {
  const { corps, reponse } = await lireCorps(request);
  if (reponse) return reponse;
  const r = valider(corps, SCHEMA.commentaire);
  if (r.erreurs) return erreur(400, 'donnees_invalides', "Le commentaire est invalide : rien n'a été enregistré.", { erreurs: r.erreurs });
  if (!(await env.DATA.head(cleFiche(id)))) return erreur(404, 'introuvable', 'Fiche introuvable.');

  const deja = await env.DATA.list({ prefix: prefixeComm(id), limit: MAX_COMMENTAIRES_PAR_OUTIL + 1 });
  if (deja.objects.length > MAX_COMMENTAIRES_PAR_OUTIL) {
    return erreur(409, 'limite', `Cet outil a déjà ${MAX_COMMENTAIRES_PAR_OUTIL} commentaires.`);
  }
  const commentaireId = crypto.randomUUID();
  const commentaire = { commentaireId, outilId: id, creeLe: new Date().toISOString(), ...r.valeur };
  const ecrit = await env.DATA.put(`${prefixeComm(id)}${commentaireId}.json`, JSON.stringify(commentaire), {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'application/json' },
  });
  if (!ecrit) return erreur(500, 'ecriture_echouee', "Le commentaire n'a pas pu être enregistré.");
  return json({ commentaire }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const chemin = url.pathname.replace(/\/+$/, '');
    const methode = request.method;

    // Les pages du site sont servies sans passer ici. Une adresse inconnue hors /api arrive jusqu'ici.
    if (chemin !== '/api' && !chemin.startsWith('/api/')) {
      return new Response('Page introuvable.\n', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      });
    }

    try {
      // ---- lecture publique
      if (methode === 'GET' && chemin === '/api/etat') return await etat(env);
      if (methode === 'GET' && chemin === '/api/schema') return json(SCHEMA);
      if (methode === 'GET' && chemin === '/api/outils') {
        const { elements, suivant } = await lirePage(env, 'outils/', url.searchParams.get('curseur'));
        return json({ fiches: elements, suivant });
      }
      if (methode === 'GET' && chemin === '/api/commentaires') {
        const { elements, suivant } = await lirePage(env, 'commentaires/', url.searchParams.get('curseur'));
        return json({ commentaires: elements, suivant });
      }

      // ---- écriture protégée
      if (chemin.startsWith('/api/ecriture')) {
        const refus = await autoriserEcriture(request, env, url);
        if (refus) return refus;

        if (methode === 'GET' && chemin === '/api/ecriture/session') return json({ ok: true });
        if (methode === 'GET' && chemin === '/api/ecriture/connexion') {
          return new Response(null, { status: 303, headers: { Location: '/outils.html', 'Cache-Control': 'no-store' } });
        }
        if (methode === 'POST' && chemin === '/api/ecriture/init') return await initialiser(request, env);

        const m = chemin.match(/^\/api\/ecriture\/outils\/([^/]+)(\/commentaires)?$/);
        if (m) {
          const id = m[1];
          if (!RE_ID.test(id)) return erreur(400, 'identifiant_invalide', "Identifiant d'outil invalide.");
          if (!m[2] && methode === 'PUT') return await modifierFiche(request, env, id);
          if (m[2] && methode === 'POST') return await ajouterCommentaire(request, env, id);
          return erreur(405, 'methode_non_autorisee', 'Méthode non autorisée.');
        }
      }
      return erreur(404, 'introuvable', 'Route inconnue.');
    } catch (e) {
      // On ne renvoie jamais le détail technique au navigateur.
      console.error('erreur interne', e && e.message);
      return erreur(500, 'erreur_interne', 'Erreur interne du service.');
    }
  },
};
