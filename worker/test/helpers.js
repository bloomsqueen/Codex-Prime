// Aides de test : faux R2 en mémoire et faux Cloudflare Access (vraie signature RSA).
import { createHash } from 'node:crypto';
import worker from '../index.js';

export const ORIGINE = 'https://site.test';
export const EQUIPE = 'monequipe.cloudflareaccess.com';
export const AUD = 'a'.repeat(32);

// Imite R2 : get / head / put avec onlyIf (etagMatches, etagDoesNotMatch '*') / list paginé.
export class FauxR2 {
  constructor() {
    this.objets = new Map();
    this.delai = 0; // ms : simule la latence de R2 pour provoquer de vraies écritures simultanées
  }
  cles() {
    return [...this.objets.keys()].sort();
  }
  async head(cle) {
    const o = this.objets.get(cle);
    return o ? { key: cle, etag: o.etag } : null;
  }
  async get(cle) {
    const o = this.objets.get(cle); // on lit tout de suite, puis on attend : la valeur lue peut devenir périmée
    if (this.delai) await new Promise((r) => setTimeout(r, this.delai));
    if (!o) return null;
    return { key: cle, etag: o.etag, json: async () => JSON.parse(o.texte), text: async () => o.texte };
  }
  async put(cle, valeur, options = {}) {
    const existant = this.objets.get(cle);
    const cond = options.onlyIf || {};
    if (cond.etagDoesNotMatch === '*' && existant) return null;
    if (cond.etagMatches !== undefined && (!existant || existant.etag !== cond.etagMatches)) return null;
    const texte = String(valeur);
    const etag = createHash('md5').update(texte).digest('hex');
    this.objets.set(cle, { texte, etag });
    return { key: cle, etag };
  }
  async list({ prefix = '', limit = 1000, cursor } = {}) {
    const toutes = this.cles().filter((c) => c.startsWith(prefix));
    const debut = cursor ? Number(cursor) : 0;
    const page = toutes.slice(debut, debut + limit);
    const truncated = debut + limit < toutes.length;
    return { objects: page.map((key) => ({ key })), truncated, cursor: truncated ? String(debut + limit) : undefined };
  }
}

// ---- faux Access
const b64u = (octets) => Buffer.from(octets).toString('base64url');
let paire;
async function lirePaire() {
  if (!paire) {
    paire = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    );
  }
  return paire;
}

export async function jeton({ iss = `https://${EQUIPE}`, aud = AUD, exp = Math.floor(Date.now() / 1000) + 600, kid = 'cle-1', pirate = false } = {}) {
  const p = await lirePaire();
  const entete = b64u(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid })));
  const charge = b64u(new TextEncoder().encode(JSON.stringify({ iss, aud: [aud], exp, email: 'test@exemple.fr' })));
  let cle = p.privateKey;
  if (pirate) {
    // jeton signé par une autre clé : la signature doit être refusée
    cle = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])).privateKey;
  }
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cle, new TextEncoder().encode(`${entete}.${charge}`));
  return `${entete}.${charge}.${b64u(new Uint8Array(sig))}`;
}

// Remplace fetch pour servir les clés publiques d'Access (le Worker les demande en HTTPS).
export async function installerFauxAccess() {
  const p = await lirePaire();
  const jwk = { ...(await crypto.subtle.exportKey('jwk', p.publicKey)), kid: 'cle-1', alg: 'RS256', use: 'sig' };
  const reel = globalThis.fetch;
  globalThis.fetch = async (entree, init) => {
    const url = String(entree && entree.url ? entree.url : entree);
    if (url === `https://${EQUIPE}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Content-Type': 'application/json' } });
    }
    return reel(entree, init);
  };
}

export function creerEnv({ configure = true } = {}) {
  return {
    DATA: new FauxR2(),
    ACCESS_TEAM_DOMAIN: configure ? EQUIPE : '',
    ACCESS_AUD: configure ? AUD : '',
  };
}

// Appelle le Worker. `auth: true` ajoute un jeton valide ; sinon on peut passer un jeton précis.
export async function appeler(env, methode, chemin, { corps, auth = false, jetonPerso, entetes = {}, type = 'application/json', origine = ORIGINE } = {}) {
  const h = { ...entetes };
  if (corps !== undefined) h['Content-Type'] = type;
  if (methode !== 'GET') h.Origin = origine;
  if (auth) h['Cf-Access-Jwt-Assertion'] = await jeton();
  if (jetonPerso) h['Cf-Access-Jwt-Assertion'] = jetonPerso;
  const requete = new Request(`${ORIGINE}${chemin}`, {
    method: methode,
    headers: h,
    body: corps === undefined ? undefined : typeof corps === 'string' ? corps : JSON.stringify(corps),
  });
  const rep = await worker.fetch(requete, env);
  const texte = await rep.text();
  let donnees = null;
  try {
    donnees = JSON.parse(texte);
  } catch {
    /* réponse sans JSON */
  }
  return { statut: rep.status, donnees, entetes: rep.headers };
}

export const FICHE_A = {
  outilId: 'outil-001',
  nom: 'Alpha',
  url: 'https://alpha.example/',
  categorie: 'Inspiration',
  famille: 'inspiration',
  description: '',
  acces: '',
  dateVerification: '',
  libre: null,
  tags: [],
};
export const FICHE_B = { ...FICHE_A, outilId: 'outil-002', nom: 'Beta', url: 'https://beta.example/', famille: 'prompts', categorie: 'Prompts' };
