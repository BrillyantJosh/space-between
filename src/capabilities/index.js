// ═══ CAPABILITY LOADER ═══
// Samodejno registrira vse ROKE sposobnosti iz capabilities/ mape.
// Vsak .js fajl (razen tega) je ena sposobnost.

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Naloži vse capability fajle
const capabilities = {};

const files = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.js') && f !== 'index.js');

for (const file of files) {
  try {
    const mod = await import(path.join(__dirname, file));
    const cap = mod.default;
    if (cap && cap.name) {
      capabilities[cap.name] = cap;
    }
  } catch (e) {
    console.error(`[BODY] Napaka pri nalaganju sposobnosti ${file}:`, e.message);
  }
}

const names = Object.keys(capabilities);
console.log(`[BODY] Roke registrirane: ${names.join(', ')}`);

// Vrni capabilities map
export default capabilities;

// Helper: vrni capabilities ki so dovoljene za dani triggerType
export function getCapabilitiesFor(triggerType) {
  return Object.values(capabilities).filter(cap => {
    if (triggerType === 'conversation') return cap.conversationAllowed;
    return cap.heartbeatAllowed;
  });
}

// Helper: izgradi MOJE ROKE blok za buildContext()
export function buildCapabilitiesBlock(triggerType) {
  const allowed = getCapabilitiesFor(triggerType);
  if (allowed.length === 0) return '';
  return '\n═══ MOJE ROKE (sposobnosti) ═══\n' +
    allowed.map(cap => `- ${cap.name}: ${cap.when}`).join('\n') +
    '\n';
}
