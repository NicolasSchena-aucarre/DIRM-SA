// Petits utilitaires de construction du DOM (le texte est toujours inséré comme texte, jamais comme HTML).
export const NBSP = "\u00a0";
export const FINE = "\u202f";

export function h(tag, attrs = {}, ...enfants) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const e of enfants.flat()) {
    if (e === null || e === undefined || e === false) continue;
    el.append(typeof e === "object" ? e : document.createTextNode(String(e)));
  }
  return el;
}

export const $ = (id) => document.getElementById(id);

export function vider(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// Texte visible uniquement des lecteurs d’écran.
export const masque = (texte) => h("span", { class: "fr-sr-only" }, texte);

// Lien externe : nouvel onglet, annoncé comme tel.
export function lienExterne(url, libelle, classe = "") {
  return h("a", { href: url, target: "_blank", rel: "noopener noreferrer", class: classe || false }, libelle, masque(` (nouvelle fenêtre)`));
}
