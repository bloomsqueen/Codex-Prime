import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { appeler, creerEnv, installerFauxAccess, jeton, EQUIPE, AUD, FICHE_A, FICHE_B } from './helpers.js';

before(installerFauxAccess);

async function envInitialise() {
  const env = creerEnv();
  const r = await appeler(env, 'POST', '/api/ecriture/init', { corps: { fiches: [FICHE_A, FICHE_B] }, auth: true });
  assert.equal(r.statut, 201);
  return env;
}
const { outilId: _a, ...CHAMPS_A } = FICHE_A;
const lireFiches = async (env) => (await appeler(env, 'GET', '/api/outils')).donnees.fiches;
const fiche = async (env, id) => (await lireFiches(env)).find((f) => f.outilId === id);
const modifier = (env, id, version, champs, options = {}) =>
  appeler(env, 'PUT', `/api/ecriture/outils/${id}`, { corps: { versionAttendue: version, champs }, auth: true, ...options });

describe('protection', () => {
  test('sans protection configurée : toute écriture est désactivée', async () => {
    const env = creerEnv({ configure: false });
    const etat = await appeler(env, 'GET', '/api/etat');
    assert.equal(etat.donnees.ecritureConfiguree, false);
    for (const [m, c, corps] of [
      ['GET', '/api/ecriture/session'],
      ['POST', '/api/ecriture/init', { fiches: [FICHE_A] }],
      ['PUT', '/api/ecriture/outils/outil-001', { versionAttendue: 1, champs: CHAMPS_A }],
      ['POST', '/api/ecriture/outils/outil-001/commentaires', { texte: 'x' }],
    ]) {
      const r = await appeler(env, m, c, { corps, auth: true });
      assert.equal(r.statut, 403, `${m} ${c}`);
      assert.equal(r.donnees.erreur, 'ecriture_desactivee');
    }
    assert.equal(env.DATA.cles().length, 0);
  });

  test('configurée mais sans jeton : 401', async () => {
    const env = creerEnv();
    const r = await appeler(env, 'POST', '/api/ecriture/init', { corps: { fiches: [FICHE_A] } });
    assert.equal(r.statut, 401);
    assert.equal(env.DATA.cles().length, 0);
  });

  test('jetons refusés : mauvaise audience, mauvais émetteur, expiré, mauvaise signature, clé inconnue', async () => {
    const env = creerEnv();
    const mauvais = [
      await jeton({ aud: 'b'.repeat(32) }),
      await jeton({ iss: 'https://autre.cloudflareaccess.com' }),
      await jeton({ exp: Math.floor(Date.now() / 1000) - 3600 }),
      await jeton({ pirate: true }),
      await jeton({ kid: 'inconnue' }),
      'pas.un.jeton',
      'abc',
    ];
    for (const j of mauvais) {
      const r = await appeler(env, 'POST', '/api/ecriture/init', { corps: { fiches: [FICHE_A] }, jetonPerso: j });
      assert.equal(r.statut, 401, j.slice(0, 20));
    }
    assert.equal(env.DATA.cles().length, 0);
  });

  test('origine étrangère et type de contenu non JSON refusés', async () => {
    const env = creerEnv();
    const a = await appeler(env, 'POST', '/api/ecriture/init', { corps: { fiches: [FICHE_A] }, auth: true, origine: 'https://pirate.test' });
    assert.equal(a.statut, 403);
    const b = await appeler(env, 'POST', '/api/ecriture/init', { corps: 'fiches=1', auth: true, type: 'application/x-www-form-urlencoded' });
    assert.equal(b.statut, 415);
    assert.equal(env.DATA.cles().length, 0);
  });

  test('un jeton valide donne accès', async () => {
    const r = await appeler(creerEnv(), 'GET', '/api/ecriture/session', { auth: true });
    assert.equal(r.statut, 200);
  });

  test('équipe mal formée : écriture désactivée', async () => {
    const env = creerEnv();
    env.ACCESS_TEAM_DOMAIN = 'evil.example.com';
    const r = await appeler(env, 'GET', '/api/ecriture/session', { auth: true });
    assert.equal(r.statut, 403);
  });
});

