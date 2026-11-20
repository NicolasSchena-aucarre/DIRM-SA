// Logique pure du widget de gestion : aucune dépendance au DOM ni à Grist (testable sous Node).

/* ---------- Décodage des valeurs de cellules Grist ---------- */

/** Liste de références Grist ["L", 1, 2] (ou déjà [1, 2]) -> [1, 2]. */
export function liste(valeur) {
  const v = Array.isArray(valeur) ? (valeur[0] === "L" ? valeur.slice(1) : valeur) : [];
  return v.filter(Number.isInteger);
}

/** Référence Grist -> identifiant de ligne, ou 0 si vide. */
export function ref(valeur) {
  return Number.isInteger(valeur) && valeur > 0 ? valeur : 0;
}

/** Table Grist en colonnes {id:[…], Col:[…]} -> tableau d'objets {id, Col…}. */
export function lignes(table) {
  if (!table || !Array.isArray(table.id)) return [];
  const cles = Object.keys(table).filter((k) => k !== "id");
  return table.id.map((id, i) => {
    const o = { id };
    for (const k of cles) o[k] = table[k][i];
    return o;
  });
}

const LISTES = { Panorama: ["Besoins"], Appels_a_projets: ["Themes", "Besoins"], Montage_financier: ["Financements"] };
const REFS = {
  Sous_themes: ["Theme"], Besoins: ["Theme"], Montage_financier: ["Theme"],
  Panorama: ["Sous_theme", "Financement", "Fiche_detaillee", "Theme"], Appels_a_projets: ["Financement"],
};

/** Index du document : une Map (id -> ligne) par table, valeurs de références normalisées. */
export function construireModele(tables) {
  const M = {};
  for (const [nom, brut] of Object.entries(tables)) {
    const l = lignes(brut);
    for (const x of l) {
      for (const c of LISTES[nom] ?? []) x[c] = liste(x[c]);
      for (const c of REFS[nom] ?? []) x[c] = ref(x[c]);
    }
    M[nom] = new Map(l.map((x) => [x.id, x]));
  }
  // Organisme d'un financement : référence vers Organismes (identifiant dans `Organisme`, nom dans `OrganismeNom`).
  // Une ancienne colonne de texte est encore lue (nom seul, sans lien).
  for (const f of M.Financements?.values() ?? []) {
    const brut = f.Organisme;
    f.Organisme = Number.isInteger(brut) && brut > 0 ? brut : 0;
    f.OrganismeNom = typeof brut === "string" ? brut : (M.Organismes?.get(f.Organisme)?.Nom ?? "");
  }
  return M;
}

/* ---------- Dates et statut des appels à projets ---------- */

/** Secondes epoch (Date Grist) -> « AAAA-MM-JJ », ou « ». */
export function jourDepuisEpoch(s) {
  return typeof s === "number" && Number.isFinite(s) && s !== 0 ? new Date(s * 1000).toISOString().slice(0, 10) : "";
}

/** « AAAA-MM-JJ » -> secondes epoch UTC (minuit), ou null. */
export function epochDepuisJour(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000 : null;
}

export const jourLocal = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Même règle que la formule Statut de Grist. `aujourdhui` : « AAAA-MM-JJ ». */
export function statutAppel(a, aujourdhui, seuilJours = 30) {
  if (a.Statut_particulier) return a.Statut_particulier;
  const ouverture = jourDepuisEpoch(a.Ouverture);
  const cloture = jourDepuisEpoch(a.Cloture);
  if (ouverture && ouverture > aujourdhui) return "À venir";
  if (!cloture) return "Au fil de l’eau";
  if (cloture < aujourdhui) return "Clos";
  const jours = Math.round((Date.parse(cloture) - Date.parse(aujourdhui)) / 86400000);
  return jours <= seuilJours ? "Clôture proche" : "Ouvert";
}

/* ---------- Ordre d'affichage ---------- */

const cleOrdre = (v) => (Number.isFinite(v) ? v : 1e9);

/** Lignes d'un groupe, dans l'ordre d'affichage (Ordre, puis identifiant). */
export function trier(membres) {
  return [...membres].sort((a, b) => cleOrdre(a.Ordre) - cleOrdre(b.Ordre) || a.id - b.id);
}

/** Déplacer une ligne de `delta` rangs (−1 : monter, +1 : descendre) dans son groupe.
 *  Renvoie [[id, nouvelOrdre], …] pour les seules lignes à modifier ; le groupe est renuméroté 1…n. */
