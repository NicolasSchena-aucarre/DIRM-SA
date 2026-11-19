// Modèle de données du widget public : fonctions pures, sans accès au navigateur ni à Grist.

const NBSP = "\u00a0";

// Tableau « colonnes » de Grist (fetchTable) → liste de lignes.
export function lignes(table) {
  if (!table || !Array.isArray(table.id)) return [];
  const cles = Object.keys(table);
  return table.id.map((id, i) => {
    const r = {};
    for (const c of cles) r[c] = table[c][i];
    return r;
  });
}

// Colonne « liste de références » de Grist → tableau d’identifiants.
export function liste(valeur) {
  if (!Array.isArray(valeur)) return [];
  const v = valeur[0] === "L" ? valeur.slice(1) : valeur;
  return v.filter((x) => Number.isInteger(x) && x > 0);
}

export function ref(valeur) {
  return Number.isInteger(valeur) && valeur > 0 ? valeur : 0;
}

const texte = (v) => (typeof v === "string" ? v.trim() : "");
const parOrdre = (a, b) => (a.Ordre ?? 0) - (b.Ordre ?? 0) || a.id - b.id;

// Liens d’une fiche détaillée : « [libellé](https://…) | [libellé](https://…) » ou adresses seules.
export function analyserLiens(valeur) {
  const brut = typeof valeur === "string" ? valeur : "";
  const liens = [];
  const reste = brut.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, libelle, url) => {
    liens.push({ libelle: libelle.trim(), url });
    return " ";
  });
  for (const m of reste.matchAll(/https?:\/\/[^\s|)]+/g)) liens.push({ libelle: m[0], url: m[0] });
  const vus = new Set();
  return liens.filter((l) => !vus.has(l.url) && vus.add(l.url));
}

// « Organisme – Nom ». Un organisme générique (par exemple « Autres ») n’est pas affiché devant le nom.
export function libelleFinancement(f, organismes, masques = []) {
  if (!f) return "";
  const brut = organismes.get(ref(f.Organisme)) ?? "";
  const org = masques.some((x) => x.toLowerCase() === brut.toLowerCase()) ? "" : brut;
  const nom = texte(f.Nom);
  return org && nom ? `${org} – ${nom}` : nom || org;
}

// Statut d’un appel quand la colonne calculée de Grist n’est pas fournie.
export function statutAppel(a, aujourdhui, seuilJours = 30) {
  const part = texte(a.Statut_particulier);
  if (part) return part;
  const jour = Math.floor(aujourdhui.getTime() / 86400000) * 86400;
  const ouv = a.Ouverture || 0;
  const clo = a.Cloture || 0;
  if (!ouv && !clo) return "Au fil de l’eau";
  if (ouv && jour < ouv) return "À venir";
  if (clo && jour > clo) return "Clos";
  if (clo && (clo - jour) / 86400 <= seuilJours) return "Clôture proche";
  return "Ouvert";
}

// Construit le modèle à partir des tables lues (format fetchTable de Grist).
export function construireModele(tables, aujourdhui = new Date(), seuilJours = 30, masques = []) {
  const T = {};
  for (const [nom, t] of Object.entries(tables)) T[nom] = lignes(t);

  const textes = {};
  for (const r of T.Textes_communs ?? []) textes[r.Cle] = texte(r.Texte);

  const themes = (T.Themes ?? []).filter((t) => t.Publie).sort(parOrdre);
  const idsThemes = new Set(themes.map((t) => t.id));

  const besoinsParTheme = new Map(themes.map((t) => [t.id, []]));
  for (const b of [...(T.Besoins ?? [])].sort(parOrdre)) {
    const th = ref(b.Theme);
    if (idsThemes.has(th)) besoinsParTheme.get(th).push({ id: b.id, theme: th, libelle: texte(b.Libelle) });
  }

  const ordreSousTheme = new Map((T.Sous_themes ?? []).map((s) => [s.id, s.Ordre ?? 0]));
  const organismes = new Map((T.Organismes ?? []).map((o) => [o.id, texte(o.Nom)]));
  const financements = new Map((T.Financements ?? []).map((f) => [f.id, f]));
  const liensFiche = new Map((T.Fiches_detaillees ?? []).map((f) => [f.id, analyserLiens(f.Liens)]));

  const lignesPanorama = (T.Panorama ?? [])
    .filter((p) => p.Visible && idsThemes.has(ref(p.Theme)))
    .map((p) => ({
      id: p.id,
      theme: ref(p.Theme),
      ordreSousTheme: ordreSousTheme.get(ref(p.Sous_theme)) ?? 0,
      ordre: p.Ordre ?? 0,
      nom: texte(p.Dispositif) || libelleFinancement(financements.get(ref(p.Financement)), organismes, masques) || texte(p.Nom_affiche),
      besoins: liste(p.Besoins),
      liens: liensFiche.get(ref(p.Fiche_detaillee)) ?? [],
    }))
    .sort((a, b) => a.ordreSousTheme - b.ordreSousTheme || a.ordre - b.ordre || a.id - b.id);

  const appels = (T.Appels_a_projets ?? [])
    .filter((a) => a.Visible)
    .map((a) => ({
      id: a.id,
      nom: texte(a.Nom),
      lien: /^https?:\/\//.test(texte(a.Lien)) ? texte(a.Lien) : "",
      financeur: libelleFinancement(financements.get(ref(a.Financement)), organismes, masques),
      themes: liste(a.Themes),
      besoins: liste(a.Besoins),
      statut: texte(a.Statut) || statutAppel(a, aujourdhui, seuilJours),
      ouverture: a.Ouverture || 0,
      cloture: a.Cloture || 0,
      heure: texte(a.Heure_cloture),
    }));

  return { themes, besoinsParTheme, lignes: lignesPanorama, appels, textes };
}