describe('initialisation unique', () => {
  test('crée les fiches et la marque, puis refuse de recommencer sans rien écraser', async () => {
    const env = await envInitialise();
    assert.deepEqual(env.DATA.cles(), ['meta/init.json', 'outils/outil-001.json', 'outils/outil-002.json']);
    assert.equal((await appeler(env, 'GET', '/api/etat')).donnees.initialise, true);
    await modifier(env, 'outil-001', 1, { ...CHAMPS_A, nom: 'Alpha modifié' });
    const avant = JSON.stringify(await lireFiches(env));
    const encore = await appeler(env, 'POST', '/api/ecriture/init', { corps: { fiches: [{ ...FICHE_A, nom: 'ÉCRASE' }] }, auth: true });
    assert.equal(encore.statut, 409);
    assert.equal(JSON.stringify(await lireFiches(env)), avant);
  });

  test('si une fiche existe déjà (marque absente), elle est ignorée et conservée', async () => {
    const env = creerEnv();
    await env.DATA.put('outils/outil-001.json', JSON.stringify({ ...FICHE_A, version: 7, nom: 'Déjà là' }));
    const r = await appeler(env, 'POST', '/api/ecriture/init', { corps: { fiches: [FICHE_A, FICHE_B] }, auth: true });
    assert.deepEqual(r.donnees, { crees: 1, ignores: 1 });
    const a = await fiche(env, 'outil-001');
    assert.equal(a.nom, 'Déjà là');
    assert.equal(a.version, 7);
  });

  test('une fiche invalide dans la liste : rien n\'est écrit', async () => {
    const env = creerEnv();
    const r = await appeler(env, 'POST', '/api/ecriture/init', { corps: { fiches: [FICHE_A, { ...FICHE_B, url: 'javascript:alert(1)' }] }, auth: true });
    assert.equal(r.statut, 400);
    assert.equal(env.DATA.cles().length, 0);
  });

  test('identifiants en double refusés', async () => {
    const env = creerEnv();
    const r = await appeler(env, 'POST', '/api/ecriture/init', { corps: { fiches: [FICHE_A, FICHE_A] }, auth: true });
    assert.equal(r.statut, 400);
  });
});

describe('modification de chaque champ, types conservés', () => {
  const cas = [
    ['nom', 'Nouveau nom'],
    ['url', 'http://nouveau.example/chemin?x=1'],
    ['categorie', 'Autre catégorie'],
    ['famille', 'outils-ia'],
    ['description', 'Une description\navec deux lignes.'],
    ['acces', 'Gratuit'],
    ['dateVerification', '2026-09-18'],
    ['libre', true],
    ['libre', false],
    ['tags', ['ia', 'code', 'ia']],
  ];
  for (const [champ, valeur] of cas) {
    test(`${champ} = ${JSON.stringify(valeur)}`, async () => {
      const env = await envInitialise();
      const r = await modifier(env, 'outil-001', 1, { ...CHAMPS_A, [champ]: valeur });
      assert.equal(r.statut, 200, JSON.stringify(r.donnees));
      const relu = await fiche(env, 'outil-001'); // « recharger »
      const attendu = champ === 'tags' ? ['ia', 'code'] : champ === 'url' ? new URL(valeur).href : valeur;
      assert.deepEqual(relu[champ], attendu);
      assert.equal(typeof relu[champ], typeof attendu);
      assert.equal(relu.version, 2);
      assert.equal(relu.outilId, 'outil-001');
      // les autres champs sont intacts
      for (const k of Object.keys(CHAMPS_A)) if (k !== champ) assert.deepEqual(relu[k], CHAMPS_A[k], k);
    });
  }

  test('B n\'est pas touchée par la modification de A', async () => {
    const env = await envInitialise();
    const avant = JSON.stringify(await fiche(env, 'outil-002'));
    await modifier(env, 'outil-001', 1, { ...CHAMPS_A, nom: 'Changé' });
    assert.equal(JSON.stringify(await fiche(env, 'outil-002')), avant);
  });
});

