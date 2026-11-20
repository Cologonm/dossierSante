import * as V from './vault.js';
import * as D from './dates.js';
import { inspect, buildBundle } from './pdf.js';
import { h, svgCheck, dot, modal, toast, field, errorLine, busy, readFile } from './dom.js';

const app = document.getElementById('app');
const IDLE_LOCK_MS = 5 * 60 * 1000;
const AWAY_LOCK_MS = 30 * 1000;
const VISIBLE_COUNT = 6;
const FIG = (n) => `ds/assets/figurines/iso-${n}.png`;
const ui = { showArchive: false };

/* ======================= Démarrage ======================= */

async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (await V.hasVault()) renderLock();
  else renderWelcome();
}

/* ======================= Verrouillage ======================= */

let idleTimer;
let hiddenAt = null;

function lock() {
  V.lockNow();
  // Recharger la page efface de la mémoire les données déchiffrées et les aperçus.
  location.reload();
}

function resetIdle() {
  clearTimeout(idleTimer);
  if (V.isUnlocked()) idleTimer = setTimeout(lock, IDLE_LOCK_MS);
}

function startSessionGuards() {
  ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((ev) =>
    addEventListener(ev, resetIdle, { passive: true }));
  resetIdle();
}

// Quand l'app passe en arrière-plan, le contenu est masqué (aperçu du sélecteur d'apps),
// puis l'app se verrouille si l'absence dépasse 30 secondes.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    document.body.classList.add('veiled');
  } else {
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;
    if (V.isUnlocked() && away > AWAY_LOCK_MS) return lock();
    document.body.classList.remove('veiled');
    resetIdle();
  }
});

/* ======================= Écrans d'accès ======================= */

function screen(...children) {
  app.replaceChildren(h('main', { class: 'ds-wrap access' }, h('div', { class: 'access-inner' }, ...children)));
}

const MIN_PASS = 12;

function renderWelcome() {
  const err = errorLine();
  const form = h('form', { class: 'stack-form', onsubmit: async (e) => {
    e.preventDefault();
    const p1 = form.elements.p1.value;
    const p2 = form.elements.p2.value;
    if (p1.length < MIN_PASS) return (err.textContent = `Ta phrase de passe doit faire au moins ${MIN_PASS} caractères.`);
    if (p1 !== p2) return (err.textContent = 'Les deux phrases de passe ne sont pas identiques.');
    const done = busy(form.querySelector('button[type=submit]'), 'Création du coffre…');
    try {
      await V.create(p1);
      renderPasskeyOffer();
    } catch (ex) {
      done();
      err.textContent = 'Le coffre n’a pas pu être créé. Réessaie dans un instant.';
      console.error(ex);
    }
  } },
    field({ label: 'Phrase de passe', name: 'p1', type: 'password', required: true, autocomplete: 'new-password',
      hint: 'Au moins 12 caractères. Quatre mots au hasard se retiennent facilement. Elle ne peut pas être récupérée si tu l’oublies.' }),
    field({ label: 'Confirme la phrase de passe', name: 'p2', type: 'password', required: true, autocomplete: 'new-password' }),
    err,
    h('div', { class: 'actions ds-action' },
      h('button', { class: 'cta ds-press', type: 'submit' }, 'Créer mon coffre'),
      h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: () => openRestore() }, 'Restaurer une sauvegarde')));

  screen(
    h('img', { class: 'ds-figurine ds-figurine-lg', src: FIG('14'), alt: '' }),
    h('p', { class: 'ds-label ds-upper ds-muted' }, 'Bienvenue'),
    h('h1', { class: 'ds-headline' }, 'Ton dossier santé, ', h('span', { class: 'ds-accent' }, 'rien que pour toi')),
    h('p', { class: 'ds-text ds-muted lead' }, 'Tout est chiffré sur cet iPhone. Commence par choisir la phrase de passe qui protège ton coffre.'),
    form);
}

function renderPasskeyOffer() {
  if (!V.passkeyAvailable()) return renderDashboard(true);
  const err = errorLine();
  const btn = h('button', { class: 'cta ds-press', type: 'button', onclick: async () => {
    const done = busy(btn, 'Activation…');
    try {
      await V.enablePasskey();
      renderDashboard(true);
      toast('Face ID activé');
    } catch (ex) {
      done();
      err.textContent = passkeyError(ex);
    }
  } }, 'Activer Face ID');
  screen(
    h('img', { class: 'ds-figurine ds-figurine-lg', src: FIG('14'), alt: '' }),
    h('p', { class: 'ds-label ds-upper ds-muted' }, 'Coffre créé'),
    h('h1', { class: 'ds-headline' }, 'Ouvre-le ', h('span', { class: 'ds-accent' }, 'd’un regard')),
    h('p', { class: 'ds-text ds-muted lead' }, 'Avec Face ID, plus besoin de taper ta phrase de passe à chaque fois. Elle reste ta clé de secours.'),
    err,
    h('div', { class: 'actions ds-action' }, btn,
      h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: () => renderDashboard(true) }, 'Plus tard')));
}

