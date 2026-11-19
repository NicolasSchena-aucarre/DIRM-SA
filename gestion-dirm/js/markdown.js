// Markdown limité : paragraphes, listes à puces (« - »), **gras**, [texte](https://lien).
// Tout le HTML saisi est neutralisé AVANT la conversion : le résultat est sûr pour innerHTML.

export function echapper(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inline(s) {
  return s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, texte, url) =>
      `<a class="fr-link" href="${url}" target="_blank" rel="noopener noreferrer" title="${texte} - nouvelle fenêtre">${texte}</a>`
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/** Texte Markdown -> HTML. `classeP` s’applique aux paragraphes et listes. */
export function rendreMarkdown(source, classeP = "") {
  const attr = classeP ? ` class="${classeP}"` : "";
  const blocs = echapper(source).replaceAll("\r", "").split(/\n{2,}/);
  return blocs
    .map((bloc) => bloc.trim())
    .filter(Boolean)
    .map((bloc) => {
      const lignes = bloc.split("\n");
      if (lignes.every((l) => /^\s*-\s+/.test(l))) {
        const items = lignes.map((l) => `<li>${inline(l.replace(/^\s*-\s+/, ""))}</li>`).join("");
        return `<ul${attr}>${items}</ul>`;
      }
      return `<p${attr}>${inline(lignes.join(" "))}</p>`;
    })
    .join("");
}