export function deplacement(membres, id, delta) {
  const tri = trier(membres);
  const i = tri.findIndex((l) => l.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= tri.length) return [];
  [tri[i], tri[j]] = [tri[j], tri[i]];
  const avant = new Map(membres.map((l) => [l.id, l.Ordre]));
  return tri.map((l, k) => [l.id, k + 1]).filter(([x, ordre]) => avant.get(x) !== ordre);
}

/* ---------- Libellés ---------- */

/** Nom de l'organisme d'un financement (« » s'il n'en a pas). */
export const nomOrganisme = (f) => f?.OrganismeNom ?? (typeof f?.Organisme === "string" ? f.Organisme : "");

/** « Organisme – Nom » quand l'organisme est renseigné, sinon le nom. */
export function libelleFinancement(f) {
  if (!f) return "";
  const nom = f.Nom || "(sans nom)";
  const org = nomOrganisme(f);
  return org ? `${org} – ${nom}` : nom;
}

export const nomAffiche = (p, M) => p.Dispositif || libelleFinancement(M.Financements.get(p.Financement));

/* ---------- Visibilité publique : pourquoi une ligne est (in)visible ---------- */

/** Raisons pour lesquelles une ligne du panorama n'est pas visible (tableau vide : elle l'est). */
export function raisonsPanorama(p, M) {
  const r = [];
  const theme = M.Themes.get(p.Theme);
  const fin = M.Financements.get(p.Financement);
  if (!p.Publie) r.push("ligne non publiée");
  if (theme && !theme.Publie) r.push("thème non publié");
  if (!fin) r.push("aucun financement");
  else if (!fin.Actif) r.push("financement masqué");
  return r;
}

export function raisonsAppel(a, M) {
  const r = [];
  const fin = M.Financements.get(a.Financement);
  if (!a.Publie) r.push("appel non publié");
  if (fin && !fin.Actif) r.push("financement masqué");
  return r;
}

export function raisonsMontage(q, M) {
  const r = [];
  if (!q.Publie) r.push("étape non publiée");
  const theme = M.Themes.get(q.Theme);
  if (theme && !theme.Publie) r.push("thème non publié");
  if (q.Financements.some((id) => M.Financements.get(id) && !M.Financements.get(id).Actif)) r.push("financement cité masqué");
  return r;
}

/* ---------- Contenu d'une fiche (un thème) ---------- */

export function fiche(M, themeId) {
  const tous = (nom) => [...M[nom].values()];
  const theme = M.Themes.get(themeId);
  const sousThemes = trier(tous("Sous_themes").filter((s) => s.Theme === themeId));
  const besoins = trier(tous("Besoins").filter((b) => b.Theme === themeId));
  const panorama = tous("Panorama").filter((p) => p.Theme === themeId);
  const parSousTheme = new Map(sousThemes.map((s) => [s.id, trier(panorama.filter((p) => p.Sous_theme === s.id))]));
  const sansSousTheme = trier(panorama.filter((p) => !parSousTheme.has(p.Sous_theme)));
  const appels = tous("Appels_a_projets").filter((a) => a.Themes.includes(themeId));
  // Fiches détaillées désignées par les lignes de ce thème, dans l'ordre du panorama.
  const ordrePanorama = [...parSousTheme.values()].flat().concat(sansSousTheme);
  const fichesIds = [];
  for (const p of ordrePanorama) if (p.Fiche_detaillee && !fichesIds.includes(p.Fiche_detaillee)) fichesIds.push(p.Fiche_detaillee);
  const montage = trier(tous("Montage_financier").filter((q) => q.Theme === themeId));
  return { theme, sousThemes, besoins, parSousTheme, sansSousTheme, appels, fichesIds, montage };
}

/** Lignes d'un groupe d'ordre : la même table, le même thème (et le même sous-thème pour le panorama). */
export function groupeOrdre(M, table, l) {
  const tous = [...M[table].values()];
  if (table === "Themes") return tous;
  if (table === "Panorama") return tous.filter((p) => p.Theme === l.Theme && p.Sous_theme === l.Sous_theme);
  return tous.filter((x) => x.Theme === l.Theme);
}

/** Thèmes qui utilisent un financement (par les lignes de panorama). */
export function themesDuFinancement(M, financementId) {
  const ids = new Set();
  for (const p of M.Panorama.values()) if (p.Financement === financementId && p.Theme) ids.add(p.Theme);
  return trier([...ids].map((id) => M.Themes.get(id)).filter(Boolean));
}

