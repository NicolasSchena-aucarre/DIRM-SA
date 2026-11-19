// Réglages du widget de gestion. Seul fichier à adapter selon l'installation.
export const CONFIG = {
  // Script « API plugin » de Grist. À remplacer par celui de votre instance quand elle est connue,
  // par exemple "https://grist.exemple.gouv.fr/grist-plugin-api.js".
  scriptApiGrist: "https://docs.getgrist.com/grist-plugin-api.js",

  // Tables lues par le widget (identifiants Grist).
  tables: ["Themes", "Sous_themes", "Besoins", "Organismes", "Financements", "Panorama", "Fiches_detaillees", "Appels_a_projets", "Montage_financier"],

  // Une clôture dans ce délai (en jours) donne le statut « Clôture proche ».
  seuilClotureJours: 30,

  // Choix de la colonne Appels_a_projets.Statut_particulier.
  statutsParticuliers: ["Annoncé", "Phase 2 réservée", "Ouvert sous conditions", "Aucun appel confirmé", "À venir", "Clos", "Ouvert"],
};
