// Le coffre : clés, déverrouillage, données et fichiers PDF chiffrés.
import * as C from './crypto.js';
import * as db from './store.js';

const session = { key: null, data: null };

export const emptyData = () => ({
  version: 1,
  profile: { nom: '' },
  ordonnances: [],          // { id, date, fileName, pages, addedAt }
  annual: null,             // { id, issued, prescriber, fileName, pages }
  contacts: {
    mt: { nom: '', specialite: 'Médecine générale', lieu: '', tel: '', email: '' },
    psy: { nom: '', specialite: 'Psychiatrie', lieu: '', tel: '', email: '' },
    pharmacie: { nom: '', lieu: '', tel: '', email: '' },
  },
});

export const isUnlocked = () => !!session.key;
export const data = () => session.data;
export const hasVault = async () => !!(await db.get('meta', 'keys'));
export const keysInfo = () => db.get('meta', 'keys');

export function lockNow() {
  session.key = null;
  session.data = null;
}

/* ---------- Création et déverrouillage ---------- */

export async function create(passphrase) {
  const key = await C.newDataKey();
  const salt = C.random(16);
  const wrapped = await C.wrapKey(key, await C.keyFromPassphrase(passphrase, salt));
  await db.put('meta', 'keys', { v: 1, pass: { salt, iterations: C.PBKDF2_ITERATIONS, wrapped }, passkey: null });
  session.key = key;
  session.data = emptyData();
  await save();
  db.askPersistence();
}

export async function unlockWithPassphrase(passphrase) {
  const k = await keysInfo();
  let key;
  try {
    key = await C.unwrapKey(k.pass.wrapped, await C.keyFromPassphrase(passphrase, k.pass.salt, k.pass.iterations));
  } catch {
    throw new Error('BAD_PASSPHRASE');
  }
  await open(key);
}

async function open(key) {
  const box = await db.get('meta', 'vault');
  session.data = { ...emptyData(), ...(await C.decryptJSON(key, box)) };
  session.key = key;
  db.askPersistence();
}

export async function save() {
  await db.put('meta', 'vault', await C.encryptJSON(session.key, session.data));
}

export async function changePassphrase(current, next) {
  const k = await keysInfo();
  try {
    await C.unwrapKey(k.pass.wrapped, await C.keyFromPassphrase(current, k.pass.salt, k.pass.iterations));
  } catch {
    throw new Error('BAD_PASSPHRASE');
  }
  const salt = C.random(16);
  k.pass = { salt, iterations: C.PBKDF2_ITERATIONS, wrapped: await C.wrapKey(session.key, await C.keyFromPassphrase(next, salt)) };
  await db.put('meta', 'keys', k);
}

/* ---------- Face ID (passkey + extension PRF) ---------- */

export const passkeyAvailable = () => !!window.PublicKeyCredential && !!navigator.credentials;

async function prfSecret(credId, prfSalt) {
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: C.random(32),
      allowCredentials: [{ type: 'public-key', id: credId }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  });
  const first = cred.getClientExtensionResults()?.prf?.results?.first;
  if (!first) throw new Error('PRF_UNSUPPORTED');
  return new Uint8Array(first);
}

export async function enablePasskey() {
  const prfSalt = C.random(32);
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Mon dossier santé' },
      user: { id: C.random(16), name: 'Mon dossier santé', displayName: 'Mon dossier santé' },
      challenge: C.random(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: 60000,
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  });
  const credId = new Uint8Array(cred.rawId);
  const ext = cred.getClientExtensionResults()?.prf;
  if (ext && ext.enabled === false) throw new Error('PRF_UNSUPPORTED');
  // Certains appareils renvoient le secret dès la création, les autres seulement à l'authentification.
  const secret = ext?.results?.first ? new Uint8Array(ext.results.first) : await prfSecret(credId, prfSalt);
  const hkdfSalt = C.random(16);
  const wrapped = await C.wrapKey(session.key, await C.keyFromSecret(secret, hkdfSalt));
  const k = await keysInfo();
  k.passkey = { credId, prfSalt, hkdfSalt, wrapped };
  await db.put('meta', 'keys', k);
}

export async function disablePasskey() {
  const k = await keysInfo();
  k.passkey = null;
  await db.put('meta', 'keys', k);
}

export async function unlockWithPasskey() {
  const { passkey } = await keysInfo();
  const secret = await prfSecret(passkey.credId, passkey.prfSalt);
  let key;
  try {
    key = await C.unwrapKey(passkey.wrapped, await C.keyFromSecret(secret, passkey.hkdfSalt));
  } catch {
    throw new Error('BAD_PASSKEY');
  }
  await open(key);
}

/* ---------- Fichiers PDF ---------- */

export async function putFile(bytes) {
  const id = crypto.randomUUID();
  await db.put('files', id, await C.encryptBytes(session.key, bytes));
  return id;
}
export async function getFile(id) {
  return C.decryptBytes(session.key, await db.get('files', id));
}
export const deleteFile = (id) => db.del('files', id);

/* ---------- Sauvegarde ---------- */

const pack = (box) => ({ iv: C.toB64(box.iv), ct: C.toB64(box.ct) });
const unpack = (o) => ({ iv: C.fromB64(o.iv), ct: C.fromB64(o.ct) });

/** Fichier JSON entièrement chiffré, ouvrable seulement avec la phrase de passe. */
export async function exportBackup() {
  const k = await keysInfo();
  const files = {};
  for (const id of await db.keys('files')) files[id] = pack(await db.get('files', id));
  return JSON.stringify({
    app: 'dossier-sante', v: 1, createdAt: new Date().toISOString(),
    pass: { salt: C.toB64(k.pass.salt), iterations: k.pass.iterations, wrapped: C.toB64(k.pass.wrapped) },
    vault: pack(await db.get('meta', 'vault')),
    files,
  });
}

export async function importBackup(text, passphrase) {
  let b;
  try { b = JSON.parse(text); } catch { throw new Error('BAD_FILE'); }
  if (b?.app !== 'dossier-sante' || !b.pass || !b.vault) throw new Error('BAD_FILE');
  const pass = { salt: C.fromB64(b.pass.salt), iterations: b.pass.iterations, wrapped: C.fromB64(b.pass.wrapped) };
  let key;
  try {
    key = await C.unwrapKey(pass.wrapped, await C.keyFromPassphrase(passphrase, pass.salt, pass.iterations));
  } catch {
    throw new Error('BAD_PASSPHRASE');
  }
  const vault = unpack(b.vault);
  await C.decryptJSON(key, vault); // vérifie l'intégrité avant d'écraser quoi que ce soit
  await db.wipe();
  await db.put('meta', 'keys', { v: 1, pass, passkey: null });
  await db.put('meta', 'vault', vault);
  for (const [id, box] of Object.entries(b.files || {})) await db.put('files', id, unpack(box));
  await open(key);
}

export async function wipeAll() {
  lockNow();
  await db.wipe();
}