function passkeyError(ex) {
  if (ex?.message === 'PRF_UNSUPPORTED') return 'Cet appareil ne permet pas encore le déverrouillage par Face ID ici. Ta phrase de passe reste disponible. Il faut iOS 18 ou plus récent.';
  if (ex?.name === 'NotAllowedError') return 'Face ID a été annulé. Tu peux réessayer.';
  if (ex?.message === 'BAD_PASSKEY') return 'Cette passkey ne correspond plus au coffre. Utilise ta phrase de passe.';
  return 'Face ID n’a pas fonctionné. Utilise ta phrase de passe.';
}

async function renderLock() {
  const keys = await V.keysInfo();
  const err = errorLine();
  const passForm = h('form', { class: 'stack-form', hidden: !!keys.passkey, onsubmit: async (e) => {
    e.preventDefault();
    const done = busy(passForm.querySelector('button[type=submit]'), 'Déverrouillage…');
    try {
      await V.unlockWithPassphrase(passForm.elements.p.value);
      renderDashboard(true);
    } catch (ex) {
      done();
      err.textContent = ex.message === 'BAD_PASSPHRASE' ? 'Cette phrase de passe ne correspond pas. Vérifie les majuscules et les espaces.' : 'Le déverrouillage a échoué.';
      passForm.elements.p.select();
    }
  } },
    field({ label: 'Phrase de passe', name: 'p', type: 'password', required: true, autocomplete: 'current-password' }),
    h('div', { class: 'actions ds-action' }, h('button', { class: 'cta ds-press', type: 'submit' }, 'Déverrouiller')));

  let faceBtn = null;
  if (keys.passkey) {
    faceBtn = h('button', { class: 'cta ds-press', type: 'button', onclick: async () => {
      const done = busy(faceBtn, 'Face ID…');
      try {
        await V.unlockWithPasskey();
        renderDashboard(true);
      } catch (ex) {
        done();
        err.textContent = passkeyError(ex);
        passForm.hidden = false;
      }
    } }, 'Déverrouiller avec Face ID');
  }

  screen(
    h('img', { class: 'ds-figurine ds-figurine-lg', src: FIG('14'), alt: '' }),
    h('p', { class: 'ds-label ds-upper ds-muted' }, 'Coffre verrouillé'),
    h('h1', { class: 'ds-headline' }, 'Mon dossier ', h('span', { class: 'ds-accent' }, 'santé')),
    faceBtn && h('div', { class: 'actions ds-action' }, faceBtn,
      h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: () => { passForm.hidden = false; passForm.elements.p.focus(); } }, 'Utiliser ma phrase de passe')),
    passForm,
    err);
}

/* ======================= Tableau de bord ======================= */

let guardsStarted = false;

function renderDashboard(first = false) {
  if (first && !guardsStarted) { startSessionGuards(); guardsStarted = true; }
  const data = V.data();
  const today = D.todayISO();
  const sorted = [...data.ordonnances].sort((a, b) => b.date.localeCompare(a.date) || b.addedAt - a.addedAt);

  app.replaceChildren(h('div', { class: 'ds-wrap page' },
    h('header', { class: 'top' },
      h('span', { class: 'logo' }, 'Mon dossier santé'),
      h('div', { class: 'lock' },
        h('span', { class: 'ds-caption ds-muted lock-note' }, 'Verrouillage auto après 5 min'),
        h('button', { class: 'pill-btn ds-press', type: 'button', onclick: lock }, 'Verrouiller'))),
    h('main', null,
      heroSection(sorted, today),
      annualSection(data.annual, today),
      ordonnancesSection(sorted),
      contactsSection(data.contacts)),
    h('footer', { class: 'foot ds-action' },
      h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: openSettings }, 'Réglages'),
      h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: exportBackup }, 'Exporter une sauvegarde'),
      h('span', { class: 'ds-caption ds-muted' }, 'Données chiffrées sur cet iPhone'))));
}

