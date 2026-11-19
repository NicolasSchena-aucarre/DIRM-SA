// Widget public « Financements mobilisables » : choix des thèmes et des besoins, résultats, formulaires.
import { CONFIG } from "./config.js";
import { construireModele, resultats, calendrierAppel, pluriel } from "./modele.js";
import { h, $, vider, FINE, lienExterne } from "./dom.js";
import { ouvrirFormulaire } from "./formulaires.js";

let M = null;
const etat = { themes: new Set(), besoins: new Set() };
let boutonOrigine = null;

const BADGES = {
  "Ouvert": "fr-badge--success",
  "Au fil de l’eau": "fr-badge--info",
  "Clôture proche": "fr-badge--warning",
  "À venir": "fr-badge--new",
  "Annoncé": "fr-badge--new",
  "Phase 2 réservée": "fr-badge--new",
  "Ouvert sous conditions": "fr-badge--info",
};

// ---------- Chargement ----------

function chargerScript(src) {
  if (window.grist) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Impossible de charger l’API de Grist."));
    document.head.append(s);
  });
}

function afficherErreur(message) {
  const zone = $("erreurs");
  vider(zone);
  zone.append(h("div", { class: "fr-alert fr-alert--error" }, h("h2", { class: "fr-alert__title" }, "Les financements ne peuvent pas être affichés"), h("p", {}, message)));
}

async function charger() {
  const tables = {};
  const lues = await Promise.all(CONFIG.tables.map(async (t) => [t, await window.grist.docApi.fetchTable(t)]));
  for (const [nom, t] of lues) tables[nom] = t;
  M = construireModele(tables, new Date(), CONFIG.seuilClotureJours, CONFIG.organismesNonAffiches);
  if (!M.themes.length) console.warn(`Widget public : aucun thème publié (${M.themesTotal} thème(s) dans le document). Cochez « Publie » sur au moins un thème de la table Themes.`);
}

// ---------- Éléments communs ----------

function paragraphes(texte) {
  return texte.split(/\n+/).map((p) => p.trim()).filter(Boolean).map((p) => h("p", {}, p));
}

function caseACocher(id, libelle, coche, surChangement, fort = false) {
  const input = h("input", { type: "checkbox", id, checked: coche || false, onchange: (e) => surChangement(e.target.checked) });
  return h("div", { class: fort ? "fr-checkbox-group pub-toutsel" : "fr-checkbox-group" }, input, h("label", { class: "fr-label", for: id }, fort ? h("strong", {}, libelle) : libelle));
}

function rendreAvertissement() {
  const zone = $("avert");
  vider(zone);
  const texte = M.textes.bandeau_avertissement;
  if (texte) zone.append(h("div", { class: "fr-alert fr-alert--info pub-avert" }, h("h2", { class: "fr-alert__title" }, "À propos de cette fiche"), paragraphes(texte)));
  const contact = $("contact");
  vider(contact);
  if (M.textes.contact) contact.append("Une question\u202f? Écrivez à ", h("a", { href: `mailto:${M.textes.contact}` }, M.textes.contact), ".");
}

// ---------- Étape 1 : thèmes ----------

function rendreThemes() {
  const panneau = $("panneau-themes");
  vider(panneau);
  if (!M.themes.length) {
    panneau.append(h("p", { class: "pub-mention" }, "Aucun thème n’est publié pour le moment."));
    return;
  }
  const liste = h("div", { class: "pub-cases" }, M.themes.map((t) => caseACocher(`th-${t.id}`, t.Nom, etat.themes.has(t.id), (coche) => surTheme(t.id, coche))));
  panneau.append(h("fieldset", { class: "pub-groupe" }, h("legend", { class: "fr-sr-only" }, "Thèmes"), caseACocher("th-tous", "Tout sélectionner", false, surTousThemes, true), liste));
}

