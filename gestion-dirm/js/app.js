import { CONFIG } from "./config.js";
import { echapper as e, rendreMarkdown } from "./markdown.js";
import * as mod from "./modele.js";

const $ = (id) => document.getElementById(id);
let modele = null; // index du document (voir modele.js)
let themeId = 0;
let dialogue = null; // contexte du formulaire ouvert
let ouvreur = null; // élément qui a ouvert la fenêtre, pour lui rendre le focus

/* ======================================================================
   Connexion à Grist
   ====================================================================== */

function chargerScript(src) {
  return new Promise((resoudre, rejeter) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resoudre;
    s.onerror = () => rejeter(new Error(`Le script de Grist est introuvable : ${src}`));
    document.head.appendChild(s);
  });
}

const avecDelai = (promesse, ms, message) =>
  Promise.race([promesse, new Promise((_, rejeter) => setTimeout(() => rejeter(new Error(message)), ms))]);

async function recharger() {
  const jeux = await avecDelai(
    Promise.all(CONFIG.tables.map((t) => window.grist.docApi.fetchTable(t))),
    20000,
    "Grist ne répond pas. Vérifiez que le widget a l’accès complet au document."
  );
  modele = mod.construireModele(Object.fromEntries(CONFIG.tables.map((t, i) => [t, jeux[i]])));
}

async function appliquer(actions) {
  await window.grist.docApi.applyUserActions(actions);
  await recharger();
}

/* ======================================================================
   Messages
   ====================================================================== */

function annoncer(texte) {
  $("messages").innerHTML = `<div class="fr-alert fr-alert--success fr-alert--sm"><p>${e(texte)}</p></div>`;
}

function erreur(err) {
  console.error(err);
  $("erreurs").innerHTML = `<div class="fr-alert fr-alert--error"><h2 class="fr-alert__title">Une erreur s’est produite</h2><p>${e(err?.message ?? String(err))}</p></div>`;
}

function effacerMessages() {
  $("messages").innerHTML = "";
  $("erreurs").innerHTML = "";
}

/* ======================================================================
   Gabarits communs
   ====================================================================== */

const md = (texte) => (texte ? rendreMarkdown(texte, "fr-text--sm") : `<p class="fr-text--sm w-vide">Non renseigné</p>`);
const formatJour = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const dateHtml = (s) => {
  const iso = mod.jourDepuisEpoch(s);
  return iso ? `<time datetime="${iso}">${formatJour.format(new Date(`${iso}T00:00:00`))}</time>` : `<span class="w-vide">Non précisée</span>`;
};

/** Préfixe des identifiants quand on dessine la maintenance : les mêmes éléments existent aussi dans les fiches. */
let prefixeId = "";
function avecPrefixe(prefixe, fn) {
  const avant = prefixeId;
  prefixeId = prefixe;
  try {
    return fn();
  } finally {
    prefixeId = avant;
  }
}

function bouton(action, texte, table, id, nom, extra = "") {
  return (
    `<button type="button" class="fr-btn fr-btn--sm fr-btn--tertiary" data-action="${action}" data-table="${table}" data-id="${id}" ` +
    `data-cle="${prefixeId}${action}-${table}-${id}" aria-label="${e(texte)} ${e(nom)}" ${extra}>${texte}</button>`
  );
}

function boutonCreer(table, texte) {
  return `<button type="button" class="fr-btn fr-btn--sm fr-btn--secondary" data-action="creer" data-table="${table}" data-id="0" data-cle="${prefixeId}creer-${table}-0">${texte}</button>`;
}

function boutonsOrdre(table, ligne, nom) {
  const groupe = mod.trier(mod.groupeOrdre(modele, table, ligne));
  const rang = groupe.findIndex((x) => x.id === ligne.id);
  return (
    bouton("monter", "Monter", table, ligne.id, `« ${nom} »`, rang <= 0 ? "disabled" : "") +
    bouton("descendre", "Descendre", table, ligne.id, `« ${nom} »`, rang < 0 || rang >= groupe.length - 1 ? "disabled" : "")
  );
}

function interrupteur(table, colonne, ligne, coche, nom, libelle) {
  const idc = `tg-${prefixeId}${table}-${colonne}-${ligne}`;
  return (
    `<label class="w-sw" for="${idc}"><input type="checkbox" class="w-sw__input" id="${idc}" data-toggle="${table}.${colonne}" data-id="${ligne}" data-cle="${idc}" ${coche ? "checked" : ""}>` +
    `<span class="w-sw__piste" aria-hidden="true"></span><span class="w-sw__texte">${libelle}<span class="w-vh"> : ${e(nom)}</span></span></label>`
  );
}

/** Menu « Plus d’actions » : les actions rares (supprimer…) ne sont pas alignées avec les autres boutons. */
function menuActions(libelle, classe, nom, ...boutons) {
  return `<details class="w-plus"><summary class="fr-btn ${classe} fr-btn--sm">${libelle}<span class="w-vh"> : ${e(nom)}</span></summary><div class="w-plus__liste">${boutons.join("")}</div></details>`;
}

const menuPlus = (nom, ...boutons) => menuActions("Plus d’actions", "fr-btn--tertiary", nom, ...boutons);

function etiquettes(textes) {
  if (!textes.length) return "";
  return `<ul class="fr-tags-group">${textes.map((t) => `<li><p class="fr-tag fr-tag--sm">${e(t)}</p></li>`).join("")}</ul>`;
}

function lienExterne(url, texte) {
  return /^https?:\/\//i.test(url ?? "")
    ? `<a class="fr-link" href="${e(url)}" target="_blank" rel="noopener noreferrer" title="${e(texte)} - nouvelle fenêtre">${e(texte)}</a>`
    : e(texte);
}

/** Lignes dépliées : mémorisées pour rester ouvertes quand l’écran est redessiné. */
const lignesOuvertes = new Set();

function etatVisible(raisons) {
  return raisons.length
    ? `<span class="fr-badge fr-badge--sm fr-badge--no-icon">Non visible</span>`
    : `<span class="fr-badge fr-badge--sm fr-badge--no-icon fr-badge--success">Visible</span>`;
}

const raisonsHtml = (raisons) => (raisons.length ? `<p class="fr-text--sm w-meta">Non visible au public : ${e(raisons.join(", "))}.</p>` : "");

/** Ligne repliable : titre (bouton), pastilles d’état et interrupteur en tête ; détail et actions dans le panneau. */
function ligneRepliable(cle, { titre, meta = "", etat = "", detail }) {
  const ouverte = lignesOuvertes.has(cle);
  return (
    `<li class="w-lig" id="${cle}"><div class="w-lig__tete">` +
    `<button type="button" class="w-lig__titre" data-ligne="${cle}" aria-expanded="${ouverte}" aria-controls="lig-${cle}"><span class="w-lig__chevron" aria-hidden="true"></span>` +
    `<span class="w-lig__nom"><span class="w-nom">${titre}</span>${meta ? `<span class="w-lig__meta">${meta}</span>` : ""}</span></button>` +
    `<div class="w-lig__etat">${etat}</div></div>` +
    `<div class="w-lig__detail" id="lig-${cle}"${ouverte ? "" : " hidden"}>${detail}</div></li>`
  );
}

function basculerLigne(cle, ouvrir) {
  const bouton = document.querySelector(`button[data-ligne="${CSS.escape(cle)}"]`);
  const detail = $(`lig-${cle}`);
  if (!bouton || !detail) return null;
  const ouvre = ouvrir ?? bouton.getAttribute("aria-expanded") !== "true";
  bouton.setAttribute("aria-expanded", String(ouvre));
  detail.hidden = !ouvre;
  if (ouvre) lignesOuvertes.add(cle);
  else lignesOuvertes.delete(cle);
  return bouton;
}

/** Après un ajout : la nouvelle ligne s’affiche dépliée. */
function ouvrirNouvelle(table, id) {
  const prefixe = { Panorama: "pano", Appels_a_projets: "appel", Montage_financier: "montage", Fiches_detaillees: "fiche", Financements: "fin" }[table];
  if (prefixe && Number.isInteger(id) && id > 0) lignesOuvertes.add(`${prefixe}-${id}`);
}

/* ======================================================================
   Les six parties de la fiche
   ====================================================================== */

function partiePerimetre(F) {
  const t = F.theme;
  const sous = F.sousThemes
    .map(
      (s, i) =>
        `<li class="w-ligne"><span class="w-ligne__texte"><strong>2.${i + 1}</strong> ${e(s.Titre)}</span><span class="w-actions">` +
        boutonsOrdre("Sous_themes", s, s.Titre) + bouton("editer", "Modifier", "Sous_themes", s.id, `« ${s.Titre} »`) + menuPlus(s.Titre, bouton("supprimer", "Supprimer", "Sous_themes", s.id, `« ${s.Titre} »`)) + `</span></li>`
    )
    .join("");
  return (
    `<section id="perimetre" aria-labelledby="h-perimetre" class="w-partie"><h3 class="fr-h5" id="h-perimetre">Identification du besoin</h3>` +
    `<div class="w-bloc">${md(t.Description)}<p class="fr-text--sm"><strong>Sigles utiles :</strong> ${t.Sigles_utiles ? e(t.Sigles_utiles) : `<span class="w-vide">Non renseignés</span>`}</p>` +
    `<div class="w-actions">${boutonsOrdre("Themes", t, t.Nom)}${bouton("editer", "Modifier le thème", "Themes", t.id, `« ${t.Nom} »`)}</div></div>` +
    `<h4 class="fr-h6">Sous-thèmes du panorama</h4>` +
    (sous ? `<ol class="w-liste">${sous}</ol>` : `<p class="fr-text--sm w-vide">Aucun sous-thème.</p>`) +
    `<div class="w-actions">${boutonCreer("Sous_themes", "Ajouter un sous-thème")}</div></section>`
  );
}

function partieBesoins(F) {
  const lignesPanorama = [...F.parSousTheme.values()].flat().concat(F.sansSousTheme);
  const items = F.besoins
    .map((b) => {
      const liees = lignesPanorama.filter((p) => p.Besoins.includes(b.id));
      const detail = liees.length
        ? `<details class="w-details"><summary>${liees.length} ligne${liees.length > 1 ? "s" : ""} de panorama liée${liees.length > 1 ? "s" : ""}</summary><ul>${liees
            .map((p) => `<li>${e(mod.nomAffiche(p, modele))}</li>`)
            .join("")}</ul></details>`
        : `<p class="fr-text--xs w-vide">Aucune ligne de panorama n’est liée à ce besoin : il ne proposera aucun financement.</p>`;
      return (
        `<li class="w-ligne w-ligne--haut"><div class="w-ligne__texte"><strong>${e(b.Libelle)}</strong>${detail}</div><span class="w-actions">` +
        boutonsOrdre("Besoins", b, b.Libelle) + bouton("editer", "Modifier", "Besoins", b.id, `« ${b.Libelle} »`) + menuPlus(b.Libelle, bouton("supprimer", "Supprimer", "Besoins", b.id, `« ${b.Libelle} »`)) + `</span></li>`
      );
    })
    .join("");
  return (
    `<section id="besoins" aria-labelledby="h-besoins" class="w-partie"><h3 class="fr-h5" id="h-besoins">Besoins</h3>` +
    `<p class="fr-hint-text">Ils correspondent au tableau « Quel financement selon le besoin ? » des fiches : ce sont les besoins que l’usager coche à l’étape 2. Le lien d’un besoin avec les financements se règle dans chaque ligne du panorama.</p>` +
    (items ? `<ol class="w-liste">${items}</ol>` : `<p class="fr-text--sm w-vide">Aucun besoin.</p>`) +
    `<div class="w-actions">${boutonCreer("Besoins", "Ajouter un besoin")}</div></section>`
  );
}

function lignePanorama(p) {
  const fin = modele.Financements.get(p.Financement);
  const nom = mod.nomAffiche(p, modele);
  const themesFin = fin ? mod.themesDuFinancement(modele, fin.id) : [];
  const besoins = p.Besoins.map((id) => modele.Besoins.get(id)?.Libelle).filter(Boolean);
  const fiche = p.Fiche_detaillee ? modele.Fiches_detaillees.get(p.Fiche_detaillee) : null;
  const raisons = mod.raisonsPanorama(p, modele);
  const meta = [];
  if (fin && p.Dispositif && p.Dispositif !== mod.libelleFinancement(fin)) meta.push(`Financement : ${e(mod.libelleFinancement(fin))}`);
  meta.push(fin ? `utilisé dans ${themesFin.length} thème${themesFin.length > 1 ? "s" : ""}` : "aucun financement");
  const detail =
    `<dl class="w-def"><dt>À utiliser pour</dt><dd>${md(p.A_utiliser_pour)}</dd><dt>Fonctionnement</dt><dd>${md(p.Fonctionnement)}</dd><dt>Accès et situation</dt><dd>${md(p.Acces)}</dd></dl>` +
    (besoins.length ? `<p class="fr-text--sm w-meta">Besoins liés :</p>${etiquettes(besoins)}` : `<p class="fr-text--sm w-meta">Aucun besoin lié.</p>`) +
    (fin ? `<p class="fr-text--sm w-bloc">Financement : <strong>${e(mod.libelleFinancement(fin))}</strong></p><p>${interrupteur("Financements", "Actif", fin.id, fin.Actif, mod.libelleFinancement(fin), "Financement visible")}</p>` : "") +
    `<p class="fr-text--sm">${fiche ? `Fiche détaillée : <a class="fr-link fr-text--sm" href="#fiche-${fiche.id}">${e(fiche.Titre || "sans titre")}</a>` : "Aucune fiche détaillée"}</p>` +
    raisonsHtml(raisons) +
    `<div class="w-actions">` + boutonsOrdre("Panorama", p, nom) +
    bouton("editer", "Modifier", "Panorama", p.id, `la ligne « ${nom} »`) +
    menuPlus(
      nom,
      ...(fin ? [bouton("editer", "Modifier le financement", "Financements", fin.id, `« ${mod.libelleFinancement(fin)} »`)] : []),
      bouton("supprimer", "Supprimer la ligne", "Panorama", p.id, `la ligne « ${nom} »`)
    ) + `</div>`;
  return ligneRepliable(`pano-${p.id}`, {
    titre: e(nom),
    meta: meta.join(" · "),
    etat: etatVisible(raisons) + interrupteur("Panorama", "Publie", p.id, p.Publie, nom, "Publié"),
    detail,
  });
}

const listeLignes = (lignes) => `<ul class="w-lignes">${lignes.join("")}</ul>`;

function partiePanorama(F) {
  let html = `<section id="panorama" aria-labelledby="h-panorama" class="w-partie"><h3 class="fr-h5" id="h-panorama">Panorama</h3>`;
  F.sousThemes.forEach((s, i) => {
    const l = F.parSousTheme.get(s.id) ?? [];
    html += `<h4 class="fr-h6" id="h-pano-${s.id}">2.${i + 1} ${e(s.Titre)}</h4>`;
    html += l.length ? listeLignes(l.map(lignePanorama)) : `<p class="fr-text--sm w-vide">Aucune ligne dans ce sous-thème.</p>`;
    html += `<div class="w-actions"><button type="button" class="fr-btn fr-btn--sm fr-btn--secondary" data-action="ajouter-ligne" data-table="Panorama" data-id="${s.id}" data-cle="ajouter-Panorama-${s.id}" aria-label="Ajouter une ligne au sous-thème « ${e(s.Titre)} »">Ajouter une ligne</button></div>`;
  });
  if (F.sansSousTheme.length) {
    html += `<h4 class="fr-h6" id="h-pano-sans">Sans sous-thème</h4>` + listeLignes(F.sansSousTheme.map(lignePanorama));
  }
  return html + `</section>`;
}

