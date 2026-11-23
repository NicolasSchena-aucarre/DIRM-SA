// PDF de la sélection (pdfmake, chargé seulement au clic). Reprend les thèmes et besoins cochés.
import { appelsConcernes, calendrierAppel, pluriel } from "./modele.js";

const BLEU = "#000091";
const GRIS = "#666666";
const FOND = "#f6f6f6";
const TRAIT = "#dddddd";
const COULEURS_STATUT = { "Ouvert": "#18753c", "Clôture proche": "#b34000", "Au fil de l’eau": "#0063cb", "À venir": "#6e445a", "Annoncé": "#6e445a", "Clos": GRIS };

// ---------- Chargement de la bibliothèque et des polices ----------

function chargerScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Impossible de charger ${src}`));
    document.head.append(s);
  });
}

let pret = null;
export function chargerPdfmake(cfg) {
  if (!pret) {
    pret = (async () => {
      if (!window.pdfMake) await chargerScript(cfg.scriptPdfmake);
      if (!window.POLICES_MARIANNE) await chargerScript(cfg.scriptPolices);
      window.pdfMake.addVirtualFileSystem(window.POLICES_MARIANNE);
      window.pdfMake.addFonts({ Marianne: { normal: "Marianne-Regular.ttf", bold: "Marianne-Bold.ttf", italics: "Marianne-Regular_Italic.ttf", bolditalics: "Marianne-Bold_Italic.ttf" } });
    })().catch((e) => { pret = null; throw e; });
  }
  return pret;
}

// ---------- Texte ----------

// Seuls les caractères de la police Marianne embarquée sont conservés (pas de carré vide dans le PDF).
const CARACTERE_OK = /[\n\u0020-\u007e\u00a0-\u00ff\u0152\u0153\u0178\u021b\u2010\u2011\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac\u2192\u202f\u2082\u2083\u2264\u2265]/;
export function nettoyer(s) {
  return Array.from(String(s ?? "").replaceAll("\r", "")).filter((c) => CARACTERE_OK.test(c)).join("");
}

const lien = (texte, url, extra = {}) => ({ text: nettoyer(texte), link: url, color: BLEU, decoration: "underline", ...extra });

// Texte avec **gras** et [libellé](https://lien) → morceaux de texte pdfmake.
export function morceaux(texte, base = {}) {
  const t = nettoyer(texte);
  const out = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*/g;
  let i = 0;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (m.index > i) out.push({ text: t.slice(i, m.index), ...base });
    out.push(m[1] ? lien(m[1], m[2], base) : { text: m[3], bold: true, ...base });
    i = re.lastIndex;
  }
  if (i < t.length) out.push({ text: t.slice(i), ...base });
  return out.length ? out : [{ text: "", ...base }];
}

// Markdown limité (paragraphes, listes « - ») → blocs pdfmake.
export function blocs(texte, base = {}, marge = [0, 0, 0, 4]) {
  return nettoyer(texte).split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).map((bloc) => {
    const lignes = bloc.split("\n");
    if (lignes.every((l) => /^\s*-\s+/.test(l))) return { ul: lignes.map((l) => ({ text: morceaux(l.replace(/^\s*-\s+/, ""), base) })), margin: marge };
    return { text: morceaux(lignes.join(" "), base), margin: marge };
  });
}

const cellule = (texte, base = {}) => ({ stack: texte ? blocs(texte, base, [0, 0, 0, 3]) : [{ text: "" }] });
const entete = (texte) => ({ text: texte, bold: true, fillColor: FOND });

const miseEnPageTableau = {
  hLineColor: () => TRAIT,
  vLineColor: () => TRAIT,
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 4,
  paddingBottom: () => 2,
};

// Un titre ne reste jamais seul en bas de page : on le lie à son tableau quand celui-ci est court.
const lier = (titres, tableau, nbLignes) => (nbLignes <= 14 ? [{ stack: [...titres, tableau], unbreakable: true }] : [...titres, tableau]);

function titre(texte, niveau, extra = {}) {
  const styles = { 1: { fontSize: 20, bold: true, margin: [0, 0, 0, 10] }, 2: { fontSize: 14, bold: true, margin: [0, 16, 0, 6], color: BLEU }, 3: { fontSize: 11.5, bold: true, margin: [0, 12, 0, 4] } };
  return { text: nettoyer(texte), ...styles[niveau], ...(niveau > 1 ? { headlineLevel: 1 } : {}), ...extra };
}

// ---------- Sections ----------

function elementFinancement(l) {
  if (l.liens.length === 1) return { text: nettoyer(l.nom), link: l.liens[0].url, color: BLEU, decoration: "underline" };
  if (l.liens.length > 1) {
    return { stack: [{ text: nettoyer(l.nom) }, { ul: l.liens.map((k) => lien(k.libelle, k.url, { fontSize: 8.5 })), margin: [8, 2, 0, 0] }], margin: [0, 0, 0, 2] };
  }
  return { text: nettoyer(l.nom) };
}

function tableFinancements(M, theme, besoinsTheme) {
  const lignes = besoinsTheme.map((b) => {
    const ls = M.lignes.filter((l) => l.theme === theme.id && l.besoins.includes(b.id));
    return [{ text: nettoyer(b.libelle), bold: true }, ls.length ? { ul: ls.map(elementFinancement), margin: [0, 0, 0, 2] } : { text: "Aucun financement recensé pour ce besoin.", color: GRIS }];
  });
  return { table: { headerRows: 1, widths: ["34%", "*"], body: [[entete("Besoin"), entete("Financements mobilisables")], ...lignes] }, layout: miseEnPageTableau, fontSize: 9.5 };
}

function sectionPanorama(M, lignes, titreSection) {
  const groupes = new Map();
  for (const l of lignes) groupes.set(l.sousTheme, [...(groupes.get(l.sousTheme) ?? []), l]);
  const ordonnes = [...groupes.entries()].sort((a, b) => (M.sousThemes.get(a[0])?.ordre ?? 0) - (M.sousThemes.get(b[0])?.ordre ?? 0));
  return ordonnes.flatMap(([id, ls], i) => lier([...(i === 0 ? [titreSection] : []), titre(M.sousThemes.get(id)?.titre || "Autres financements", 3)],
    { table: { headerRows: 1, widths: ["22%", "26%", "26%", "26%"], body: [[entete("Dispositif"), entete("À utiliser pour…"), entete("Fonctionnement"), entete("Accès et situation")],
      ...ls.map((l) => [{ text: nettoyer(l.nom), bold: true }, cellule(l.aUtiliser), cellule(l.fonctionnement), cellule(l.acces)])] }, layout: miseEnPageTableau, fontSize: 8.5 }, ls.length));
}

function tableAppels(appels, aujourdhui) {
  const lignes = appels.map((a) => {
    const cal = calendrierAppel(a, aujourdhui);
    const clos = a.statut === "Clos";
    const fond = clos ? "#eeeeee" : null;
    return [
      { stack: [a.lien ? lien(a.nom, a.lien) : { text: nettoyer(a.nom) }, ...(a.financeur ? [{ text: nettoyer(a.financeur), fontSize: 8, color: GRIS }] : [])], fillColor: fond },
      { text: nettoyer(a.statut), bold: true, color: COULEURS_STATUT[a.statut] ?? GRIS, fillColor: fond },
      { stack: [{ text: nettoyer(cal.date) }, ...(cal.delai ? [{ text: nettoyer(cal.delai), fontSize: 8, color: GRIS }] : [])], fillColor: fond },
    ];
  });
  return { table: { headerRows: 1, widths: ["*", "20%", "28%"], body: [[entete("Appel à projets et financeur"), entete("Statut"), entete("Calendrier")], ...lignes] }, layout: miseEnPageTableau, fontSize: 9.5 };
}

function fichesDetaillees(lignes) {
  return lignes.filter((l) => l.fiche).flatMap((l) => {
    const lignesFiche = l.fiche.rubriques.map((r) => [{ text: r.libelle, bold: true, fillColor: FOND }, cellule(r.texte)]);
    if (l.fiche.liens.length) lignesFiche.push([{ text: l.fiche.liens.length > 1 ? "Liens" : "Lien", bold: true, fillColor: FOND }, { ul: l.fiche.liens.map((k) => lien(k.libelle, k.url)) }]);
    if (!lignesFiche.length) return [];
    // Le titre de la fiche est la ligne d’en-tête du tableau : il ne reste pas seul en bas de page et se répète si la fiche change de page.
    const enTete = [{ text: nettoyer(l.nom), bold: true, fontSize: 10.5, colSpan: 2, fillColor: "#e3e3fd" }, {}];
    return [{ table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths: [105, "*"], body: [enTete, ...lignesFiche] }, layout: miseEnPageTableau, fontSize: 9, margin: [0, 8, 0, 0] }];
  });
}

function sectionTheme(M, theme, besoinsSel, aujourdhui, premier) {
  const besoinsTheme = (M.besoinsParTheme.get(theme.id) ?? []).filter((b) => besoinsSel.has(b.id));
  const lignes = M.lignes.filter((l) => l.theme === theme.id && l.besoins.some((b) => besoinsSel.has(b)));
  const sigles = String(theme.Sigles_utiles ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  const appels = appelsConcernes(M, new Set([theme.id]), new Set(besoinsTheme.map((b) => b.id)));
  const questions = M.montage.filter((q) => q.theme === theme.id);
  const contenu = [titre(theme.Nom, 1, premier ? { margin: [0, 24, 0, 10] } : { pageBreak: "before" }), ...blocs(String(theme.Description ?? ""), {}, [0, 0, 0, 6])];
  if (sigles.length) contenu.push({ text: "Sigles utiles", bold: true, fontSize: 9, margin: [0, 4, 0, 2] }, { ul: sigles.map((s) => nettoyer(s)), fontSize: 8.5, color: GRIS });
  if (questions.length) {
    const blocsQuestions = questions.map((q) => ({ stack: [{ text: nettoyer(q.question), bold: true, margin: [0, 6, 0, 2] }, ...blocs(q.reponse, { fontSize: 9.5 }, [0, 0, 0, 4])], unbreakable: true }));
    contenu.push({ stack: [titre("Montage financier", 2), blocsQuestions[0]], unbreakable: true }, ...blocsQuestions.slice(1));
  }
  contenu.push(...lier([titre("Financements mobilisables selon vos besoins", 2)], tableFinancements(M, theme, besoinsTheme), besoinsTheme.length));
  if (lignes.length) contenu.push(...sectionPanorama(M, lignes, titre("Panorama des financements", 2)));
  contenu.push(...lier([titre("Appels à projets", 2)], appels.length ? tableAppels(appels, aujourdhui) : { text: "Aucun appel à projets n’est recensé pour l’instant pour cette sélection.", color: GRIS }, appels.length));
  const fiches = fichesDetaillees(lignes);
  if (fiches.length) contenu.push({ stack: [titre("Fiches détaillées", 2), fiches[0]], unbreakable: true }, ...fiches.slice(1));
  return contenu;
}

// ---------- Document ----------

const dateFr = (d) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" }).format(d);

async function texteDe(url) {
  try { const r = await fetch(url); return r.ok ? await r.text() : null; } catch { return null; }
}
async function imageDe(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const octets = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (const o of octets) bin += String.fromCharCode(o);
    return `data:image/png;base64,${btoa(bin)}`;
  } catch { return null; }
}

export function construireDocument(M, themesSel, besoinsSel, aujourdhui, images = {}) {
  const themes = M.themes.filter((t) => themesSel.has(t.id));
  const recap = themes.map((t) => {
    const bes = (M.besoinsParTheme.get(t.id) ?? []).filter((b) => besoinsSel.has(b.id));
    return { stack: [{ text: nettoyer(t.Nom), bold: true, margin: [0, 6, 0, 2] }, { ul: bes.map((b) => nettoyer(b.libelle)), fontSize: 9.5 }] };
  });
  const avert = M.textes.bandeau_avertissement ? [{ stack: [{ table: { widths: ["*"], body: [[{ stack: [{ text: "À propos de cette fiche", bold: true, margin: [0, 0, 0, 4] }, ...blocs(M.textes.bandeau_avertissement, { fontSize: 8.5 }, [0, 0, 0, 3])], fillColor: FOND, margin: [6, 6, 6, 3] }]] }, layout: { ...miseEnPageTableau, hLineWidth: () => 0.5 } }], unbreakable: true, margin: [0, 20, 0, 0] }] : [];
  const garde = [
    { columns: [
      { stack: [images.marianne ? { svg: images.marianne, width: 84 } : { text: "" }, { text: "RÉPUBLIQUE\nFRANÇAISE", bold: true, fontSize: 12, margin: [0, 4, 0, 0] }], width: "*" },
      images.dsf ? { image: images.dsf, width: 130 } : { text: "", width: 130 },
    ] },
    { text: "Financements mobilisables pour la mise en œuvre du plan d’action du DSF Sud-Atlantique", fontSize: 24, bold: true, margin: [0, 40, 0, 10] },
    { text: `Document généré le ${dateFr(aujourdhui)}`, color: GRIS, margin: [0, 0, 0, 24] },
    { text: "Votre sélection", fontSize: 14, bold: true, color: BLEU, margin: [0, 0, 0, 4] },
    ...recap,
    ...avert,
  ];
  const contenu = [...garde, ...themes.flatMap((t, i) => sectionTheme(M, t, besoinsSel, aujourdhui, i === 0))];
  return {
    pageSize: "A4",
    pageMargins: [40, 52, 40, 48],
    defaultStyle: { font: "Marianne", fontSize: 10, lineHeight: 1.15 },
    info: { title: "Financements mobilisables – DSF Sud-Atlantique", subject: "Sélection de thèmes et de besoins", creator: "DIRM Sud-Atlantique", keywords: "financements, appels à projets, DSF, Sud-Atlantique" },
    header: (page) => (page === 1 ? null : { text: "Financements mobilisables – DSF Sud-Atlantique", fontSize: 8, color: GRIS, margin: [40, 24, 40, 0] }),
    footer: (page, total) => ({ columns: [{ text: `Document généré le ${dateFr(aujourdhui)}`, fontSize: 8, color: GRIS }, { text: `Page ${page} / ${total}`, fontSize: 8, color: GRIS, alignment: "right" }], margin: [40, 0, 40, 0] }),
    pageBreakBefore: (noeud, suivants) => Boolean(noeud.headlineLevel === 1 && suivants.length === 0),
    content: contenu,
  };
}

export async function genererPdf({ M, themesSel, besoinsSel, aujourdhui = new Date(), config }) {
  await chargerPdfmake(config);
  const [marianne, dsf] = await Promise.all([texteDe("assets/bloc-marianne.svg"), imageDe("assets/logo-dsf.png")]);
  const definition = construireDocument(M, themesSel, besoinsSel, aujourdhui, { marianne, dsf });
  const blob = await window.pdfMake.createPdf(definition).getBlob();
  const texteBrut = new TextDecoder("latin1").decode(await blob.arrayBuffer());
  const pages = (texteBrut.match(/\/Type\s*\/Page(?![a-z])/g) ?? []).length;
  const jour = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(aujourdhui);
  return { blob, pages, taille: blob.size, nom: `financements-dsf-sud-atlantique-${jour}.pdf`, date: dateFr(aujourdhui), libelle: pluriel(pages, "page", "pages") };
}