function surTheme(id, coche) {
  if (coche) etat.themes.add(id);
  else {
    etat.themes.delete(id);
    for (const b of M.besoinsParTheme.get(id) ?? []) etat.besoins.delete(b.id);
  }
  majSelection();
}

function surTousThemes(coche) {
  etat.themes = new Set(coche ? M.themes.map((t) => t.id) : []);
  if (!coche) etat.besoins = new Set();
  M.themes.forEach((t) => { const c = $(`th-${t.id}`); if (c) c.checked = coche; });
  majSelection();
}

function majThemes() {
  if (!M.themes.length) {
    $("compte-themes").textContent = "Aucun thème disponible";
    return;
  }
  const n = etat.themes.size;
  $("compte-themes").textContent = n ? pluriel(n, "thème sélectionné", "thèmes sélectionnés") : "Sélectionnez un ou plusieurs thèmes";
  const tous = $("th-tous");
  if (tous) tous.checked = M.themes.length > 0 && n === M.themes.length;
  M.themes.forEach((t) => { const c = $(`th-${t.id}`); if (c) c.checked = etat.themes.has(t.id); });
  const tags = $("tags-themes");
  vider(tags);
  M.themes.filter((t) => etat.themes.has(t.id)).forEach((t) => tags.append(h("li", {}, h("p", { class: "fr-tag" }, t.Nom))));
}

function rendrePresentations() {
  const zone = $("presentations");
  vider(zone);
  for (const t of M.themes.filter((x) => etat.themes.has(x.id))) {
    const sigles = String(t.Sigles_utiles ?? "").split(";").map((s) => s.trim()).filter(Boolean);
    zone.append(h("div", { class: "fr-callout pub-presentation" },
      h("h3", { class: "fr-callout__title fr-h6" }, t.Nom),
      paragraphes(String(t.Description ?? "")).map((p) => { p.className = "fr-callout__text"; return p; }),
      sigles.length ? h("details", { class: "pub-sigles" }, h("summary", {}, "Sigles utiles"), h("ul", {}, sigles.map((s) => h("li", {}, s)))) : null));
  }
}

// ---------- Étape 2 : besoins ----------

function rendreBesoins() {
  const liste = $("liste-besoins");
  const panneau = $("panneau-besoins");
  const choisis = M.themes.filter((t) => etat.themes.has(t.id));
  vider(panneau);
  liste.hidden = choisis.length === 0;
  $("aide-besoins").textContent = choisis.length ? "Plusieurs choix possibles. Les besoins sont regroupés par thème." : "Sélectionnez d’abord au moins un thème : les besoins proposés dépendent des thèmes choisis.";
  if (!choisis.length) return;
  const tous = caseACocher("bs-tous", "Tout sélectionner", false, surTousBesoins, true);
  panneau.append(tous);
  for (const t of choisis) {
    const bes = M.besoinsParTheme.get(t.id) ?? [];
    panneau.append(h("fieldset", { class: "pub-groupe" },
      h("legend", {}, `${t.Nom} · ${pluriel(bes.length, "besoin", "besoins")}`),
      bes.length ? h("div", { class: "pub-cases" }, bes.map((b) => caseACocher(`bs-${b.id}`, b.libelle, etat.besoins.has(b.id), (coche) => surBesoin(b.id, coche))))
        : h("p", { class: "pub-mention" }, "Aucun besoin n’est encore recensé pour ce thème.")));
  }
  majBesoins();
}

const besoinsDisponibles = () => M.themes.filter((t) => etat.themes.has(t.id)).flatMap((t) => M.besoinsParTheme.get(t.id) ?? []);

function surBesoin(id, coche) {
  if (coche) etat.besoins.add(id);
  else etat.besoins.delete(id);
  majBesoins();
  rendreResultats();
}

function surTousBesoins(coche) {
  const dispo = besoinsDisponibles();
  etat.besoins = new Set(coche ? dispo.map((b) => b.id) : []);
  dispo.forEach((b) => { const c = $(`bs-${b.id}`); if (c) c.checked = coche; });
  majBesoins();
  rendreResultats();
}