/* ---------- Recherche et ajout de financements ---------- */

/** Minuscules, sans accents ni ponctuation, espaces simples : pour comparer des libellés. */
export function normaliser(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Financements dont l'organisme + le nom contiennent tous les mots de la requête (ordre alphabétique).
 *  Requête vide : tous les financements. */
export function rechercherFinancements(M, requete) {
  const mots = normaliser(requete).split(" ").filter(Boolean);
  return [...M.Financements.values()]
    .filter((f) => {
      const cible = normaliser(`${nomOrganisme(f)} ${f.Nom}`);
      return mots.every((m) => cible.includes(m));
    })
    .sort((a, b) => libelleFinancement(a).localeCompare(libelleFinancement(b), "fr", { numeric: true }));
}

/** Financements existants proches d'un organisme + nom saisis.
 *  `identiques` : même organisme et même nom (à une mise en forme près) ; `proches` : l'un contient l'autre. */
export function financementsSimilaires(M, organisme, nom) {
  const n = normaliser(nom);
  const o = normaliser(organisme);
  const res = { identiques: [], proches: [] };
  if (!n) return res;
  for (const f of M.Financements.values()) {
    const fn = normaliser(f.Nom);
    const fo = normaliser(nomOrganisme(f));
    if (!fn) continue;
    if (fn === n && fo === o) res.identiques.push(f);
    else if ((fn.includes(n) || n.includes(fn)) && (!o || !fo || o === fo || fo.includes(o) || o.includes(fo))) res.proches.push(f);
  }
  return res;
}

/** Rang à donner à une nouvelle ligne placée à la fin d'un groupe. */
export function prochainOrdre(membres) {
  const ordres = membres.map((l) => l.Ordre).filter(Number.isFinite);
  return (ordres.length ? Math.max(...ordres) : membres.length) + 1;
}

/** Lignes de panorama d'un thème qui utilisent déjà un financement. */
export function lignesDuFinancementDansTheme(M, financementId, themeId) {
  return [...M.Panorama.values()].filter((p) => p.Financement === financementId && p.Theme === themeId);
}

/** Appels existants dont le nom est identique ou proche de celui saisi (comparaison sans accents ni ponctuation). */
export function appelsSimilaires(M, nom) {
  const n = normaliser(nom);
  const res = { identiques: [], proches: [] };
  if (n.length < 4) return res;
  for (const a of M.Appels_a_projets.values()) {
    const an = normaliser(a.Nom);
    if (an.length < 4) continue;
    if (an === n) res.identiques.push(a);
    else if (an.includes(n) || n.includes(an)) res.proches.push(a);
  }
  return res;
}

/** Fiches détaillées dont le titre est identique ou proche de celui saisi. */
export function fichesSimilaires(M, titre) {
  const n = normaliser(titre);
  const res = { identiques: [], proches: [] };
  if (n.length < 4) return res;
  for (const f of M.Fiches_detaillees.values()) {
    const ft = normaliser(f.Titre);
    if (ft.length < 4) continue;
    if (ft === n) res.identiques.push(f);
    else if (ft.includes(n) || n.includes(ft)) res.proches.push(f);
  }
  return res;
}

/** « AAAA-MM-JJ » d'il y a un an, ou « » si la date est invalide. */
export function ilYaUnAn(aujourdhui) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(aujourdhui ?? "");
  return m ? jourDepuisEpoch(Date.UTC(Number(m[1]) - 1, Number(m[2]) - 1, Number(m[3])) / 1000) : "";
}

/** Appel encore publié dont la clôture remonte à plus d'un an (quel que soit son statut particulier). */
export function clotureAncienne(a, aujourdhui) {
  const limite = ilYaUnAn(aujourdhui);
  const cloture = jourDepuisEpoch(a.Cloture);
  return Boolean(a.Publie && limite && cloture && cloture < limite);
}

/* ---------- Suppression ---------- */

const sansElement = (liste, id) => {
  const reste = liste.filter((x) => x !== id);
  return reste.length ? ["L", ...reste] : null;
};

