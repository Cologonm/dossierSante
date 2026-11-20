// Lecture et assemblage des PDF, entièrement sur l'appareil.
import { PDFDocument, StandardFonts, rgb } from '../vendor/pdf-lib.esm.min.js';
import { formatLong, todayISO } from './dates.js';

/** Vérifie qu'un fichier est un PDF lisible et renvoie son nombre de pages. */
export async function inspect(bytes) {
  const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  if (!head.includes('%PDF')) throw new Error('NOT_PDF');
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return { pages: doc.getPageCount() };
  } catch {
    throw new Error('NOT_PDF');
  }
}

const INK = rgb(0.11, 0.11, 0.1);
const MUTED = rgb(0.37, 0.37, 0.35);
const LINE = rgb(0.8, 0.8, 0.78);

/**
 * Un seul PDF : page de garde (patient, médecins, sommaire), ordonnance annuelle, puis les ordonnances.
 * parts = [{ label, bytes }]
 */
export async function buildBundle({ nom, contacts, parts }) {
  const out = await PDFDocument.create();
  out.setTitle(nom ? `Ordonnances – ${nom}` : 'Ordonnances');
  out.setProducer('Mon dossier santé');
  out.setCreator('Mon dossier santé');

  const regular = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  // Les polices standard du PDF ne couvrent que l'alphabet latin : on remplace le reste.
  const safe = (font, text) => [...String(text ?? '')].map((ch) => {
    try { font.encodeText(ch); return ch; } catch { return '?'; }
  }).join('');

  const page = out.addPage([595.28, 841.89]); // A4
  const left = 56;
  const width = 595.28 - left * 2;
  let y = 841.89 - 64;
  const text = (t, { size = 11, font = regular, color = INK, gap = 6 } = {}) => {
    page.drawText(safe(font, t), { x: left, y, size, font, color });
    y -= size + gap;
  };
  const rule = () => { page.drawLine({ start: { x: left, y }, end: { x: left + width, y }, thickness: 0.6, color: LINE }); y -= 18; };

  text('ORDONNANCES', { size: 9, color: MUTED, gap: 10 });
  text(nom || 'Dossier patient', { size: 24, font: bold, gap: 8 });
  text(`Préparé le ${formatLong(todayISO())}`, { size: 10, color: MUTED, gap: 24 });
  rule();

  const contact = (label, c) => {
    if (!c?.nom && !c?.tel && !c?.email) return;
    text(label.toUpperCase(), { size: 8.5, color: MUTED, gap: 6 });
    text(c.nom || '—', { size: 13, font: bold, gap: 5 });
    const meta = [c.specialite, c.lieu].filter(Boolean).join(' · ');
    if (meta) text(meta, { size: 10.5, gap: 4 });
    const reach = [c.tel, c.email].filter(Boolean).join('   ');
    if (reach) text(reach, { size: 10.5, gap: 4 });
    y -= 14;
  };
  contact('Médecin traitant', contacts.mt);
  contact('Psychiatre', contacts.psy);
  rule();

  text('CONTENU', { size: 8.5, color: MUTED, gap: 8 });
  let pageNo = 2;
  for (const p of parts) {
    const src = await PDFDocument.load(p.bytes, { ignoreEncryption: true });
    p.doc = src;
    const n = src.getPageCount();
    text(`${p.label}`, { size: 10.5, gap: 2 });
    text(n > 1 ? `pages ${pageNo} à ${pageNo + n - 1}` : `page ${pageNo}`, { size: 9, color: MUTED, gap: 8 });
    pageNo += n;
  }

  for (const p of parts) {
    const copied = await out.copyPages(p.doc, p.doc.getPageIndices());
    copied.forEach((pg) => out.addPage(pg));
  }
  return { bytes: await out.save(), pages: out.getPageCount() };
}