const RANG_STATUT = { "Clôture proche": 0, Ouvert: 1, "Ouvert sous conditions": 1, "Au fil de l’eau": 2, "À venir": 3, Annoncé: 3, "Phase 2 réservée": 3, "Aucun appel confirmé": 4, Clos: 5 };
const VARIANTE_STATUT = { "Clôture proche": "fr-badge--warning", Ouvert: "fr-badge--success", "Ouvert sous conditions": "fr-badge--success", "Au fil de l’eau": "fr-badge--info", "À venir": "fr-badge--blue-cumulus" };

function htmlAlerteAnciens(anciens, aujourdhui, ancre) {
  const [ay, am, aj] = mod.ilYaUnAn(aujourdhui).split("-");
  return anciens.length
    ? `<div class="fr-alert fr-alert--warning fr-alert--sm w-bloc"><p>${anciens.length > 1 ? `${anciens.length} appels sont clos` : "1 appel est clos"} depuis plus d’un an (clôture avant le ${aj}/${am}/${ay}) et encore publié${anciens.length > 1 ? "s" : ""}. Dépubliez-${anciens.length > 1 ? "les" : "le"} avec l’interrupteur « Publié » s’il${anciens.length > 1 ? "s n’ont" : " n’a"} plus d’intérêt.</p><ul>${anciens.map((a) => `<li><a class="fr-link" href="#${ancre}-${a.id}">${e(a.Nom)}</a></li>`).join("")}</ul></div>`
    : "";
}

/** Ligne repliable d’un appel. `idsBesoins` : dans la fiche d’un thème, on ne montre que les besoins de ce thème. */
function ligneAppel(a, statut, aujourdhui, { cle, idsBesoins = null }) {
  const fin = modele.Financements.get(a.Financement);
  const besoins = mod.besoinsDeduitsAppel(modele, a).filter((id) => !idsBesoins || idsBesoins.has(id)).map((id) => modele.Besoins.get(id)?.Libelle).filter(Boolean);
  const themes = a.Themes.map((id) => modele.Themes.get(id)?.Code).filter(Boolean);
  const raisons = mod.raisonsAppel(a, modele);
  const ancien = mod.clotureAncienne(a, aujourdhui);
  const cloture = mod.jourDepuisEpoch(a.Cloture) ? `Clôture : ${dateHtml(a.Cloture)}${a.Heure_cloture ? ` (${e(a.Heure_cloture)})` : ""}` : "Sans date de clôture";
  const detail =
    (fin ? `<p class="fr-text--sm">Financement : <strong>${e(mod.libelleFinancement(fin))}</strong></p>` : `<p class="fr-text--sm w-vide">Aucun financement lié.</p>`) +
    `<p class="fr-text--sm">Ouverture : ${dateHtml(a.Ouverture)} · Clôture : ${dateHtml(a.Cloture)}${a.Heure_cloture ? ` · ${e(a.Heure_cloture)}` : ""}</p>` +
    (a.Lien ? `<p class="fr-text--sm">${lienExterne(a.Lien, "Page de l’appel")}</p>` : "") +
    (a.Texte ? md(a.Texte) : "") +
    (besoins.length ? `<p class="fr-text--sm w-meta">${idsBesoins ? "Besoins concernés dans ce thème" : "Besoins concernés"} (déduits des lignes du panorama qui ont ce financement) :</p>${etiquettes(besoins)}` : "") +
    (themes.length ? `<p class="fr-text--sm w-meta">Thèmes : ${e(themes.join(", "))}</p>` : "") +
    raisonsHtml(raisons) +
    `<div class="w-actions">${bouton("editer", "Modifier", "Appels_a_projets", a.id, `« ${a.Nom} »`)}${menuPlus(a.Nom, bouton("supprimer", "Supprimer", "Appels_a_projets", a.id, `« ${a.Nom} »`))}</div>`;
  return ligneRepliable(cle, {
    titre: e(a.Nom),
    meta: cloture,
    etat:
      `<span class="fr-badge fr-badge--sm fr-badge--no-icon ${VARIANTE_STATUT[statut] ?? ""}">${e(statut)}</span>` +
      (ancien ? `<span class="fr-badge fr-badge--sm fr-badge--warning fr-badge--no-icon">Clos depuis plus d’un an</span>` : "") +
      etatVisible(raisons) + interrupteur("Appels_a_projets", "Publie", a.id, a.Publie, a.Nom, "Publié"),
    detail,
  });
}

const trierAppels = (liste) =>
  [...liste].sort((x, y) => (RANG_STATUT[x.statut] ?? 2) - (RANG_STATUT[y.statut] ?? 2) || (mod.jourDepuisEpoch(x.a.Cloture) || "9").localeCompare(mod.jourDepuisEpoch(y.a.Cloture) || "9"));

function partieAppels(F) {
  const aujourdhui = mod.jourLocal();
  const idsBesoins = new Set(F.besoins.map((b) => b.id));
  const avecStatut = trierAppels(F.appels.map((a) => ({ a, statut: mod.statutAppel(a, aujourdhui, CONFIG.seuilClotureJours) })));
  const lignes = avecStatut.map(({ a, statut }) => ligneAppel(a, statut, aujourdhui, { cle: `appel-${a.id}`, idsBesoins }));
  const anciens = avecStatut.filter(({ a }) => mod.clotureAncienne(a, aujourdhui)).map(({ a }) => a);
  const alerteAnciens = htmlAlerteAnciens(anciens, aujourdhui, "appel");
  return (
    `<section id="appels" aria-labelledby="h-appels" class="w-partie"><h3 class="fr-h5" id="h-appels">Appels à projets</h3>` +
    `<p class="fr-hint-text">Les appels des fiches de ce thème, par statut. Le statut se calcule d’après les dates.</p>` + alerteAnciens +
    (lignes.length ? listeLignes(lignes) : `<p class="fr-text--sm w-vide">Aucun appel à projets pour ce thème.</p>`) +
    `<div class="w-actions"><button type="button" class="fr-btn fr-btn--sm fr-btn--secondary" data-action="ajouter-appel" data-table="Appels_a_projets" data-id="0" data-cle="ajouter-Appels_a_projets-0">Ajouter un appel à projets</button></div>` +
    `</section>`
  );
}

function partieFiches(F) {
  const themeCourant = F.theme.id;
  const items = F.fichesIds
    .map((id) => {
      const f = modele.Fiches_detaillees.get(id);
      if (!f) return "";
      const titre = f.Titre || "sans titre";
      const lignes = [...modele.Panorama.values()].filter((p) => p.Fiche_detaillee === id);
      const ici = lignes.filter((p) => p.Theme === themeCourant);
      const ailleurs = lignes.length - ici.length;
      const rub = [
        ["Type de soutien", f.Type_de_soutien], ["Bénéficiaires", f.Beneficiaires], ["Dépenses", f.Depenses],
        ["Comment y accéder ?", f.Comment_y_acceder], ["Calendrier", f.Precision_calendrier], ["Niveau d’aide", f.Niveau_d_aide],
        ["Dans quel cas le mobiliser ?", f.Dans_quel_cas], ["Point de vigilance", f.Point_de_vigilance], ["Exemple de projet financé", f.Exemple_de_projet], ["Lien", f.Liens],
      ]
        .map(([t, v]) => `<dt>${t}</dt><dd>${md(v)}</dd>`)
        .join("");
      const raisons = f.Panorama_visible ? [] : ["aucune ligne de panorama visible ne la désigne"];
      return ligneRepliable(`fiche-${id}`, {
        titre: e(f.Titre || "(sans titre)"),
        meta: `Désignée par ${ici.length} ligne${ici.length > 1 ? "s" : ""} de ce thème${ailleurs ? ` et ${ailleurs} d’autres thèmes` : ""}`,
        etat: etatVisible(raisons),
        detail:
          raisonsHtml(raisons) + `<dl class="w-def">${rub}</dl>` +
          `<div class="w-actions">${bouton("editer", "Modifier", "Fiches_detaillees", id, `la fiche « ${titre} »`)}${menuPlus(titre, bouton("supprimer", "Supprimer", "Fiches_detaillees", id, `la fiche « ${titre} »`))}</div>`,
      });
    })
    .filter(Boolean);
  return (
    `<section id="fiches" aria-labelledby="h-fiches" class="w-partie"><h3 class="fr-h5" id="h-fiches">Fiches détaillées</h3>` +
    `<p class="fr-hint-text">Une fiche détaillée peut être désignée par plusieurs lignes du panorama. Pour changer la fiche d’une ligne, modifiez la ligne du panorama.</p>` +
    (items.length ? listeLignes(items) : `<p class="fr-text--sm w-vide">Aucune fiche détaillée pour ce thème.</p>`) +
    `<div class="w-actions"><button type="button" class="fr-btn fr-btn--sm fr-btn--secondary" data-action="ajouter-fiche" data-table="Fiches_detaillees" data-id="0" data-cle="ajouter-Fiches_detaillees-0">Ajouter une fiche détaillée</button></div></section>`
  );
}

function partieMontage(F) {
  const items = F.montage.map((q) => {
    const fins = q.Financements.map((id) => modele.Financements.get(id)).filter(Boolean).map(mod.libelleFinancement);
    const raisons = mod.raisonsMontage(q, modele);
    const detail =
      `<dl class="w-def"><dt>Réponse</dt><dd>${md(q.Reponse)}</dd></dl>` +
      (fins.length ? `<p class="fr-text--sm w-meta">Financements cités :</p>${etiquettes(fins)}` : `<p class="fr-text--sm w-meta">Aucun financement cité.</p>`) +
      raisonsHtml(raisons) +
      `<div class="w-actions">${boutonsOrdre("Montage_financier", q, q.Question)}${bouton("editer", "Modifier", "Montage_financier", q.id, `« ${q.Question} »`)}${menuPlus(q.Question, bouton("supprimer", "Supprimer", "Montage_financier", q.id, `« ${q.Question} »`))}</div>`;
    return ligneRepliable(`montage-${q.id}`, {
      titre: e(q.Question),
      meta: `${fins.length} financement${fins.length > 1 ? "s" : ""} cité${fins.length > 1 ? "s" : ""}`,
      etat: etatVisible(raisons) + interrupteur("Montage_financier", "Publie", q.id, q.Publie, q.Question, "Publié"),
      detail,
    });
  });
  return (
    `<section id="montage" aria-labelledby="h-montage" class="w-partie"><h3 class="fr-h5" id="h-montage">Montage financier</h3>` +
    (items.length ? listeLignes(items) : `<p class="fr-text--sm w-vide">Aucune question pour ce thème.</p>`) +
    `<div class="w-actions">${boutonCreer("Montage_financier", "Ajouter une question")}</div></section>`
  );
}

const ONGLETS = [["perimetre", "Identification du besoin"], ["besoins", "Besoins"], ["panorama", "Panorama"], ["appels", "Appels à projets"], ["fiches", "Fiches détaillées"], ["montage", "Montage financier"]];
let ongletActif = "perimetre";

function fichePage(F) {
  const t = F.theme;
  const nombres = {
    besoins: F.besoins.length,
    panorama: [...F.parSousTheme.values()].flat().length + F.sansSousTheme.length,
    appels: F.appels.length,
    fiches: F.fichesIds.length,
    montage: F.montage.length,
  };
  const parties = { perimetre: partiePerimetre(F), besoins: partieBesoins(F), panorama: partiePanorama(F), appels: partieAppels(F), fiches: partieFiches(F), montage: partieMontage(F) };
  if (!ONGLETS.some(([id]) => id === ongletActif)) ongletActif = "perimetre";
  return (
    `<div class="w-entete-fiche"><div class="w-entete-fiche__titre"><h2 class="fr-h3">${e(t.Code)} · ${e(t.Nom)}</h2>` +
    (t.Publie ? "" : `<p class="fr-text--sm w-meta">Non publié : rien de ce thème n’est visible du public.</p>`) + `</div>` +
    `<div class="w-entete-fiche__etat">` + interrupteur("Themes", "Publie", t.id, t.Publie, t.Nom, "Thème publié") +
    menuActions("Actions sur la fiche", "fr-btn--secondary", t.Nom, bouton("publier-tout", "Publier toute la fiche…", "Themes", t.id, `« ${t.Nom} »`), bouton("supprimer-theme", "Supprimer la fiche et son contenu…", "Themes", t.id, `« ${t.Nom} »`)) + `</div></div>` +
    `<div class="w-onglets" role="tablist" aria-label="Parties de la fiche">` +
    ONGLETS.map(([id, libelle]) => {
      const actif = id === ongletActif;
      const n = nombres[id] !== undefined ? `<span class="w-onglet__n">${nombres[id]}</span>` : "";
      return `<button type="button" class="w-onglet" role="tab" id="tab-${id}" data-onglet="${id}" aria-controls="panneau-${id}" aria-selected="${actif}" tabindex="${actif ? 0 : -1}">${libelle}${n}</button>`;
    }).join("") + `</div>` +
    ONGLETS.map(([id]) => `<div role="tabpanel" class="w-panneau" id="panneau-${id}" aria-labelledby="tab-${id}" tabindex="0"${id === ongletActif ? "" : " hidden"}>${parties[id]}</div>`).join("")
  );
}

function choisirOnglet(id, focus = false) {
  if (!ONGLETS.some(([x]) => x === id)) return;
  ongletActif = id;
  for (const [x] of ONGLETS) {
    const tab = $(`tab-${x}`);
    const panneau = $(`panneau-${x}`);
    if (!tab || !panneau) continue;
    tab.setAttribute("aria-selected", String(x === id));
    tab.tabIndex = x === id ? 0 : -1;
    panneau.hidden = x !== id;
  }
  if (focus) $(`tab-${id}`)?.focus();
}

function fermerMenus(sauf = null) {
  document.querySelectorAll("details.w-plus[open]").forEach((d) => {
    if (!sauf || !d.contains(sauf)) d.removeAttribute("open");
  });
}

/* ======================================================================
   Affichage
   ====================================================================== */

function remplirChoixTheme() {
  const themes = mod.trier([...modele.Themes.values()]);
  $("choix-theme").innerHTML = themes.map((t) => `<option value="${t.id}">${e(t.Code)} · ${e(t.Nom)}${t.Publie ? "" : " (non publié)"}</option>`).join("");
  if (!themes.some((t) => t.id === themeId)) themeId = themes[0]?.id ?? 0;
  $("choix-theme").value = String(themeId);
}

/* ======================================================================
   Maintenance : financements, appels de tous les thèmes, organismes
   ====================================================================== */

const MTABS = [["financements", "Financements"], ["appels", "Appels à projets"], ["organismes", "Organismes"]];
let sousOnglet = "financements";
const filtres = { q: "", org: "", statut: "", theme: "", ancien: false, nonPublies: false };

const pluriel = (n, un, plusieurs) => (n > 1 ? plusieurs : un);