function heroSection(sorted, today) {
  if (!sorted.length) {
    return h('section', { class: 'empty', 'aria-labelledby': 'h-next' },
      h('img', { class: 'ds-figurine ds-figurine-lg', src: FIG('09'), alt: '' }),
      h('p', { class: 'ds-label ds-upper ds-muted' }, 'Prochaine délivrance en pharmacie'),
      h('h1', { id: 'h-next', class: 'ds-headline' }, 'Ton premier cycle ', h('span', { class: 'ds-accent' }, 'commence ici')),
      h('p', { class: 'ds-text ds-muted lead' }, 'Ajoute ta dernière ordonnance délivrée : le compte à rebours de 28 jours démarre à sa date de délivrance.'),
      h('div', { class: 'actions ds-action' }, h('button', { class: 'cta ds-press', type: 'button', onclick: openAddOrdonnance }, 'Ajouter une ordonnance')));
  }
  const last = sorted[0].date;
  const { next, days, dayOfCycle } = D.nextDelivery(last, today);
  const when = D.formatWeekday(next).replace(/(\d+) /, '$1\u00a0'); // pas de « 4 » seul en fin de ligne
  let lead;
  let status;
  if (days > 1) { lead = `Dans ${days} jours, `; }
  else if (days === 1) { lead = 'Demain, '; }
  else if (days === 0) { lead = 'Aujourd’hui, '; }
  else { lead = `En retard de ${D.plural(-days, 'jour', 'jours')}, `; }
  if (days < 0) status = [dot('mandarine'), 'À aller chercher'];
  else if (days <= 3) status = [dot('souci'), days === 0 ? 'C’est le jour' : 'Bientôt'];
  else status = [dot('herbe'), 'À jour'];
  const pct = Math.max(0, Math.min(1, dayOfCycle / D.CYCLE_DAYS)) * 100;

  return h('section', { class: 'hero', 'aria-labelledby': 'h-next' },
    h('div', null,
      h('p', { class: 'ds-label ds-upper ds-muted' }, 'Prochaine délivrance en pharmacie'),
      h('h1', { id: 'h-next', class: 'ds-headline' }, lead, h('span', { class: 'ds-accent' }, days < 0 ? `depuis le ${D.formatDayMonth(next)}` : when)),
      h('div', { class: 'cycle' },
        h('div', { class: 'cycle-legend ds-label' },
          h('span', null, `Dernière délivrance · ${D.formatDayMonth(last)}`),
          h('span', { class: 'status' }, ...status)),
        h('div', { class: 'track', role: 'img', 'aria-label': `Jour ${Math.max(0, dayOfCycle)} sur ${D.CYCLE_DAYS} du cycle` },
          h('i', { style: `width:${pct}%` }), h('b', { style: `left:${pct}%` })),
        h('div', { class: 'cycle-legend ds-caption ds-muted' },
          h('span', null, `Jour ${Math.max(0, dayOfCycle)} sur ${D.CYCLE_DAYS}`),
          h('span', null, `Cycle de ${D.CYCLE_DAYS} jours`)))),
    h('img', { class: 'ds-figurine', src: FIG('14'), alt: '' }));
}

function annualSection(annual, today) {
  const head = h('div', { class: 'block-head' }, h('h2', { id: 'h-annual', class: 'ds-title' }, 'Ordonnance annuelle'));
  if (!annual) {
    return h('section', { class: 'block', 'aria-labelledby': 'h-annual' }, head,
      h('div', { class: 'annual' },
        h('div', { class: 'ds-stack' },
          h('p', { class: 'ds-text' }, 'Ajoute ton ordonnance annuelle pour savoir combien de temps elle reste valide.'),
          h('p', { class: 'ds-action' }, h('button', { class: 'cta ds-press', type: 'button', onclick: () => openAnnual() }, 'Ajouter l’ordonnance annuelle')))));
  }
  const { end, days } = D.annualValidity(annual.issued, today);
  let note;
  if (days <= 0) note = h('p', { class: 'ds-label status' }, dot('mandarine'), `Expirée depuis le ${D.formatLong(end)}. Prends rendez-vous pour la renouveler.`);
  else if (days <= D.ANNUAL_REMINDER_DAYS) note = h('p', { class: 'ds-label status' }, dot('souci'), `Pense à prendre rendez-vous avant le ${D.formatDayMonth(end)} pour la renouveler.`);
  return h('section', { class: 'block', 'aria-labelledby': 'h-annual' }, head,
    h('div', { class: 'annual' },
      h('p', { class: 'num' }, days > 0 ? String(days) : '0', h('small', null, days === 1 ? 'jour de validité' : 'jours de validité')),
      h('div', { class: 'ds-stack' },
        h('p', { class: 'ds-text' }, days > 0 ? 'Valide jusqu’au ' : 'Était valide jusqu’au ', h('strong', null, D.formatLong(end)), `. Émise le ${D.formatLong(annual.issued)}${annual.prescriber ? ` par ${annual.prescriber}` : ''}.`),
        note,
        h('p', { class: 'ds-action inline-actions' },
          h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: () => openViewer(annual, 'annual') }, 'Voir l’ordonnance'),
          h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: () => openAnnual(annual) }, 'Remplacer')))));
}

