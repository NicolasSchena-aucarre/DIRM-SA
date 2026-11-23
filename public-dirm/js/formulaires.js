// Les deux formulaires du bas de page : « Signaler votre besoin » et « Proposer votre dispositif ».
import { CONFIG } from "./config.js";
import { h, $, vider, FINE } from "./dom.js";

// Styles des formulaires : chargés à la première ouverture seulement (sobriété : ils ne servent pas aux résultats).
const STYLES_FORMULAIRE = ["form", "input", "select"].map((n) => `dsfr/component/${n}/${n}.min.css`);
function chargerStyles() {
  for (const href of STYLES_FORMULAIRE) {
    if (!document.querySelector(`link[href="${href}"]`)) document.head.append(h("link", { rel: "stylesheet", href }));
  }
}

let compteur = 0;
const nouvelId = (base) => `${base}-${++compteur}`;

function specDemande(ctx) {
  return {
    table: CONFIG.tablesEnvoi.demande,
    titre: `Vous n’avez pas trouvé votre financement${FINE}?`,
    chapo: "Décrivez votre projet : la DIRM Sud-Atlantique s’en servira pour compléter le recensement et pourra vous orienter vers un dispositif adapté.",
    envoi: "Envoyer ma demande",
    merci: ["Merci, votre demande a bien été transmise.", "La DIRM Sud-Atlantique l’étudiera pour compléter le recensement et pourra vous contacter."],
    recap: true,
    consentement: "J’accepte que la DIRM Sud-Atlantique utilise ces informations pour traiter ma demande. Vos données ne sont utilisées que pour ce recensement.",
    sections: [
      { legende: "Vous", champs: [
        { id: "profil", col: "Profil", type: "select", label: "Vous êtes", options: CONFIG.profils },
        { id: "nom", col: "Nom_prenom", type: "text", label: "Nom et prénom", autocomplete: "name" },
        { id: "structure", col: "Structure", type: "text", label: "Structure", autocomplete: "organization" },
        { id: "mel", col: "Courriel", type: "email", label: "Adresse électronique", hint: "Format attendu : nom@domaine.fr", autocomplete: "email" },
        { id: "tel", col: "Telephone", type: "tel", label: "Téléphone (facultatif)", hint: "Exemple : 05 56 00 00 00", autocomplete: "tel", requis: false },
      ] },
      { legende: "Votre projet", champs: [
        { id: "intitule", col: "Intitule", type: "text", label: "Intitulé du projet" },
        { id: "desc", col: "Description", type: "textarea", label: "Description", hint: "En quelques lignes : objectifs, lieu, partenaires, besoin non couvert." },
        { id: "aide", col: "Type_aide", type: "select", label: "Type d’aide recherchée", options: CONFIG.typesAide },
        { id: "cal", col: "Calendrier", type: "select", label: "Calendrier envisagé", options: CONFIG.calendriers },
      ] },
    ],
    extra: () => ({ Themes_choisis: ctx.themes.join(" ; "), Besoins_choisis: ctx.besoins.join(" ; ") }),
  };
}

function specFinanceur(ctx) {
  return {
    table: CONFIG.tablesEnvoi.financeur,
    titre: `Vous êtes financeur et n’êtes pas visible${FINE}?`,
    chapo: "Présentez votre dispositif : après vérification par la DIRM Sud-Atlantique, il pourra être ajouté au recensement.",
    envoi: "Proposer ce dispositif",
    merci: ["Merci, votre proposition a bien été transmise.", "La DIRM Sud-Atlantique la vérifiera avant de l’ajouter, le cas échéant, au recensement."],
    recap: false,
    consentement: "J’accepte que la DIRM Sud-Atlantique utilise ces informations pour vérifier et publier le dispositif.",
    sections: [
      { legende: "Votre organisme", champs: [
        { id: "org", col: "Organisme", type: "text", label: "Nom de l’organisme", autocomplete: "organization" },
        { id: "type", col: "Type_organisme", type: "radio", label: "Type d’organisme", options: CONFIG.typesOrganisme },
        { id: "contact", col: "Contact", type: "text", label: "Nom et prénom du contact", autocomplete: "name" },
        { id: "mel", col: "Courriel", type: "email", label: "Adresse électronique", hint: "Format attendu : nom@domaine.fr", autocomplete: "email" },
      ] },
      { legende: "Votre dispositif", champs: [
        { id: "disp", col: "Dispositif", type: "text", label: "Nom du dispositif ou de l’appel à projets" },
        { id: "url", col: "Url", type: "url", label: "Adresse de la page de présentation", hint: "Exemple : https://www.exemple.fr/appel-a-projets", autocomplete: "url" },
        { id: "themes", col: "Themes_concernes", type: "checkboxes", label: "Thème(s) concerné(s)", options: ctx.themesPublies, vide: "Sélectionnez au moins un thème." },
        { id: "modalite", col: "Modalite_depot", type: "radio", label: "Modalité de dépôt", options: CONFIG.modalites },
        { id: "pres", col: "Presentation", type: "textarea", label: "Présentation courte", hint: "Publics éligibles, types de projets soutenus, conditions principales." },
      ] },
    ],
    extra: () => ({}),
  };
}