function ligneFinancement(f, doublons) {
  const nom = mod.libelleFinancement(f);
  const themes = mod.themesDuFinancement(modele, f.id);
  const u = mod.usagesFinancement(modele, f.id);
  const doublon = doublons.has(f.id);
  const detail =
    `<dl class="w-def"><dt>Calendrier</dt><dd>${md(f.Calendrier)}</dd></dl>` +
    `<p class="fr-text--sm w-meta">Utilisé par ${u.lignes.length} ligne${pluriel(u.lignes.length, "", "s")} de panorama, ${u.appels.length} appel${pluriel(u.appels.length, "", "s")} et ${u.questions.length} question${pluriel(u.questions.length, "", "s")} du montage financier.</p>` +
    (themes.length ? etiquettes(themes.map((t) => `${t.Code} · ${t.Nom}`)) : "") +
    (doublon ? `<p class="fr-text--sm w-meta">Doublon possible : un autre financement a le même organisme et le même nom.</p>` : "") +
    `<div class="w-actions">${bouton("editer", "Modifier", "Financements", f.id, `« ${nom} »`)}${menuPlus(nom, bouton("supprimer", "Supprimer", "Financements", f.id, `« ${nom} »`))}</div>`;
  return ligneRepliable(`fin-${f.id}`, {
    titre: e(nom),
    meta: `utilisé dans ${themes.length} thème${pluriel(themes.length, "", "s")}${themes.length ? ` (${e(themes.map((t) => t.Code).join(", "))})` : ""}`,
    etat:
      (doublon ? `<span class="fr-badge fr-badge--sm fr-badge--warning fr-badge--no-icon">Doublon possible</span>` : "") +
      (f.Actif ? `<span class="fr-badge fr-badge--sm fr-badge--no-icon fr-badge--success">Visible</span>` : `<span class="fr-badge fr-badge--sm fr-badge--no-icon">Masqué</span>`) +
      interrupteur("Financements", "Actif", f.id, f.Actif, nom, "Financement visible"),
    detail,
  });
}

function financementsFiltres() {
  const mots = mod.normaliser(filtres.q).split(" ").filter(Boolean);
  return [...modele.Financements.values()]
    .filter((f) => {
      const cible = mod.normaliser(`${mod.nomOrganisme(f)} ${f.Nom}`);
      if (!mots.every((x) => cible.includes(x))) return false;
      if (filtres.org === "0") return !f.Organisme;
      return !filtres.org || f.Organisme === Number(filtres.org);
    })
    .sort((a, b) => mod.libelleFinancement(a).localeCompare(mod.libelleFinancement(b), "fr", { numeric: true }));
}

function majListeFinancements() {
  const zone = $("mf-liste");
  if (!zone) return;
  avecPrefixe("m-", () => {
    const l = financementsFiltres();
    const doublons = mod.doublonsFinancements(modele);
    $("mf-compte").textContent = `${l.length} financement${pluriel(l.length, "", "s")} sur ${modele.Financements.size}.`;
    zone.innerHTML = l.length ? listeLignes(l.map((f) => ligneFinancement(f, doublons))) : `<p class="fr-text--sm w-vide">Aucun financement ne correspond.</p>`;
  });
}

function appelsFiltres() {
  const aujourdhui = mod.jourLocal();
  return trierAppels(
    [...modele.Appels_a_projets.values()]
      .map((a) => ({ a, statut: mod.statutAppel(a, aujourdhui, CONFIG.seuilClotureJours) }))
      .filter(({ a, statut }) => {
        if (filtres.statut && statut !== filtres.statut) return false;
        if (filtres.theme && !mod.appelDuTheme(modele, a, Number(filtres.theme))) return false;
        if (filtres.ancien && !mod.clotureAncienne(a, aujourdhui)) return false;
        return !(filtres.nonPublies && a.Publie);
      })
  );
}

function majListeAppels() {
  const zone = $("ma-liste");
  if (!zone) return;
  avecPrefixe("m-", () => {
    const aujourdhui = mod.jourLocal();
    const l = appelsFiltres();
    $("ma-compte").textContent = `${l.length} appel${pluriel(l.length, "", "s")} sur ${modele.Appels_a_projets.size}.`;
    zone.innerHTML = l.length ? listeLignes(l.map(({ a, statut }) => ligneAppel(a, statut, aujourdhui, { cle: `mappel-${a.id}` }))) : `<p class="fr-text--sm w-vide">Aucun appel ne correspond.</p>`;
  });
}

function panneauOrganismes() {
  const orgs = [...modele.Organismes.values()].sort((a, b) => (a.Nom ?? "").localeCompare(b.Nom ?? "", "fr", { numeric: true }));
  const items = orgs
    .map((o) => {
      const n = [...modele.Financements.values()].filter((f) => f.Organisme === o.id).length;
      const nom = o.Nom || "(sans nom)";
      return (
        `<li class="w-ligne"><span class="w-ligne__texte"><strong>${e(nom)}</strong> <span class="w-meta">· ${n} financement${n > 1 ? "s" : ""}</span></span><span class="w-actions">` +
        bouton("editer", "Modifier", "Organismes", o.id, `« ${nom} »`) + menuPlus(nom, bouton("supprimer", "Supprimer", "Organismes", o.id, `« ${nom} »`)) + `</span></li>`
      );
    })
    .join("");
  return (
    `<section aria-labelledby="mh-organismes"><h2 class="fr-h5" id="mh-organismes" tabindex="-1">Organismes</h2>` +
    `<p class="fr-hint-text">Les organismes financeurs (FEAMPA, Fonds vert…). Chaque financement s’y rattache dans « Modifier ». Renommer un organisme le change pour tous ses financements.</p>` +
    (items ? `<ul class="w-liste">${items}</ul>` : `<p class="fr-text--sm w-vide">Aucun organisme.</p>`) +
    `<div class="w-actions">${boutonCreer("Organismes", "Ajouter un organisme")}</div></section>`
  );
}

function rendreMaintenance() {
  const aujourdhui = mod.jourLocal();
  const option = (valeur, libelle, choisi) => `<option value="${e(valeur)}"${String(choisi) === String(valeur) ? " selected" : ""}>${e(libelle)}</option>`;
  const orgs = [...modele.Organismes.values()].sort((a, b) => (a.Nom ?? "").localeCompare(b.Nom ?? "", "fr", { numeric: true }));
  const themes = mod.trier([...modele.Themes.values()]);
  const statuts = [...new Set([...modele.Appels_a_projets.values()].map((a) => mod.statutAppel(a, aujourdhui, CONFIG.seuilClotureJours)))].sort((x, y) => (RANG_STATUT[x] ?? 2) - (RANG_STATUT[y] ?? 2));
  const nombres = { financements: modele.Financements.size, appels: modele.Appels_a_projets.size, organismes: modele.Organismes.size };
  const anciens = [...modele.Appels_a_projets.values()].filter((a) => mod.clotureAncienne(a, aujourdhui));
  const panneaux = {
    financements:
      `<section aria-labelledby="mh-financements"><h2 class="fr-h5" id="mh-financements" tabindex="-1">Financements</h2>` +
      `<p class="fr-hint-text">Tous les financements, tous thèmes confondus. Masquer un financement le fait disparaître de tous les thèmes. Pour le rattacher à un thème, ajoutez une ligne dans le panorama de ce thème.</p>` +
      `<div class="w-filtres"><div class="fr-input-group"><label class="fr-label" for="mf-q">Rechercher</label><input class="fr-input" type="search" id="mf-q" autocomplete="off" value="${e(filtres.q)}"></div>` +
      `<div class="fr-select-group"><label class="fr-label" for="mf-org">Organisme</label><select class="fr-select" id="mf-org">${option("", "Tous", filtres.org)}${option("0", "Sans organisme", filtres.org)}${orgs.map((o) => option(o.id, o.Nom || "(sans nom)", filtres.org)).join("")}</select></div></div>` +
      `<p class="fr-text--sm w-meta" id="mf-compte" role="status" aria-live="polite"></p><div id="mf-liste"></div>` +
      `<div class="w-actions">${avecPrefixe("m-", () => boutonCreer("Financements", "Ajouter un financement"))}</div></section>`,
    appels:
      `<section aria-labelledby="mh-appels"><h2 class="fr-h5" id="mh-appels" tabindex="-1">Appels à projets de tous les thèmes</h2>` +
      `<p class="fr-hint-text">Pour ajouter un appel, ouvrez la fiche du thème concerné.</p>` +
      htmlAlerteAnciens(anciens, aujourdhui, "mappel") +
      `<div class="w-filtres"><div class="fr-select-group"><label class="fr-label" for="ma-statut">Statut</label><select class="fr-select" id="ma-statut">${option("", "Tous", filtres.statut)}${statuts.map((x) => option(x, x, filtres.statut)).join("")}</select></div>` +
      `<div class="fr-select-group"><label class="fr-label" for="ma-theme">Thème</label><select class="fr-select" id="ma-theme">${option("", "Tous", filtres.theme)}${themes.map((t) => option(t.id, `${t.Code} · ${t.Nom}`, filtres.theme)).join("")}</select></div></div>` +
      `<div class="w-filtres"><div class="fr-checkbox-group fr-checkbox-group--sm"><input type="checkbox" id="ma-ancien"${filtres.ancien ? " checked" : ""}><label class="fr-label" for="ma-ancien">Clos depuis plus d’un an</label></div>` +
      `<div class="fr-checkbox-group fr-checkbox-group--sm"><input type="checkbox" id="ma-nonpub"${filtres.nonPublies ? " checked" : ""}><label class="fr-label" for="ma-nonpub">Non publiés seulement</label></div></div>` +
      `<p class="fr-text--sm w-meta" id="ma-compte" role="status" aria-live="polite"></p><div id="ma-liste"></div></section>`,
    organismes: avecPrefixe("m-", panneauOrganismes),
  };
  $("maintenance").innerHTML =
    `<div class="w-onglets" role="tablist" aria-label="Rubriques de la maintenance">` +
    MTABS.map(([id, libelle]) => `<button type="button" class="w-onglet" role="tab" id="mtab-${id}" data-mtab="${id}" aria-controls="mpanneau-${id}" aria-selected="${id === sousOnglet}" tabindex="${id === sousOnglet ? 0 : -1}">${libelle}<span class="w-onglet__n">${nombres[id]}</span></button>`).join("") +
    `</div>` +
    MTABS.map(([id]) => `<div role="tabpanel" class="w-panneau" id="mpanneau-${id}" aria-labelledby="mtab-${id}" tabindex="0"${id === sousOnglet ? "" : " hidden"}>${panneaux[id]}</div>`).join("");
  majListeFinancements();
  majListeAppels();
}

function choisirSousOnglet(id) {
  if (!MTABS.some(([x]) => x === id)) return;
  sousOnglet = id;
  for (const [x] of MTABS) {
    const tab = $(`mtab-${x}`);
    const panneau = $(`mpanneau-${x}`);
    if (!tab || !panneau) continue;
    tab.setAttribute("aria-selected", String(x === id));
    tab.tabIndex = x === id ? 0 : -1;
    panneau.hidden = x !== id;
  }
}

function choisirVue(v) {
  if (!["fiches", "maintenance"].includes(v)) return;
  for (const x of ["fiches", "maintenance"]) {
    const tab = $(`vue-${x}`);
    tab.setAttribute("aria-selected", String(x === v));
    tab.tabIndex = x === v ? 0 : -1;
    $(`vue-panneau-${x}`).hidden = x !== v;
  }
}