describe('commentaires', () => {
  test('commenter A sans toucher B ; un objet R2 par commentaire', async () => {
    const env = await envInitialise();
    const avantB = JSON.stringify(await fiche(env, 'outil-002'));
    const c1 = await appeler(env, 'POST', '/api/ecriture/outils/outil-001/commentaires', { corps: { texte: 'Premier', auteur: 'Zoé' }, auth: true });
    const c2 = await appeler(env, 'POST', '/api/ecriture/outils/outil-001/commentaires', { corps: { texte: 'Second' }, auth: true });
    assert.equal(c1.statut, 201);
    assert.equal(c2.statut, 201);
    const cles = env.DATA.cles().filter((c) => c.startsWith('commentaires/'));
    assert.equal(cles.length, 2);
    assert.ok(cles.every((c) => c.startsWith('commentaires/outil-001/') && c.endsWith('.json')));
    const liste = (await appeler(env, 'GET', '/api/commentaires')).donnees.commentaires;
    assert.equal(liste.length, 2);
    assert.ok(liste.every((c) => c.outilId === 'outil-001'));
    assert.equal(JSON.stringify(await fiche(env, 'outil-002')), avantB);
  });

  test('changer l\'URL de A ne fait pas perdre ses commentaires', async () => {
    const env = await envInitialise();
    await appeler(env, 'POST', '/api/ecriture/outils/outil-001/commentaires', { corps: { texte: 'Je reste' }, auth: true });
    await modifier(env, 'outil-001', 1, { ...CHAMPS_A, url: 'https://autre-adresse.example/', nom: 'Renommé' });
    const liste = (await appeler(env, 'GET', '/api/commentaires')).donnees.commentaires;
    assert.equal(liste.length, 1);
    assert.equal(liste[0].outilId, 'outil-001');
    assert.equal(liste[0].texte, 'Je reste');
  });

  test('commentaire vide, trop long, champ inconnu, outil inconnu : refusés', async () => {
    const env = await envInitialise();
    const avant = env.DATA.cles().length;
    const essais = [
      [{ texte: '' }, 400],
      [{ texte: '   ' }, 400],
      [{ texte: 'x'.repeat(1001) }, 400],
      [{ texte: 'ok', auteur: 'a'.repeat(41) }, 400],
      [{ texte: 'ok', extra: 1 }, 400],
      [{ texte: 12 }, 400],
    ];
    for (const [corps, statut] of essais) {
      const r = await appeler(env, 'POST', '/api/ecriture/outils/outil-001/commentaires', { corps, auth: true });
      assert.equal(r.statut, statut, JSON.stringify(corps).slice(0, 30));
    }
    assert.equal((await appeler(env, 'POST', '/api/ecriture/outils/outil-099/commentaires', { corps: { texte: 'ok' }, auth: true })).statut, 404);
    assert.equal((await appeler(env, 'POST', '/api/ecriture/outils/pas-un-id/commentaires', { corps: { texte: 'ok' }, auth: true })).statut, 400);
    assert.equal(env.DATA.cles().length, avant);
  });

  test('le HTML saisi est stocké tel quel, jamais interprété par le Worker', async () => {
    const env = await envInitialise();
    const r = await appeler(env, 'POST', '/api/ecriture/outils/outil-001/commentaires', { corps: { texte: '<img src=x onerror=alert(1)>' }, auth: true });
    assert.equal(r.donnees.commentaire.texte, '<img src=x onerror=alert(1)>');
    assert.match(r.entetes.get('Content-Type'), /application\/json/);
    assert.equal(r.entetes.get('X-Content-Type-Options'), 'nosniff');
  });
});