/** Ce qu'entraîne la suppression d'une ligne (pour informer avant de confirmer). */
export function impactSuppression(M, table, id) {
  const tous = (nom) => [...M[nom].values()];
  if (table === "Panorama") {
    const p = M.Panorama.get(id);
    const fiche = p?.Fiche_detaillee ? M.Fiches_detaillees.get(p.Fiche_detaillee) : null;
    const autres = fiche ? tous("Panorama").filter((x) => x.Fiche_detaillee === fiche.id && x.id !== id) : [];
    return { ficheOrpheline: fiche && !autres.length ? fiche : null };
  }
  if (table === "Fiches_detaillees") return { lignes: tous("Panorama").filter((x) => x.Fiche_detaillee === id) };
  if (table === "Besoins") {
    const lignes = tous("Panorama").filter((x) => x.Besoins.includes(id));
    return { lignes, appels: [], lignesSansBesoin: lignes.filter((x) => x.Besoins.length === 1) };
  }
  if (table === "Financements") return usagesFinancement(M, id);
  if (table === "Organismes") return { financements: tous("Financements").filter((f) => f.Organisme === id) };
  if (table === "Appels_a_projets") return { themes: M.Appels_a_projets.get(id)?.Themes ?? [] };
  // Thème et sous-thème : on ne les supprime que s'ils sont vides (ces listes disent ce qui reste à supprimer).
  if (table === "Themes") {
    return {
      sousThemes: tous("Sous_themes").filter((x) => x.Theme === id),
      besoins: tous("Besoins").filter((x) => x.Theme === id),
      lignes: tous("Panorama").filter((x) => x.Theme === id),
      montage: tous("Montage_financier").filter((x) => x.Theme === id),
      appels: tous("Appels_a_projets").filter((x) => x.Themes.includes(id)),
    };
  }
  if (table === "Sous_themes") return { lignes: tous("Panorama").filter((x) => x.Sous_theme === id) };
  return {};
}

/** Actions Grist à envoyer en un seul lot : nettoyage des liens, puis suppression.
 *  `avecFiche` : pour une ligne du panorama, supprime aussi sa fiche si plus aucune ligne ne la désigne. */
export function actionsSuppression(M, table, id, { avecFiche = false } = {}) {
  const imp = impactSuppression(M, table, id);
  const actions = [];
  if (table === "Fiches_detaillees" && imp.lignes.length) {
    actions.push(["BulkUpdateRecord", "Panorama", imp.lignes.map((x) => x.id), { Fiche_detaillee: imp.lignes.map(() => 0) }]);
  }
  if (table === "Besoins") {
    if (imp.lignes.length) actions.push(["BulkUpdateRecord", "Panorama", imp.lignes.map((x) => x.id), { Besoins: imp.lignes.map((x) => sansElement(x.Besoins, id)) }]);
  }
  actions.push(["RemoveRecord", table, id]);
  if (table === "Panorama" && avecFiche && imp.ficheOrpheline) actions.push(["RemoveRecord", "Fiches_detaillees", imp.ficheOrpheline.id]);
  return actions;
}

/* ---------- Maintenance : usages et doublons de financements ---------- */

/** Ce qui utilise un financement : lignes de panorama, appels et questions du montage. */
export function usagesFinancement(M, id) {
  const tous = (nom) => [...M[nom].values()];
  return {
    lignes: tous("Panorama").filter((p) => p.Financement === id),
    appels: tous("Appels_a_projets").filter((a) => a.Financement === id),
    questions: tous("Montage_financier").filter((q) => q.Financements.includes(id)),
  };
}

/** Identifiants des financements qui partagent le même organisme et le même nom (à une mise en forme près). */
export function doublonsFinancements(M) {
  const groupes = new Map();
  for (const f of M.Financements.values()) {
    const cle = normaliser(`${nomOrganisme(f)} ${f.Nom}`);
    if (!cle) continue;
    groupes.set(cle, [...(groupes.get(cle) ?? []), f.id]);
  }
  return new Set([...groupes.values()].filter((g) => g.length > 1).flat());
}

/** Un appel appartient à un thème quand il le cite : c'est ainsi que les fiches du client le rattachent. */
export function appelDuTheme(M, a, themeId) {
  return a.Themes.includes(themeId);
}

/**
 * Besoins d'un appel (règle B) : ceux des lignes du panorama qui ont le même financement que l'appel,
 * dans les thèmes où l'appel figure. Rien n'est saisi à la main : la colonne « Besoins » des appels n'est plus utilisée.
 */
export function besoinsDeduitsAppel(M, a) {
  if (!a.Financement) return [];
  const themes = a.Themes.length ? new Set(a.Themes) : null;
  const besoins = new Set();
  for (const p of M.Panorama.values()) if (p.Financement === a.Financement && (!themes || themes.has(p.Theme))) p.Besoins.forEach((b) => besoins.add(b));
  return [...besoins];
}