// ---------- Construction des champs ----------

function etiquette(champ, pour) {
  return h("label", { class: "fr-label", for: pour }, champ.label, champ.hint ? h("span", { class: "fr-hint-text" }, champ.hint) : null);
}

function construireChamp(champ, prefixe) {
  const id = `${prefixe}-${champ.id}`;
  champ.domId = id;
  const requis = champ.requis !== false;
  if (champ.type === "select") {
    const select = h("select", { class: "fr-select", id, name: champ.id, required: requis || false },
      h("option", { value: "", selected: true, disabled: true, hidden: true }, "Sélectionner une option"),
      champ.options.map((o) => h("option", { value: o }, o)));
    return h("div", { class: "fr-select-group", "data-champ": champ.id }, etiquette(champ, id), select);
  }
  if (champ.type === "textarea") {
    return h("div", { class: "fr-input-group", "data-champ": champ.id }, etiquette(champ, id), h("textarea", { class: "fr-input", id, name: champ.id, rows: 5, required: requis || false }));
  }
  if (champ.type === "radio" || champ.type === "checkboxes") {
    const unique = champ.type === "radio";
    const legende = nouvelId(`${id}-legende`);
    const elements = (champ.options ?? []).map((o, i) => {
      const valeur = typeof o === "string" ? o : o.nom;
      const oid = `${id}-${i}`;
      return h("div", { class: "fr-fieldset__element" },
        h("div", { class: unique ? "fr-radio-group" : "fr-checkbox-group" },
          h("input", { type: unique ? "radio" : "checkbox", id: oid, name: unique ? id : `${id}-${i}`, value: valeur }),
          h("label", { class: "fr-label", for: oid }, valeur)));
    });
    return h("fieldset", { class: "fr-fieldset", id, "data-champ": champ.id, "aria-labelledby": legende },
      h("legend", { class: "fr-fieldset__legend fr-text--regular", id: legende }, champ.label), elements);
  }
  return h("div", { class: "fr-input-group", "data-champ": champ.id },
    etiquette(champ, id),
    h("input", { class: "fr-input", type: champ.type, id, name: champ.id, autocomplete: champ.autocomplete || false, required: requis || false }));
}

function lire(champ, form) {
  const id = champ.domId;
  if (champ.type === "radio") return form.querySelector(`input[name="${id}"]:checked`)?.value ?? "";
  if (champ.type === "checkboxes") return [...form.querySelectorAll(`#${id} input:checked`)].map((i) => i.value);
  return (form.elements[champ.id]?.value ?? "").trim();
}

// ---------- Validation ----------

function messageErreur(champ, valeur) {
  const vide = Array.isArray(valeur) ? valeur.length === 0 : valeur === "";
  const requis = champ.requis !== false;
  if (vide) {
    if (!requis) return "";
    if (champ.type === "checkboxes") return champ.vide || "Sélectionnez au moins une option.";
    if (champ.type === "select" || champ.type === "radio") return "Sélectionnez une option.";
    return "Renseignez ce champ.";
  }
  if (champ.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valeur)) return "Saisissez une adresse électronique valide, par exemple nom@domaine.fr.";
  if (champ.type === "url" && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(valeur)) return "Saisissez une adresse complète, commençant par https:// ou http://.";
  if (champ.type === "tel" && !/^[0-9 +().-]{6,20}$/.test(valeur)) return "Saisissez un numéro de téléphone valide, par exemple 05 56 00 00 00.";
  return "";
}

