// Page Outils : fiches modifiables et commentaires, lus et écrits via le Worker (/api).
// La page fonctionne sans ce script (liste et filtre en HTML et CSS).
// Règles : aucun secret ici, aucun innerHTML, tous les textes passent par textContent.
(function () {
  'use strict';

  var API = (document.currentScript && document.currentScript.dataset.api) || '/api';
  var zone = document.querySelector('.filtrable');
  if (!zone) return;

  var lignes = new Map(); // outilId -> <tr>
  var fiches = new Map(); // outilId -> fiche enregistrée
  var commentaires = new Map(); // outilId -> [commentaire]
  var ouverts = new Set(); // commentaires dépliés
  var libelles = {}; // libellés du filtre, sans le nombre
  var etat = null;
  var schema = null;
  var statut = document.getElementById('etat-api');
  var zoneInit = document.getElementById('zone-init');

  var DEFAUT = { description: '', acces: '', dateVerification: '', libre: null, tags: [] };

  // ---------------------------------------------------------------- outils

  function el(balise, attrs) {
    var n = document.createElement(balise);
    var a = attrs || {};
    Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v === false || v === null || v === undefined) return;
      if (k === 'texte') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var enfants = [].concat(arguments[i]);
      for (var j = 0; j < enfants.length; j++) if (enfants[j] !== null && enfants[j] !== undefined) n.append(enfants[j]);
    }
    return n;
  }

  function dire(message, lien) {
    statut.replaceChildren(message);
    if (lien) statut.append(' ', el('a', { href: lien.href, texte: lien.texte }));
  }

  async function appel(methode, chemin, corps) {
    var options = { method: methode, credentials: 'same-origin', headers: {} };
    if (corps !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(corps);
    }
    // Une redirection vers la page de connexion d'Access ne doit pas être suivie par fetch.
    if (chemin.indexOf('/ecriture') === 0) options.redirect = 'manual';
    var rep;
    try {
      rep = await fetch(API + chemin, options);
    } catch (e) {
      return { statut: 0, donnees: null };
    }
    if (rep.type === 'opaqueredirect') return { statut: 401, donnees: { erreur: 'non_authentifie' } };
    var donnees = null;
    try {
      donnees = await rep.json();
    } catch (e) {
      donnees = null;
    }
    return { statut: rep.status, donnees: donnees };
  }

  async function toutCharger(chemin, cle) {
    var tout = [];
    var curseur = null;
    do {
      var r = await appel('GET', chemin + (curseur ? '?curseur=' + encodeURIComponent(curseur) : ''));
      if (r.statut !== 200 || !r.donnees) throw new Error('lecture impossible');
      tout = tout.concat(r.donnees[cle]);
      curseur = r.donnees.suivant;
    } while (curseur);
    return tout;
  }

  function urlSure(url) {
    try {
      var u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch (e) {
      return null;
    }
  }

  function domaine(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  function dateLongue(iso) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', { dateStyle: 'long', timeZone: 'UTC' });
  }

  function dateHeure(iso) {
    return new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'long' });
  }

  // ---------------------------------------------------------------- lecture de la liste HTML (graine)

  function ficheDepuisLigne(tr) {
    var lien = tr.querySelector('th a.nom');
    var extra = {};
    try {
      extra = JSON.parse(tr.dataset.champs || '{}');
    } catch (e) {
      extra = {};
    }
    return Object.assign(
      {
        outilId: tr.dataset.outilId,
        nom: lien.textContent.trim(),
        url: lien.getAttribute('href'),
        categorie: tr.querySelector('.categorie').textContent.trim(),
        famille: tr.dataset.cat,
      },
      DEFAUT,
      extra,
    );
  }

  // ---------------------------------------------------------------- affichage

  function peutEcrire() {
    return Boolean(etat && etat.initialise && etat.ecritureConfiguree && schema);
  }

  function infos(f) {
    var items = [];
    if (f.acces) items.push('Accès : ' + f.acces);
    if (f.dateVerification) items.push('Vérifié le ' + dateLongue(f.dateVerification));
    if (f.libre === true) items.push('Code ouvert : oui');
    if (f.libre === false) items.push('Code ouvert : non');
    if (f.tags && f.tags.length) items.push('Mots-clés : ' + f.tags.join(', '));
    if (!items.length) return null;
    return el('ul', { class: 'infos' }, items.map(function (t) { return el('li', { texte: t }); }));
  }

  function blocCommentaires(id) {
    var liste = commentaires.get(id) || [];
    var d = el('details', { class: 'coms', 'data-outil': id });
    if (ouverts.has(id)) d.open = true;
    d.addEventListener('toggle', function () {
      if (d.open) ouverts.add(id);
      else ouverts.delete(id);
    });
    d.append(el('summary', { texte: 'Commentaires (' + liste.length + ')' }));
    if (!liste.length) {
      d.append(el('p', { class: 'meta', texte: "Aucun commentaire pour l'instant." }));
    } else {
      d.append(
        el('ul', { class: 'liste-coms' }, liste.map(function (c) {
          var qui = (c.auteur ? c.auteur + ' · ' : '') + dateHeure(c.creeLe);
          return el('li', null, el('p', { class: 'com-texte', texte: c.texte }), el('p', { class: 'meta', texte: qui }));
        })),
      );
    }
    return d;
  }

  function bouton(id, action, texte, nom) {
    var actif = peutEcrire() && (action === 'commentaire' || fiches.has(id));
    return el(
      'button',
      {
        type: 'button',
        class: 'button petit',
        'data-action': action,
        'aria-disabled': actif ? null : 'true',
        onclick: function () {
          if (!actif) return expliquerBlocage(id);
          if (action === 'fiche') ouvrirFiche(id);
          else ouvrirCommentaire(id);
        },
      },
      texte,
      el('span', { class: 'visually-hidden', texte: ' : ' + nom }),
    );
  }

  function rendreLigne(id) {
    var tr = lignes.get(id);
    var f = fiches.get(id) || ficheDepuisLigne(tr);
    tr.dataset.cat = f.famille;
    var sure = urlSure(f.url);
    tr.querySelector('th').replaceChildren(
      el('a', { class: 'nom', href: sure, texte: f.nom }),
      el('span', { class: 'domaine', texte: domaine(f.url) }),
    );
    tr.querySelector('td').replaceChildren(
      el('span', { class: 'categorie', texte: f.categorie }),
      f.description ? el('p', { class: 'description', texte: f.description }) : null,
      infos(f),
      blocCommentaires(id),
      el('div', { class: 'actions' }, bouton(id, 'fiche', 'Modifier la fiche', f.nom), bouton(id, 'commentaire', 'Ajouter un commentaire', f.nom)),
    );
  }

  function toutRendre() {
    lignes.forEach(function (tr, id) { rendreLigne(id); });
    recompter();
  }

  function recompter() {
    var n = {};
    lignes.forEach(function (tr) { n[tr.dataset.cat] = (n[tr.dataset.cat] || 0) + 1; });
    document.querySelectorAll('.filtre label').forEach(function (l) {
      var cle = l.querySelector('input').id.replace(/^f-/, '');
      var total = cle === 'toutes' ? lignes.size : n[cle] || 0;
      l.lastChild.textContent = libelles[cle] + ' (' + total + ')';
    });
  }

  // ---------------------------------------------------------------- accès en écriture

  function expliquerBlocage() {
    if (!etat) return dire('Les fiches sont indisponibles pour le moment.');
    if (!etat.ecritureConfiguree) return dire("La modification est désactivée : la protection de l'accès n'est pas encore configurée.");
    if (!etat.initialise) return dire("Les fiches ne sont pas encore enregistrées : elles doivent d'abord être initialisées.");
    dire('Cette fiche ne peut pas être modifiée pour le moment.');
  }

  async function exigerConnexion() {
    var r = await appel('GET', '/ecriture/session');
    if (r.statut === 200 && r.donnees && r.donnees.ok) return true;
    if (r.statut === 403) dire("La modification est désactivée : la protection de l'accès n'est pas configurée.");
    else if (r.statut === 0) dire("Le service n'est pas joignable. Réessayez plus tard.");
    else dire('Connexion nécessaire pour modifier.', { href: API + '/ecriture/connexion', texte: 'Se connecter' });
    return false;
  }

  // ---------------------------------------------------------------- formulaires

  function champ(def, valeur, prefixe) {
    var id = prefixe + '-' + def.nom;
    var aide = id + '-aide';
    var erreur = id + '-err';
    var attrs = { id: id, name: def.nom, 'aria-describedby': aide + ' ' + erreur, required: def.obligatoire ? true : null };
    var saisie;
    var lire;

    if (def.type === 'texte-long' || def.type === 'liste') {
      saisie = el('textarea', Object.assign(attrs, { rows: def.type === 'liste' ? 3 : 4, maxlength: def.max || null }));
      saisie.value = def.type === 'liste' ? (valeur || []).join('\n') : valeur || '';
      lire = def.type === 'liste'
        ? function () { return saisie.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); }
        : function () { return saisie.value; };
    } else if (def.type === 'choix') {
      saisie = el('select', attrs, def.choix.map(function (c) { return el('option', { value: c.valeur, texte: c.libelle }); }));
      saisie.value = valeur;
      lire = function () { return saisie.value; };
    } else if (def.type === 'booleen') {
      saisie = el('select', attrs,
        el('option', { value: '', texte: 'Non renseigné' }),
        el('option', { value: 'true', texte: 'Oui' }),
        el('option', { value: 'false', texte: 'Non' }),
      );
      saisie.value = valeur === true ? 'true' : valeur === false ? 'false' : '';
      lire = function () { return saisie.value === '' ? null : saisie.value === 'true'; };
    } else {
      var type = def.type === 'url' ? 'url' : def.type === 'date' ? 'date' : 'text';
      saisie = el('input', Object.assign(attrs, { type: type, maxlength: def.max || null, autocomplete: 'off' }));
      saisie.value = valeur || '';
      lire = function () { return saisie.value; };
    }

    var indications = [];
    if (def.type === 'liste') indications.push('Un mot-clé par ligne, ' + def.maxElements + ' au plus.');
    if (def.max) indications.push(def.max + ' caractères au plus.');
    if (def.type === 'date') indications.push('Facultatif.');
    var racine = el('div', { class: 'field' },
      el('label', { for: id, texte: def.libelle }, def.obligatoire ? el('span', { class: 'req', texte: ' (obligatoire)' }) : null),
      el('p', { class: 'hint', id: aide, texte: indications.join(' ') }),
      saisie,
      el('p', { class: 'erreur-champ', id: erreur }),
    );
    return { racine: racine, saisie: saisie, lire: lire, nom: def.nom, erreur: erreur };
  }

  function marquerErreurs(champs, erreurs, alerte) {
    var premier = null;
    var resume = [];
    champs.forEach(function (c) {
      var message = erreurs[c.nom];
      var zoneErreur = document.getElementById(c.erreur);
      zoneErreur.textContent = message ? 'Erreur : ' + message : '';
      if (message) {
        c.saisie.setAttribute('aria-invalid', 'true');
        resume.push(c.nom + ' : ' + message);
        if (!premier) premier = c.saisie;
      } else {
        c.saisie.removeAttribute('aria-invalid');
      }
    });
    var autres = Object.keys(erreurs).filter(function (k) { return !champs.some(function (c) { return c.nom === k; }); });
    alerte.textContent = resume.length || autres.length
      ? "Rien n'a été enregistré. " + (resume.length ? 'Corrigez les champs signalés.' : erreurs[autres[0]])
      : '';
    if (premier) premier.focus();
  }

  function fenetre(titre, corps) {
    var d = el('dialog', { class: 'fenetre', 'aria-labelledby': 'fenetre-titre' });
    d.append(el('h2', { id: 'fenetre-titre', texte: titre }), corps);
    d.addEventListener('close', function () { d.remove(); });
    document.body.append(d);
    d.showModal();
    return d;
  }

  function ouvrirFiche(id) {
    if (typeof HTMLDialogElement === 'undefined') return dire("Ce navigateur ne permet pas d'ouvrir le formulaire.");
    exigerConnexion().then(function (ok) {
      if (!ok) return;
      var f = fiches.get(id);
      var version = f.version;
      var alerte = el('p', { class: 'alerte', role: 'alert' });
      var liens = el('p', { class: 'meta' });
      var champs = [];
      var zoneChamps = el('div');
      var enregistrer = el('button', { type: 'submit', class: 'button petit', texte: 'Enregistrer' });
      var annuler = el('button', { type: 'button', class: 'button petit secondaire', texte: 'Annuler' });
      var conflit = el('p');

      function remplir(source) {
        champs = schema.champs.map(function (def) { return champ(def, source[def.nom], 'fiche'); });
        zoneChamps.replaceChildren.apply(zoneChamps, champs.map(function (c) { return c.racine; }));
      }
      remplir(f);

      var form = el('form', { class: 'form', novalidate: true }, alerte, conflit, zoneChamps, el('div', { class: 'actions' }, enregistrer, annuler), liens);
      var d = fenetre('Modifier la fiche : ' + f.nom, form);
      annuler.addEventListener('click', function () { d.close(); });

      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        enregistrer.setAttribute('aria-disabled', 'true');
        conflit.replaceChildren();
        var valeurs = {};
        champs.forEach(function (c) { valeurs[c.nom] = c.lire(); });
        var r = await appel('PUT', '/ecriture/outils/' + encodeURIComponent(id), { versionAttendue: version, champs: valeurs });
        enregistrer.removeAttribute('aria-disabled');
        if (r.statut === 200) {
          fiches.set(id, r.donnees.fiche);
          rendreLigne(id);
          recompter();
          d.close();
          dire('Fiche « ' + r.donnees.fiche.nom + ' » enregistrée.');
          var b = lignes.get(id).querySelector('[data-action="fiche"]');
          if (b) b.focus();
        } else if (r.statut === 400 && r.donnees && r.donnees.erreurs) {
          marquerErreurs(champs, r.donnees.erreurs, alerte);
        } else if (r.statut === 409 && r.donnees && r.donnees.erreur === 'conflit') {
          alerte.textContent = "Cette fiche a été modifiée par quelqu'un d'autre depuis son ouverture. Rien n'a été écrasé.";
          var actuelle = r.donnees.actuelle;
          conflit.replaceChildren(
            el('button', {
              type: 'button',
              class: 'button petit',
              texte: 'Charger la version actuelle (vos changements seront perdus)',
              onclick: function () {
                fiches.set(id, actuelle);
                version = actuelle.version;
                remplir(actuelle);
                rendreLigne(id);
                recompter();
                alerte.textContent = 'Version actuelle chargée. Modifiez-la puis enregistrez.';
                conflit.replaceChildren();
              },
            }),
          );
        } else if (r.statut === 401 || r.statut === 403) {
          alerte.textContent = 'Votre connexion a expiré ou vous n\'avez pas le droit de modifier.';
          liens.replaceChildren(el('a', { href: API + '/ecriture/connexion', texte: 'Se connecter' }));
        } else if (r.statut === 404) {
          alerte.textContent = 'Cette fiche est introuvable.';
        } else {
          alerte.textContent = "L'enregistrement a échoué. Rien n'a été modifié. Réessayez plus tard.";
        }
      });
    });
  }

  function ouvrirCommentaire(id) {
    if (typeof HTMLDialogElement === 'undefined') return dire("Ce navigateur ne permet pas d'ouvrir le formulaire.");
    exigerConnexion().then(function (ok) {
      if (!ok) return;
      var f = fiches.get(id) || ficheDepuisLigne(lignes.get(id));
      var alerte = el('p', { class: 'alerte', role: 'alert' });
      var liens = el('p', { class: 'meta' });
      var champs = schema.commentaire.map(function (def) { return champ(def, '', 'com'); });
      var envoyer = el('button', { type: 'submit', class: 'button petit', texte: 'Publier le commentaire' });
      var annuler = el('button', { type: 'button', class: 'button petit secondaire', texte: 'Annuler' });
      var form = el('form', { class: 'form', novalidate: true },
        el('p', { class: 'meta', texte: 'Ne mettez pas d\'information personnelle (adresse, téléphone…). Le commentaire sera visible par tout le monde.' }),
        alerte, champs.map(function (c) { return c.racine; }), el('div', { class: 'actions' }, envoyer, annuler), liens);
      var d = fenetre('Ajouter un commentaire : ' + f.nom, form);
      annuler.addEventListener('click', function () { d.close(); });

      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        envoyer.setAttribute('aria-disabled', 'true');
        var valeurs = {};
        champs.forEach(function (c) { valeurs[c.nom] = c.lire(); });
        var r = await appel('POST', '/ecriture/outils/' + encodeURIComponent(id) + '/commentaires', valeurs);
        envoyer.removeAttribute('aria-disabled');
        if (r.statut === 201) {
          var liste = commentaires.get(id) || [];
          liste.push(r.donnees.commentaire);
          commentaires.set(id, liste);
          ouverts.add(id);
          rendreLigne(id);
          d.close();
          dire('Commentaire ajouté à « ' + f.nom + ' ».');
          var b = lignes.get(id).querySelector('[data-action="commentaire"]');
          if (b) b.focus();
        } else if (r.statut === 400 && r.donnees && r.donnees.erreurs) {
          marquerErreurs(champs, r.donnees.erreurs, alerte);
        } else if (r.statut === 401 || r.statut === 403) {
          alerte.textContent = 'Votre connexion a expiré ou vous n\'avez pas le droit de commenter.';
          liens.replaceChildren(el('a', { href: API + '/ecriture/connexion', texte: 'Se connecter' }));
        } else if (r.statut === 404) {
          alerte.textContent = 'Cette fiche est introuvable.';
        } else if (r.statut === 409) {
          alerte.textContent = (r.donnees && r.donnees.message) || 'Impossible d\'ajouter ce commentaire.';
        } else {
          alerte.textContent = "L'envoi a échoué. Rien n'a été enregistré. Réessayez plus tard.";
        }
      });
    });
  }

  // ---------------------------------------------------------------- chargement

  async function charger() {
    var resultats = await Promise.all([toutCharger('/outils', 'fiches'), toutCharger('/commentaires', 'commentaires')]);
    fiches.clear();
    resultats[0].forEach(function (f) { fiches.set(f.outilId, f); });
    commentaires.clear();
    resultats[1].forEach(function (c) {
      if (!commentaires.has(c.outilId)) commentaires.set(c.outilId, []);
      commentaires.get(c.outilId).push(c);
    });
    commentaires.forEach(function (liste) { liste.sort(function (a, b) { return a.creeLe < b.creeLe ? -1 : 1; }); });
  }

  function proposerInitialisation() {
    zoneInit.hidden = false;
    zoneInit.replaceChildren(
      el('p', { texte: "Les fiches ne sont pas encore enregistrées. À faire une seule fois : elles sont créées d'après la liste ci-dessous. Les fiches déjà enregistrées ne sont jamais écrasées." }),
      el('button', {
        type: 'button',
        class: 'button petit',
        texte: 'Initialiser les fiches depuis la liste',
        onclick: async function () {
          if (!(await exigerConnexion())) return;
          var liste = [];
          lignes.forEach(function (tr) { liste.push(ficheDepuisLigne(tr)); });
          var r = await appel('POST', '/ecriture/init', { fiches: liste });
          if (r.statut === 201 || r.statut === 409) {
            dire(r.statut === 201 ? 'Fiches initialisées : ' + r.donnees.crees + ' créées, ' + r.donnees.ignores + ' déjà présentes.' : 'Les fiches étaient déjà initialisées.');
            zoneInit.hidden = true;
            await demarrer(true);
          } else {
            dire((r.donnees && r.donnees.message) || "L'initialisation a échoué : rien n'a été écrit.");
          }
        },
      }),
    );
  }

  async function demarrer(relance) {
    if (!relance) {
      document.querySelectorAll('.filtre label').forEach(function (l) {
        var cle = l.querySelector('input').id.replace(/^f-/, '');
        libelles[cle] = l.lastChild.textContent.replace(/\s*\(\d+\)\s*$/, '');
      });
      document.querySelectorAll('tbody tr[data-outil-id]').forEach(function (tr) { lignes.set(tr.dataset.outilId, tr); });
      dire('Chargement des fiches…');
    }
    var e = await appel('GET', '/etat');
    var s = e.statut === 200 ? await appel('GET', '/schema') : null;
    if (e.statut !== 200 || !e.donnees || !s || s.statut !== 200 || !s.donnees) {
      etat = null;
      schema = null;
      dire('Les fiches enregistrées sont indisponibles pour le moment : la liste de base est affichée, sans modification possible.');
      toutRendre();
      return;
    }
    etat = e.donnees;
    schema = s.donnees;
    try {
      if (etat.initialise) {
        await charger();
        dire(fiches.size + ' fiches chargées.' + (etat.ecritureConfiguree ? '' : " La modification est désactivée : la protection de l'accès n'est pas configurée."));
      } else if (etat.ecritureConfiguree) {
        dire("Les fiches ne sont pas encore enregistrées : la liste de la page est affichée.");
        proposerInitialisation();
      } else {
        dire("La modification est désactivée : la protection de l'accès n'est pas configurée. La liste de la page est affichée.");
      }
    } catch (err) {
      etat.initialise = false;
      dire('Les fiches enregistrées sont indisponibles pour le moment : la liste de base est affichée, sans modification possible.');
    }
    toutRendre();
  }

  demarrer(false);
})();
