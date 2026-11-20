// Test de bout en bout : node tests/e2e.cjs (sert le dossier sur http://localhost:4173).
// Nécessite Playwright et Chromium.
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4173;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const SHOTS = process.env.SHOTS;

function serve() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(PORT);
}

const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() - n); return iso(d); };

let failures = 0;
function check(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) failures++;
}

(async () => {
  const { PDFDocument, StandardFonts } = await import(path.join(ROOT, 'vendor/pdf-lib.esm.min.js'));
  async function makePdf(label, pages = 1) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages; i++) doc.addPage([595, 842]).drawText(`${label} p${i + 1}`, { x: 50, y: 780, size: 20, font });
    const file = path.join(require('os').tmpdir(), `${label}.pdf`);
    fs.writeFileSync(file, await doc.save());
    return file;
  }

  const server = serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${PORT}` });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'EFFACER' : undefined));
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`), fullPage: true });
  const URL_ = `http://localhost:${PORT}/`;
  // Simule le menu de partage d'iOS : on récupère le fichier partagé.
  await page.addInitScript(() => {
    navigator.canShare = (d) => !!d?.files?.length;
    navigator.share = async (d) => { window.__shared = d; };
  });
  const sharedFile = () => page.evaluate(async () => {
    const f = window.__shared.files[0];
    const b = new Uint8Array(await f.arrayBuffer());
    let s = ''; for (const x of b) s += String.fromCharCode(x);
    return { name: f.name, type: f.type, text: window.__shared.text || '', b64: btoa(s) };
  });

  await page.goto(URL_);

  // 1. Création du coffre
  await page.getByText('Ton dossier santé').waitFor();
  await shot('01-bienvenue');
  await page.fill('input[name=p1]', 'court');
  await page.fill('input[name=p2]', 'court');
  await page.click('text=Créer mon coffre');
  check(await page.getByRole('alert').filter({ hasText: 'au moins 12 caractères' }).isVisible(), 'refuse une phrase de passe trop courte');
  const PASS = 'cheval agrafe batterie correct';
  await page.fill('input[name=p1]', PASS);
  await page.fill('input[name=p2]', PASS);
  await page.click('text=Créer mon coffre');
  await page.getByText('Plus tard').click();
  await page.getByText('commence ici').waitFor();
  check(true, 'tableau de bord vide après création');
  await shot('02-vide');

  // 2. Ordonnances : 7 délivrances, la dernière il y a 14 jours
  const add = async (date, label, pages = 1) => {
    await page.getByRole('button', { name: 'Ajouter une ordonnance' }).first().click();
    await page.setInputFiles('input[name=pdf]', await makePdf(label, pages));
    await page.fill('input[name=date]', date);
    await page.click('dialog >> text=Enregistrer');
    await page.locator('dialog').waitFor({ state: 'detached' });
  };
  for (let i = 6; i >= 0; i--) await add(daysAgo(14 + 28 * i), `rx${i}`, i === 0 ? 2 : 1);
  check(await page.getByText('Dans 14 jours,').isVisible(), 'compte à rebours : dans 14 jours');
  check(await page.locator('.rx li').count() === 6, 'affiche les 6 dernières ordonnances');
  check(await page.getByText('Voir l’archive (1)').isVisible(), 'la 7e est dans l’archive');

  // Fichier qui n'est pas un PDF
  await page.getByRole('button', { name: 'Ajouter une ordonnance' }).first().click();
  const fake = path.join(require('os').tmpdir(), 'faux.pdf');
  fs.writeFileSync(fake, 'pas un pdf');
  await page.setInputFiles('input[name=pdf]', fake);
  await page.click('dialog >> text=Enregistrer');
  check(await page.getByRole('alert').filter({ hasText: 'ne ressemble pas à un PDF' }).waitFor().then(() => true, () => false), 'refuse un faux PDF');
  await page.click('dialog >> text=Annuler');

  // 3. Ordonnance annuelle émise il y a 250 jours → 115 jours restants (année de 365 jours)
  await page.click('text=Ajouter l’ordonnance annuelle');
  await page.setInputFiles('input[name=pdf]', await makePdf('annuelle', 3));
  await page.fill('input[name=issued]', daysAgo(250));
  await page.click('dialog >> text=Enregistrer');
  await page.locator('dialog').waitFor({ state: 'detached' });
  const num = await page.locator('.annual .num').innerText();
  check(/^11[56]/.test(num), `ordonnance annuelle : ${num.split('\n')[0]} jours restants`);

  // 4. Contacts
  const editContact = async (index, values) => {
    await page.locator('.contact').nth(index).getByRole('button').click();
    for (const [k, v] of Object.entries(values)) await page.fill(`dialog input[name=${k}]`, v);
    await page.click('dialog >> text=Enregistrer');
    await page.locator('dialog').waitFor({ state: 'detached' });
  };
  await editContact(0, { nom: 'Dr Claire Martin', lieu: 'Paris 11e', tel: '01 23 45 67 89', email: 'cabinet@exemple.fr' });
  await editContact(1, { nom: 'Dr Julien Durand', lieu: 'Paris 12e', tel: '01 98 76 54 32', email: 'secretariat@exemple.fr' });
  await editContact(2, { nom: 'Pharmacie du Marché', email: 'pharmacie@exemple.fr' });
  check(await page.getByText('Dr Julien Durand').isVisible(), 'contacts enregistrés');
  await shot('03-tableau-de-bord');

  // 5. Envoi : un seul PDF = 1 page de garde + 3 (annuelle) + 2 + 5 = 11 pages
  await page.click('text=Envoyer par e-mail');
  await page.fill('dialog input[name=nom]', 'Camille Exemple');
  await shot('04-envoi');
  await page.click('text=Préparer l’e-mail');
  await page.getByText('PDF prêt').waitFor();
  await shot('05-pdf-pret');
  check(await page.getByText('11 pages').isVisible(), 'PDF assemblé : 11 pages');
  await page.getByRole('button', { name: 'Ouvrir le partage' }).click();
  await page.waitForFunction(() => window.__shared);
  const shared = await sharedFile();
  const bundle = await PDFDocument.load(Buffer.from(shared.b64, 'base64'));
  check(bundle.getPageCount() === 11 && shared.type === 'application/pdf', `partage du PDF ${shared.name} (11 pages)`);
  check(shared.text.includes('Camille Exemple'), 'message du mail signé');
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  check(clip === null || clip === 'pharmacie@exemple.fr', `adresse copiée (${clip ?? 'presse-papiers non lisible ici'})`);
  await page.click('dialog >> text=Fermer');

  // 6. Aperçu
  await page.locator('.rx li').first().getByRole('button', { name: /Voir/ }).click();
  check(await page.locator('dialog iframe.viewer').waitFor().then(() => true, () => false), 'aperçu du PDF');
  await page.click('dialog >> text=Fermer');

  // 7. Les données sur le disque sont chiffrées
  const raw = await page.evaluate(() => new Promise((resolve) => {
    const r = indexedDB.open('dossier-sante');
    r.onsuccess = () => {
      const tx = r.result.transaction('meta');
      const g = tx.objectStore('meta').get('vault');
      g.onsuccess = () => resolve(new TextDecoder().decode(g.result.ct));
    };
  }));
  check(!raw.includes('Durand') && !raw.includes('pharmacie'), 'le coffre stocké est illisible');

  // 8. Verrouillage puis déverrouillage
  await page.click('text=Verrouiller');
  await page.getByText('Coffre verrouillé').waitFor();
  check(!(await page.content()).includes('Durand'), 'plus aucune donnée affichée une fois verrouillé');
  await page.fill('input[name=p]', 'mauvaise phrase de passe');
  await page.click('button:has-text("Déverrouiller")');
  check(await page.getByRole('alert').filter({ hasText: 'ne correspond pas' }).waitFor().then(() => true, () => false), 'refuse une mauvaise phrase de passe');
  await page.fill('input[name=p]', PASS);
  await page.click('button:has-text("Déverrouiller")');
  await page.getByText('Dans 14 jours,').waitFor();
  check(true, 'déverrouillage avec la phrase de passe');

  // 9. Sauvegarde, tout effacer, restauration
  await page.evaluate(() => { window.__shared = null; });
  await page.click('footer >> text=Exporter une sauvegarde');
  await page.waitForFunction(() => window.__shared);
  const backupFile = path.join(require('os').tmpdir(), 'sauvegarde.json');
  fs.writeFileSync(backupFile, Buffer.from((await sharedFile()).b64, 'base64'));
  check(!fs.readFileSync(backupFile, 'utf8').includes('Durand'), 'la sauvegarde est chiffrée');
  await page.click('footer >> text=Réglages');
  await page.click('dialog >> button:has-text("Tout effacer")');
  await page.getByText('Ton dossier santé').waitFor();
  check(true, 'tout effacer ramène à l’écran de bienvenue');
  await page.click('text=Restaurer une sauvegarde');
  await page.setInputFiles('input[name=backup]', backupFile);
  await page.fill('dialog input[name=p]', PASS);
  await page.click('dialog >> button:has-text("Restaurer")');
  await page.getByText('Dans 14 jours,').waitFor();
  check(await page.locator('.rx li').count() === 6, 'restauration complète');

  // 10. Face ID simulé (authentificateur virtuel avec PRF)
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
    await page.click('footer >> text=Réglages');
    await page.click('dialog >> text=Activer Face ID');
    await page.locator('dialog').waitFor({ state: 'detached' });
    await page.click('text=Verrouiller');
    await page.click('text=Déverrouiller avec Face ID');
    await page.getByText('Dans 14 jours,').waitFor({ timeout: 5000 });
    check(true, 'déverrouillage par passkey (PRF)');
  } catch (e) {
    check(false, `passkey : ${e.message.split('\n')[0]}`);
  }

  // 11. Écran étroit 320 px : pas de défilement horizontal
  await page.setViewportSize({ width: 320, height: 700 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  check(!overflow, 'pas de défilement horizontal à 320 px');

  check(errors.length === 0, `aucune erreur console${errors.length ? ` : ${errors.join(' | ')}` : ''}`);
  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est passé.');
  process.exit(failures ? 1 : 0);
})();