function majBesoins() {
  const dispo = besoinsDisponibles();
  const n = dispo.filter((b) => etat.besoins.has(b.id)).length;
  $("compte-besoins").textContent = n ? pluriel(n, "besoin sélectionné", "besoins sélectionnés") : "Sélectionnez un ou plusieurs besoins";
  const tous = $("bs-tous");
  if (tous) tous.checked = dispo.length > 0 && n === dispo.length;
}

// ---------- Étape 3 : résultats ----------

function tableDsfr(legende, entetes, lignes, classe = "") {
  return h("div", { class: `fr-table fr-table--no-caption pub-table ${classe}`.trim() }, h("div", { class: "fr-table__wrapper" }, h("div", { class: "fr-table__container" }, h("div", { class: "fr-table__content" },
    h("table", {}, h("caption", {}, legende), h("thead", {}, h("tr", {}, entetes.map((e) => h("th", { scope: "col" }, e)))), h("tbody", {}, lignes))))));
}

function elementFinancement(l) {
  if (l.liens.length === 1) return h("li", {}, lienExterne(l.liens[0].url, l.nom));
  if (l.liens.length > 1) return h("li", {}, l.nom, h("ul", { class: "pub-liens" }, l.liens.map((k) => h("li", {}, lienExterne(k.url, k.libelle)))));
  return h("li", {}, l.nom);
}

function blocTheme(bloc) {
  const lignes = bloc.besoins.map(({ besoin, lignes: ls }) => h("tr", {},
    h("th", { scope: "row" }, besoin.libelle),
    h("td", {}, ls.length ? h("ul", { class: "pub-financeurs" }, ls.map(elementFinancement)) : h("span", { class: "pub-mention" }, "Aucun financement recensé pour ce besoin."))));
  return h("div", { class: "pub-theme" },
    h("h3", { class: "fr-h5 pub-theme__titre" }, bloc.theme.Nom),
    tableDsfr(`Financements correspondant aux besoins sélectionnés, thème ${bloc.theme.Nom}`, ["Besoin", "Financements mobilisables"], lignes, "pub-table--financements"));
}

function ligneAppel(a) {
  const cal = calendrierAppel(a, new Date());
  const classeBadge = BADGES[a.statut] ?? "";
  return h("tr", { class: a.statut === "Clos" ? "pub-ligne-close" : false },
    h("th", { scope: "row" }, a.lien ? lienExterne(a.lien, a.nom) : a.nom, a.financeur ? h("span", { class: "pub-financeur" }, a.financeur) : null),
    h("td", {}, h("p", { class: `fr-badge fr-badge--sm fr-badge--no-icon ${classeBadge}`.trim() }, a.statut)),
    h("td", {}, cal.date, cal.delai ? h("span", { class: "pub-delai" }, cal.delai) : null));
}