/* ---------- Actions sur toute une fiche (un thème) ---------- */

/** Ce que contient la fiche d'un thème (lignes de panorama, appels, questions du montage). */
export function elementsDuTheme(M, id) {
  const tous = (nom) => [...M[nom].values()];
  return {
    lignes: tous("Panorama").filter((p) => p.Theme === id),
    appels: tous("Appels_a_projets").filter((a) => appelDuTheme(M, a, id)),
    montage: tous("Montage_financier").filter((q) => q.Theme === id),
  };
}

/** Publication de tout ce qui n'est pas encore publié dans la fiche : éléments, points d'attention, actions Grist. */
export function planPublication(M, id, aujourdhui) {
  const theme = M.Themes.get(id);
  const { lignes, appels, montage } = elementsDuTheme(M, id);
  const aPublier = {
    theme: theme && !theme.Publie ? [theme] : [],
    lignes: lignes.filter((p) => !p.Publie),
    appels: appels.filter((a) => !a.Publie),
    montage: montage.filter((q) => !q.Publie),
  };
  const total = aPublier.theme.length + aPublier.lignes.length + aPublier.appels.length + aPublier.montage.length;
  const alertes = {
    financementsMasques: aPublier.lignes.filter((p) => {
      const f = M.Financements.get(p.Financement);
      return !f || !f.Actif;
    }),
    appelsPartages: aPublier.appels.filter((a) => a.Themes.some((t) => t !== id)),
    lignesSansBesoin: aPublier.lignes.filter((p) => p.Besoins.length === 0),
    appelsAnciens: aPublier.appels.filter((a) => clotureAncienne({ ...a, Publie: true }, aujourdhui)),
  };
  const actions = [];
  for (const [cle, table] of [["theme", "Themes"], ["lignes", "Panorama"], ["appels", "Appels_a_projets"], ["montage", "Montage_financier"]]) {
    const ids = aPublier[cle].map((x) => x.id);
    if (ids.length) actions.push(["BulkUpdateRecord", table, ids, { Publie: ids.map(() => true) }]);
  }
  return { aPublier, total, alertes, actions };
}

/** Suppression d'un thème et de tout son contenu. Les appels partagés avec d'autres thèmes sont conservés et détachés ;
 *  les fiches détaillées ne sont supprimées que si seules les lignes supprimées les désignent. Financements et organismes ne sont jamais touchés. */
export function planSuppressionTheme(M, id) {
  const tous = (nom) => [...M[nom].values()];
  const sousThemes = tous("Sous_themes").filter((x) => x.Theme === id);
  const besoins = tous("Besoins").filter((x) => x.Theme === id);
  const lignes = tous("Panorama").filter((p) => p.Theme === id);
  const montage = tous("Montage_financier").filter((q) => q.Theme === id);
  const lies = tous("Appels_a_projets").filter((a) => a.Themes.includes(id));
  const exclusif = (a) => a.Themes.every((t) => t === id);
  const appelsSupprimes = lies.filter(exclusif);
  const appelsDetaches = lies.filter((a) => !exclusif(a));
  const idsLignes = new Set(lignes.map((p) => p.id));
  const fichesSupprimees = [...new Set(lignes.map((p) => p.Fiche_detaillee).filter(Boolean))]
    .filter((fid) => tous("Panorama").filter((p) => p.Fiche_detaillee === fid).every((p) => idsLignes.has(p.id)))
    .map((fid) => M.Fiches_detaillees.get(fid))
    .filter(Boolean);
  const actions = [];
  if (appelsDetaches.length) {
    const liste = (valeurs) => (valeurs.length ? ["L", ...valeurs] : null);
    actions.push([
      "BulkUpdateRecord",
      "Appels_a_projets",
      appelsDetaches.map((a) => a.id),
      { Themes: appelsDetaches.map((a) => liste(a.Themes.filter((t) => t !== id))) },
    ]);
  }
  const retirer = (table, l) => {
    if (l.length) actions.push(["BulkRemoveRecord", table, l.map((x) => x.id)]);
  };
  retirer("Panorama", lignes);
  retirer("Fiches_detaillees", fichesSupprimees);
  retirer("Appels_a_projets", appelsSupprimes);
  retirer("Montage_financier", montage);
  retirer("Besoins", besoins);
  retirer("Sous_themes", sousThemes);
  actions.push(["RemoveRecord", "Themes", id]);
  return { sousThemes, besoins, lignes, montage, appelsSupprimes, appelsDetaches, fichesSupprimees, actions };
}
