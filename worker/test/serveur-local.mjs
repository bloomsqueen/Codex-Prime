// Essai local complet, sans compte Cloudflare : sert le site et le Worker sur une seule adresse.
//   cd worker && npm run essai-local            (puis ouvrir http://127.0.0.1:8100/outils.html)
//   cd worker && npm run essai-local -- 8100 non   (sans protection : la modification doit rester désactivée)
//
// ATTENTION : c'est une SIMULATION. Le stockage est un faux R2 en mémoire (tout est perdu à l'arrêt)
// et la connexion est un faux Access : /__connexion vous « connecte », /__deconnexion vous déconnecte.
// Ne sert qu'à voir et tester la page. Rien ici ne tourne sur Cloudflare.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { creerEnv, installerFauxAccess, jeton } from './helpers.js';
import worker from '../index.js';

const RACINE = path.resolve(import.meta.dirname, '../..');
const port = Number(process.argv[2] || 8100);
const configure = process.argv[3] !== 'non';
await installerFauxAccess();
const env = creerEnv({ configure });
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    if (url.pathname === '/__connexion') {
      res.writeHead(302, { 'Set-Cookie': 'TESTAUTH=1; Path=/; SameSite=Lax', Location: '/outils.html' });
      return res.end();
    }
    if (url.pathname === '/__deconnexion') {
      res.writeHead(302, { 'Set-Cookie': 'TESTAUTH=; Path=/; Max-Age=0', Location: '/outils.html' });
      return res.end();
    }
    // inspection et réglages pour les tests automatisés
    if (url.pathname === '/__etat') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(Object.fromEntries([...env.DATA.objets].map(([k, v]) => [k, JSON.parse(v.texte)]))));
    }
    if (url.pathname === '/__delai') {
      env.DATA.delai = Number(url.searchParams.get('ms') || 0);
      return res.end('ok');
    }

    if (url.pathname.startsWith('/api/')) {
      const connecte = /(^|; )TESTAUTH=1/.test(req.headers.cookie || '');
      const entetes = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (k !== 'cf-access-jwt-assertion') entetes.set(k, String(v));
      if (url.pathname.startsWith('/api/ecriture')) {
        if (!connecte) {
          // Comme Access : une personne non connectée est renvoyée vers la page de connexion.
          res.writeHead(302, { Location: '/__connexion' });
          return res.end();
        }
        entetes.set('Cf-Access-Jwt-Assertion', await jeton());
      }
      const corps = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(await req.toArray());
      const rep = await worker.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: entetes, body: corps }), env);
      res.writeHead(rep.status, Object.fromEntries(rep.headers));
      return res.end(Buffer.from(await rep.arrayBuffer()));
    }

    const f = path.join(RACINE, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!f.startsWith(RACINE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      return res.end('404');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`Essai local : http://127.0.0.1:${port}/outils.html (${configure ? 'protection simulée' : 'SANS protection'})`);
    console.log('Connexion simulée : /__connexion — déconnexion : /__deconnexion — données en mémoire seulement.');
  });
