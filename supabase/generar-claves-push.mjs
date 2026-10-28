// ==========================================================================
// generar-claves-push.mjs — Claves VAPID para las notificaciones push
// --------------------------------------------------------------------------
// Uso, desde la carpeta del proyecto:   node supabase/generar-claves-push.mjs
//
// Genera un par de claves nuevo (curva P-256, el formato que piden los
// navegadores) y lo muestra en pantalla. Cópialas en Supabase:
//   Edge Functions → Secrets → Add new secret
//     VAPID_PUBLIC_KEY   = la clave pública
//     VAPID_PRIVATE_KEY  = la clave privada  (no la compartas ni la subas a GitHub)
//     VAPID_SUBJECT      = mailto:tu-correo
// La app pide la clave pública a la función enviar-push; no hay que ponerla
// en ningún archivo. No necesita instalar nada: solo Node 18 o superior.
// ==========================================================================
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });

// Clave pública en formato «sin comprimir» (0x04 + x + y) y en base64url
const b64 = (texto) => Buffer.from(texto, 'base64url');
const publica = Buffer.concat([Buffer.from([4]), b64(pub.x), b64(pub.y)]).toString('base64url');

console.log('\nClaves VAPID nuevas (cópialas en Supabase → Edge Functions → Secrets):\n');
console.log(`VAPID_PUBLIC_KEY   ${publica}`);
console.log(`VAPID_PRIVATE_KEY  ${priv.d}`);
console.log('VAPID_SUBJECT      mailto:tu-correo@ejemplo.com   (pon tu correo)\n');
console.log('La clave privada es secreta: no la compartas ni la guardes en el proyecto.\n');