function ordonnancesSection(sorted) {
  const visible = ui.showArchive ? sorted : sorted.slice(0, VISIBLE_COUNT);
  const older = sorted.length - VISIBLE_COUNT;
  return h('section', { class: 'block', 'aria-labelledby': 'h-rx' },
    h('div', { class: 'block-head' },
      h('h2', { id: 'h-rx', class: 'ds-title' }, 'Ordonnances'),
      h('div', { class: 'actions ds-action' },
        h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: openAddOrdonnance }, 'Ajouter une ordonnance'),
        h('button', { class: 'cta ds-press', type: 'button', onclick: openSend }, 'Envoyer par e-mail'))),
    sorted.length
      ? h('ol', { class: 'rx' }, visible.map((o, i) =>
        h('li', { class: i >= VISIBLE_COUNT ? 'archived' : null },
          h('span', { class: 'n' }, String(i + 1)),
          h('div', null,
            h('p', { class: 'when' }, D.formatLong(o.date)),
            h('p', { class: 'ds-caption ds-muted' }, `PDF · ${D.plural(o.pages, 'page', 'pages')}${i >= VISIBLE_COUNT ? ' · archive' : ''}`)),
          h('button', { class: 'linkbtn ds-link ds-action ds-target', type: 'button', 'aria-label': `Voir l’ordonnance du ${D.formatLong(o.date)}`, onclick: () => openViewer(o, 'rx') }, 'Voir'))))
      : h('p', { class: 'ds-text ds-muted rx-empty' }, 'Aucune ordonnance pour l’instant. Les 6 plus récentes s’afficheront ici.'),
    older > 0 && h('p', { class: 'ds-action archive-toggle' },
      h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: () => { ui.showArchive = !ui.showArchive; renderDashboard(); } },
        ui.showArchive ? 'Masquer l’archive' : `Voir l’archive (${older})`)));
}

function contactCard(role, label, c) {
  const empty = !c.nom && !c.tel && !c.email;
  return h('article', { class: 'contact' },
    h('p', { class: 'ds-label ds-upper ds-muted' }, label),
    empty
      ? h('p', { class: 'ds-text ds-muted contact-empty' }, 'Pas encore de coordonnées.')
      : [
        h('p', { class: 'ds-subtitle' }, c.nom || '—'),
        h('div', { class: 'lines ds-text' },
          [c.specialite, c.lieu].filter(Boolean).length ? h('span', null, [c.specialite, c.lieu].filter(Boolean).join(' · ')) : null,
          c.tel && h('a', { class: 'ds-link ds-target', href: `tel:${c.tel.replace(/[^\d+]/g, '')}` }, c.tel),
          c.email && h('a', { class: 'ds-link ds-target', href: `mailto:${c.email}` }, c.email)),
      ],
    h('p', { class: 'ds-action edit' },
      h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: () => openContact(role, label) }, empty ? 'Ajouter les coordonnées' : 'Modifier')));
}

function contactsSection(contacts) {
  return h('section', { class: 'block', 'aria-labelledby': 'h-contacts' },
    h('div', { class: 'block-head' }, h('h2', { id: 'h-contacts', class: 'ds-title' }, 'Mes contacts')),
    h('div', { class: 'contacts' },
      contactCard('mt', 'Médecin traitant', contacts.mt),
      contactCard('psy', 'Psychiatre', contacts.psy),
      contactCard('pharmacie', 'Ma pharmacie', contacts.pharmacie)));
}

/* ======================= Ajouts et modifications ======================= */

async function storePdf(input, err) {
  const file = input.files?.[0];
  if (!file) { err.textContent = 'Choisis un fichier PDF.'; return null; }
  const bytes = await readFile(file);
  try {
    const { pages } = await inspect(bytes);
    const id = await V.putFile(bytes);
    return { id, pages, fileName: file.name };
  } catch {
    err.textContent = 'Ce fichier ne ressemble pas à un PDF lisible. Exporte l’ordonnance en PDF puis réessaie.';
    return null;
  }
}

const pdfInput = () => h('div', { class: 'field-row' },
  h('label', { class: 'ds-label', for: 'pdf' }, 'Fichier PDF'),
  h('input', { class: 'field file', id: 'pdf', name: 'pdf', type: 'file', accept: 'application/pdf,.pdf', required: true }));

