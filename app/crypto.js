// Chiffrement local (Web Crypto, intégré au navigateur).
//
// Une clé de données aléatoire (AES-256-GCM) chiffre tout : le coffre (JSON) et chaque PDF.
// Cette clé n'est jamais stockée en clair : elle est « emballée » (AES-KW) par
//  - une clé tirée de la phrase de passe (PBKDF2-SHA-256, 600 000 itérations) ;
//  - et, si activé, une clé tirée de la passkey Face ID (extension WebAuthn PRF + HKDF).

const enc = new TextEncoder();
const dec = new TextDecoder();

export const PBKDF2_ITERATIONS = 600000;
export const random = (n) => crypto.getRandomValues(new Uint8Array(n));

export function newDataKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function keyFromPassphrase(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

export async function keyFromSecret(secret, salt) {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('dossier-sante/passkey') },
    base, { name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

export async function wrapKey(dataKey, wrappingKey) {
  return new Uint8Array(await crypto.subtle.wrapKey('raw', dataKey, wrappingKey, 'AES-KW'));
}

/** Lève une erreur si la clé d'emballage est mauvaise (phrase de passe fausse). */
export function unwrapKey(wrapped, wrappingKey) {
  return crypto.subtle.unwrapKey('raw', wrapped, wrappingKey, 'AES-KW',
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function encryptBytes(key, bytes) {
  const iv = random(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { iv, ct };
}
export async function decryptBytes(key, { iv, ct }) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
}
export const encryptJSON = (key, value) => encryptBytes(key, enc.encode(JSON.stringify(value)));
export const decryptJSON = async (key, box) => JSON.parse(dec.decode(await decryptBytes(key, box)));

// Base64 pour le fichier de sauvegarde
export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