function effacerErreurs(form) {
  form.querySelectorAll(".fr-error-text").forEach((n) => n.remove());
  form.querySelectorAll("[class*='--error']").forEach((n) => [...n.classList].filter((c) => c.endsWith("--error")).forEach((c) => n.classList.remove(c)));
  form.querySelectorAll("[aria-describedby$='-erreur']").forEach((n) => n.removeAttribute("aria-describedby"));
}

function marquerErreur(champ, message, groupe) {
  const erreurId = `${champ.domId}-erreur`;
  const type = champ.type === "select" ? "select" : champ.type === "radio" || champ.type === "checkboxes" ? "fieldset" : "input";
  groupe.classList.add(type === "select" ? "fr-select-group--error" : type === "fieldset" ? "fr-fieldset--error" : "fr-input-group--error");
  const controle = type === "fieldset" ? groupe : groupe.querySelector("input, select, textarea");
  controle?.setAttribute("aria-describedby", erreurId);
  if (type === "input") controle?.classList.add("fr-input--error");
  if (type === "select") controle?.classList.add("fr-select--error");
  groupe.append(h("p", { class: "fr-error-text", id: erreurId }, message));
}

// ---------- Vue du formulaire ----------

export function ouvrirFormulaire(type, ctx) {
  chargerStyles();
  const spec = type === "demande" ? specDemande(ctx) : specFinanceur(ctx);
  const prefixe = type === "demande" ? "dem" : "fin";
  const zone = $("vue-formulaire");
  vider(zone);
  const titre = h("h2", { class: "fr-h3", tabindex: "-1", id: `${prefixe}-titre` }, spec.titre);
  const retour = h("button", { type: "button", class: "fr-link fr-icon-arrow-left-line fr-link--icon-left", onclick: ctx.retour }, "Retour aux résultats");

  const sections = spec.sections.map((s) => h("fieldset", { class: "fr-fieldset pub-form-section" },
    h("legend", { class: "fr-fieldset__legend fr-h5" }, s.legende),
    s.champs.map((c) => h("div", { class: "fr-fieldset__element" }, construireChamp(c, prefixe)))));

  const idRgpd = `${prefixe}-rgpd`;
  const consent = { id: "consent", domId: idRgpd, type: "consent", label: spec.consentement };
  const lienRgpd = ctx.rgpdUrl ? h("a", { href: ctx.rgpdUrl, target: "_blank", rel: "noopener noreferrer" }, "En savoir plus sur vos données personnelles", h("span", { class: "fr-sr-only" }, " (nouvelle fenêtre)")) : null;
  const blocConsent = h("div", { class: "fr-checkbox-group", "data-champ": "consent" },
    h("input", { type: "checkbox", id: idRgpd, name: "consent" }),
    h("label", { class: "fr-label", for: idRgpd }, spec.consentement, lienRgpd ? h("span", { class: "fr-hint-text" }, lienRgpd) : null));

  const piege = h("div", { class: "pub-piege", "aria-hidden": "true" }, h("label", { for: `${prefixe}-site` }, "Ne pas remplir"), h("input", { type: "text", id: `${prefixe}-site`, name: "site_web", tabindex: "-1", autocomplete: "off" }));
  const zoneAlerte = h("div", { id: `${prefixe}-alertes`, class: "pub-form-alertes" });
  const bouton = h("button", { type: "submit", class: "fr-btn" }, spec.envoi);
  const annuler = h("button", { type: "button", class: "fr-btn fr-btn--secondary", onclick: ctx.retour }, "Annuler");

  const recap = spec.recap && (ctx.themes.length || ctx.besoins.length)
    ? h("div", { class: "pub-recap" },
        h("p", {}, h("strong", {}, "Votre recherche"), " ", h("span", { class: "pub-mention" }, "(jointe automatiquement à votre demande)")),
        h("ul", { class: "fr-tags-group" }, [...ctx.themes, ...ctx.besoins].map((n) => h("li", {}, h("p", { class: "fr-tag fr-tag--sm" }, n)))))
    : null;

  const form = h("form", { novalidate: true, class: "pub-form", "aria-labelledby": `${prefixe}-titre` }, zoneAlerte, sections, blocConsent, piege,
    h("div", { class: "pub-form-boutons" }, bouton, annuler));

  // `recap` est nul pour le formulaire financeur ou sans sélection : append(null) écrirait « null » dans la page.
  zone.append(...[h("p", { class: "pub-retour" }, retour), titre, h("p", { class: "pub-chapo" }, spec.chapo),
    h("p", { class: "pub-aide-texte" }, "Tous les champs sont obligatoires, sauf mention contraire."), recap, form].filter(Boolean));

  const champs = spec.sections.flatMap((s) => s.champs);

  function confirmer() {
    vider(zone);
    const t = h("h2", { class: "fr-alert__title", tabindex: "-1" }, spec.merci[0]);
    zone.append(h("div", { class: "fr-alert fr-alert--success", role: "status" }, t, h("p", {}, spec.merci[1])),
      h("p", { class: "pub-form-boutons" }, h("button", { type: "button", class: "fr-btn", onclick: ctx.retour }, "Retour aux résultats")));
    t.focus();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (form.elements.site_web.value) { confirmer(); return; } // envoi automatique : on fait semblant, rien n’est enregistré
    effacerErreurs(form);
    zoneAlerte.replaceChildren();
    const erreurs = [];
    const valeurs = {};
    for (const c of champs) {
      const v = lire(c, form);
      valeurs[c.col] = Array.isArray(v) ? v.join(" ; ") : v;
      const m = messageErreur(c, v);
      if (m) { erreurs.push({ champ: c, message: m }); marquerErreur(c, m, form.querySelector(`[data-champ="${c.id}"]`)); }
    }
    if (!form.elements.consent.checked) {
      erreurs.push({ champ: consent, message: "Vous devez accepter pour envoyer le formulaire." });
      blocConsent.classList.add("fr-checkbox-group--error");
      blocConsent.append(h("p", { class: "fr-error-text", id: `${idRgpd}-erreur` }, "Vous devez accepter pour envoyer le formulaire."));
      form.elements.consent.setAttribute("aria-describedby", `${idRgpd}-erreur`);
    }
    if (erreurs.length) {
      const resume = h("div", { class: "fr-alert fr-alert--error", role: "alert", tabindex: "-1" },
        h("h3", { class: "fr-alert__title" }, erreurs.length > 1 ? `Le formulaire contient ${erreurs.length} erreurs` : "Le formulaire contient 1 erreur"),
        h("ul", {}, erreurs.map((er) => h("li", {}, h("a", { href: `#${er.champ.domId}`, onclick: (ev) => { ev.preventDefault(); const cible = document.getElementById(er.champ.domId); (cible.matches("fieldset") ? cible.querySelector("input") : cible)?.focus(); } }, `${er.champ.label.replace(/ \(facultatif\)$/, "")}${FINE}: ${er.message}`)))));
      zoneAlerte.append(resume);
      resume.focus();
      return;
    }
    bouton.disabled = true;
    bouton.textContent = "Envoi en cours…";
    try {
      await ctx.enregistrer(spec.table, { Date_envoi: Math.floor(Date.now() / 1000), ...valeurs, ...spec.extra(), Consentement: true });
      confirmer();
    } catch (err) {
      console.error(err);
      bouton.disabled = false;
      bouton.textContent = spec.envoi;
      const contact = ctx.contact ? ` Si le problème persiste, écrivez à ${ctx.contact}.` : "";
      const alerte = h("div", { class: "fr-alert fr-alert--error", role: "alert", tabindex: "-1" }, h("h3", { class: "fr-alert__title" }, "L’envoi a échoué"), h("p", {}, `Vos informations n’ont pas pu être transmises. Vérifiez votre connexion et réessayez.${contact}`));
      zoneAlerte.append(alerte);
      alerte.focus();
    }
  });

  return titre;
}