function rendre() {
  const y = window.scrollY;
  const focus = document.activeElement?.dataset?.cle;
  remplirChoixTheme();
  rendreMaintenance();
  const zone = $("fiche");
  if (!themeId) {
    zone.innerHTML = `<div class="fr-alert fr-alert--info"><h2 class="fr-alert__title">Aucun thème</h2><p>Utilisez « Ajouter un thème » pour commencer, ou importez les fiches.</p></div>`;
  } else {
    zone.innerHTML = fichePage(mod.fiche(modele, themeId));
  }
  zone.hidden = false;
  $("chargement").hidden = true;
  window.scrollTo(0, y);
  if (focus) document.querySelector(`[data-cle="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
}

/* ======================================================================
   Formulaires de modification
   ====================================================================== */

const texte = (col, label, extra = {}) => ({ col, label, type: "texte", ...extra });
const markdown = (col, label, extra = {}) => ({ col, label, type: "markdown", ...extra });
const reference = (col, label, options, extra = {}) => ({ col, label, type: "ref", options, ...extra });
const listeRefs = (col, label, options, extra = {}) => ({ col, label, type: "liste", options, ...extra });
const financement = (col, label, extra = {}) => ({ col, label, type: "financement", ...extra });
const AIDE_MD = "Mise en forme : **gras**, listes avec « - » en début de ligne, liens [texte](https://…).";

const optionsDe = (table, libelle, filtre = () => true) => (ligne) =>
  mod.trier([...modele[table].values()].filter((x) => filtre(x, ligne))).map((x) => ({ valeur: x.id, libelle: libelle(x) }));
const parLibelle = (a, b) => a.libelle.localeCompare(b.libelle, "fr", { numeric: true });

/** Financements cités : regroupés par organisme (puis par nom), pour les retrouver sans chercher à la main. */
const optionsFinancementsGroupes = () =>
  [...modele.Financements.values()]
    .map((f) => ({ valeur: f.id, libelle: `${f.Actif ? "" : "(masqué) "}${f.Nom || "(sans nom)"}`, groupe: mod.nomOrganisme(f) || "Sans organisme" }))
    .sort((a, b) => (a.groupe === "Sans organisme") - (b.groupe === "Sans organisme") || a.groupe.localeCompare(b.groupe, "fr", { numeric: true }) || a.libelle.localeCompare(b.libelle, "fr", { numeric: true }));

const FORMULAIRES = {
  Themes: {
    titre: (l) => `Modifier le thème ${l.Code}`,
    champs: [texte("Code", "Code du thème", { requis: true, unique: true, aide: "Identifiant court et unique, par exemple T15." }), texte("Nom", "Nom du thème", { requis: true }), markdown("Description", "Texte d’identification du besoin", { aide: AIDE_MD }), texte("Sigles_utiles", "Sigles utiles", { aide: "Format : « SIGLE : signification ; SIGLE : signification »." })],
  },
  Organismes: { titre: (l) => `Modifier l’organisme « ${l.Nom} »`, champs: [texte("Nom", "Nom de l’organisme", { requis: true, unique: true, aide: "Exemples : « FEAMPA », « Fonds vert »." })] },
  Sous_themes: { titre: () => "Modifier le sous-thème", champs: [texte("Titre", "Titre du sous-thème", { requis: true })] },
  Besoins: { titre: () => "Modifier le besoin", champs: [texte("Libelle", "Libellé du besoin", { requis: true })] },
  Financements: {
    titre: (l) => `Modifier le financement « ${mod.libelleFinancement(l)} »`,
    info: (l) => {
      const th = mod.themesDuFinancement(modele, l.id);
      return `<div class="fr-alert fr-alert--warning fr-alert--sm"><p>Ce financement est utilisé dans ${th.length} thème${th.length > 1 ? "s" : ""}${th.length ? " : " + th.map((t) => t.Code).join(", ") : ""}. Toute modification s’applique à tous ces thèmes.</p></div>`;
    },
    champs: [texte("Nom", "Nom du financement", { requis: true, aide: "Sans l’organisme. Exemple : « gestion zoosanitaire conchylicole »." }), reference("Organisme", "Organisme financeur", (l) => optionsDe("Organismes", (o) => o.Nom ?? "")(l).sort(parLibelle), { nouveau: true }), markdown("Calendrier", "Calendrier commun", { aide: AIDE_MD })],
  },
  Panorama: {
    titre: () => "Modifier la ligne du panorama",
    champs: [
      financement("Financement", "Financement", { requis: true }),
      reference("Sous_theme", "Sous-thème", optionsDe("Sous_themes", (s) => s.Titre, (s, l) => s.Theme === l.Theme), { requis: true }),
      texte("Dispositif", "Dispositif", { aide: "Nom de la ligne dans la fiche. À la création, il reprend le nom du financement choisi ; vous pouvez le modifier. Laissé vide, c’est le nom du financement qui s’affiche." }),
      reference("Fiche_detaillee", "Fiche détaillée", (l) => optionsDe("Fiches_detaillees", (f) => f.Titre || "(sans titre)")(l).sort(parLibelle)),
      listeRefs("Besoins", "Besoins pour lesquels la ligne s’affiche", optionsDe("Besoins", (b) => b.Libelle, (b, l) => b.Theme === l.Theme)),
      markdown("A_utiliser_pour", "À utiliser pour…", { aide: AIDE_MD }),
      markdown("Fonctionnement", "Fonctionnement", { aide: AIDE_MD }),
      markdown("Acces", "Accès et situation", { aide: AIDE_MD }),
    ],
  },
  Fiches_detaillees: {
    titre: (l) => `Modifier la fiche « ${l.Titre || "sans titre"} »`,
    champs: [
      texte("Titre", "Titre de la fiche", { requis: true }),
      ...[["Type_de_soutien", "Type de soutien"], ["Beneficiaires", "Bénéficiaires"], ["Depenses", "Dépenses"], ["Comment_y_acceder", "Comment y accéder ?"], ["Precision_calendrier", "Calendrier"], ["Niveau_d_aide", "Niveau d’aide"], ["Dans_quel_cas", "Dans quel cas le mobiliser ?"], ["Point_de_vigilance", "Point de vigilance"], ["Exemple_de_projet", "Exemple de projet financé"], ["Liens", "Lien"]].map(([c, l]) => markdown(c, l, { aide: AIDE_MD })),
    ],
  },
  Appels_a_projets: {
    titre: () => "Modifier l’appel à projets",
    champs: [
      texte("Nom", "Appel à projet / dispositif", { requis: true }),
      financement("Financement", "Financement (facultatif)", { facultatif: true }),
      { col: "Cloture", label: "Date de clôture (vide : au fil de l’eau)", type: "date" },
      { col: "Statut_particulier", label: "Statut", type: "choix", choix: CONFIG.statutsParticuliers, aide: "Laisser vide : le statut se calcule d’après les dates (À venir, Ouvert, Clôture proche, Clos…). À renseigner seulement si les dates ne suffisent pas." },
      markdown("Texte", "Accès / Situation", { aide: AIDE_MD }),
      { col: "Ouverture", label: "Date d’ouverture", type: "date", replie: true },
      texte("Heure_cloture", "Heure limite", { aide: "Facultatif, par exemple « 14 h ».", replie: true }),
      texte("Lien", "Lien vers la page de l’appel", { url: true, aide: "Facultatif. Rend le nom de l’appel cliquable.", replie: true }),
      listeRefs("Themes", "Thèmes où l’appel figure", optionsDe("Themes", (t) => `${t.Code} · ${t.Nom}`), { replie: true, sansOuverture: true }),
    ],
  },
  Montage_financier: {
    titre: () => "Modifier la question du montage financier",
    champs: [texte("Question", "Question", { requis: true }), markdown("Reponse", "Réponse", { aide: AIDE_MD }), listeRefs("Financements", "Financements cités", optionsFinancementsGroupes, { groupes: true })],
  },
};

const prochainOrdreDe = (table, filtre = () => true) => mod.prochainOrdre([...modele[table].values()].filter(filtre));

/** Création : mêmes champs que la modification ; `complete` ajoute ce que le formulaire ne demande pas. */
const CREATIONS = {
  Themes: {
    titre: "Ajouter un thème",
    valider: "Ajouter le thème",
    champs: FORMULAIRES.Themes.champs,
    vierge: () => ({}),
    complete: () => ({ Ordre: prochainOrdreDe("Themes"), Publie: false }),
    fait: "Thème ajouté. Il n’est pas publié : activez « Thème publié » quand il est prêt.",
    apres: (id) => {
      themeId = id;
    },
  },
  Organismes: {
    titre: "Ajouter un organisme",
    valider: "Ajouter l’organisme",
    champs: FORMULAIRES.Organismes.champs,
    vierge: () => ({}),
    complete: () => ({}),
    fait: "Organisme ajouté. Rattachez-y des financements avec « Modifier le financement ».",
  },
  Financements: {
    titre: "Ajouter un financement",
    valider: "Ajouter le financement",
    champs: FORMULAIRES.Financements.champs,
    vierge: () => ({ Organisme: 0 }),
    complete: () => ({ Actif: true }),
    verifier: () => {
      const { identiques } = mod.financementsSimilaires(modele, organismeSaisi(), $("champ-Nom").value.trim());
      return identiques.length ? [`Ce financement existe déjà (« ${mod.libelleFinancement(identiques[0])} »).`] : [];
    },
    fait: "Financement ajouté. Pour l’afficher dans un thème, ajoutez une ligne dans le panorama de ce thème.",
  },
  Sous_themes: {
    titre: "Ajouter un sous-thème",
    valider: "Ajouter le sous-thème",
    champs: FORMULAIRES.Sous_themes.champs,
    vierge: () => ({}),
    complete: () => ({ Theme: themeId, Ordre: prochainOrdreDe("Sous_themes", (x) => x.Theme === themeId) }),
    fait: "Sous-thème ajouté.",
  },
  Besoins: {
    titre: "Ajouter un besoin",
    valider: "Ajouter le besoin",
    champs: FORMULAIRES.Besoins.champs,
    vierge: () => ({}),
    complete: () => ({ Theme: themeId, Ordre: prochainOrdreDe("Besoins", (x) => x.Theme === themeId) }),
    fait: "Besoin ajouté. Liez-le aux lignes du panorama concernées (« Modifier » sur chaque ligne).",
  },
  Montage_financier: {
    titre: "Ajouter une question au montage financier",
    valider: "Ajouter la question",
    champs: FORMULAIRES.Montage_financier.champs,
    vierge: () => ({ Financements: [] }),
    complete: () => ({ Theme: themeId, Ordre: prochainOrdreDe("Montage_financier", (x) => x.Theme === themeId), Publie: false }),
    fait: "Question ajoutée. Elle n’est pas publiée : activez « Publié » quand elle est prête.",
  },
};

const valeurChamp = (f, ligne) => {
  const v = ligne[f.col];
  if (f.type === "ref" || f.type === "financement") return v || 0;
  if (f.type === "liste") return Array.isArray(v) ? v : [];
  if (f.type === "date") return mod.jourDepuisEpoch(v);
  return v ?? "";
};

/** Financements d’un organisme (« » : tous, « 0 » : sans organisme), en <option>. */
function htmlOptionsFinancements(orgId, choisi, { facultatif = false, creerFinancement = false } = {}) {
  const liste = [...modele.Financements.values()]
    .filter((x) => !orgId || (orgId === "0" ? !x.Organisme : x.Organisme === Number(orgId)))
    .sort((a, b) => mod.libelleFinancement(a).localeCompare(mod.libelleFinancement(b), "fr", { numeric: true }));
  const opt = (valeur, texte) => `<option value="${valeur}"${valeur === choisi ? " selected" : ""}>${e(texte)}</option>`;
  return (
    opt(0, facultatif ? "Aucun" : "Choisir un financement…") +
    liste.map((x) => opt(x.id, `${x.Actif ? "" : "(masqué) "}${mod.libelleFinancement(x)}`)).join("") +
    (creerFinancement ? opt(-1, "Nouveau financement…") : "")
  );
}

/** Choix en deux listes : l’organisme, puis ses financements. */
function htmlChoixFinancement(f, id, v) {
  const fin = modele.Financements.get(v);
  const orgInit = fin ? String(fin.Organisme || 0) : "";
  const orgs = [...modele.Organismes.values()].sort((a, b) => (a.Nom ?? "").localeCompare(b.Nom ?? "", "fr", { numeric: true }));
  const aide = f.aide ? `<span class="fr-hint-text">${e(f.aide)}</span>` : "";
  const requis = f.requis ? ` <span class="w-requis">(obligatoire)</span>` : "";
  const optOrg = (valeur, texte) => `<option value="${valeur}"${orgInit === String(valeur) ? " selected" : ""}>${e(texte)}</option>`;
  return (
    `<fieldset class="w-fieldset"><legend class="fr-label">${e(f.label)}${requis}${aide}</legend>` +
    `<div class="fr-select-group"><label class="fr-label" for="${id}-org">Organisme</label><select class="fr-select" id="${id}-org" data-picker="${f.col}">${optOrg("", "Tous les organismes")}${optOrg("0", "Sans organisme")}${orgs.map((o) => optOrg(o.id, o.Nom || "(sans nom)")).join("")}</select></div>` +
    `<div class="fr-select-group"><label class="fr-label" for="${id}">Financement</label><select class="fr-select" id="${id}" data-financement="${f.col}" data-facultatif="${f.facultatif ? 1 : 0}" data-creer="${f.creerFinancement ? 1 : 0}">${htmlOptionsFinancements(orgInit, v, f)}</select></div></fieldset>`
  );
}

function majChoixFinancement(col) {
  const sel = $(`champ-${col}`);
  const org = $(`champ-${col}-org`).value;
  sel.innerHTML = htmlOptionsFinancements(org, Number(sel.value) || 0, { facultatif: sel.dataset.facultatif === "1", creerFinancement: sel.dataset.creer === "1" });
}

/** Filtre une liste de cases à cocher groupées (organismes) d’après le texte saisi. */
function filtrerListe(idListe, saisie) {
  const mots = mod.normaliser(saisie).split(" ").filter(Boolean);
  for (const groupe of $(idListe).querySelectorAll(".w-groupe")) {
    let visibles = 0;
    for (const c of groupe.querySelectorAll(".fr-checkbox-group")) {
      const ok = mots.every((m) => c.dataset.texte.includes(m));
      c.hidden = !ok;
      if (ok) visibles++;
    }
    groupe.hidden = !visibles;
  }
}

const nouveauHtml = (id) =>
  `<div class="fr-input-group"><label class="fr-label" for="${id}-nouveau">Ou créer un nouvel organisme<span class="fr-hint-text">Laissez vide pour garder le choix ci-dessus. Un organisme déjà existant est réutilisé.</span></label><input class="fr-input" type="text" id="${id}-nouveau" autocomplete="off"></div>`;

/** Identifiant de l’organisme de ce nom : l’existant s’il y en a un, sinon il est créé. */
async function organismeParNom(nom) {
  const n = mod.normaliser(nom);
  const existant = [...modele.Organismes.values()].find((o) => mod.normaliser(o.Nom) === n);
  if (existant) return existant.id;
  const rep = await window.grist.docApi.applyUserActions([["AddRecord", "Organismes", null, { Nom: nom }]]);
  await recharger();
  let id = Number(rep?.retValues?.[0]);
  if (!(id > 0)) id = Math.max(0, ...[...modele.Organismes.values()].filter((o) => o.Nom === nom).map((o) => o.id));
  if (!id) throw new Error("L’organisme a été créé, mais son identifiant est introuvable. Rechargez les données et choisissez-le dans la liste.");
  return id;
}

/** Nom de l’organisme en cours de saisie : le nouveau s’il est tapé, sinon celui de la liste. */
const organismeSaisi = () => $("champ-Organisme-nouveau")?.value.trim() || modele.Organismes.get(Number($("champ-Organisme")?.value))?.Nom || "";

/** Champs d’un formulaire : ceux marqués `replie` vont sous « Plus d’informations (facultatif) ». */
function champsHtml(champs, ligne, { ouvrirSiRempli = false } = {}) {
  const html = champs.filter((f) => !f.replie).map((f) => champHtml(f, ligne)).join("");
  const replies = champs.filter((f) => f.replie);
  if (!replies.length) return html;
  const rempli = ouvrirSiRempli && replies.some((f) => !f.sansOuverture && (Array.isArray(valeurChamp(f, ligne)) ? valeurChamp(f, ligne).length : Boolean(valeurChamp(f, ligne))));
  return html + `<details class="w-infos"${rempli ? " open" : ""}><summary>Plus d’informations (facultatif)</summary><div class="w-infos__contenu">${replies.map((f) => champHtml(f, ligne)).join("")}</div></details>`;
}

function champHtml(f, ligne) {
  const id = `champ-${f.col}`;
  const v = valeurChamp(f, ligne);
  const aide = f.aide ? `<span class="fr-hint-text">${e(f.aide)}</span>` : "";
  const requis = f.requis ? ` <span class="w-requis">(obligatoire)</span>` : "";
  const etiquette = `<label class="fr-label" for="${id}">${e(f.label)}${requis}${aide}</label>`;
  if (f.type === "texte") return `<div class="fr-input-group">${etiquette}<input class="fr-input" type="text" id="${id}" value="${e(v)}"></div>`;
  if (f.type === "markdown") return `<div class="fr-input-group">${etiquette}<textarea class="fr-input" id="${id}" rows="5">${e(v)}</textarea></div>`;
  if (f.type === "date") return `<div class="fr-input-group">${etiquette}<input class="fr-input" type="date" id="${id}" value="${e(v)}"></div>`;
  if (f.type === "choix") {
    return `<div class="fr-select-group">${etiquette}<select class="fr-select" id="${id}"><option value="">Aucun</option>${f.choix.map((c) => `<option value="${e(c)}"${c === v ? " selected" : ""}>${e(c)}</option>`).join("")}</select></div>`;
  }
  if (f.type === "financement") return htmlChoixFinancement(f, id, v);
  const options = f.options(ligne);
  if (f.type === "ref") {
    return `<div class="fr-select-group">${etiquette}<select class="fr-select" id="${id}"><option value="0">Aucun</option>${options.map((o) => `<option value="${o.valeur}"${o.valeur === v ? " selected" : ""}>${e(o.libelle)}</option>`).join("")}</select></div>${f.nouveau ? nouveauHtml(id) : ""}`;
  }
  const caseHtml = (o) =>
    `<div class="fr-checkbox-group fr-checkbox-group--sm" data-texte="${e(mod.normaliser(`${o.groupe ?? ""} ${o.libelle}`))}"><input type="checkbox" id="${id}-${o.valeur}" name="${id}" value="${o.valeur}"${v.includes(o.valeur) ? " checked" : ""}><label class="fr-label" for="${id}-${o.valeur}">${e(o.libelle)}</label></div>`;
  if (f.groupes) {
    const groupes = new Map();
    for (const o of options) groupes.set(o.groupe, [...(groupes.get(o.groupe) ?? []), o]);
    const liste = [...groupes].map(([g, opts]) => `<div class="w-groupe"><p class="w-groupe__titre">${e(g)}</p>${opts.map(caseHtml).join("")}</div>`).join("");
    return (
      `<fieldset class="w-fieldset"><legend class="fr-label" id="${id}-legende">${e(f.label)}${aide}</legend>` +
      `<div class="fr-input-group"><label class="fr-label" for="${id}-filtre">Filtrer la liste<span class="fr-hint-text">Par organisme ou par nom.</span></label><input class="fr-input" type="search" id="${id}-filtre" data-filtre="${id}-liste" autocomplete="off"></div>` +
      `<div class="w-cases w-cases--hautes" id="${id}-liste">${liste || `<p class="fr-text--sm w-vide">Aucun choix disponible.</p>`}</div></fieldset>`
    );
  }
  const cases = options.map(caseHtml).join("");
  return `<fieldset class="w-fieldset" aria-describedby="${id}-aide"><legend class="fr-label" id="${id}-legende">${e(f.label)}${aide}</legend><div class="w-cases">${cases || `<p class="fr-text--sm w-vide">Aucun choix disponible.</p>`}</div></fieldset>`;
}

function lireChamp(f, ligne) {
  const el = $(`champ-${f.col}`);
  if (f.type === "ref" || f.type === "financement") return Number(el.value) || 0;
  if (f.type === "liste") {
    const affiches = new Set(f.options(ligne).map((o) => o.valeur));
    const coches = [...document.querySelectorAll(`input[name="champ-${f.col}"]:checked`)].map((c) => Number(c.value));
    const gardes = valeurChamp(f, ligne).filter((id) => !affiches.has(id)); // liens hors liste affichée : conservés
    return [...gardes, ...coches];
  }
  return el.value.replace(/\r\n/g, "\n");
}

const egal = (a, b) => (Array.isArray(a) ? a.length === b.length && a.every((x) => b.includes(x)) : a === b);
const encoder = (f, v) => {
  if (f.type === "liste") return v.length ? ["L", ...v] : null;
  if (f.type === "date") return mod.epochDepuisJour(v);
  return v;
};

function ouvrirDialogue(table, id, declencheur) {
  const ligne = modele[table]?.get(id);
  const def = FORMULAIRES[table];
  if (!ligne || !def) return;
  ouvreur = declencheur;
  dialogue = { table, id, def, ligne };
  $("dialogue-titre").textContent = def.titre(ligne);
  $("dialogue-info").innerHTML = def.info ? def.info(ligne) : "";
  $("dialogue-champs").innerHTML = champsHtml(def.champs, ligne, { ouvrirSiRempli: true });
  $("dialogue-valider").textContent = "Enregistrer";
  $("dialogue-erreur").hidden = true;
  $("dialogue").showModal();
}

function ouvrirCreation(table, declencheur) {
  const def = CREATIONS[table];
  if (!def || (table !== "Themes" && table !== "Organismes" && table !== "Financements" && !themeId)) return;
  ouvreur = declencheur;
  const ligne = def.vierge();
  dialogue = { table, id: 0, def, ligne, creation: true };
  $("ajout-contenu").innerHTML = ""; // évite les identifiants en double avec la fenêtre d’ajout
  $("dialogue-titre").textContent = def.titre;
  $("dialogue-info").innerHTML = "";
  $("dialogue-champs").innerHTML = champsHtml(def.champs, ligne);
  $("dialogue-valider").textContent = def.valider;
  $("dialogue-erreur").hidden = true;
  $("dialogue").showModal();
}

async function enregistrer(ev) {
  ev.preventDefault();
  const { table, id, def, ligne, creation } = dialogue;
  const changes = {};
  const erreurs = [];
  for (const f of def.champs) {
    const v = lireChamp(f, ligne);
    if (f.requis && (f.type === "texte" ? !v.trim() : !v)) erreurs.push(`« ${f.label} » est obligatoire.`);
    if (f.url && v.trim() && !/^https?:\/\//i.test(v.trim())) erreurs.push(`« ${f.label} » doit commencer par http:// ou https://.`);
    if (!egal(v, valeurChamp(f, ligne))) changes[f.col] = encoder(f, f.type === "texte" ? v.trim() : v);
  }
  const ouv = $("champ-Ouverture")?.value;
  const clo = $("champ-Cloture")?.value;
  if (ouv && clo && clo < ouv) erreurs.push("La date de clôture est antérieure à la date d’ouverture.");
  if (creation && def.verifier) erreurs.push(...def.verifier());
  const champNouveau = def.champs.find((x) => x.nouveau);
  const nomNouveau = champNouveau ? $(`champ-${champNouveau.col}-nouveau`).value.trim() : "";
  if (nomNouveau) changes[champNouveau.col] = 0; // remplacé par l’identifiant de l’organisme dès qu’il est trouvé ou créé
  for (const f of def.champs.filter((x) => x.unique)) {
    const n = mod.normaliser($(`champ-${f.col}`).value);
    const autre = n && [...modele[table].values()].find((x) => x.id !== id && mod.normaliser(x[f.col]) === n);
    if (autre) erreurs.push(`« ${f.label} » est déjà utilisé (« ${autre[f.col]} »).`);
  }
  const zoneErreur = $("dialogue-erreur");
  if (erreurs.length) {
    zoneErreur.textContent = erreurs.join(" ");
    zoneErreur.hidden = false;
    return;
  }
  if (creation) {
    $("dialogue-valider").disabled = true;
    try {
      if (nomNouveau) changes[champNouveau.col] = await organismeParNom(nomNouveau);
      const rep = await window.grist.docApi.applyUserActions([["AddRecord", table, null, { ...changes, ...def.complete() }]]);
      await recharger();
      let idNouveau = Number(rep?.retValues?.[0]);
      if (!(idNouveau > 0) && table === "Themes") idNouveau = [...modele.Themes.values()].find((t) => t.Code === changes.Code)?.id ?? 0;
      if (idNouveau > 0) def.apres?.(idNouveau);
      fermerDialogue();
      ouvrirNouvelle(table, idNouveau);
      rendre();
      annoncer(def.fait);
      const cibleFocus = table === "Financements" ? document.querySelector(`button[data-ligne="fin-${idNouveau}"]`) : document.querySelector(`[data-cle="editer-${table}-${idNouveau}"]`);
      cibleFocus?.focus();
    } catch (err) {
      zoneErreur.textContent = `L’ajout a échoué : ${err?.message ?? err}`;
      zoneErreur.hidden = false;
    } finally {
      $("dialogue-valider").disabled = false;
    }
    return;
  }
  if (!Object.keys(changes).length) {
    fermerDialogue();
    annoncer("Aucune modification à enregistrer.");
    return;
  }
  $("dialogue-valider").disabled = true;
  try {
    if (nomNouveau) changes[champNouveau.col] = await organismeParNom(nomNouveau);
    await appliquer([["UpdateRecord", table, id, changes]]);
    fermerDialogue();
    rendre();
    annoncer("Modification enregistrée.");
  } catch (err) {
    zoneErreur.textContent = `L’enregistrement a échoué : ${err?.message ?? err}`;
    zoneErreur.hidden = false;
  } finally {
    $("dialogue-valider").disabled = false;
  }
}