function rendreResultats() {
  const resume = $("resume");
  const corps = $("resultats-corps");
  vider(corps);
  const dispo = besoinsDisponibles();
  if (!etat.themes.size) { resume.textContent = "Les résultats s’afficheront ici dès que vous aurez choisi un thème puis au moins un besoin."; return; }
  if (!dispo.some((b) => etat.besoins.has(b.id))) { resume.textContent = "Choisissez au moins un besoin pour afficher les financements et les appels à projets."; return; }

  const r = resultats(M, etat.themes, etat.besoins);
  const appels = r.appels.length;
  resume.textContent = `${pluriel(r.nbFinancements, "financement mobilisable", "financements mobilisables")} et ${pluriel(appels, "appel à projets", "appels à projets")} pour votre sélection.`;
  if (!r.nbFinancements && !appels) {
    corps.append(h("div", { class: "pub-vide" }, h("h3", { class: "fr-h5" }, "Aucun financement ne correspond à votre sélection"),
      h("p", {}, "Aucun financement ni appel à projets n’est recensé pour l’instant pour cette sélection. Essayez un autre besoin ou un autre thème, ou consultez les sites des financeurs régionaux et nationaux.")));
    return;
  }
  corps.append(h("p", { class: "pub-info" }, h("span", { class: "fr-icon-external-link-line", "aria-hidden": "true" }), " Les liens vers les sites des financeurs s’ouvrent dans un nouvel onglet."));
  corps.append(h("section", { class: "pub-section", "aria-labelledby": "t-financements" },
    h("h3", { class: "fr-h4", id: "t-financements" }, "Financements mobilisables"), r.blocs.map(blocTheme)));
  if (appels) {
    corps.append(h("section", { class: "pub-section", "aria-labelledby": "t-appels" },
      h("h3", { class: "fr-h4", id: "t-appels" }, `Appels à projets · ${pluriel(appels, "appel", "appels")}`),
      r.nbProches ? h("div", { class: "fr-alert fr-alert--warning fr-alert--sm pub-alerte-delai" }, h("p", {}, `${pluriel(r.nbProches, "appel se termine", "appels se terminent")} dans les ${CONFIG.seuilClotureJours}${FINE}prochains jours.`)) : null,
      tableDsfr("Appels à projets correspondant aux besoins sélectionnés", ["Appel à projets et financeur", "Statut", "Calendrier"], r.appels.map(ligneAppel), "pub-table--appels"),
      r.nbClos ? h("p", { class: "pub-info" }, h("span", { class: "fr-icon-information-line", "aria-hidden": "true" }), " Les appels clos restent affichés sur fond gris : ils aident à repérer les types de financement à surveiller pour une prochaine édition.") : null));
  } else {
    corps.append(h("section", { class: "pub-section", "aria-labelledby": "t-appels" }, h("h3", { class: "fr-h4", id: "t-appels" }, "Appels à projets"),
      h("p", {}, "Aucun appel à projets n’est recensé pour l’instant pour cette sélection.")));
  }
}

function majSelection() {
  majThemes();
  rendrePresentations();
  rendreBesoins();
  rendreResultats();
}

// ---------- Formulaires ----------

function fermerFormulaire() {
  $("vue-formulaire").hidden = true;
  vider($("vue-formulaire"));
  $("vue-principale").hidden = false;
  boutonOrigine?.focus();
}

function ouvrir(type, bouton) {
  boutonOrigine = bouton;
  const themesChoisis = M.themes.filter((t) => etat.themes.has(t.id));
  const ctx = {
    themes: themesChoisis.map((t) => t.Nom),
    besoins: besoinsDisponibles().filter((b) => etat.besoins.has(b.id)).map((b) => b.libelle),
    themesPublies: M.themes.map((t) => ({ id: t.id, nom: t.Nom })),
    contact: M.textes.contact || "",
    rgpdUrl: /^https?:\/\//.test(M.textes.rgpd_url ?? "") ? M.textes.rgpd_url : "",
    retour: fermerFormulaire,
    enregistrer: async (table, champs) => { await window.grist.docApi.applyUserActions([["AddRecord", table, null, champs]]); },
  };
  $("vue-principale").hidden = true;
  $("vue-formulaire").hidden = false;
  ouvrirFormulaire(type, ctx).focus();
  window.scrollTo(0, 0);
}

// ---------- Démarrage ----------

async function demarrer() {
  try {
    await chargerScript(CONFIG.scriptApiGrist);
    window.grist.ready({ requiredAccess: "full" });
    await charger();
  } catch (err) {
    console.error(err);
    afficherErreur("Vérifiez que le widget a accès au document et que les tables nécessaires sont lisibles.");
    $("compte-themes").textContent = "";
    return;
  }
  rendreAvertissement();
  rendreThemes();
  majSelection();
  $("btn-demande").addEventListener("click", (e) => ouvrir("demande", e.currentTarget));
  $("btn-financeur").addEventListener("click", (e) => ouvrir("financeur", e.currentTarget));
}

demarrer();