function openAddOrdonnance() {
  const err = errorLine();
  const form = h('form', { class: 'stack-form', onsubmit: async (e) => {
    e.preventDefault();
    const date = form.elements.date.value;
    if (!date) return (err.textContent = 'Indique la date de délivrance.');
    if (date > D.todayISO()) return (err.textContent = 'La date de délivrance ne peut pas être dans le futur.');
    const done = busy(form.querySelector('button[type=submit]'), 'Chiffrement…');
    const stored = await storePdf(form.elements.pdf, err);
    if (!stored) return done();
    V.data().ordonnances.push({ ...stored, date, addedAt: Date.now() });
    await V.save();
    m.close();
    renderDashboard();
    toast('Ordonnance ajoutée');
  } },
    pdfInput(),
    field({ label: 'Date de délivrance en pharmacie', name: 'date', type: 'date', value: D.todayISO(), required: true, attrs: { max: D.todayISO() } }),
    err,
    h('div', { class: 'actions ds-action' },
      h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: () => m.close() }, 'Annuler'),
      h('button', { class: 'cta ds-press', type: 'submit' }, 'Enregistrer')));
  const m = modal(
    h('p', { class: 'ds-label ds-upper ds-muted' }, 'Nouvelle ordonnance'),
    h('p', { class: 'ds-heading' }, 'Ajouter une ordonnance délivrée'),
    form);
}

function openAnnual(current) {
  const err = errorLine();
  const psy = V.data().contacts.psy.nom;
  const form = h('form', { class: 'stack-form', onsubmit: async (e) => {
    e.preventDefault();
    const issued = form.elements.issued.value;
    if (!issued) return (err.textContent = 'Indique la date d’émission.');
    const done = busy(form.querySelector('button[type=submit]'), 'Chiffrement…');
    const stored = await storePdf(form.elements.pdf, err);
    if (!stored) return done();
    if (current) await V.deleteFile(current.id);
    V.data().annual = { ...stored, issued, prescriber: form.elements.prescriber.value.trim() };
    await V.save();
    m.close();
    renderDashboard();
    toast('Ordonnance annuelle enregistrée');
  } },
    pdfInput(),
    field({ label: 'Date d’émission', name: 'issued', type: 'date', value: current?.issued || '', required: true, attrs: { max: D.todayISO() } }),
    field({ label: 'Prescrite par', name: 'prescriber', value: current?.prescriber || (psy ? psy : ''), hint: 'Facultatif, par exemple « le Dr Durand ».' }),
    err,
    h('div', { class: 'actions ds-action' },
      h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: () => m.close() }, 'Annuler'),
      h('button', { class: 'cta ds-press', type: 'submit' }, 'Enregistrer')));
  const m = modal(
    h('p', { class: 'ds-label ds-upper ds-muted' }, 'Ordonnance annuelle'),
    h('p', { class: 'ds-heading' }, current ? 'Remplacer l’ordonnance annuelle' : 'Ajouter l’ordonnance annuelle'),
    form);
}

function openContact(role, label) {
  const c = V.data().contacts[role];
  const err = errorLine();
  const isDoctor = role !== 'pharmacie';
  const form = h('form', { class: 'stack-form', onsubmit: async (e) => {
    e.preventDefault();
    const f = form.elements;
    const email = f.email.value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (err.textContent = 'Cette adresse ne ressemble pas à un e-mail.');
    Object.assign(c, {
      nom: f.nom.value.trim(), lieu: f.lieu.value.trim(), tel: f.tel.value.trim(), email,
      ...(isDoctor ? { specialite: f.specialite.value.trim() } : {}),
    });
    await V.save();
    m.close();
    renderDashboard();
    toast('Coordonnées enregistrées');
  } },
    field({ label: isDoctor ? 'Nom' : 'Nom de la pharmacie', name: 'nom', value: c.nom, attrs: { placeholder: isDoctor ? 'Dr Claire Martin' : 'Pharmacie du Marché' } }),
    isDoctor && field({ label: 'Spécialité', name: 'specialite', value: c.specialite }),
    field({ label: 'Ville ou quartier', name: 'lieu', value: c.lieu }),
    field({ label: 'Téléphone', name: 'tel', type: 'tel', value: c.tel }),
    field({ label: 'E-mail', name: 'email', type: 'email', value: c.email, hint: role === 'pharmacie' ? 'C’est l’adresse utilisée pour envoyer tes ordonnances.' : null }),
    err,
    h('div', { class: 'actions ds-action' },
      h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: () => m.close() }, 'Annuler'),
      h('button', { class: 'cta ds-press', type: 'submit' }, 'Enregistrer')));
  const m = modal(
    h('p', { class: 'ds-label ds-upper ds-muted' }, label),
    h('p', { class: 'ds-heading' }, 'Coordonnées'),
    form);
}

/* ======================= Aperçu d'un PDF ======================= */

