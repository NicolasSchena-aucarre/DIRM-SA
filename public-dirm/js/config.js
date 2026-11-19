// Réglages du widget public. Seul fichier à adapter selon l’installation.
export const CONFIG = {
  // Script « API plugin » de Grist. À remplacer par celui de votre instance,
  // par exemple "https://grist.exemple.gouv.fr/grist-plugin-api.js".
  scriptApiGrist: "https://grist.aucarre.tech/grist-plugin-api.js",

  // Tables lues par le widget (identifiants Grist).
  tables: ["Themes", "Sous_themes", "Besoins", "Organismes", "Financements", "Panorama", "Fiches_detaillees", "Appels_a_projets", "Textes_communs"],

  // Tables où les deux formulaires du bas de page enregistrent leurs envois.
  tablesEnvoi: { demande: "Demandes_financement", financeur: "Propositions_financeurs" },

  // Une clôture dans ce délai (en jours) donne le statut « Clôture proche ».
  seuilClotureJours: 30,

  // Organismes génériques non affichés devant le nom d’un financement (« Autres – Banque des Territoires » devient « Banque des Territoires »).
  organismesNonAffiches: ["Autres"],

  // Listes de choix des formulaires.
  profils: ["Pêcheur ou armement", "Aquaculteur ou conchyliculteur", "Port ou gestionnaire portuaire", "Collectivité territoriale", "Association", "Organisme de recherche", "Entreprise", "Autre"],
  typesAide: ["Subvention", "Prêt ou avance remboursable", "Accompagnement technique", "Je ne sais pas"],
  calendriers: ["Dans les 6 prochains mois", "Entre 6 et 12 mois", "Dans plus d’un an", "Je ne sais pas encore"],
  typesOrganisme: ["Union européenne ou programme européen", "État ou établissement public", "Collectivité territoriale", "Fondation, fonds de dotation ou entreprise", "Filière professionnelle ou association", "Autre"],
  modalites: ["Appel à projets avec date limite", "Dépôt au fil de l’eau", "Campagne périodique (annuelle, semestrielle…)"],
};