function fermerDialogue() {
  $("dialogue").close();
  dialogue = null;
  ouvreur?.focus?.();
}

/** Confirmation dans une fenêtre du widget (confirm() peut être bloqué dans le cadre de Grist). */
function confirmer(titre, message, libelleOui = "Masquer partout", { sansOui = false, libelleNon = "Annuler", saisieAttendue = "" } = {}) {
  return new Promise((resoudre) => {
    const d = $("confirmation");
    $("confirmation-titre").textContent = titre;
    $("confirmation-oui").textContent = libelleOui;
    $("confirmation-oui").hidden = sansOui;
    $("confirmation-non").textContent = libelleNon;
    $("confirmation-message").innerHTML = message + (saisieAttendue ? `<div class="fr-input-group"><label class="fr-label" for="confirmation-saisie">Pour confirmer, tapez <strong>${e(saisieAttendue)}</strong></label><input class="fr-input" type="text" id="confirmation-saisie" autocomplete="off"></div>` : "");
    $("confirmation-oui").disabled = Boolean(saisieAttendue);
    if (saisieAttendue) $("confirmation-saisie").oninput = (ev) => ($("confirmation-oui").disabled = mod.normaliser(ev.target.value) !== mod.normaliser(saisieAttendue));
    const fin = (ok) => {
      d.close();
      $("confirmation-oui").onclick = $("confirmation-non").onclick = null;
      resoudre(ok);
    };
    $("confirmation-oui").onclick = () => fin(true);
    $("confirmation-non").onclick = () => fin(false);
    d.showModal();
  });
}

/* ======================================================================
   Ajout d’une ligne au panorama (avec recherche d’un financement existant)
   ====================================================================== */

const CHAMPS_LIGNE = FORMULAIRES.Panorama.champs.filter((f) => ["Dispositif", "Besoins", "A_utiliser_pour", "Fonctionnement", "Acces"].includes(f.col));
const CHAMPS_FINANCEMENT = FORMULAIRES.Financements.champs;

let ajout = null; // { type: "ligne" | "appel" | "fiche", sousThemeId, etape: "saisie", financementId, cree, ... }

const ligneVierge = () => ({ Theme: themeId, Sous_theme: ajout.sousThemeId, Dispositif: "", Besoins: [], A_utiliser_pour: "", Fonctionnement: "", Acces: "" });
const financementVierge = () => ({ Nom: "", Organisme: 0, Calendrier: "" });

function ouvrirAjout(sousThemeId, declencheur) {
  if (!modele.Sous_themes.get(sousThemeId)) return;
  ouvreur = declencheur;
  ajout = { type: "ligne", sousThemeId, etape: "saisie", financementId: 0, cree: false };
  $("dialogue-champs").innerHTML = ""; // évite les identifiants en double avec la fenêtre de modification
  const choix = financement("Financement", "Financement", { requis: true, creerFinancement: true });
  $("ajout-titre").textContent = "Ajouter une ligne au panorama";
  $("ajout-contenu").innerHTML =
    titreAjout() +
    champHtml(choix, { Financement: 0 }) +
    `<div id="ajout-info-fin" role="status" aria-live="polite"></div>` +
    `<div id="ajout-nouveau-fin" hidden><h3 class="fr-h6">Nouveau financement</h3>${CHAMPS_FINANCEMENT.map((f) => champHtml(f, financementVierge())).join("")}<div id="ajout-similaires" role="status" aria-live="polite"></div></div>` +
    `<h3 class="fr-h6">Ligne du panorama</h3>` +
    CHAMPS_LIGNE.map((f) => champHtml(f, ligneVierge())).join("");
  $("ajout-boutons").innerHTML =
    `<button type="submit" class="fr-btn" id="ajout-valider">Ajouter la ligne</button>` +
    `<button type="button" class="fr-btn fr-btn--tertiary" data-ajout="annuler">Annuler</button>`;
  $("ajout-erreur").hidden = true;
  $("ajout").showModal();
}

function titreAjout() {
  const s = modele.Sous_themes.get(ajout.sousThemeId);
  const t = modele.Themes.get(themeId);
  return `<p class="fr-text--sm">Thème : <strong>${e(t?.Code ?? "")} · ${e(t?.Nom ?? "")}</strong>${s ? `<br>Sous-thème : <strong>${e(s.Titre)}</strong>` : ""}</p>`;
}

/** Le Dispositif reprend le nom du financement choisi, tant qu’il n’a pas été modifié à la main. */
function majDispositifAuto() {
  const champ = $("champ-Dispositif");
  if (!champ) return;
  const val = Number($("champ-Financement").value) || 0;
  let lib = "";
  if (val > 0) lib = mod.libelleFinancement(modele.Financements.get(val));
  else if (val === -1) {
    const nom = $("champ-Nom").value.trim();
    const org = organismeSaisi();
    lib = nom ? (org ? `${org} – ${nom}` : nom) : "";
  }
  if (champ.value === "" || champ.value === champ.dataset.auto) champ.value = lib;
  champ.dataset.auto = lib;
}

function majFormulaireLigne() {
  const val = Number($("champ-Financement").value) || 0;
  $("ajout-nouveau-fin").hidden = val !== -1;
  const info = $("ajout-info-fin");
  info.innerHTML = "";
  if (val > 0) {
    const f = modele.Financements.get(val);
    const th = mod.themesDuFinancement(modele, val).filter((t) => t.id !== themeId);
    const dejaIci = mod.lignesDuFinancementDansTheme(modele, val, themeId).length;
    info.innerHTML =
      (th.length ? `<div class="fr-alert fr-alert--info fr-alert--sm w-bloc"><p>Ce financement est aussi utilisé dans : ${e(th.map((t) => t.Code).join(", "))}. Son nom, son lien et son calendrier sont communs à tous ces thèmes.</p></div>` : "") +
      (dejaIci ? `<div class="fr-alert fr-alert--warning fr-alert--sm w-bloc"><p>Ce financement figure déjà ${dejaIci > 1 ? dejaIci + " fois" : "une fois"} dans ce thème. Vérifiez qu’il ne s’agit pas d’un doublon.</p></div>` : "") +
      (f.Actif ? "" : `<div class="fr-alert fr-alert--warning fr-alert--sm w-bloc"><p>Ce financement est masqué : la ligne ne sera pas visible tant qu’il l’est.</p></div>`);
  } else if (val === -1) majSimilaires();
  majDispositifAuto();
}

function majSimilaires() {
  const zone = $("ajout-similaires");
  if (!zone) return;
  const { identiques, proches } = mod.financementsSimilaires(modele, organismeSaisi(), $("champ-Nom").value);
  const ligne = (f) => `<li>« ${e(mod.libelleFinancement(f))} » <button type="button" class="fr-btn fr-btn--sm fr-btn--tertiary" data-ajout="utiliser" data-id="${f.id}" aria-label="Utiliser « ${e(mod.libelleFinancement(f))} »">Utiliser celui-ci</button></li>`;
  zone.innerHTML =
    (identiques.length ? `<div class="fr-alert fr-alert--error fr-alert--sm w-bloc"><p>Ce financement existe déjà :</p><ul>${identiques.map(ligne).join("")}</ul></div>` : "") +
    (proches.length ? `<div class="fr-alert fr-alert--warning fr-alert--sm w-bloc"><p>Des financements proches existent déjà :</p><ul>${proches.slice(0, 3).map(ligne).join("")}</ul></div>` : "");
}