async function openViewer(item, kind) {
  const bytes = await V.getFile(item.id);
  const file = new File([bytes], kind === 'annual' ? 'ordonnance-annuelle.pdf' : `ordonnance-${item.date}.pdf`, { type: 'application/pdf' });
  const url = URL.createObjectURL(file);
  const title = kind === 'annual' ? `Ordonnance annuelle · ${D.formatLong(item.issued)}` : `Délivrée le ${D.formatLong(item.date)}`;
  const m = modal(
    h('p', { class: 'ds-label ds-upper ds-muted' }, kind === 'annual' ? 'Ordonnance annuelle' : 'Ordonnance'),
    h('p', { class: 'ds-heading' }, title),
    h('iframe', { class: 'viewer', src: url, title }),
    h('div', { class: 'actions ds-action' },
      kind === 'rx' && h('button', { class: 'linkbtn ds-link ds-target danger', type: 'button', onclick: async () => {
        if (!confirm(`Supprimer l’ordonnance du ${D.formatLong(item.date)} ? Elle sera effacée de cet iPhone.`)) return;
        const d = V.data();
        d.ordonnances = d.ordonnances.filter((o) => o.id !== item.id);
        await V.deleteFile(item.id);
        await V.save();
        m.close();
        renderDashboard();
        toast('Ordonnance supprimée');
      } }, 'Supprimer'),
      h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: () => shareFile(file) }, 'Ouvrir en grand'),
      h('button', { class: 'cta ds-press', type: 'button', onclick: () => m.close() }, 'Fermer')));
  m.dialog.classList.add('wide');
  m.dialog.addEventListener('close', () => URL.revokeObjectURL(url));
}

/* ======================= Envoi à la pharmacie ======================= */

function shareFile(file, extra = {}) {
  if (navigator.canShare?.({ files: [file] })) {
    return navigator.share({ files: [file], ...extra }).then(() => true).catch((e) => {
      if (e.name !== 'AbortError') console.error(e);
      return false;
    });
  }
  // Repli (ordinateur) : téléchargement du fichier
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return Promise.resolve(true);
}

function openSend() {
  const data = V.data();
  const sorted = [...data.ordonnances].sort((a, b) => b.date.localeCompare(a.date)).slice(0, VISIBLE_COUNT);
  if (!sorted.length) {
    const m = modal(
      h('p', { class: 'ds-label ds-upper ds-muted' }, 'Envoyer le dossier'),
      h('p', { class: 'ds-heading' }, 'Rien à envoyer pour l’instant'),
      h('p', { class: 'ds-text ds-muted' }, 'Ajoute au moins une ordonnance, puis reviens ici.'),
      h('div', { class: 'actions ds-action' },
        h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: () => m.close() }, 'Fermer'),
        h('button', { class: 'cta ds-press', type: 'button', onclick: () => { m.close(); openAddOrdonnance(); } }, 'Ajouter une ordonnance')));
    return;
  }
  const ph = data.contacts.pharmacie;
  const err = errorLine();
  const emailField = field({ label: 'E-mail de la pharmacie', name: 'email', type: 'email', value: ph.email, required: true });
  const nomField = field({ label: 'Ton nom, en tête du PDF', name: 'nom', value: data.profile.nom, autocomplete: 'name', hint: 'Pour que la pharmacie sache à qui sont ces ordonnances.' });
  const form = h('form', { class: 'stack-form', onsubmit: async (e) => {
    e.preventDefault();
    const email = form.elements.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (err.textContent = 'Cette adresse ne ressemble pas à un e-mail.');
    const nom = form.elements.nom.value.trim();
    if (email !== ph.email || nom !== data.profile.nom) {
      ph.email = email;
      data.profile.nom = nom;
      await V.save();
    }
    const done = busy(form.querySelector('button[type=submit]'), 'Création du PDF…');
    try {
      const parts = [];
      if (data.annual) parts.push({ label: `Ordonnance annuelle, émise le ${D.formatLong(data.annual.issued)}`, bytes: await V.getFile(data.annual.id) });
      for (const o of sorted) parts.push({ label: `Ordonnance délivrée le ${D.formatLong(o.date)}`, bytes: await V.getFile(o.id) });
      const { bytes, pages } = await buildBundle({ nom, contacts: data.contacts, parts });
      const file = new File([bytes], `ordonnances-${D.todayISO()}.pdf`, { type: 'application/pdf' });
      showReady(m, file, pages, email, nom);
      renderDashboard();
    } catch (ex) {
      console.error(ex);
      done();
      err.textContent = 'Le PDF n’a pas pu être créé. Un des fichiers est peut-être abîmé : ouvre chaque ordonnance pour vérifier.';
    }
  } },
    h('ul', { class: 'incl ds-text' },
      h('li', null, dot('ciel'), 'Page 1 : tes deux médecins et le sommaire'),
      data.annual ? h('li', null, dot('ciel'), 'L’ordonnance annuelle') : null,
      h('li', null, dot('ciel'), sorted.length === 1 ? 'La dernière ordonnance' : `Les ${sorted.length} dernières ordonnances`)),
    emailField, nomField,
    h('p', { class: 'ds-caption ds-muted' }, 'Le PDF est créé sur ton iPhone. Rien ne passe par un serveur.'),
    err,
    h('div', { class: 'actions ds-action' },
      h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: () => m.close() }, 'Annuler'),
      h('button', { class: 'cta ds-press', type: 'submit' }, 'Préparer l’e-mail')));
  const m = modal(
    h('p', { class: 'ds-label ds-upper ds-muted' }, 'Envoyer à la pharmacie'),
    h('p', { class: 'ds-heading' }, ph.nom ? ph.nom : 'Un seul PDF, prêt à joindre'),
    form);
}