describe('validation : envois invalides refusés, rien n\'est écrit', () => {
  const invalides = [
    ['url javascript:', { url: 'javascript:alert(1)' }],
    ['url data:', { url: 'data:text/html,<b>x</b>' }],
    ['url ftp:', { url: 'ftp://exemple.fr/x' }],
    ['url sans protocole', { url: 'exemple.fr' }],
    ['url avec mot de passe', { url: 'https://user:pass@exemple.fr/' }],
    ['url trop longue', { url: 'https://exemple.fr/' + 'a'.repeat(300) }],
    ['url vide', { url: '' }],
    ['nom vide', { nom: '   ' }],
    ['nom trop long', { nom: 'n'.repeat(81) }],
    ['nom non texte', { nom: 42 }],
    ['nom avec caractère de contrôle', { nom: 'a\u0000b' }],
    ['catégorie trop longue', { categorie: 'c'.repeat(81) }],
    ['famille inconnue', { famille: 'autre' }],
    ['description trop longue', { description: 'd'.repeat(401) }],
    ['accès trop long', { acces: 'a'.repeat(201) }],
    ['date mal formée', { dateVerification: '18/09/2026' }],
    ['date inexistante', { dateVerification: '2026-02-30' }],
    ['booléen en texte', { libre: 'oui' }],
    ['liste en texte', { tags: 'a,b' }],
    ['liste trop longue', { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ['élément de liste trop long', { tags: ['x'.repeat(31)] }],
    ['élément de liste non texte', { tags: [1] }],
    ['champ inconnu', { prix: 5 }],
    ['champ interdit (version)', { version: 99 }],
    ['champ interdit (outilId)', { outilId: 'outil-009' }],
  ];
  for (const [nom, patch] of invalides) {
    test(nom, async () => {
      const env = await envInitialise();
      const avant = JSON.stringify(await lireFiches(env));
      const r = await modifier(env, 'outil-001', 1, { ...CHAMPS_A, ...patch });
      assert.equal(r.statut, 400, JSON.stringify(r.donnees));
      assert.ok(r.donnees.erreurs && Object.keys(r.donnees.erreurs).length > 0);
      assert.equal(JSON.stringify(await lireFiches(env)), avant);
    });
  }

  test('corps absent, JSON cassé, trop gros, version absente', async () => {
    const env = await envInitialise();
    assert.equal((await appeler(env, 'PUT', '/api/ecriture/outils/outil-001', { corps: '{pas du json', auth: true })).statut, 400);
    assert.equal((await appeler(env, 'PUT', '/api/ecriture/outils/outil-001', { corps: JSON.stringify({ champs: CHAMPS_A, plus: 'x'.repeat(30000) }), auth: true })).statut, 413);
    assert.equal((await appeler(env, 'PUT', '/api/ecriture/outils/outil-001', { corps: { champs: CHAMPS_A }, auth: true })).statut, 400);
    assert.equal((await appeler(env, 'PUT', '/api/ecriture/outils/outil-001', { corps: { versionAttendue: 'a', champs: CHAMPS_A }, auth: true })).statut, 400);
  });

  test('fiche inconnue : 404', async () => {
    const env = await envInitialise();
    assert.equal((await modifier(env, 'outil-099', 1, CHAMPS_A)).statut, 404);
  });

  test('l\'identifiant d\'outil ne peut pas être modifié', async () => {
    const env = await envInitialise();
    const r = await modifier(env, 'outil-001', 1, { ...CHAMPS_A, nom: 'Ok' });
    assert.equal(r.donnees.fiche.outilId, 'outil-001');
    assert.deepEqual(env.DATA.cles().filter((c) => c.startsWith('outils/')), ['outils/outil-001.json', 'outils/outil-002.json']);
  });
});

describe('conflit d\'édition', () => {
  test('version périmée : 409, rien n\'est écrasé, la version actuelle est renvoyée', async () => {
    const env = await envInitialise();
    const premiere = await modifier(env, 'outil-001', 1, { ...CHAMPS_A, nom: 'Version de Léa' });
    assert.equal(premiere.statut, 200);
    const perimee = await modifier(env, 'outil-001', 1, { ...CHAMPS_A, nom: 'Version de Sam' });
    assert.equal(perimee.statut, 409);
    assert.equal(perimee.donnees.erreur, 'conflit');
    assert.equal(perimee.donnees.actuelle.nom, 'Version de Léa');
    assert.equal(perimee.donnees.actuelle.version, 2);
    assert.equal((await fiche(env, 'outil-001')).nom, 'Version de Léa');
    // avec la bonne version, ça passe
    assert.equal((await modifier(env, 'outil-001', 2, { ...CHAMPS_A, nom: 'Version de Sam' })).statut, 200);
  });

  test('écriture simultanée : une seule gagne (écriture conditionnelle)', async () => {
    const env = await envInitialise();
    env.DATA.delai = 15; // les deux requêtes lisent la version 1 avant que l'une n'écrive
    const [x, y] = await Promise.all([
      modifier(env, 'outil-001', 1, { ...CHAMPS_A, nom: 'X' }),
      modifier(env, 'outil-001', 1, { ...CHAMPS_A, nom: 'Y' }),
    ]);
    env.DATA.delai = 0;
    assert.deepEqual([x.statut, y.statut].sort(), [200, 409]);
    const f = await fiche(env, 'outil-001');
    assert.equal(f.version, 2); // une seule écriture a eu lieu
    assert.ok(['X', 'Y'].includes(f.nom));
  });
});

describe('lecture publique', () => {
  test('lecture sans connexion ; schéma exposé ; pagination par 40', async () => {
    const env = creerEnv();
    const fiches = Array.from({ length: 100 }, (_, i) => ({ ...FICHE_A, outilId: `outil-${String(i + 1).padStart(3, '0')}`, nom: `Outil ${i + 1}` }));
    assert.equal((await appeler(env, 'POST', '/api/ecriture/init', { corps: { fiches }, auth: true })).statut, 201);
    const s = await appeler(env, 'GET', '/api/schema');
    assert.equal(s.statut, 200);
    assert.ok(s.donnees.champs.find((c) => c.nom === 'famille').choix.length === 7);
    let curseur = null;
    const tailles = [];
    do {
      const r = await appeler(env, 'GET', `/api/outils${curseur ? `?curseur=${curseur}` : ''}`);
      tailles.push(r.donnees.fiches.length);
      curseur = r.donnees.suivant;
    } while (curseur);
    assert.deepEqual(tailles, [40, 40, 20]);
  });

  test('routes inconnues, méthodes non prévues', async () => {
    const env = creerEnv();
    assert.equal((await appeler(env, 'GET', '/api/nimporte')).statut, 404);
    assert.equal((await appeler(env, 'DELETE', '/api/ecriture/outils/outil-001', { auth: true })).statut, 405);
    assert.equal((await appeler(env, 'POST', '/api/outils', { corps: {} })).statut, 404);
  });
});
