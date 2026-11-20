# Mon dossier santé

Une app web pour iPhone, sur une seule page : les 6 dernières ordonnances, le compte à rebours jusqu'à la prochaine délivrance (tous les 28 jours), la validité de l'ordonnance annuelle, les coordonnées du médecin traitant, du psychiatre et de la pharmacie, et un bouton pour envoyer le tout à la pharmacie en un seul PDF.

Style : [design system Cologonm](https://github.com/Cologonm/designSystem), copié dans `ds/`.

## Confidentialité

- **Rien ne quitte l'iPhone**, sauf le mail que tu envoies toi-même. Pas de serveur, pas de compte, pas de suivi. Le site GitHub Pages ne contient que le code.
- **Tout est chiffré** (AES-256-GCM, Web Crypto) dans le stockage de l'app : coffre (dates, contacts) et chaque PDF.
- **Déverrouillage** : Face ID (passkey + extension WebAuthn PRF, iOS 18 ou plus) ou phrase de passe (PBKDF2-SHA-256, 600 000 itérations). La clé n'est jamais enregistrée en clair.
- **Verrouillage automatique** après 5 minutes sans activité, ou après 30 secondes passées hors de l'app. Le contenu est masqué dès que l'app passe en arrière-plan.
- **Politique de sécurité stricte** (CSP) : aucun script ni ressource extérieurs.

## Installer sur l'iPhone

1. Ouvrir l'adresse GitHub Pages du dépôt dans **Safari**.
2. Bouton Partager → **Sur l'écran d'accueil**.
3. Ouvrir l'app depuis l'écran d'accueil, choisir une phrase de passe, puis activer Face ID.

Important : supprimer l'icône de l'écran d'accueil efface les données. Exporte régulièrement une **sauvegarde chiffrée** (pied de page ou Réglages) dans Fichiers ou iCloud Drive. Elle s'ouvre avec la phrase de passe active au moment de l'export.

## Structure

```
index.html            page unique, CSP
app/main.js           écrans et interactions
app/vault.js          coffre : clés, Face ID, données, fichiers, sauvegarde
app/crypto.js         chiffrement (Web Crypto)
app/store.js          stockage IndexedDB
app/dates.js          calculs : cycle de 28 jours, validité annuelle
app/pdf.js            lecture et assemblage des PDF (pdf-lib, local)
app/ui.css            mise en page, à partir des tokens du design system
ds/                   design system (tokens, fondations, polices, figurines)
vendor/               pdf-lib 1.17.1 (MIT)
sw.js                 fonctionnement hors ligne
tests/e2e.cjs         test de bout en bout (Playwright)
```

## Développer

Aucune dépendance à installer. Servir le dossier en local, par exemple :

```bash
python3 -m http.server 4173
```

Test de bout en bout (Playwright et Chromium nécessaires) :

```bash
node tests/e2e.cjs
```

Après une modification, augmenter `VERSION` dans `sw.js` pour que l'iPhone reçoive la mise à jour.