// ---------- Dates ----------

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

// Date Grist (secondes, minuit UTC) → « 20 novembre 2026 » (espaces insécables).
export function dateLongue(secondes) {
  if (!secondes) return "";
  const d = new Date(secondes * 1000);
  return [d.getUTCDate() === 1 ? "1er" : String(d.getUTCDate()), MOIS[d.getUTCMonth()], d.getUTCFullYear()].join(NBSP);
}

// Écart en jours entre aujourd’hui (heure de Paris) et une date Grist.
function joursAvant(secondes, aujourdhui) {
  const p = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(aujourdhui);
  const g = (t) => Number(p.find((x) => x.type === t).value);
  const jour = Date.UTC(g("year"), g("month") - 1, g("day")) / 1000;
  return Math.round((secondes - jour) / 86400);
}

export function delai(secondes, aujourdhui) {
  if (!secondes) return "";
  const n = joursAvant(secondes, aujourdhui);
  if (n < 0) return "";
  if (n === 0) return "aujourd’hui";
  if (n === 1) return "demain";
  return `dans${NBSP}${n}${NBSP}jours`;
}

// Texte du calendrier d’un appel.
export function calendrierAppel(a, aujourdhui) {
  const heure = a.heure ? `${NBSP}à${NBSP}${a.heure}` : "";
  if (a.statut === "Clos") return { date: a.cloture ? `Clôturé le${NBSP}${dateLongue(a.cloture)}` : "Clôturé", delai: "" };
  if (a.cloture) return { date: `Clôture le${NBSP}${dateLongue(a.cloture)}${heure}`, delai: delai(a.cloture, aujourdhui) };
  if (a.ouverture && a.statut === "À venir") return { date: `Ouverture prévue le${NBSP}${dateLongue(a.ouverture)}`, delai: "" };
  if (a.statut === "Au fil de l’eau") return { date: "Dépôt possible à tout moment", delai: "" };
  return { date: "", delai: "" };
}

// ---------- Résultats ----------

const estClos = (a) => a.statut === "Clos";

// Appels à afficher : un de leurs besoins est coché ; sans besoin, un de leurs thèmes est coché.
export function appelsConcernes(M, themesSel, besoinsSel) {
  const retenus = M.appels.filter((a) => (a.besoins.length ? a.besoins.some((b) => besoinsSel.has(b)) : a.themes.some((t) => themesSel.has(t))));
  const tri = (a, b) => (a.cloture || Infinity) - (b.cloture || Infinity) || a.nom.localeCompare(b.nom, "fr");
  const ouverts = retenus.filter((a) => !estClos(a)).sort(tri);
  const clos = retenus.filter(estClos).sort((a, b) => (b.cloture || 0) - (a.cloture || 0) || a.nom.localeCompare(b.nom, "fr"));
  return [...ouverts, ...clos];
}

// Résultats pour la sélection : par thème, puis par besoin coché.
export function resultats(M, themesSel, besoinsSel) {
  const blocs = [];
  const distinctes = new Set();
  for (const t of M.themes) {
    if (!themesSel.has(t.id)) continue;
    const parBesoin = [];
    for (const b of M.besoinsParTheme.get(t.id) ?? []) {
      if (!besoinsSel.has(b.id)) continue;
      const ls = M.lignes.filter((l) => l.theme === t.id && l.besoins.includes(b.id));
      ls.forEach((l) => distinctes.add(l.id));
      parBesoin.push({ besoin: b, lignes: ls });
    }
    if (parBesoin.length) blocs.push({ theme: t, besoins: parBesoin });
  }
  const appels = blocs.length ? appelsConcernes(M, themesSel, besoinsSel) : [];
  return { blocs, nbFinancements: distinctes.size, appels, nbClos: appels.filter(estClos).length, nbProches: appels.filter((a) => a.statut === "Clôture proche").length };
}

export const pluriel = (n, un, plusieurs) => `${n}${NBSP}${n > 1 ? plusieurs : un}`;