function showReady(m, file, pages, email, nom) {
  const copy = () => navigator.clipboard?.writeText(email).then(() => toast('Adresse copiée'), () => {});
  const shareBtn = h('button', { class: 'cta ds-press', type: 'button', onclick: async () => {
    // Le partage doit partir directement du geste : on l'appelle avant tout le reste.
    const shared = shareFile(file, {
      title: 'Ordonnances',
      text: `Bonjour,\n\nVous trouverez ci-joint mes ordonnances.\n\nCordialement,\n${nom}`.trim(),
    });
    copy();
    if (await shared) toast('Partage ouvert');
  } }, 'Ouvrir le partage');
  m.body.replaceChildren(
    h('div', { class: 'done' },
      svgCheck(),
      h('p', { class: 'ds-heading' }, 'PDF prêt'),
      h('p', { class: 'ds-text ds-muted' }, `${D.plural(pages, 'page', 'pages')}. Touche « Ouvrir le partage », choisis Mail, puis colle l’adresse de la pharmacie dans « À ».`),
      h('p', { class: 'ds-text address' }, email, ' ',
        h('button', { class: 'linkbtn ds-link ds-action ds-target', type: 'button', onclick: copy }, 'Copier')),
      h('div', { class: 'actions ds-action center' },
        h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: () => m.close() }, 'Fermer'),
        shareBtn)));
}

/* ======================= Réglages et sauvegarde ======================= */

async function exportBackup() {
  const json = await V.exportBackup();
  const file = new File([json], `dossier-sante-sauvegarde-${D.todayISO()}.json`, { type: 'application/json' });
  if (await shareFile(file, { title: 'Sauvegarde chiffrée' })) toast('Sauvegarde prête');
}

function openRestore() {
  const err = errorLine();
  const form = h('form', { class: 'stack-form', onsubmit: async (e) => {
    e.preventDefault();
    const f = form.elements.backup.files?.[0];
    if (!f) return (err.textContent = 'Choisis le fichier de sauvegarde.');
    if (V.isUnlocked() && !confirm('La sauvegarde va remplacer tout ce qui est sur cet iPhone. Continuer ?')) return;
    const done = busy(form.querySelector('button[type=submit]'), 'Restauration…');
    try {
      await V.importBackup(await f.text(), form.elements.p.value);
      m.close();
      renderDashboard(true);
      toast('Sauvegarde restaurée');
    } catch (ex) {
      done();
      err.textContent = ex.message === 'BAD_PASSPHRASE' ? 'Cette phrase de passe n’ouvre pas cette sauvegarde. C’est celle qui était active au moment de l’export.'
        : ex.message === 'BAD_FILE' ? 'Ce fichier n’est pas une sauvegarde de Mon dossier santé.' : 'La restauration a échoué.';
    }
  } },
    h('div', { class: 'field-row' },
      h('label', { class: 'ds-label', for: 'backup' }, 'Fichier de sauvegarde'),
      h('input', { class: 'field file', id: 'backup', name: 'backup', type: 'file', accept: 'application/json,.json', required: true })),
    field({ label: 'Phrase de passe de la sauvegarde', name: 'p', type: 'password', required: true, autocomplete: 'current-password' }),
    h('p', { class: 'ds-caption ds-muted' }, 'Face ID sera à réactiver après la restauration.'),
    err,
    h('div', { class: 'actions ds-action' },
      h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: () => m.close() }, 'Annuler'),
      h('button', { class: 'cta ds-press', type: 'submit' }, 'Restaurer')));
  const m = modal(
    h('p', { class: 'ds-label ds-upper ds-muted' }, 'Sauvegarde'),
    h('p', { class: 'ds-heading' }, 'Restaurer une sauvegarde'),
    form);
}

