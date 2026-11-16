// Les mêmes protections, mais avec le simulateur R2 de Cloudflare (Miniflare, via wrangler)
// à la place du faux R2 en mémoire. C'est une simulation locale : elle ne remplace pas un essai chez Cloudflare.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import worker from '../index.js';
import { installerFauxAccess, jeton, AUD, EQUIPE, ORIGINE, FICHE_A, FICHE_B } from './helpers.js';

let proxy;
let compteur = 0;

// Isole chaque test dans son propre « dossier » du bucket simulé.
function bucketIsole() {
  const p = `essai-${Date.now()}-${++compteur}/`;
  const r = proxy.env.DATA;
  return {
    head: (k) => r.head(p + k),
    get: (k) => r.get(p + k),
    put: (k, v, o) => r.put(p + k, v, o),
    list: async ({ prefix = '', limit, cursor } = {}) => {
      const l = await r.list({ prefix: p + prefix, limit, cursor });
      return { objects: l.objects.map((o) => ({ ...o, key: o.key.slice(p.length) })), truncated: l.truncated, cursor: l.cursor };
    },
  };
}
const env = () => ({ DATA: bucketIsole(), ACCESS_TEAM_DOMAIN: EQUIPE, ACCESS_AUD: AUD });

async function appeler(e, methode, chemin, corps) {
  const h = { 'Cf-Access-Jwt-Assertion': await jeton() };
  if (corps !== undefined) h['Content-Type'] = 'application/json';
  if (methode !== 'GET') h.Origin = ORIGINE;
  const rep = await worker.fetch(new Request(`${ORIGINE}${chemin}`, { method: methode, headers: h, body: corps === undefined ? undefined : JSON.stringify(corps) }), e);
  return { statut: rep.status, donnees: await rep.json().catch(() => null) };
}
const { outilId: _a, ...CHAMPS_A } = FICHE_A;

before(async () => {
  await installerFauxAccess();
  proxy = await getPlatformProxy({ configPath: path.resolve(import.meta.dirname, '../../wrangler.jsonc'), persist: false });
});
after(async () => { await proxy.dispose(); });

test('R2 simulé : initialisation en création seule, jamais d\'écrasement', async () => {
  const e = env();
  await e.DATA.put('outils/outil-001.json', JSON.stringify({ ...FICHE_A, version: 7, nom: 'Déjà là' }));
  const r = await appeler(e, 'POST', '/api/ecriture/init', { fiches: [FICHE_A, FICHE_B] });
  assert.deepEqual(r.donnees, { crees: 1, ignores: 1 });
  const fiches = (await appeler(e, 'GET', '/api/outils')).donnees.fiches;
  assert.equal(fiches.find((f) => f.outilId === 'outil-001').nom, 'Déjà là');
  const encore = await appeler(e, 'POST', '/api/ecriture/init', { fiches: [{ ...FICHE_A, nom: 'ECRASE' }] });
  assert.equal(encore.statut, 409);
});

test('R2 simulé : modification, conflit de version, écritures simultanées', async () => {
  const e = env();
  await appeler(e, 'POST', '/api/ecriture/init', { fiches: [FICHE_A, FICHE_B] });
  const a = await appeler(e, 'PUT', '/api/ecriture/outils/outil-001', { versionAttendue: 1, champs: { ...CHAMPS_A, nom: 'Un', libre: true, tags: ['x'], dateVerification: '2026-09-18' } });
  assert.equal(a.statut, 200);
  const perime = await appeler(e, 'PUT', '/api/ecriture/outils/outil-001', { versionAttendue: 1, champs: { ...CHAMPS_A, nom: 'Deux' } });
  assert.equal(perime.statut, 409);
  assert.equal(perime.donnees.actuelle.nom, 'Un');
  const relu = (await appeler(e, 'GET', '/api/outils')).donnees.fiches.find((f) => f.outilId === 'outil-001');
  assert.equal(relu.libre, true);
  assert.deepEqual(relu.tags, ['x']);
  // vraies requêtes simultanées
  const [x, y] = await Promise.all([
    appeler(e, 'PUT', '/api/ecriture/outils/outil-002', { versionAttendue: 1, champs: { ...CHAMPS_A, nom: 'Beta X' } }),
    appeler(e, 'PUT', '/api/ecriture/outils/outil-002', { versionAttendue: 1, champs: { ...CHAMPS_A, nom: 'Beta Y' } }),
  ]);
  assert.deepEqual([x.statut, y.statut].sort(), [200, 409]);
});

test('R2 simulé : un objet par commentaire, A sans toucher B, URL changée sans perdre les commentaires', async () => {
  const e = env();
  await appeler(e, 'POST', '/api/ecriture/init', { fiches: [FICHE_A, FICHE_B] });
  const c1 = await appeler(e, 'POST', '/api/ecriture/outils/outil-001/commentaires', { texte: 'Premier', auteur: 'Zoé' });
  const c2 = await appeler(e, 'POST', '/api/ecriture/outils/outil-001/commentaires', { texte: 'Second' });
  assert.equal(c1.statut, 201);
  assert.equal(c2.statut, 201);
  await appeler(e, 'PUT', '/api/ecriture/outils/outil-001', { versionAttendue: 1, champs: { ...CHAMPS_A, url: 'https://autre.example/' } });
  const liste = (await appeler(e, 'GET', '/api/commentaires')).donnees.commentaires;
  assert.equal(liste.length, 2);
  assert.ok(liste.every((c) => c.outilId === 'outil-001'));
  const cles = (await e.DATA.list({ prefix: 'commentaires/' })).objects.map((o) => o.key);
  assert.equal(cles.length, 2);
  assert.ok(cles.every((k) => k.startsWith('commentaires/outil-001/')));
});

test('R2 simulé : lecture paginée par 40', async () => {
  const e = env();
  const fiches = Array.from({ length: 100 }, (_, i) => ({ ...FICHE_A, outilId: `outil-${String(i + 1).padStart(3, '0')}` }));
  assert.equal((await appeler(e, 'POST', '/api/ecriture/init', { fiches })).statut, 201);
  let curseur = null;
  const tailles = [];
  do {
    const r = await appeler(e, 'GET', `/api/outils${curseur ? `?curseur=${curseur}` : ''}`);
    tailles.push(r.donnees.fiches.length);
    curseur = r.donnees.suivant;
  } while (curseur);
  assert.deepEqual(tailles, [40, 40, 20]);
});