async function enregistrerAjout(ev) {
  ev.preventDefault();
  if (!ajout || ajout.etape !== "saisie") return;
  if (ajout.type === "appel") return enregistrerAjoutAppel();
  if (ajout.type === "fiche") return enregistrerAjoutFiche();
  const erreurs = [];
  const fin = {};
  const choix = Number($("champ-Financement").value) || 0;
  if (!choix) erreurs.push("Choisissez un financement, ou « Nouveau financement… ».");
  if (choix === -1 && !ajout.financementId) {
    for (const f of CHAMPS_FINANCEMENT) {
      const v = lireChamp(f, financementVierge());
      if (f.type === "ref") {
        fin[f.col] = v; // organisme choisi dans la liste ; un nouvel organisme est traité à l’enregistrement
        continue;
      }
      if (f.requis && !v.trim()) erreurs.push(`« ${f.label} » est obligatoire.`);
      if (f.url && v.trim() && !/^https?:\/\//i.test(v.trim())) erreurs.push(`« ${f.label} » doit commencer par http:// ou https://.`);
      fin[f.col] = v.trim();
    }
    const { identiques } = mod.financementsSimilaires(modele, organismeSaisi(), fin.Nom);
    if (identiques.length) erreurs.push(`Ce financement existe déjà (« ${mod.libelleFinancement(identiques[0])} ») : choisissez-le dans la liste plutôt que d’en créer un second.`);
  }
  const zoneErreur = $("ajout-erreur");
  if (erreurs.length) {
    zoneErreur.textContent = erreurs.join(" ");
    zoneErreur.hidden = false;
    return;
  }
  const vierge = ligneVierge();
  const ligne = {};
  for (const f of CHAMPS_LIGNE) {
    const v = lireChamp(f, vierge);
    ligne[f.col] = f.type === "texte" ? v.trim() : v;
  }
  const bouton = $("ajout-valider");
  bouton.disabled = true;
  zoneErreur.hidden = true;
  try {
    let idFin = choix > 0 ? choix : ajout.financementId;
    if (choix === -1 && !idFin) {
      const nomOrg = $("champ-Organisme-nouveau")?.value.trim();
      if (nomOrg) fin.Organisme = await organismeParNom(nomOrg);
      const rep = await window.grist.docApi.applyUserActions([["AddRecord", "Financements", null, { ...fin, Actif: true }]]);
      await recharger();
      let id = Number(rep?.retValues?.[0]);
      if (!Number.isInteger(id) || id <= 0) {
        // Réponse de Grist sans identifiant : on retrouve le financement qu’on vient de créer.
        id = Math.max(0, ...[...modele.Financements.values()].filter((f) => f.Nom === fin.Nom && f.Organisme === fin.Organisme).map((f) => f.id));
      }
      if (!id) throw new Error("Le financement a été créé, mais son identifiant est introuvable. Rechargez les données et choisissez-le dans la liste.");
      idFin = id;
      ajout.financementId = id; // en cas d’échec de la suite, un nouvel essai ne recrée pas le financement
      ajout.cree = true;
    }
    const groupe = [...modele.Panorama.values()].filter((p) => p.Theme === themeId && p.Sous_theme === ajout.sousThemeId);
    const champs = {
      Sous_theme: ajout.sousThemeId,
      Financement: idFin,
      Ordre: mod.prochainOrdre(groupe),
      Publie: false,
      Dispositif: ligne.Dispositif,
      A_utiliser_pour: ligne.A_utiliser_pour,
      Fonctionnement: ligne.Fonctionnement,
      Acces: ligne.Acces,
    };
    if (ligne.Besoins.length) champs.Besoins = ["L", ...ligne.Besoins];
    const rep = await window.grist.docApi.applyUserActions([["AddRecord", "Panorama", null, champs]]);
    await recharger();
    const idLigne = Number(rep?.retValues?.[0]);
    const sousThemeId = ajout.sousThemeId;
    $("ajout").close();
    ouvrirNouvelle("Panorama", idLigne);
    rendre();
    annoncer("Ligne ajoutée au panorama. Elle n’est pas publiée : activez « Publié » quand elle est prête.");
    const cible = (Number.isInteger(idLigne) && document.querySelector(`[data-cle="editer-Panorama-${idLigne}"]`)) || document.querySelector(`[data-cle="ajouter-Panorama-${sousThemeId}"]`);
    cible?.focus();
  } catch (err) {
    zoneErreur.textContent = `L’ajout a échoué : ${err?.message ?? err}${ajout?.cree ? " Le financement est déjà créé : un nouvel essai le réutilise." : ""}`;
    zoneErreur.hidden = false;
  } finally {
    const b = $("ajout-valider");
    if (b) b.disabled = false;
  }
}

/* ---------- Ajout d’un appel à projets ---------- */

const CHAMPS_APPEL = FORMULAIRES.Appels_a_projets.champs.filter((f) => f.col !== "Financement");

const appelVierge = () => ({ Nom: "", Themes: [themeId], Lien: "", Ouverture: null, Cloture: null, Heure_cloture: "", Statut_particulier: "", Texte: "" });

function ouvrirAjoutAppel(declencheur) {
  ouvreur = declencheur;
  ajout = { type: "appel", sousThemeId: 0, etape: "saisie", financementId: 0, cree: false, financementAuto: 0 };
  $("dialogue-champs").innerHTML = "";
  const v = appelVierge();
  const champ = (col) => CHAMPS_APPEL.find((f) => f.col === col);
  const F = mod.fiche(modele, themeId);
  const lignes = [...F.parSousTheme.values()].flat().concat(F.sansSousTheme);
  const optionLigne = (p) => {
    const st = modele.Sous_themes.get(p.Sous_theme);
    return `<option value="${p.id}">${e(mod.nomAffiche(p, modele))}${st ? ` (${e(st.Titre)})` : ""}</option>`;
  };
  $("ajout-titre").textContent = "Ajouter un appel à projets";
  $("ajout-contenu").innerHTML =
    titreAjout() +
    (lignes.length
      ? `<div class="fr-select-group"><label class="fr-label" for="ajout-ligne-appel">Ligne du panorama concernée<span class="fr-hint-text">Facultatif. Reprend le nom et le financement de la ligne ; vous pouvez ensuite compléter le nom (par exemple « – 4e appel »).</span></label>` +
        `<select class="fr-select" id="ajout-ligne-appel"><option value="0">Aucune : choisir le financement ci-dessous</option>${lignes.map(optionLigne).join("")}</select></div>`
      : "") +
    champHtml(champ("Nom"), v) +
    `<div id="ajout-similaires" role="status" aria-live="polite"></div>` +
    champHtml(financement("Financement", "Financement (facultatif)", { facultatif: true, aide: "Le financement dont relève l’appel. Absent de la liste ? Ajoutez-le d’abord dans « Maintenance »." }), { Financement: 0 }) +
    `<p class="fr-text--sm w-meta" id="ajout-besoins-info" role="status" aria-live="polite"></p>` +
    champsHtml(CHAMPS_APPEL.filter((f) => f.col !== "Nom"), v);
  $("ajout-boutons").innerHTML =
    `<button type="submit" class="fr-btn" id="ajout-valider">Ajouter l’appel</button>` +
    `<button type="button" class="fr-btn fr-btn--tertiary" data-ajout="annuler">Annuler</button>`;
  $("ajout-erreur").hidden = true;
  majInfoBesoinsAppel();
  $("ajout").showModal();
}

/** Le choix d’une ligne remplit le nom et le financement de l’appel (tout reste modifiable). */
function majAppelLigne() {
  const p = modele.Panorama.get(Number($("ajout-ligne-appel").value));
  const champ = $("champ-Nom");
  const lib = p ? mod.nomAffiche(p, modele) : "";
  if (champ.value === "" || champ.value === champ.dataset.auto) champ.value = lib;
  champ.dataset.auto = lib;
  const selection = $("champ-Financement");
  if (p?.Financement) {
    $("champ-Financement-org").value = "";
    majChoixFinancement("Financement");
    selection.value = String(p.Financement);
    ajout.financementAuto = p.Financement;
  } else if (ajout.financementAuto && Number(selection.value) === ajout.financementAuto) {
    selection.value = "0"; // on n’efface le financement que s’il venait de la ligne
    ajout.financementAuto = 0;
  }
  majInfoBesoinsAppel();
  majSimilairesAppel();
}

/** Les besoins d'un appel ne se saisissent pas : on indique sous quels besoins de ce thème il s'affichera (règle B). */
function majInfoBesoinsAppel() {
  const id = Number($("champ-Financement").value) || 0;
  const info = $("ajout-besoins-info");
  if (!id) {
    info.textContent = "Sans financement, l’appel ne peut pas être rattaché à des besoins : il s’affichera pour tout le thème.";
    return;
  }
  const besoins = [...new Set(mod.lignesDuFinancementDansTheme(modele, id, themeId).flatMap((p) => p.Besoins))].map((b) => modele.Besoins.get(b)?.Libelle).filter(Boolean);
  info.textContent = besoins.length
    ? `Cet appel s’affichera sous ${besoins.length} besoin${besoins.length > 1 ? "s" : ""} de ce thème, d’après les lignes du panorama qui ont ce financement : ${besoins.join(" ; ")}.`
    : "Aucune ligne du panorama de ce thème n’a ce financement : l’appel s’affichera pour tout le thème, sans filtre par besoin.";
}

function majSimilairesAppel() {
  const zone = $("ajout-similaires");
  if (!zone) return;
  const { identiques, proches } = mod.appelsSimilaires(modele, $("champ-Nom").value);
  const ligne = (a) =>
    `<li>« ${e(a.Nom)} »${
      a.Themes.includes(themeId)
        ? " (déjà dans ce thème)"
        : ` <button type="button" class="fr-btn fr-btn--sm fr-btn--tertiary" data-ajout="ajouter-theme" data-id="${a.id}" aria-label="Ajouter ce thème à l’appel « ${e(a.Nom)} »">Ajouter ce thème à cet appel</button>`
    }</li>`;
  zone.innerHTML =
    (identiques.length ? `<div class="fr-alert fr-alert--error fr-alert--sm w-bloc"><p>Cet appel existe déjà :</p><ul>${identiques.map(ligne).join("")}</ul></div>` : "") +
    (proches.length ? `<div class="fr-alert fr-alert--warning fr-alert--sm w-bloc"><p>Des appels proches existent déjà :</p><ul>${proches.slice(0, 3).map(ligne).join("")}</ul></div>` : "");
}

async function ajouterThemeAuAppel(id) {
  const a = modele.Appels_a_projets.get(id);
  if (!a) return;
  const zoneErreur = $("ajout-erreur");
  try {
    await appliquer([["UpdateRecord", "Appels_a_projets", id, { Themes: ["L", ...a.Themes, themeId] }]]);
    $("ajout").close();
    rendre();
    annoncer(`Le thème a été ajouté à l’appel « ${a.Nom} ».`);
  } catch (err) {
    zoneErreur.textContent = `L’enregistrement a échoué : ${err?.message ?? err}`;
    zoneErreur.hidden = false;
  }
}

async function enregistrerAjoutAppel() {
  const erreurs = [];
  const vierge = appelVierge();
  const v = {};
  for (const f of CHAMPS_APPEL) {
    v[f.col] = lireChamp(f, vierge);
    if (f.type === "texte") v[f.col] = v[f.col].trim();
    if (f.requis && !v[f.col]) erreurs.push(`« ${f.label} » est obligatoire.`);
    if (f.url && v[f.col] && !/^https?:\/\//i.test(v[f.col])) erreurs.push(`« ${f.label} » doit commencer par http:// ou https://.`);
  }
  if (v.Ouverture && v.Cloture && v.Cloture < v.Ouverture) erreurs.push("La date de clôture est antérieure à la date d’ouverture.");
  const { identiques } = mod.appelsSimilaires(modele, v.Nom);
  if (identiques.length) {
    const a = identiques[0];
    erreurs.push(a.Themes.includes(themeId) ? `Cet appel existe déjà dans ce thème (« ${a.Nom} »).` : `Cet appel existe déjà (« ${a.Nom} ») : ajoutez-lui ce thème plutôt que de le recréer.`);
  }
  if (!v.Themes.includes(themeId)) erreurs.push("Cochez le thème de cette fiche : sinon l’appel ne figurerait pas dans cette fiche.");
  const zoneErreur = $("ajout-erreur");
  if (erreurs.length) {
    zoneErreur.textContent = erreurs.join(" ");
    zoneErreur.hidden = false;
    return;
  }
  const champs = { Nom: v.Nom, Lien: v.Lien, Heure_cloture: v.Heure_cloture, Texte: v.Texte, Publie: false };
  const idFinancement = Number($("champ-Financement").value) || 0;
  if (idFinancement > 0) champs.Financement = idFinancement;
  if (v.Themes.length) champs.Themes = ["L", ...v.Themes];
  if (v.Ouverture) champs.Ouverture = mod.epochDepuisJour(v.Ouverture);
  if (v.Cloture) champs.Cloture = mod.epochDepuisJour(v.Cloture);
  if (v.Statut_particulier) champs.Statut_particulier = v.Statut_particulier;
  const bouton = $("ajout-valider");
  bouton.disabled = true;
  zoneErreur.hidden = true;
  try {
    const rep = await window.grist.docApi.applyUserActions([["AddRecord", "Appels_a_projets", null, champs]]);
    await recharger();
    const idAppel = Number(rep?.retValues?.[0]);
    $("ajout").close();
    ouvrirNouvelle("Appels_a_projets", idAppel);
    rendre();
    annoncer("Appel ajouté. Il n’est pas publié : activez « Publié » quand il est prêt.");
    const cible = (Number.isInteger(idAppel) && document.querySelector(`[data-cle="editer-Appels_a_projets-${idAppel}"]`)) || document.querySelector(`[data-cle="ajouter-Appels_a_projets-0"]`);
    cible?.focus();
  } catch (err) {
    zoneErreur.textContent = `L’ajout a échoué : ${err?.message ?? err}`;
    zoneErreur.hidden = false;
  } finally {
    const b = $("ajout-valider");
    if (b) b.disabled = false;
  }
}

/* ---------- Ajout d’une fiche détaillée ---------- */

const CHAMPS_FICHE = FORMULAIRES.Fiches_detaillees.champs;

const ficheVierge = () => Object.fromEntries(CHAMPS_FICHE.map((f) => [f.col, ""]));

function ouvrirAjoutFiche(declencheur) {
  ouvreur = declencheur;
  ajout = { type: "fiche", sousThemeId: 0, etape: "saisie", financementId: 0, cree: false, ficheId: 0 };
  $("dialogue-champs").innerHTML = "";
  const F = mod.fiche(modele, themeId);
  const toutes = [...F.parSousTheme.values()].flat().concat(F.sansSousTheme);
  const optionsLigne = (p) => {
    const st = modele.Sous_themes.get(p.Sous_theme);
    return `<option value="${p.id}">${e(mod.nomAffiche(p, modele))}${st ? ` (${e(st.Titre)})` : ""}</option>`;
  };
  const sans = toutes.filter((p) => !p.Fiche_detaillee);
  const avec = toutes.filter((p) => p.Fiche_detaillee);
  const [titre, ...rubriques] = CHAMPS_FICHE;
  const v = ficheVierge();
  $("ajout-titre").textContent = "Ajouter une fiche détaillée";
  $("ajout-contenu").innerHTML =
    titreAjout() +
    (toutes.length
      ? `<div class="fr-select-group"><label class="fr-label" for="ajout-ligne-fiche">Ligne du panorama <span class="w-requis">(obligatoire)</span><span class="fr-hint-text">La fiche détaille le financement de cette ligne et en reprend le nom. Les lignes sans fiche sont en premier.</span></label>` +
        `<select class="fr-select" id="ajout-ligne-fiche"><option value="0">Choisir une ligne…</option>` +
        (sans.length ? `<optgroup label="Lignes sans fiche détaillée">${sans.map(optionsLigne).join("")}</optgroup>` : "") +
        (avec.length ? `<optgroup label="Lignes qui ont déjà une fiche (elle sera remplacée)">${avec.map(optionsLigne).join("")}</optgroup>` : "") +
        `</select></div><div id="ajout-remplacement" role="status" aria-live="polite"></div>`
      : `<div class="fr-alert fr-alert--warning fr-alert--sm w-bloc"><p>Ce thème n’a aucune ligne de panorama. Ajoutez d’abord une ligne, puis sa fiche.</p></div>`) +
    champHtml(titre, v) +
    `<div id="ajout-similaires" role="status" aria-live="polite"></div>` +
    rubriques.map((f) => champHtml(f, v)).join("");
  $("ajout-boutons").innerHTML =
    (toutes.length ? `<button type="submit" class="fr-btn" id="ajout-valider">Ajouter la fiche</button>` : "") +
    `<button type="button" class="fr-btn fr-btn--tertiary" data-ajout="annuler">Annuler</button>`;
  $("ajout-erreur").hidden = true;
  $("ajout").showModal();
}

/** Le titre reprend le nom de la ligne choisie, tant qu’il n’a pas été modifié à la main. */
function majFicheLigne() {
  const p = modele.Panorama.get(Number($("ajout-ligne-fiche").value));
  const champ = $("champ-Titre");
  const lib = p ? mod.nomAffiche(p, modele) : "";
  if (champ.value === "" || champ.value === champ.dataset.auto) champ.value = lib;
  champ.dataset.auto = lib;
  majRemplacement();
  majSimilairesFiche();
}

/** Adapte le bouton si la ligne choisie a déjà une fiche, et prévient si cette fiche ne sera plus utilisée. */
function majRemplacement() {
  const p = modele.Panorama.get(Number($("ajout-ligne-fiche")?.value));
  const ancienne = p?.Fiche_detaillee ? modele.Fiches_detaillees.get(p.Fiche_detaillee) : null;
  const bouton = $("ajout-valider");
  if (bouton) bouton.textContent = ancienne ? "Ajouter la fiche et remplacer l’actuelle" : "Ajouter la fiche";
  const orpheline = ancienne && [...modele.Panorama.values()].filter((x) => x.Fiche_detaillee === ancienne.id).every((x) => x.id === p.id);
  $("ajout-remplacement").innerHTML = orpheline
    ? `<div class="fr-alert fr-alert--info fr-alert--sm w-bloc"><p>La fiche « ${e(ancienne.Titre || "sans titre")} » ne sera plus désignée par aucune ligne : elle restera dans Grist, sans s’afficher.</p></div>`
    : "";
}

function majSimilairesFiche() {
  const zone = $("ajout-similaires");
  if (!zone) return;
  const { identiques, proches } = mod.fichesSimilaires(modele, $("champ-Titre").value);
  const ligne = (f) => {
    const n = [...modele.Panorama.values()].filter((p) => p.Fiche_detaillee === f.id).length;
    return `<li>« ${e(f.Titre)} » (désignée par ${n} ligne${n > 1 ? "s" : ""})</li>`;
  };
  const aide = "Pour la réutiliser, ne créez pas de fiche : modifiez la fiche de la ligne dans le panorama.";
  zone.innerHTML =
    (identiques.length ? `<div class="fr-alert fr-alert--warning fr-alert--sm w-bloc"><p>Une fiche porte déjà ce titre. ${aide}</p><ul>${identiques.map(ligne).join("")}</ul></div>` : "") +
    (proches.length ? `<div class="fr-alert fr-alert--info fr-alert--sm w-bloc"><p>Des fiches au titre proche existent. ${aide}</p><ul>${proches.slice(0, 3).map(ligne).join("")}</ul></div>` : "");
}

async function enregistrerAjoutFiche() {
  const erreurs = [];
  const vierge = ficheVierge();
  const v = {};
  for (const f of CHAMPS_FICHE) {
    v[f.col] = lireChamp(f, vierge);
    if (f.type === "texte") v[f.col] = v[f.col].trim();
    if (f.requis && !v[f.col]) erreurs.push(`« ${f.label} » est obligatoire.`);
  }
  const idLigne = Number($("ajout-ligne-fiche")?.value) || 0;
  const lignes = idLigne ? [idLigne] : [];
  if (!lignes.length) erreurs.push("Choisissez la ligne du panorama : sans ligne, la fiche ne s’afficherait nulle part.");
  const zoneErreur = $("ajout-erreur");
  if (erreurs.length) {
    zoneErreur.textContent = erreurs.join(" ");
    zoneErreur.hidden = false;
    return;
  }
  const bouton = $("ajout-valider");
  bouton.disabled = true;
  zoneErreur.hidden = true;
  try {
    if (!ajout.ficheId) {
      const rep = await window.grist.docApi.applyUserActions([["AddRecord", "Fiches_detaillees", null, v]]);
      await recharger();
      let id = Number(rep?.retValues?.[0]);
      if (!Number.isInteger(id) || id <= 0) {
        // Réponse de Grist sans identifiant : on retrouve la fiche qu’on vient de créer.
        id = Math.max(0, ...[...modele.Fiches_detaillees.values()].filter((f) => f.Titre === v.Titre).map((f) => f.id));
      }
      if (!id) throw new Error("La fiche a été créée, mais son identifiant est introuvable. Rechargez les données et rattachez-la depuis la ligne du panorama.");
      ajout.ficheId = id; // en cas d’échec de la suite, un nouvel essai ne recrée pas la fiche
    }
    await appliquer(lignes.map((id) => ["UpdateRecord", "Panorama", id, { Fiche_detaillee: ajout.ficheId }]));
    const idFiche = ajout.ficheId;
    $("ajout").close();
    ouvrirNouvelle("Fiches_detaillees", idFiche);
    rendre();
    annoncer("Fiche ajoutée et rattachée aux lignes cochées. Elle devient visible dès qu’une de ces lignes l’est.");
    const cible = document.querySelector(`[data-cle="editer-Fiches_detaillees-${idFiche}"]`) || document.querySelector(`[data-cle="ajouter-Fiches_detaillees-0"]`);
    cible?.focus();
  } catch (err) {
    zoneErreur.textContent = `L’ajout a échoué : ${err?.message ?? err}${ajout?.ficheId ? " La fiche est déjà créée : un nouvel essai la réutilise." : ""}`;
    zoneErreur.hidden = false;
  } finally {
    const b = $("ajout-valider");
    if (b) b.disabled = false;
  }
}

function brancherAjout() {
  const d = $("ajout");
  d.addEventListener("click", (ev) => {
    const b = ev.target.closest?.("button[data-ajout]");
    if (!b || !ajout) return;
    const id = Number(b.dataset.id);
    switch (b.dataset.ajout) {
      case "utiliser": // un financement existant proche : on le choisit dans la liste
        $("champ-Financement-org").value = "";
        majChoixFinancement("Financement");
        $("champ-Financement").value = String(id);
        majFormulaireLigne();
        break;
      case "ajouter-theme":
        ajouterThemeAuAppel(id);
        break;
      case "annuler":
        d.close();
        break;
    }
  });
  d.addEventListener("input", (ev) => {
    if (!ajout) return;
    const cible = ev.target.id;
    if (ajout.type === "fiche" && cible === "champ-Titre") majSimilairesFiche();
    else if (cible === "champ-Nom" || cible === "champ-Organisme-nouveau") {
      if (ajout.type === "appel") majSimilairesAppel();
      else {
        majSimilaires();
        majDispositifAuto();
      }
    }
  });
  d.addEventListener("change", (ev) => {
    if (!ajout) return;
    const cible = ev.target;
    if (cible.dataset?.picker) majChoixFinancement(cible.dataset.picker);
    if (cible.dataset?.picker || cible.dataset?.financement) {
      if (ajout.type === "ligne") majFormulaireLigne();
      else if (ajout.type === "appel") majInfoBesoinsAppel();
    } else if (ajout.type === "ligne" && cible.id === "champ-Organisme") {
      majSimilaires();
      majDispositifAuto();
    } else if (ajout.type === "fiche" && cible.id === "ajout-ligne-fiche") majFicheLigne();
    else if (ajout.type === "appel" && cible.id === "ajout-ligne-appel") majAppelLigne();
  });
  d.addEventListener("close", () => {
    $("ajout-contenu").innerHTML = "";
    $("ajout-boutons").innerHTML = "";
    ajout = null;
  });
  $("ajout-formulaire").addEventListener("submit", enregistrerAjout);
}

/* ======================================================================
   Événements
   ====================================================================== */

async function surChangementInterrupteur(input) {
  const [table, colonne] = input.dataset.toggle.split(".");
  const id = Number(input.dataset.id);
  const valeur = input.checked;
  if (input.closest("label")?.classList.contains("w-sw--occupe")) {
    input.checked = !valeur; // enregistrement déjà en cours pour cet interrupteur
    return;
  }
  effacerMessages();
  if (table === "Financements" && !valeur) {
    const f = modele.Financements.get(id);
    const th = mod.themesDuFinancement(modele, id);
    const ok = await confirmer(
      "Masquer ce financement partout ?",
      `<p>« ${e(mod.libelleFinancement(f))} » disparaîtra de ${th.length} thème${th.length > 1 ? "s" : ""}${th.length ? " (" + e(th.map((t) => t.Code).join(", ")) + ")" : ""}, ainsi que des appels et du montage financier qui s’y rattachent.</p>`
    );
    if (!ok) {
      input.checked = true;
      return;
    }
  }
  input.closest("label")?.classList.add("w-sw--occupe"); // le curseur reste sur la nouvelle position pendant l’enregistrement
  try {
    await appliquer([["UpdateRecord", table, id, { [colonne]: valeur }]]);
    rendre();
    const mots = colonne === "Actif" ? ["financement visible", "financement masqué partout"] : ["publié", "non publié"];
    annoncer(`Enregistré : ${valeur ? mots[0] : mots[1]}.`);
  } catch (err) {
    input.checked = !valeur;
    input.closest("label")?.classList.remove("w-sw--occupe");
    erreur(err);
  }
}

async function surClic(bouton) {
  const { action, table } = bouton.dataset;
  const id = Number(bouton.dataset.id);
  effacerMessages();
  if (action === "editer") return ouvrirDialogue(table, id, bouton);
  if (action === "ajouter-ligne") return ouvrirAjout(id, bouton);
  if (action === "ajouter-appel") return ouvrirAjoutAppel(bouton);
  if (action === "ajouter-fiche") return ouvrirAjoutFiche(bouton);
  if (action === "supprimer") return supprimer(table, id, bouton);
  if (action === "publier-tout") return publierToutTheme(id, bouton);
  if (action === "supprimer-theme") return supprimerTheme(id, bouton);
  if (action === "creer") return ouvrirCreation(table, bouton);
  if (action === "monter" || action === "descendre") {
    const ligne = modele[table].get(id);
    const paires = mod.deplacement(mod.groupeOrdre(modele, table, ligne), id, action === "monter" ? -1 : 1);
    if (!paires.length) return;
    bouton.disabled = true;
    try {
      await appliquer([["BulkUpdateRecord", table, paires.map(([x]) => x), { Ordre: paires.map(([, o]) => o) }]]);
      rendre();
      annoncer("Ordre modifié.");
    } catch (err) {
      bouton.disabled = false;
      erreur(err);
    }
  }
}

/** Texte « N éléments (A, B, C…) » : au plus cinq noms. */
const exemples = (liste, nom) => {
  const noms = liste.slice(0, 5).map((x) => e(nom(x)));
  return `${noms.join(", ")}${liste.length > 5 ? "…" : ""}`;
};
const nbr = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

async function publierToutTheme(id, declencheur) {
  const t = modele.Themes.get(id);
  if (!t) return;
  const plan = mod.planPublication(modele, id, mod.jourLocal());
  const nomTheme = `${t.Code} · ${t.Nom}`;
  if (!plan.total) {
    await confirmer("Rien à publier", `<p>Tout ce que contient la fiche « ${e(nomTheme)} » est déjà publié.</p>`, "", { sansOui: true, libelleNon: "Fermer" });
    declencheur?.focus?.();
    return;
  }
  const { aPublier: p, alertes: a } = plan;
  const lignes = [];
  if (p.theme.length) lignes.push("le thème lui-même");
  if (p.lignes.length) lignes.push(nbr(p.lignes.length, "ligne de panorama", "lignes de panorama"));
  if (p.appels.length) lignes.push(nbr(p.appels.length, "appel à projets", "appels à projets"));
  if (p.montage.length) lignes.push(nbr(p.montage.length, "question du montage financier", "questions du montage financier"));
  const alerte = (texte) => `<div class="fr-alert fr-alert--warning fr-alert--sm w-bloc"><p>${texte}</p></div>`;
  let html =
    `<p>Seront publiés, donc visibles du public, dans la fiche « ${e(nomTheme)} » :</p><ul>${lignes.map((x) => `<li>${x}</li>`).join("")}</ul>` +
    `<p class="fr-text--sm">Ce qui est déjà publié ne change pas. Les fiches détaillées n’ont pas de publication propre. Les financements masqués le restent.</p>`;
  if (a.financementsMasques.length) html += alerte(`${nbr(a.financementsMasques.length, "ligne restera invisible", "lignes resteront invisibles")}, ${a.financementsMasques.length > 1 ? "leur financement est masqué ou absent" : "son financement est masqué ou absent"} : ${exemples(a.financementsMasques, (x) => mod.nomAffiche(x, modele))}.`);
  if (a.lignesSansBesoin.length) html += alerte(`${nbr(a.lignesSansBesoin.length, "ligne n’a", "lignes n’ont")} aucun besoin lié : ${a.lignesSansBesoin.length > 1 ? "elles ne seront proposées" : "elle ne sera proposée"} à aucun besoin : ${exemples(a.lignesSansBesoin, (x) => mod.nomAffiche(x, modele))}.`);
  if (a.appelsPartages.length) html += alerte(`${nbr(a.appelsPartages.length, "appel est aussi rattaché", "appels sont aussi rattachés")} à d’autres thèmes et y deviendr${a.appelsPartages.length > 1 ? "ont" : "a"} visible${a.appelsPartages.length > 1 ? "s" : ""} aussi : ${exemples(a.appelsPartages, (x) => x.Nom)}.`);
  if (a.appelsAnciens.length) html += alerte(`${nbr(a.appelsAnciens.length, "appel est clos", "appels sont clos")} depuis plus d’un an : ${exemples(a.appelsAnciens, (x) => x.Nom)}.`);
  const ok = await confirmer(`Publier toute la fiche ${t.Code} ?`, html, `Publier ${nbr(plan.total, "élément", "éléments")}`);
  if (!ok) {
    declencheur?.focus?.();
    return;
  }
  try {
    await appliquer(plan.actions);
    rendre();
    annoncer(`${nbr(plan.total, "élément publié", "éléments publiés")} dans la fiche ${t.Code}.`);
  } catch (err) {
    erreur(err);
  }
}

async function supprimerTheme(id, declencheur) {
  const t = modele.Themes.get(id);
  if (!t) return;
  const plan = mod.planSuppressionTheme(modele, id);
  const nomTheme = `${t.Code} · ${t.Nom}`;
  const lignes = [
    plan.sousThemes.length ? nbr(plan.sousThemes.length, "sous-thème", "sous-thèmes") : "",
    plan.besoins.length ? nbr(plan.besoins.length, "besoin", "besoins") : "",
    plan.lignes.length ? nbr(plan.lignes.length, "ligne de panorama", "lignes de panorama") : "",
    plan.fichesSupprimees.length ? nbr(plan.fichesSupprimees.length, "fiche détaillée", "fiches détaillées") : "",
    plan.appelsSupprimes.length ? nbr(plan.appelsSupprimes.length, "appel à projets", "appels à projets") : "",
    plan.montage.length ? nbr(plan.montage.length, "question du montage financier", "questions du montage financier") : "",
  ].filter(Boolean);
  let html =
    `<p>La fiche « ${e(nomTheme)} » sera supprimée <strong>définitivement</strong>, avec tout son contenu :</p>` +
    `<ul><li>le thème lui-même</li>${lignes.map((x) => `<li>${x}</li>`).join("")}</ul>` +
    `<p class="fr-text--sm">Les financements et les organismes ne sont pas supprimés.</p>`;
  if (plan.appelsDetaches.length) html += `<div class="fr-alert fr-alert--info fr-alert--sm w-bloc"><p>${nbr(plan.appelsDetaches.length, "appel est partagé", "appels sont partagés")} avec d’autres thèmes : ${plan.appelsDetaches.length > 1 ? "ils sont conservés et détachés" : "il est conservé et détaché"} de ce thème : ${exemples(plan.appelsDetaches, (x) => x.Nom)}.</p></div>`;
  html += `<div class="fr-alert fr-alert--warning fr-alert--sm w-bloc"><p>Cette action ne peut pas être annulée depuis le widget.</p></div>`;
  const ok = await confirmer(`Supprimer la fiche ${t.Code} ?`, html, "Supprimer définitivement", { saisieAttendue: `${t.Code} - ${t.Nom}` });
  if (!ok) {
    declencheur?.focus?.();
    return;
  }
  try {
    await appliquer(plan.actions);
    rendre();
    window.scrollTo(0, 0);
    annoncer(`Fiche ${t.Code} supprimée avec son contenu.`);
  } catch (err) {
    erreur(err);
  }
}

const SECTION_DE = { Financements: "maintenance", Organismes: "maintenance", Themes: "perimetre", Sous_themes: "perimetre", Besoins: "besoins", Panorama: "panorama", Appels_a_projets: "appels", Fiches_detaillees: "fiches", Montage_financier: "montage" };

async function supprimer(table, id, declencheur) {
  const l = modele[table]?.get(id);
  if (!l || !SECTION_DE[table]) return;
  const imp = mod.impactSuppression(modele, table, id);
  const liste = (items) => `<ul>${items.map((x) => `<li>${e(x)}</li>`).join("")}</ul>`;
  const pluriel = (n, un, plusieurs) => (n > 1 ? plusieurs : un);
  const codeTheme = (tid) => modele.Themes.get(tid)?.Code ?? "?";
  let titre, html, fait;
  if (table === "Themes" || table === "Sous_themes") {
    const restes =
      table === "Themes"
        ? [
            [imp.sousThemes.length, "sous-thème", "sous-thèmes", "dans la partie 1"],
            [imp.besoins.length, "besoin", "besoins", "dans la partie 2"],
            [imp.lignes.length, "ligne de panorama", "lignes de panorama", "dans la partie 3"],
            [imp.appels.length, "appel à projets rattaché", "appels à projets rattachés", "dans la partie 4 (supprimez-les, ou décochez ce thème dans « Modifier »)"],
            [imp.montage.length, "question du montage financier", "questions du montage financier", "dans la partie 6"],
          ]
        : [[imp.lignes.length, "ligne de panorama", "lignes de panorama", "dans la partie 3"]];
    const bloquants = restes.filter(([n]) => n > 0);
    const nom = table === "Themes" ? `${l.Code} · ${l.Nom}` : l.Titre;
    if (bloquants.length) {
      await confirmer(
        table === "Themes" ? "Ce thème ne peut pas être supprimé" : "Ce sous-thème ne peut pas être supprimé",
        `<p>« ${e(nom)} » n’est pas vide. Supprimez d’abord :</p>${liste(bloquants.map(([n, un, plusieurs, ou]) => `${n} ${n > 1 ? plusieurs : un} (${ou})`))}`,
        "",
        { sansOui: true, libelleNon: "Fermer" }
      );
      declencheur?.focus?.();
      return;
    }
    titre = table === "Themes" ? "Supprimer ce thème ?" : "Supprimer ce sous-thème ?";
    fait = table === "Themes" ? "Thème supprimé." : "Sous-thème supprimé.";
    html = `<p>« ${e(nom)} » est vide : il sera supprimé.</p>`;
  } else if (table === "Financements") {
    const restes = [
      [imp.lignes.length, "ligne de panorama", "lignes de panorama", "dans les fiches par thème, partie Panorama"],
      [imp.appels.length, "appel à projets", "appels à projets", "partie Appels à projets"],
      [imp.questions.length, "question du montage financier", "questions du montage financier", "partie Montage financier"],
    ].filter(([n]) => n > 0);
    if (restes.length) {
      await confirmer(
        "Ce financement ne peut pas être supprimé",
        `<p>« ${e(mod.libelleFinancement(l))} » est encore utilisé par :</p>${liste(restes.map(([n, un, plusieurs, ou]) => `${n} ${n > 1 ? plusieurs : un} (${ou})`))}<p>Détachez-le d’abord. Pour le faire disparaître sans rien détacher, masquez-le avec l’interrupteur « Financement visible ».</p>`,
        "",
        { sansOui: true, libelleNon: "Fermer" }
      );
      declencheur?.focus?.();
      return;
    }
    titre = "Supprimer ce financement ?";
    fait = "Financement supprimé.";
    html = `<p>Le financement « ${e(mod.libelleFinancement(l))} » n’est utilisé nulle part : il sera supprimé.</p>`;
  } else if (table === "Organismes") {
    if (imp.financements.length) {
      const n = imp.financements.length;
      await confirmer(
        "Cet organisme ne peut pas être supprimé",
        `<p>« ${e(l.Nom)} » est l’organisme de ${n} financement${pluriel(n, "", "s")} :</p>${liste(imp.financements.slice(0, 15).map((f) => mod.libelleFinancement(f)))}${n > 15 ? "<p>…</p>" : ""}<p>Changez d’abord leur organisme (« Modifier le financement »).</p>`,
        "",
        { sansOui: true, libelleNon: "Fermer" }
      );
      declencheur?.focus?.();
      return;
    }
    titre = "Supprimer cet organisme ?";
    fait = "Organisme supprimé.";
    html = `<p>L’organisme « ${e(l.Nom)} » n’est utilisé par aucun financement : il sera supprimé.</p>`;
  } else if (table === "Panorama") {
    const nom = mod.nomAffiche(l, modele);
    titre = "Supprimer cette ligne du panorama ?";
    fait = "Ligne du panorama supprimée.";
    html = `<p>La ligne « ${e(nom)} » sera supprimée de la fiche. Le financement n’est pas supprimé.</p>`;
    if (imp.ficheOrpheline) {
      html += `<div class="fr-checkbox-group fr-checkbox-group--sm w-bloc"><input type="checkbox" id="confirmation-option"><label class="fr-label" for="confirmation-option">Supprimer aussi la fiche détaillée « ${e(imp.ficheOrpheline.Titre || "sans titre")} », que plus aucune ligne ne désignera</label></div>`;
    }
  } else if (table === "Appels_a_projets") {
    titre = "Supprimer cet appel à projets ?";
    fait = "Appel à projets supprimé.";
    html = `<p>L’appel « ${e(l.Nom)} » sera supprimé.</p>`;
    if (imp.themes.length > 1) {
      html += `<div class="fr-alert fr-alert--warning fr-alert--sm w-bloc"><p>Cet appel figure dans ${imp.themes.length} thèmes (${e(imp.themes.map(codeTheme).join(", "))}) : il sera supprimé de tous. Pour le retirer de ce thème seulement, utilisez « Modifier » et décochez ce thème.</p></div>`;
    }
  } else if (table === "Fiches_detaillees") {
    titre = "Supprimer cette fiche détaillée ?";
    fait = "Fiche détaillée supprimée.";
    html = `<p>La fiche « ${e(l.Titre || "sans titre")} » sera supprimée.</p>`;
    html += imp.lignes.length
      ? `<p>${imp.lignes.length} ligne${pluriel(imp.lignes.length, "", "s")} du panorama ${pluriel(imp.lignes.length, "la désigne", "la désignent")} et n’${pluriel(imp.lignes.length, "aura", "auront")} plus de fiche détaillée :</p>${liste(imp.lignes.map((p) => `${mod.nomAffiche(p, modele)} (${codeTheme(p.Theme)})`))}`
      : `<p>Aucune ligne du panorama ne la désigne.</p>`;
  } else if (table === "Montage_financier") {
    titre = "Supprimer cette question du montage financier ?";
    fait = "Question du montage financier supprimée.";
    html = `<p>La question « ${e(l.Question)} » et sa réponse seront supprimées.</p>`;
  } else {
    titre = "Supprimer ce besoin ?";
    fait = "Besoin supprimé.";
    html = `<p>Le besoin « ${e(l.Libelle)} » sera supprimé.</p>`;
    if (imp.lignes.length) {
      html += `<p>Il est retiré de ${imp.lignes.length} ligne${pluriel(imp.lignes.length, "", "s")} du panorama. Les appels à projets suivent automatiquement les lignes de leur financement.</p>`;
    }
    if (imp.lignesSansBesoin.length) {
      html += `<div class="fr-alert fr-alert--warning fr-alert--sm w-bloc"><p>${imp.lignesSansBesoin.length} ligne${pluriel(imp.lignesSansBesoin.length, "", "s")} du panorama n’${pluriel(imp.lignesSansBesoin.length, "aura", "auront")} plus aucun besoin et ne ${pluriel(imp.lignesSansBesoin.length, "sera", "seront")} plus proposée${pluriel(imp.lignesSansBesoin.length, "", "s")} par les besoins :</p>${liste(imp.lignesSansBesoin.map((p) => mod.nomAffiche(p, modele)))}</div>`;
    }
  }
  html += `<p class="fr-text--sm">Cette suppression est définitive.</p>`;
  const ok = await confirmer(titre, html, "Supprimer définitivement");
  if (!ok) {
    declencheur?.focus?.();
    return;
  }
  const avecFiche = Boolean($("confirmation-option")?.checked);
  declencheur.disabled = true;
  try {
    await appliquer(mod.actionsSuppression(modele, table, id, { avecFiche }));
    rendre();
    annoncer(fait);
    const t = SECTION_DE[table] === "maintenance" ? document.querySelector(`#mpanneau-${sousOnglet} h3`) : document.querySelector(`#${SECTION_DE[table]} h3, #${SECTION_DE[table]} summary`);
    if (t) {
      t.tabIndex = -1;
      t.focus();
    }
  } catch (err) {
    declencheur.disabled = false;
    erreur(err);
  }
}

function brancher() {
  document.addEventListener("click", (ev) => {
    fermerMenus(ev.target);
    const vueBtn = ev.target.closest?.("button[data-vue]");
    if (vueBtn) return choisirVue(vueBtn.dataset.vue);
    const mtab = ev.target.closest?.("button[data-mtab]");
    if (mtab) return choisirSousOnglet(mtab.dataset.mtab);
    const onglet = ev.target.closest?.('button[role="tab"][data-onglet]');
    if (onglet) return choisirOnglet(onglet.dataset.onglet);
    const lienMaint = ev.target.closest?.('a[href^="#mappel-"]');
    if (lienMaint) {
      ev.preventDefault();
      const cle = lienMaint.hash.slice(1);
      if (!document.getElementById(cle)) {
        Object.assign(filtres, { statut: "", theme: "", ancien: false, nonPublies: false });
        rendreMaintenance();
      }
      const b = basculerLigne(cle, true);
      document.getElementById(cle)?.scrollIntoView();
      b?.focus({ preventScroll: true });
      return;
    }
    const ligne = ev.target.closest?.("button[data-ligne]");
    if (ligne) return void basculerLigne(ligne.dataset.ligne);
    const lienAppel = ev.target.closest?.('a[href^="#appel-"]');
    if (lienAppel) {
      ev.preventDefault();
      choisirOnglet("appels");
      const cle = lienAppel.hash.slice(1);
      const b = basculerLigne(cle, true);
      document.getElementById(cle)?.scrollIntoView();
      b?.focus({ preventScroll: true });
      return;
    }
    const lien = ev.target.closest?.('a[href^="#fiche-"]');
    if (lien) {
      ev.preventDefault();
      choisirOnglet("fiches");
      const cle = lien.hash.slice(1);
      const b = basculerLigne(cle, true);
      document.getElementById(cle)?.scrollIntoView();
      b?.focus({ preventScroll: true });
      return;
    }
    const b = ev.target.closest?.("button[data-action]");
    if (b) surClic(b);
  });
  document.addEventListener("input", (ev) => {
    if (ev.target.dataset?.filtre) filtrerListe(ev.target.dataset.filtre, ev.target.value);
  });
  $("dialogue").addEventListener("change", (ev) => {
    if (ev.target.dataset?.picker) majChoixFinancement(ev.target.dataset.picker);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target.dataset?.filtre) ev.preventDefault(); // le filtre ne valide pas le formulaire
    if (ev.key === "Escape") {
      const ouvert = document.querySelector("details.w-plus[open]");
      if (ouvert) {
        ouvert.removeAttribute("open");
        ouvert.querySelector("summary")?.focus();
      }
      return;
    }
    const tab = ev.target.closest?.('button[role="tab"]');
    if (!tab) return;
    const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
    const n = tabs.length;
    const i = tabs.indexOf(tab);
    const cible = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[ev.key];
    if (cible === undefined) return;
    ev.preventDefault();
    tabs[cible].focus();
    tabs[cible].click();
  });
  document.addEventListener("change", (ev) => {
    if (ev.target instanceof HTMLInputElement && ev.target.dataset.toggle) surChangementInterrupteur(ev.target);
  });
  $("maintenance").addEventListener("input", (ev) => {
    if (ev.target.id !== "mf-q") return;
    filtres.q = ev.target.value;
    majListeFinancements();
  });
  $("maintenance").addEventListener("change", (ev) => {
    const { id, type, value, checked } = ev.target;
    if (id === "mf-org") {
      filtres.org = value;
      majListeFinancements();
    } else if (id === "ma-statut" || id === "ma-theme") {
      filtres[id === "ma-statut" ? "statut" : "theme"] = value;
      majListeAppels();
    } else if (type === "checkbox" && (id === "ma-ancien" || id === "ma-nonpub")) {
      filtres[id === "ma-ancien" ? "ancien" : "nonPublies"] = checked;
      majListeAppels();
    }
  });
  $("choix-theme").addEventListener("change", (ev) => {
    themeId = Number(ev.target.value);
    effacerMessages();
    rendre();
    window.scrollTo(0, 0);
  });
  $("btn-recharger").addEventListener("click", async () => {
    effacerMessages();
    try {
      await recharger();
      rendre();
      annoncer("Données rechargées.");
    } catch (err) {
      erreur(err);
    }
  });
  $("formulaire").addEventListener("submit", enregistrer);
  brancherAjout();
  $("dialogue-annuler").addEventListener("click", fermerDialogue);
  $("dialogue").addEventListener("cancel", (ev) => {
    ev.preventDefault();
    if (ev.target === $("dialogue")) fermerDialogue(); // Échap
  });
}

/* ======================================================================
   Démarrage
   ====================================================================== */

async function demarrer() {
  brancher();
  if (window.parent === window) {
    $("chargement").hidden = true;
    $("erreurs").innerHTML = `<div class="fr-alert fr-alert--info"><h2 class="fr-alert__title">Ce widget s’ouvre dans Grist</h2><p>Ajoutez-le à une page du document Grist (widget personnalisé, avec l’accès complet au document). Ouvert seul, il n’a pas de données à afficher.</p></div>`;
    return;
  }
  try {
    await chargerScript(CONFIG.scriptApiGrist);
    window.grist.ready({ requiredAccess: "full" });
    await recharger();
    themeId = mod.trier([...modele.Themes.values()])[0]?.id ?? 0;
    rendre();
  } catch (err) {
    $("chargement").hidden = true;
    erreur(err);
  }
}

demarrer();