async function openSettings() {
  const keys = await V.keysInfo();
  const data = V.data();

  const faceErr = errorLine();
  const faceBtn = h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: async () => {
    if (keys.passkey) {
      await V.disablePasskey();
      m.close();
      toast('Face ID désactivé');
      return;
    }
    const done = busy(faceBtn, 'Activation…');
    try {
      await V.enablePasskey();
      m.close();
      toast('Face ID activé');
    } catch (ex) {
      done();
      faceErr.textContent = passkeyError(ex);
    }
  } }, keys.passkey ? 'Désactiver Face ID' : 'Activer Face ID');

  const passErr = errorLine();
  const passForm = h('form', { class: 'stack-form', onsubmit: async (e) => {
    e.preventDefault();
    const f = passForm.elements;
    if (f.n1.value.length < MIN_PASS) return (passErr.textContent = `La nouvelle phrase de passe doit faire au moins ${MIN_PASS} caractères.`);
    if (f.n1.value !== f.n2.value) return (passErr.textContent = 'Les deux nouvelles phrases de passe ne sont pas identiques.');
    const done = busy(passForm.querySelector('button[type=submit]'), 'Changement…');
    try {
      await V.changePassphrase(f.cur.value, f.n1.value);
      m.close();
      toast('Phrase de passe changée');
    } catch (ex) {
      done();
      passErr.textContent = ex.message === 'BAD_PASSPHRASE' ? 'La phrase de passe actuelle ne correspond pas.' : 'Le changement a échoué.';
    }
  } },
    field({ label: 'Phrase de passe actuelle', name: 'cur', type: 'password', required: true, autocomplete: 'current-password' }),
    field({ label: 'Nouvelle phrase de passe', name: 'n1', type: 'password', required: true, autocomplete: 'new-password' }),
    field({ label: 'Confirme la nouvelle', name: 'n2', type: 'password', required: true, autocomplete: 'new-password' }),
    passErr,
    h('div', { class: 'actions ds-action' }, h('button', { class: 'cta ds-press', type: 'submit' }, 'Changer la phrase de passe')));

  const nameForm = h('form', { class: 'stack-form', onsubmit: async (e) => {
    e.preventDefault();
    data.profile.nom = nameForm.elements.nom.value.trim();
    await V.save();
    toast('Nom enregistré');
  } },
    field({ label: 'Ton nom, en tête du PDF envoyé', name: 'nom', value: data.profile.nom, autocomplete: 'name' }),
    h('div', { class: 'actions ds-action' }, h('button', { class: 'cta ds-press', type: 'submit' }, 'Enregistrer')));

  const m = modal(
    h('p', { class: 'ds-label ds-upper ds-muted' }, 'Réglages'),
    h('p', { class: 'ds-heading' }, 'Ton coffre'),
    h('section', { class: 'set' }, nameForm),
    h('section', { class: 'set' },
      h('p', { class: 'ds-label ds-upper ds-muted' }, 'Face ID'),
      h('p', { class: 'ds-text' }, keys.passkey ? 'Activé. Ta phrase de passe reste ta clé de secours.' : 'Désactivé. Tu déverrouilles avec ta phrase de passe.'),
      faceErr,
      h('p', { class: 'ds-action' }, faceBtn)),
    h('section', { class: 'set' },
      h('p', { class: 'ds-label ds-upper ds-muted' }, 'Phrase de passe'),
      passForm),
    h('section', { class: 'set' },
      h('p', { class: 'ds-label ds-upper ds-muted' }, 'Sauvegarde'),
      h('p', { class: 'ds-text' }, 'Si tu supprimes l’app de l’écran d’accueil, iOS efface ses données. Exporte une sauvegarde chiffrée dans Fichiers ou iCloud Drive de temps en temps.'),
      h('p', { class: 'ds-action inline-actions' },
        h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: exportBackup }, 'Exporter une sauvegarde'),
        h('button', { class: 'linkbtn ds-link ds-target', type: 'button', onclick: () => { m.close(); openRestore(); } }, 'Restaurer'))),
    h('section', { class: 'set' },
      h('p', { class: 'ds-label ds-upper ds-muted' }, 'Tout effacer'),
      h('p', { class: 'ds-text' }, 'Efface le coffre, les ordonnances et les contacts de cet iPhone. Cette action ne peut pas être annulée.'),
      h('p', { class: 'ds-action' }, h('button', { class: 'linkbtn ds-link ds-target danger', type: 'button', onclick: async () => {
        const answer = prompt('Pour tout effacer, tape EFFACER');
        if (answer?.trim().toUpperCase() !== 'EFFACER') return;
        await V.wipeAll();
        location.reload();
      } }, 'Tout effacer'))),
    h('div', { class: 'actions ds-action' }, h('button', { class: 'cta ds-press', type: 'button', onclick: () => m.close() }, 'Fermer')));
}

boot();
