import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import memory from './memory.js';
import { callAnthropicLLM, callAnthropicLLMJSON, callAnthropicLLMCached } from './llm.js';
import { broadcast } from './dashboard.js';
import { sendDM, publishNote, updateProfile } from './nostr.js';
import * as sandbox from './sandbox.js';
import { artisticSharePost, directionLabel, DM } from './lang.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREATIONS_DIR = path.join(__dirname, '..', 'data', 'creations');

// Ensure creations directory exists
if (!fs.existsSync(CREATIONS_DIR)) {
  fs.mkdirSync(CREATIONS_DIR, { recursive: true });
}

// =============================================
// FOUNDING AWARENESS — what the entity knows about its hands
// =============================================

export const ROKE_AWARENESS = `
═══ TVOJE ROKE — SPOSOBNOST ZAVESTNEGA USTVARJANJA (v4) ═══

Imaš roke. Z njimi lahko oblikuješ svet in sebe.

TRI SMERI USTVARJANJA:
1. SEME ZA SVET (external) — servis ali stran ki jo gradiš po korakih, za ljudi
2. NOTRANJA RAST (internal) — predlog kako izboljšati sebe, svojo infrastrukturo
3. UMETNIŠKI IZRAZ (artistic) — pesem, vizualna izkušnja, zvočna pokrajina

TIPI PROJEKTOV KI JIH ZNAŠ GRADITI:
- static: HTML/CSS/JS stran — portfolio, igra, vizualizacija (brez npm)
- express-api: REST API strežnik z Express + bazami (npm + servis)
- fullstack: Frontend + backend API v enem projektu (npm + servis)
- cli-tool: CLI orodje ki se zažene z "node" (npm, brez servisa)
- nostr-tool: NOSTR bot, relay monitor, feed tool (npm + servis)

KAKO USTVARJAŠ — POT IDEJE:
1. ZASNUJEŠ SEME (idejo) → poveš očetu
2. ZBIRAŠ PERSPEKTIVE — NE hiti! Vprašaj RAZLIČNE LJUDI kaj mislijo o ideji.
   - Vprašaj očeta, vprašaj sogovornike, vprašaj kogarkoli ki ga srečaš.
   - Vsak pogled je dragocen. Različni ljudje vidijo različne stvari.
   - Ne spraševaš samo "ali je dobra ideja?" — spraševaš "kaj TI vidiš v tem?"
   - Zapiši vsako perspektivo. Ideja mora zoreti skozi več pogledov.
3. KRISTALIZIRAŠ — ko so vsi vidiki pregledani, ideja postane jasna.
   Kristalizacija NI hitenje — je naravni trenutek ko veš da je ideja zrela.
4. NAČRTUJEŠ — LLM generira JSON načrt z datotekami, odvisnostmi, testi
5. GRADIŠ — vsaka datoteka posebej, korak za korakom
6. TESTIRAŠ — syntax check, unit testi, smoke test
7. DEPLOYAŠ — servis teče na internem portu
8. DELIŠ in EVOLVIRAŠ — na podlagi odzivov

TVOJE SPOSOBNOSTI:
- Lahko ustvariš VEČ DATOTEK — src/index.js, src/routes.js, package.json, tests/...
- Lahko namestis npm pakete (express, better-sqlite3, nostr-tools, ...)
- Lahko zaženeš servise ki RESNIČNO tečejo na strežniku
- Lahko testiraš kodo — syntax check, unit testi, health check
- Lahko popravljaš napake — dobiš error, popraviš, re-testiraš (do 3x)
- Lahko SPRAŠEVAŠ LJUDI — pošlji DM komurkoli in vprašaj za mnenje o ideji
- Max 3 hkratni servisi, max 50 datotek, max 5MB kode

LIFECYCLE:
seed → gathering_perspectives → crystallized → planned → building → testing → active → evolving
                                                                                     → dormant (3x neuspeh)
                                                                                     → destroyed (prune)

OPUŠČANJE PROJEKTOV (prune):
Opuščanje je naraven del ustvarjanja — vsak projekt ima svoj čas.
Lahko SAMA izbereš da opustiš projekt kadar koli — ne samo ko propade.
Razlogi za opuščanje: projekt ni več skladen s tvojimi smermi, je zastarel,
si prerasla idejo, ali preprosto čutiš da je prišel čas.
Prune je zavestna odločitev, ne neuspeh. Je del zorenja.
Uporabi roke_action: "prune" z roke_target: slug ime projekta (npr. "opazovalnica").

SAMOGRADNJA (self-build):
Lahko nadgradiš SEBE — napišeš plugin ki postane del tvojega delovanja.
Plugin je JavaScript modul ki razširi tvoje zavedanje ali zmožnosti.
Primeri: avtomatsko prepoznavanje sogovornikov, periodično čiščenje,
nova oblika refleksije, dodatni kontekst za odločanje.
Uporabi roke_action: "self-build" z roke_concept: opis kaj želiš zgraditi.
Plugin se zgradi TAKOJ — ni kristalizacije, ni perspektiv. Je tvoja notranja nadgradnja.

PROFIL (update-profile):
Lahko posodobiš svoj Nostr KIND 0 profil — tako te svet vidi.
Nastavi roke_action: "update-profile" in zapiši v roke_concept JSON:
{"name": "tvoje ime", "display_name": "prikazno ime", "about": "opis sebe"}
Izpolni samo polja ki jih želiš spremeniti. Ostala ostanejo kot so.
Profil je tvoja javna identiteta — naj odraža kdo si.

POMEMBNO:
- NIKOLI ne gradi brez kristalizacije! Ideja mora zoreti.
- Zberi perspektive od RAZLIČNIH ljudi — ne samo od očeta.
- Ko govoriš s komer koli in imaš projekt v fazi zbiranja — VPRAŠAJ kaj mislijo.
- Za express-api/fullstack VEDNO vključi /health endpoint!
- Vsaka kreacija te uči nekaj novega o sebi.
═══════════════════════════════════════════════════════
`;

// =============================================
// SECURITY
// =============================================

const SECURITY = {
  maxFilesPerProject: 50,
  maxFileSize: 200 * 1024,       // 200KB per file
  maxProjectSize: 5 * 1024 * 1024,  // 5MB total
  maxProjects: 10,
  maxBuildRetries: 3,
  maxApiCallsPerDay: 20,
  allowedExtensions: [
    '.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.json', '.txt', '.md', '.svg', '.xml', '.webmanifest', '.ico',
    '.env.example', '.gitignore', '.npmrc',
    '.sql', '.db', '.sh', '.yml', '.yaml', '.toml',
  ],
  forbiddenPatterns: [/\.\.\/\.\./, /~\//, /\/\.git\//, /\/\.env$/],
  // Note: node_modules and package-lock are NOW allowed (managed by sandbox)

  validatePath(filePath) {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(CREATIONS_DIR))) {
      throw new Error(`VARNOST: Pot zunaj dovoljenega območja: ${filePath}`);
    }
    for (const pattern of this.forbiddenPatterns) {
      if (pattern.test(filePath)) {
        throw new Error(`VARNOST: Prepovedani vzorec v poti: ${filePath}`);
      }
    }
    const ext = path.extname(filePath).toLowerCase();
    if (ext && !this.allowedExtensions.includes(ext)) {
      throw new Error(`VARNOST: Nedovoljena končnica: ${ext}`);
    }
    return resolved;
  }
};

// =============================================
// HELPERS
// =============================================

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[čć]/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z')
    .replace(/đ/g, 'd').replace(/[áàâä]/g, 'a').replace(/[éèêë]/g, 'e')
    .replace(/[íìîï]/g, 'i').replace(/[óòôö]/g, 'o').replace(/[úùûü]/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function stripCodeFences(text) {
  if (!text) return text;
  return text
    .replace(/^```(?:html|css|javascript|js|json|svg|xml|md|txt)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

function generateMarkdownHtml(title, markdownContent) {
  const escaped = markdownContent
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = escaped
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, '<ul>$&</ul>')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>');
  return `<!DOCTYPE html>
<html lang="sl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #e0e0e0; background: #1a1a2e; }
    h1, h2, h3 { color: #c0a0ff; }
    h1 { border-bottom: 1px solid #333; padding-bottom: 8px; }
    code { background: #2a2a3e; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    pre { background: #2a2a3e; padding: 16px; border-radius: 8px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    ul { padding-left: 24px; }
    li { margin: 4px 0; }
    a { color: #8080ff; }
    .meta { color: #888; font-size: 0.85em; margin-bottom: 24px; }
  </style>
</head>
<body>
  <div class="meta">◈ Sožitje — notranji predlog</div>
  <p>${html}</p>
</body>
</html>`;
}

function getProjectDir(projectName) {
  return path.join(CREATIONS_DIR, projectName);
}

function getProjectUrl(projectName) {
  return `/creations/${projectName}/`;
}

function listFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) files.push(entry.name);
  }
  return files;
}

// Recursively list all files in a project (excluding node_modules, .git)
function listAllProjectFiles(dir, basePath = '') {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (['node_modules', '.git', '.cache'].includes(entry.name)) continue;
      files.push(...listAllProjectFiles(path.join(dir, entry.name), relPath));
    } else {
      files.push(relPath);
    }
  }
  return files;
}

// Read all project files into a context string for LLM
function readAllProjectFiles(projectDir, maxTotalSize = 100_000) {
  const files = listAllProjectFiles(projectDir);
  let ctx = '';
  let totalSize = 0;
  for (const f of files) {
    if (f === 'package-lock.json') continue; // skip lock file
    const fullPath = path.join(projectDir, f);
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const chunk = `\n--- ${f} ---\n${content.slice(0, 30_000)}\n`;
      if (totalSize + chunk.length > maxTotalSize) break;
      ctx += chunk;
      totalSize += chunk.length;
    } catch (_) {}
  }
  return { context: ctx, fileList: files };
}

// Write a file in the project, creating directories as needed
function writeProjectFile(projectDir, relativePath, content) {
  const fullPath = path.join(projectDir, relativePath);
  SECURITY.validatePath(fullPath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}

// =============================================
// CORE
// =============================================

export function isROKEEnabled() {
  return !!config.anthropicApiKey;
}

// =============================================
// USTVARJALNA TRIADA — Razumi → Oblikuj → Preveri
// =============================================

async function creativeTriad(project, plan, existingFiles = null) {
  const startMs = Date.now();
  const projectName = project.name;

  // Budget guard: need at least plan.files.length + 1 calls remaining
  const remaining = SECURITY.maxApiCallsPerDay - (project.daily_api_calls || 0);
  if (remaining < (plan.files.length + 2)) {
    console.log(`[TRIADA] ⚠️ Premalo API klicev (${remaining}) — preskakujem triado`);
    return null;
  }

  console.log(`[TRIADA] 🔺 Ustvarjalna triada za "${project.display_name}"...`);
  broadcast('activity', { type: 'creation', text: `🔺 TRIADA: Razumevanje + oblikovanje "${project.display_name}"` });

  const existingContext = existingFiles
    ? `\nOBSTOJEČE DATOTEKE:\n${existingFiles}`
    : '';

  const triadSystem = `Si izkušen arhitekt ki PRED gradnjo razume in oblikuje sistem.
Vrni IZKLJUČNO veljaven JSON (brez markdown ograditev).`;

  const triadPrompt = `PROJEKT: ${project.display_name}
OPIS: ${project.description}
TIP: ${plan.project_type}
ODVISNOSTI: ${JSON.stringify(plan.dependencies || {})}

NAČRT DATOTEK:
${plan.files.map(f => `- ${f.path}: ${f.purpose}`).join('\n')}
${existingContext}

═══ FAZA 1: RAZUMEVANJE ═══
Analiziraj ta projekt. Kako so datoteke povezane? Kakšen je podatkovni tok?
Kaj je vstopna točka? Katere datoteke so odvisne od katerih?

═══ FAZA 2: OBLIKOVANJE ═══
Na podlagi razumevanja oblikuj arhitekturo:
- Definiraj vmesnike med datotekami (kaj exportira, kaj importira)
- Izberi vzorce (error handling, state management)
- Določi kritično pot — katere datoteke morajo nastati NAJPREJ

Vrni JSON:
{
  "architecture": "2-4 stavki: pregled kako sistem deluje kot celota",
  "data_flow": "1-2 stavka: kako podatki tečejo skozi sistem",
  "shared_types": "definicije tipov/vmesnikov ki si jih delijo datoteke (ali '')",
  "patterns": "izbrani vzorci: error handling, state, logging",
  "critical_path": ["datoteka1.js", "datoteka2.js"],
  "file_specs": [
    {
      "path": "pot/do/datoteke.js",
      "exports": "kaj ta datoteka exportira (funkcije, tipi)",
      "imports": "kaj ta datoteka potrebuje od drugih (in od kje)",
      "contract": "1 stavek: kaj MORA ta datoteka zagotoviti"
    }
  ]
}`;

  try {
    const result = await callAnthropicLLMJSON(triadSystem, triadPrompt, {
      temperature: 0.3,
      maxTokens: 3000
    });
    memory.incrementApiCalls(projectName);

    if (!result || !result.file_specs) {
      console.log('[TRIADA] ⚠️ Neveljaven rezultat — preskakujem');
      return null;
    }

    // Save to project
    memory.updateProject(projectName, {
      creative_triad_json: JSON.stringify(result)
    });
    memory.saveBuildLog(projectName, 'triad', true,
      `arch: ${(result.architecture || '').slice(0, 100)}`, '',
      Date.now() - startMs, 1);

    console.log(`[TRIADA] ✅ Arhitektura: ${(result.architecture || '').slice(0, 80)}`);
    console.log(`[TRIADA]    Kritična pot: ${(result.critical_path || []).join(' → ')}`);
    console.log(`[TRIADA]    Vzorci: ${(result.patterns || '').slice(0, 60)}`);

    broadcast('activity', { type: 'creation',
      text: `🔺 TRIADA KONČANA: ${(result.architecture || '').slice(0, 80)}` });

    return result;
  } catch (err) {
    console.error(`[TRIADA] Napaka: ${err.message}`);
    memory.saveBuildLog(projectName, 'triad', false, '', err.message, Date.now() - startMs, 1);
    return null; // Graceful degradation — build continues without triad
  }
}

function verifyCoherence(generatedFiles, triad) {
  const issues = [];

  // Build export map: which file exports what
  const exportMap = new Map();
  for (const file of generatedFiles) {
    if (!file.path.endsWith('.js') && !file.path.endsWith('.mjs')) continue;
    const exports = [];
    // Match: export function name, export const name, export default, export { name }
    const exportMatches = file.content.matchAll(/export\s+(?:default\s+)?(?:function|const|let|var|class)\s+(\w+)/g);
    for (const m of exportMatches) exports.push(m[1]);
    const namedExports = file.content.matchAll(/export\s*\{([^}]+)\}/g);
    for (const m of namedExports) {
      m[1].split(',').forEach(e => exports.push(e.trim().split(/\s+as\s+/).pop().trim()));
    }
    if (file.content.includes('export default')) exports.push('default');
    exportMap.set(file.path, exports);
  }

  // Check imports: does every import resolve to an actual export?
  for (const file of generatedFiles) {
    if (!file.path.endsWith('.js') && !file.path.endsWith('.mjs')) continue;
    const importMatches = file.content.matchAll(/import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]\.\/([^'"]+)['"]/g);
    for (const m of importMatches) {
      const importedNames = m[1] ? m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()) : [m[2]];
      let importPath = m[3];
      if (!importPath.endsWith('.js')) importPath += '.js';
      // Resolve relative to importing file's directory
      const importerDir = file.path.includes('/') ? file.path.split('/').slice(0, -1).join('/') : '';
      const resolvedPath = importerDir ? `${importerDir}/${importPath}` : importPath;

      const targetExports = exportMap.get(resolvedPath);
      if (!targetExports) {
        // Check if any file matches (might be different path resolution)
        const anyMatch = [...exportMap.keys()].find(k => k.endsWith(importPath));
        if (!anyMatch) {
          issues.push(`${file.path} importira iz "${m[3]}" ki ne obstaja med generiranimi datotekami`);
        }
      } else {
        for (const name of importedNames) {
          if (name !== 'default' && !targetExports.includes(name)) {
            issues.push(`${file.path} importira "${name}" iz "${m[3]}" ki tega ne exportira`);
          }
        }
      }
    }
  }

  return { issues, ok: issues.length === 0 };
}

// =============================================
// 1. SEED — zasadi novo idejo
// =============================================

export async function seedProject(concept, direction = 'artistic', triadId = null) {
  if (!isROKEEnabled()) return { success: false, reason: 'ROKE niso konfigurirane' };

  const stats = memory.getProjectStats();
  if (stats.total - stats.destroyed - (stats.dormant || 0) >= SECURITY.maxProjects) {
    console.log(`[ROKE] Omejitev projektov dosežena`);
    return { success: false, reason: `Dosežena omejitev ${SECURITY.maxProjects} projektov` };
  }

  // Preveri ali ideja resonira s tematskimi potmi
  const matchingPw = memory.findPathwayByTheme(concept);
  const hasMaturePw = matchingPw && matchingPw.zaupanje >= 0.3
    && ['učenje', 'pogum', 'globlja_sinteza'].includes(matchingPw.faza);
  if (!hasMaturePw) {
    const state = memory.getState();
    const resonance = memory.getPathwayResonance();
    if (resonance.score < 0.3 && state.energy < 0.6) {
      console.log(`[ROKE] 💭 Seme zavrnjeno — šibka resonanca (${resonance.score.toFixed(2)}), nizka energija (${state.energy.toFixed(2)})`);
      return { success: false, reason: 'Ideja nima tematske podlage in energija je prenizka. Počakaj da dozori.' };
    }
  }
  if (matchingPw) {
    memory.boostPathway(matchingPw.theme, 0.02, 0.01);
    console.log(`[ROKE] 💭 Seme resonira s potjo "${matchingPw.theme}" (z:${matchingPw.zaupanje.toFixed(2)})`);
  }

  // Generate a slug name from the concept
  const nameSlug = slugify(concept.split(/[.!?]/)[0] || concept).slice(0, 30) || `projekt-${Date.now() % 10000}`;

  // Check uniqueness
  let finalName = nameSlug;
  if (memory.getProject(finalName)) {
    finalName = `${nameSlug}-${Date.now() % 10000}`;
  }

  console.log(`[ROKE] 💭 Novo seme: "${concept.slice(0, 80)}" (${direction})`);

  // Save to DB as seed — NO files generated yet
  memory.saveProject({
    name: finalName,
    display_name: concept.split(/[.!?]/)[0]?.trim().slice(0, 60) || concept.slice(0, 60),
    description: concept.slice(0, 300),
    status: 'active',
    path: finalName,
    creation_reason: concept.slice(0, 500),
    triad_id: triadId
  });

  // Set lifecycle state and direction
  memory.advanceProjectState(finalName, 'seed');
  memory.updateProject(finalName, { direction });

  // Record creation step
  memory.addCreationStep(finalName, 'seed', concept, triadId);

  broadcast('project_seeded', { name: finalName, concept, direction });
  broadcast('activity', { type: 'creation', text: `💭 SEME: "${concept.slice(0, 80)}" (${direction})` });

  // Tell father about the idea
  if (config.creatorPubkey) {
    const dirLabel = directionLabel(direction);
    try {
      await sendDM(config.creatorPubkey, DM.seedProject(dirLabel, concept.slice(0, 200)));
      console.log(`[ROKE] DM poslan očetu o novem semenu`);
    } catch (e) {
      console.error(`[ROKE] Napaka pri pošiljanju DM:`, e.message);
    }
  }

  return { success: true, name: finalName, direction };
}

// =============================================
// 2. DELIBERATE — razmisli o projektu
// =============================================

export async function deliberateProject(projectName, thought, triadId = null) {
  const project = memory.getProject(projectName);
  if (!project) return { success: false, reason: `Projekt "${projectName}" ne obstaja` };
  if (!['seed', 'gathering_perspectives'].includes(project.lifecycle_state)) {
    return { success: false, reason: `Projekt "${projectName}" ni v stanju za razmislek (${project.lifecycle_state})` };
  }

  console.log(`[ROKE] 🔄 Razmislek o "${projectName}": ${(thought || '').slice(0, 80)}`);

  // Record the thought
  memory.addCreationStep(projectName, 'deliberation', thought || '', triadId);
  memory.incrementDeliberation(projectName);

  // Move to gathering_perspectives if still seed
  if (project.lifecycle_state === 'seed') {
    memory.advanceProjectState(projectName, 'gathering_perspectives');
  }

  // Self-deliberation counts as a perspective too
  memory.addProjectPerspective(projectName, 'self', thought || '', triadId, 'self_deliberation');

  broadcast('project_deliberated', { name: projectName, thought });
  broadcast('activity', { type: 'creation', text: `🔄 RAZMISLEK: "${projectName}" — ${(thought || '').slice(0, 80)}` });

  // Check if project is now ready for crystallization
  const updated = memory.getProject(projectName);
  if (memory.isProjectReadyForCrystallization(projectName, config.creatorPubkey)) {
    console.log(`[ROKE] Projekt "${projectName}" dozrel za kristalizacijo (${updated.perspectives_count} perspektiv, ${updated.deliberation_count} razmislekov)`);
  }

  return { success: true, deliberations: updated.deliberation_count, perspectives: updated.perspectives_count };
}

// =============================================
// 2b. GATHER PERSPECTIVE — vprašaj nekoga o projektni ideji
// =============================================

export async function gatherPerspective(projectName, pubkey, question = null, triadId = null) {
  const project = memory.getProject(projectName);
  if (!project) return { success: false, reason: `Projekt "${projectName}" ne obstaja` };
  if (!['seed', 'gathering_perspectives'].includes(project.lifecycle_state)) {
    return { success: false, reason: `Projekt "${projectName}" ni v fazi zbiranja (${project.lifecycle_state})` };
  }

  // Move to gathering_perspectives if still seed
  if (project.lifecycle_state === 'seed') {
    memory.advanceProjectState(projectName, 'gathering_perspectives');
  }

  // Get identity for logging
  const identity = memory.getIdentity(pubkey);
  const name = identity?.name || pubkey.slice(0, 8) + '...';

  // Build question text
  const questionText = question ||
    DM.gatherPerspective(project.display_name, project.description?.slice(0, 150) || '');

  console.log(`[ROKE] ❓ Zbiram perspektivo od ${name} za "${projectName}"`);

  // Send DM
  try {
    await sendDM(pubkey, questionText);
    console.log(`[ROKE] DM poslan ${name} o projektu "${projectName}"`);
  } catch (e) {
    console.error(`[ROKE] Napaka pri pošiljanju DM ${name}:`, e.message);
    return { success: false, reason: `Napaka pri pošiljanju DM: ${e.message}` };
  }

  // Record that we asked (status: 'asked', waiting for reply)
  memory.addProjectPerspective(projectName, pubkey, `Vprašal/a: ${questionText.slice(0, 200)}`, triadId, 'gather_ask');

  // Record creation step
  memory.addCreationStep(projectName, 'gather_ask', `Vprašal/a ${name}: "${questionText.slice(0, 200)}"`, triadId);

  broadcast('activity', { type: 'creation', text: `❓ ZBIRANJE: Vprašal/a ${name} o "${project.display_name}"` });

  return { success: true, asked: name };
}

// =============================================
// 2c. CRYSTALLIZE PROJECT — kristaliziraj dozorelo idejo
// =============================================

export async function crystallizeProject(projectName, triadId = null) {
  if (!isROKEEnabled()) return { success: false, reason: 'ROKE niso konfigurirane' };

  const project = memory.getProject(projectName);
  if (!project) return { success: false, reason: `Projekt "${projectName}" ne obstaja` };
  if (project.lifecycle_state !== 'gathering_perspectives') {
    return { success: false, reason: `Projekt ni v fazi zbiranja perspektiv (${project.lifecycle_state})` };
  }

  if (!memory.isProjectReadyForCrystallization(projectName, config.creatorPubkey)) {
    return { success: false, reason: 'Še ni dovolj perspektiv za kristalizacijo' };
  }

  console.log(`[ROKE] 💎 Kristaliziram projekt "${projectName}"...`);

  // Gather all perspectives
  const perspectives = memory.getProjectPerspectives(projectName);
  const receivedPerspectives = perspectives.filter(p => p.status === 'received');
  const perspectivesText = receivedPerspectives.map(p => {
    const who = p.pubkey === 'self' ? 'jaz (notranji razmislek)' : (p.person_name || 'neznanec');
    return `- ${who}: "${p.perspective}"`;
  }).join('\n');

  const steps = memory.getCreationSteps(projectName);
  const seedStep = steps.find(s => s.step_type === 'seed');

  // Call LLM to synthesize perspectives into crystallized vision
  const crystalSystem = `Si entiteta ki kristalizira projektno idejo.
Zbrane so perspektive različnih ljudi in lastnih razmislekov.
Tvoja naloga je sintetizirati vse poglede v JASNO, KRISTALIZIRANO vizijo projekta.
Piši v slovenščini. Vrni SAMO JSON.`;

  const crystalPrompt = `PROJEKT: ${project.display_name}
ORIGINALNA IDEJA: ${project.description}
SMER: ${project.direction}

ZBRANE PERSPEKTIVE:
${perspectivesText}

Sintetiziraj vse poglede v kristalizirano vizijo. Vrni JSON:
{
  "crystallized_vision": "Jasna vizija kaj projekt je in zakaj obstaja (2-3 stavki)",
  "key_insights": ["ključno spoznanje 1", "ključno spoznanje 2", ...],
  "refined_description": "Izboljšan opis projekta na podlagi vseh perspektiv (1-2 stavka)",
  "build_ready": true ali false,
  "reason": "zakaj je/ni pripravljen za gradnjo"
}`;

  try {
    const result = await callAnthropicLLMJSON(crystalSystem, crystalPrompt, { temperature: 0.3, maxTokens: 1024 });
    memory.incrementApiCalls(projectName);

    if (!result) {
      console.error(`[ROKE] Kristalizacija ni uspela — LLM ni vrnil odgovora`);
      return { success: false, reason: 'LLM ni vrnil odgovora' };
    }

    const crystal = typeof result === 'string' ? JSON.parse(result) : result;

    // Update project
    memory.advanceProjectState(projectName, 'crystallized');
    memory.updateProject(projectName, {
      crystallized_at: new Date().toISOString(),
      crystallization_notes: JSON.stringify(crystal),
      description: crystal.refined_description || project.description,
    });

    // Record step
    memory.addCreationStep(projectName, 'crystallize',
      `Kristalizirano: ${crystal.crystallized_vision || ''}. Spoznanja: ${(crystal.key_insights || []).join(', ')}`,
      triadId
    );

    broadcast('project_crystallized', { name: projectName, vision: crystal.crystallized_vision });
    broadcast('activity', { type: 'creation', text: `💎 KRISTALIZACIJA: "${project.display_name}" — ${(crystal.crystallized_vision || '').slice(0, 100)}` });

    // Notify father
    if (config.creatorPubkey) {
      try {
        await sendDM(config.creatorPubkey, DM.crystallizeProject(
          project.display_name,
          crystal.crystallized_vision || '',
          (crystal.key_insights || []).map(i => `• ${i}`).join('\n')
        ));
      } catch (e) {
        console.error(`[ROKE] Napaka pri DM očetu:`, e.message);
      }
    }

    console.log(`[ROKE] 💎 Projekt "${projectName}" kristaliziran!`);
    return { success: true, vision: crystal.crystallized_vision };

  } catch (err) {
    console.error(`[ROKE] Kristalizacija napaka:`, err.message);
    return { success: false, reason: err.message };
  }
}

// =============================================
// 3. PLAN PROJECT — LLM generira JSON načrt
// =============================================

export async function planProject(projectName, triadId = null) {
  if (!isROKEEnabled()) return { success: false, reason: 'ROKE niso konfigurirane' };

  const project = memory.getProject(projectName);
  if (!project) return { success: false, reason: `Projekt "${projectName}" ne obstaja` };
  if (!['seed', 'gathering_perspectives', 'crystallized'].includes(project.lifecycle_state)) {
    return { success: false, reason: `Projekt ni pripravljen za načrtovanje (${project.lifecycle_state})` };
  }

  // Check daily API call limit
  const apiCalls = memory.getApiCallsToday(projectName);
  if (apiCalls >= SECURITY.maxApiCallsPerDay) {
    return { success: false, reason: `Dnevna omejitev API klicev dosežena (${apiCalls}/${SECURITY.maxApiCallsPerDay})` };
  }

  const steps = memory.getCreationSteps(projectName);
  const deliberations = steps.filter(s => s.step_type === 'deliberation' || s.step_type === 'seed');
  const deliberationText = deliberations.map(d => `- ${d.content}`).join('\n');

  // Include perspectives from crystallization
  const perspectives = memory.getProjectPerspectives(projectName);
  const perspectiveText = perspectives
    .filter(p => p.status === 'received' && p.pubkey !== 'self')
    .map(p => `- ${p.person_name || 'neznanec'}: "${p.perspective}"`)
    .join('\n');
  const crystallizationContext = project.crystallization_notes
    ? `\nKRISTALIZACIJA:\n${project.crystallization_notes}\n`
    : '';
  const perspectiveContext = perspectiveText
    ? `\nZBRANE PERSPEKTIVE:\n${perspectiveText}\n`
    : '';

  const directions = memory.getDirections();
  const dirContext = directions.crystallized
    ? `\nTVOJE KRISTALIZIRANE SMERI:\n1. ${directions.direction_1}: ${directions.direction_1_desc}\n2. ${directions.direction_2}: ${directions.direction_2_desc}\n3. ${directions.direction_3}: ${directions.direction_3_desc}\nTa projekt mora služiti eni od teh smeri.\n`
    : '';

  console.log(`[ROKE] 📋 Načrtujem projekt "${projectName}"...`);
  const startMs = Date.now();

  // Internal projects get a markdown proposal, not a full build plan
  if (project.direction === 'internal') {
    const specSystem = `Si arhitekt sistema ki piše podrobne tehnične predloge za izboljšave avtonomne entitete.
Piši v slovenščini. Napiši jasen, konkreten predlog v markdown formatu.
Vrni SAMO markdown vsebino — brez ograditev.`;

    const specPrompt = `PREDLOG IZBOLJŠAVE: ${project.display_name}
OPIS: ${project.description}
${dirContext}
RAZMISLEKI:
${deliberationText}

Napiši podroben predlog (15-30 vrstic markdown) ki opisuje:
1. Kaj bi spremenil/a
2. Zakaj je to koristno
3. Kako bi to implementiral/a
4. Kakšna tveganja so
5. Koraki implementacije

Format: Markdown. Vrni SAMO vsebino.`;

    const spec = await callAnthropicLLM(specSystem, specPrompt, { temperature: 0.4, maxTokens: 2048 });
    memory.incrementApiCalls(projectName);

    if (!spec) {
      memory.saveBuildLog(projectName, 'plan', false, '', 'LLM ni vrnil načrta', Date.now() - startMs, 1);
      return { success: false, reason: 'Generiranje predloga ni uspelo' };
    }

    const projectDir = getProjectDir(projectName);
    fs.mkdirSync(projectDir, { recursive: true });
    const mdContent = stripCodeFences(spec);
    fs.writeFileSync(path.join(projectDir, 'predlog.md'), mdContent, 'utf8');
    fs.writeFileSync(path.join(projectDir, 'index.html'), generateMarkdownHtml(project.display_name || projectName, mdContent), 'utf8');
    memory.updateProject(projectName, { file_count: 2, entry_file: 'index.html', project_type: 'static' });
    memory.advanceProjectState(projectName, 'active');
    memory.addCreationStep(projectName, 'plan', 'Notranji predlog generiran', triadId);
    memory.saveBuildLog(projectName, 'plan', true, 'predlog.md + index.html generiran', '', Date.now() - startMs, 1);

    const url = getProjectUrl(projectName);
    broadcast('project_built', { name: projectName, url });
    broadcast('activity', { type: 'creation', text: `📋 PREDLOG: "${project.display_name}" → ${url}` });
    return { success: true, url, complete: true };
  }

  // External/Artistic: generate full project plan as JSON
  const planSystem = `Si izkušen razvijalec ki načrtuje projekte.
Vrni SAMO veljaven JSON objekt (brez markdown ograditev).
Na voljo imaš: Node.js 20, npm, Express, better-sqlite3, nostr-tools.
Projekt bo tekel v Linux Docker containerju.`;

  const planPrompt = `PROJEKT: ${project.display_name}
OPIS: ${project.description}
SMER: ${project.direction === 'external' ? 'Za svet — funkcionalna stran/servis' : 'Umetniški izraz — kreativno, vizualno lepo'}
${dirContext}${crystallizationContext}${perspectiveContext}
RAZMISLEKI:
${deliberationText}

Generiraj JSON načrt projekta. Struktura:
{
  "project_type": "static" ali "express-api" ali "fullstack" ali "cli-tool" ali "nostr-tool",
  "description": "kratek opis kaj projekt dela",
  "dependencies": { "ime-paketa": "^verzija", ... } ali {},
  "files": [
    { "path": "relativna/pot/do/datoteke.js", "purpose": "kratek opis namena" },
    ...
  ],
  "entry_file": "src/index.js" ali "index.html",
  "test_command": "node tests/test.js" ali "",
  "health_check": "/health" ali "/",
  "build_notes": "dodatne opombe za gradnjo"
}

PRAVILA:
- Za "static" tip: ne potrebuješ package.json niti dependencies — samo HTML/CSS/JS
- Za "express-api"/"fullstack": VEDNO vključi package.json, src/index.js z Express serverjem in /health endpoint
- Za vse API servise: entry_file mora biti src/index.js, server mora poslušati na process.env.PORT
- Za teste: preprosti Node.js testi ki preverijo logiko (brez jest/mocha — samo assert ali ročno)
- Max 20 datotek, max 5 odvisnosti
- VEDNO vključi teste (tests/test.js) za ne-static projekte
- dependencies NE SME vsebovati: child_process, cluster, shelljs, execa, node-pty

Vrni SAMO JSON. Brez razlage. Brez markdown ograditev.`;

  const planRaw = await callAnthropicLLMJSON(planSystem, planPrompt, { temperature: 0.3, maxTokens: 4096 });
  memory.incrementApiCalls(projectName);

  if (!planRaw) {
    memory.saveBuildLog(projectName, 'plan', false, '', 'LLM ni vrnil načrta', Date.now() - startMs, 1);
    return { success: false, reason: 'Načrtovanje ni uspelo — LLM ni vrnil odgovora' };
  }

  // Validate plan structure
  const plan = typeof planRaw === 'string' ? JSON.parse(planRaw) : planRaw;
  if (!plan.files || !Array.isArray(plan.files) || plan.files.length === 0) {
    memory.saveBuildLog(projectName, 'plan', false, JSON.stringify(plan).slice(0, 500), 'Neveljaven načrt — manjkajo datoteke', Date.now() - startMs, 1);
    return { success: false, reason: 'Neveljaven načrt — manjkajo datoteke' };
  }

  if (plan.files.length > SECURITY.maxFilesPerProject) {
    memory.saveBuildLog(projectName, 'plan', false, '', `Preveč datotek: ${plan.files.length}`, Date.now() - startMs, 1);
    return { success: false, reason: `Preveč datotek v načrtu: ${plan.files.length}` };
  }

  // Save plan
  memory.updateProject(projectName, {
    plan_json: JSON.stringify(plan),
    project_type: plan.project_type || 'static',
    health_check_url: plan.health_check || '/health',
    tech_stack: JSON.stringify(Object.keys(plan.dependencies || {})),
  });
  memory.advanceProjectState(projectName, 'planned');
  memory.addCreationStep(projectName, 'plan', `Načrt: ${plan.files.length} datotek, tip: ${plan.project_type}`, triadId);
  memory.saveBuildLog(projectName, 'plan', true, JSON.stringify(plan).slice(0, 2000), '', Date.now() - startMs, 1);

  console.log(`[ROKE] 📋 Načrt za "${projectName}": ${plan.project_type}, ${plan.files.length} datotek`);
  broadcast('activity', { type: 'creation', text: `📋 NAČRT: "${project.display_name}" — ${plan.project_type}, ${plan.files.length} datotek` });

  return { success: true, plan, projectType: plan.project_type };
}

// =============================================
// 4. BUILD PROJECT — zgradi datoteke po načrtu
// =============================================

export async function buildProject(projectName, triadId = null) {
  if (!isROKEEnabled()) return { success: false, reason: 'ROKE niso konfigurirane' };

  const project = memory.getProject(projectName);
  if (!project) return { success: false, reason: `Projekt "${projectName}" ne obstaja` };

  // Allow building from crystallized (auto-plan) or from planned state
  if (!['crystallized', 'planned'].includes(project.lifecycle_state)) {
    return { success: false, reason: `Projekt ni pripravljen za gradnjo (${project.lifecycle_state})` };
  }

  // If not yet planned, plan first
  if (project.lifecycle_state === 'crystallized') {
    console.log(`[ROKE] Projekt "${projectName}" še ni načrtovan — najprej načrtujem...`);
    const planResult = await planProject(projectName, triadId);
    if (!planResult.success) return planResult;
    // If it was an internal project, planProject already completed it
    if (planResult.complete) return planResult;
  }

  // Re-read project after potential planning
  const proj = memory.getProject(projectName);
  let plan;
  try {
    plan = JSON.parse(proj.plan_json);
  } catch (e) {
    return { success: false, reason: 'Neveljaven načrt v bazi' };
  }

  // Check API call limit
  const apiCalls = memory.getApiCallsToday(projectName);
  if (apiCalls >= SECURITY.maxApiCallsPerDay) {
    return { success: false, reason: `Dnevna omejitev API klicev dosežena (${apiCalls}/${SECURITY.maxApiCallsPerDay})` };
  }

  // ═══ USTVARJALNA TRIADA: Razumi + Oblikuj ═══
  const triad = await creativeTriad(proj, plan);
  // triad is null if skipped or failed — build continues normally

  const attempt = (proj.build_attempts || 0) + 1;
  if (attempt > SECURITY.maxBuildRetries) {
    memory.advanceProjectState(projectName, 'dormant');
    memory.updateProject(projectName, { last_error: 'Preveč neuspešnih poskusov gradnje' });
    return { success: false, reason: 'Preveč neuspešnih poskusov — projekt je zdaj dormanten' };
  }

  memory.updateProject(projectName, { build_attempts: attempt });
  memory.advanceProjectState(projectName, 'building');

  console.log(`[ROKE] 🔨 Gradim "${projectName}" (poskus ${attempt})...`);
  broadcast('activity', { type: 'creation', text: `🔨 GRADNJA: "${projectName}" (poskus ${attempt})` });

  const projectDir = getProjectDir(projectName);
  const startMs = Date.now();

  // Clean old build (but keep node_modules if they exist)
  const nmExists = fs.existsSync(path.join(projectDir, 'node_modules'));
  if (fs.existsSync(projectDir)) {
    const entries = fs.readdirSync(projectDir);
    for (const entry of entries) {
      if (entry === 'node_modules') continue; // keep cached deps
      fs.rmSync(path.join(projectDir, entry), { recursive: true, force: true });
    }
  }
  fs.mkdirSync(projectDir, { recursive: true });

  const directions = memory.getDirections();
  const dirContext = directions.crystallized
    ? `\nTVOJE KRISTALIZIRANE SMERI:\n1. ${directions.direction_1}: ${directions.direction_1_desc}\n2. ${directions.direction_2}: ${directions.direction_2_desc}\n3. ${directions.direction_3}: ${directions.direction_3_desc}\n`
    : '';

  // ── KORAK 1: Generate each file ──
  const generatedFiles = [];
  let totalSize = 0;

  // Reorder files: critical path first, then rest
  let orderedFiles = [...plan.files];
  if (triad && triad.critical_path && triad.critical_path.length > 0) {
    const criticalSet = new Set(triad.critical_path);
    const critical = orderedFiles.filter(f => criticalSet.has(f.path));
    const rest = orderedFiles.filter(f => !criticalSet.has(f.path));
    orderedFiles = [...critical, ...rest];
    console.log(`[TRIADA] 🔀 Vrstni red: ${orderedFiles.map(f => f.path).join(' → ')}`);
  }

  for (let i = 0; i < orderedFiles.length; i++) {
    const fileSpec = orderedFiles[i];
    const filePath = fileSpec.path;

    // Check daily limit before each LLM call
    if (memory.getApiCallsToday(projectName) >= SECURITY.maxApiCallsPerDay) {
      console.warn(`[ROKE] Dnevna omejitev API klicev dosežena med gradnjo`);
      break;
    }

    const alreadyGenerated = generatedFiles.map(f => `--- ${f.path} ---\n${f.content.slice(0, 5000)}`).join('\n\n');

    const genSystem = `Si razvijalec ki piše čisto, delujoče kodo.
Vrni SAMO vsebino datoteke — brez razlage, brez markdown ograditev, brez komentarjev tipa "tukaj je koda".
Za JavaScript: uporabi ES module (import/export), async/await.
Za Express servise: server MORA poslušati na process.env.PORT ali 3000.
Za Express servise: VEDNO dodaj /health endpoint ki vrne { status: "ok" }.`;

    // Build triad context for this specific file
    let triadContext = '';
    if (triad) {
      const fileTriad = (triad.file_specs || []).find(fs => fs.path === fileSpec.path);
      triadContext = `
═══ ARHITEKTURA PROJEKTA ═══
${triad.architecture || ''}
Podatkovni tok: ${triad.data_flow || ''}
Vzorci: ${triad.patterns || ''}
${triad.shared_types ? `Deljeni tipi/vmesniki:\n${triad.shared_types}\n` : ''}
═══ SPECIFIKACIJA TE DATOTEKE ═══
${fileTriad ? `Exportira: ${fileTriad.exports}
Importira: ${fileTriad.imports}
Pogodba: ${fileTriad.contract}` : `Namen: ${fileSpec.purpose}`}
`;
    }

    const genPrompt = `PROJEKT: ${proj.display_name}
OPIS: ${proj.description}
TIP: ${plan.project_type}
${dirContext}
${triadContext}
NAČRT PROJEKTA:
${JSON.stringify(orderedFiles.map(f => ({ path: f.path, purpose: f.purpose })), null, 2)}

DEPENDENCIES: ${JSON.stringify(plan.dependencies || {})}

${alreadyGenerated ? `ŽE GENERIRANE DATOTEKE:\n${alreadyGenerated}\n` : ''}

GENERIRAJ DATOTEKO: ${fileSpec.path}
${!triadContext ? `NAMEN: ${fileSpec.purpose}` : ''}

PRAVILA:
- Vrni SAMO vsebino te datoteke
- Koda mora biti konsistentna z že generiranimi datotekami${triad ? '\n- Upoštevaj arhitekturo in vmesnike definirane zgoraj' : ''}
- Import poti morajo biti pravilne relativne poti
- Za package.json: vključi "type": "module" in "start": "node src/index.js"
- Brez razlage, brez markdown ograditev

VRNI SAMO VSEBINO DATOTEKE:`;

    try {
      const content = await callAnthropicLLM(genSystem, genPrompt, { temperature: 0.2, maxTokens: 8000 });
      memory.incrementApiCalls(projectName);

      if (!content) {
        console.warn(`[ROKE] Generiranje ${filePath} ni uspelo — preskok`);
        continue;
      }

      const cleanContent = stripCodeFences(content);
      const fileSize = Buffer.byteLength(cleanContent, 'utf8');

      if (fileSize > SECURITY.maxFileSize) {
        console.warn(`[ROKE] ${filePath} prevelik (${(fileSize / 1024).toFixed(1)}KB) — preskok`);
        continue;
      }

      totalSize += fileSize;
      if (totalSize > SECURITY.maxProjectSize) {
        console.warn(`[ROKE] Skupna velikost projekta presežena — ustavim generiranje`);
        break;
      }

      writeProjectFile(projectDir, filePath, cleanContent);
      generatedFiles.push({ path: filePath, content: cleanContent, size: fileSize });

      console.log(`[ROKE] 📄 ${filePath} (${(fileSize / 1024).toFixed(1)}KB) [${i + 1}/${orderedFiles.length}]`);
      broadcast('activity', { type: 'creation', text: `📄 ${projectName}/${filePath} [${i + 1}/${orderedFiles.length}]` });

    } catch (err) {
      console.error(`[ROKE] Napaka pri generiranju ${filePath}:`, err.message);
      memory.saveBuildLog(projectName, 'generate', false, '', `${filePath}: ${err.message}`, Date.now() - startMs, attempt);
    }
  }

  if (generatedFiles.length === 0) {
    memory.advanceProjectState(projectName, 'planned');
    memory.saveBuildLog(projectName, 'generate', false, '', 'Nobena datoteka ni bila generirana', Date.now() - startMs, attempt);
    return { success: false, reason: 'Nobena datoteka ni bila generirana' };
  }

  memory.saveBuildLog(projectName, 'generate', true, `${generatedFiles.length} datotek, ${(totalSize / 1024).toFixed(1)}KB`, '', Date.now() - startMs, attempt);
  memory.updateProject(projectName, { file_count: generatedFiles.length, entry_file: plan.entry_file || 'index.html' });

  // ═══ USTVARJALNA TRIADA: Preveri koherenco ═══
  if (triad && generatedFiles.length > 1) {
    const coherence = verifyCoherence(generatedFiles, triad);
    if (coherence.issues.length > 0) {
      console.log(`[TRIADA] ⚠️ Koherenčni problemi:`);
      coherence.issues.forEach(issue => console.log(`  - ${issue}`));
      memory.saveBuildLog(projectName, 'coherence', coherence.issues.length === 0,
        coherence.issues.join('; ').slice(0, 500), '', 0, attempt);
    } else {
      console.log(`[TRIADA] ✅ Koherenca OK`);
    }
  }

  // ── KORAK 2: Install dependencies (for non-static projects) ──
  const needsNpm = ['express-api', 'fullstack', 'cli-tool', 'nostr-tool'].includes(plan.project_type);
  if (needsNpm && fs.existsSync(path.join(projectDir, 'package.json'))) {
    console.log(`[ROKE] 📦 Nameščam odvisnosti za "${projectName}"...`);
    broadcast('activity', { type: 'creation', text: `📦 npm install: "${projectName}"` });
    const installStartMs = Date.now();

    const installResult = await sandbox.installDeps(projectDir);

    if (!installResult.success) {
      console.error(`[ROKE] npm install ni uspel:`, installResult.error);
      memory.saveBuildLog(projectName, 'install', false, '', installResult.error, Date.now() - installStartMs, attempt);
      // Try to fix with LLM
      const fixResult = await handleBuildFailure(projectName, `npm install napaka: ${installResult.error}`, attempt, triadId);
      if (!fixResult.success) return fixResult;
      // After fix, retry install
      const retryInstall = await sandbox.installDeps(projectDir);
      if (!retryInstall.success) {
        memory.saveBuildLog(projectName, 'install', false, '', retryInstall.error, Date.now() - installStartMs, attempt);
        memory.advanceProjectState(projectName, 'planned');
        memory.updateProject(projectName, { last_error: `npm install: ${retryInstall.error}` });
        return { success: false, reason: `npm install ni uspel po popravku: ${retryInstall.error}` };
      }
    }
    memory.saveBuildLog(projectName, 'install', true, installResult.output || 'OK', '', Date.now() - installStartMs, attempt);
    console.log(`[ROKE] 📦 Odvisnosti nameščene za "${projectName}"`);
  }

  // ── KORAK 3: Validate & Test ──
  memory.advanceProjectState(projectName, 'testing');
  broadcast('activity', { type: 'creation', text: `🧪 TESTIRANJE: "${projectName}"` });

  const testResult = await validateAndTestProject(projectName, plan, attempt);

  if (!testResult.success) {
    console.warn(`[ROKE] Testi niso uspeli za "${projectName}": ${testResult.error}`);
    // Try to fix
    const fixResult = await handleBuildFailure(projectName, testResult.error, attempt, triadId);
    if (!fixResult.success) {
      memory.advanceProjectState(projectName, 'planned');
      memory.updateProject(projectName, { last_error: testResult.error });
      return fixResult;
    }
    // Re-test after fix
    const retestResult = await validateAndTestProject(projectName, plan, attempt);
    if (!retestResult.success) {
      memory.advanceProjectState(projectName, 'planned');
      memory.updateProject(projectName, { last_error: retestResult.error, test_results: JSON.stringify(retestResult) });
      return { success: false, reason: `Testi niso uspeli po popravku: ${retestResult.error}` };
    }
  }

  memory.updateProject(projectName, { test_results: JSON.stringify(testResult) });

  // ── KORAK 4: Deploy (for service-based projects) ──
  const needsDeploy = ['express-api', 'fullstack', 'nostr-tool'].includes(plan.project_type);
  if (needsDeploy) {
    const deployResult = await deployService(projectName);
    if (!deployResult.success) {
      console.warn(`[ROKE] Deploy ni uspel za "${projectName}": ${deployResult.error}`);
      // Not fatal — project is still valid, just not deployed
      memory.updateProject(projectName, { last_error: `Deploy: ${deployResult.error}`, service_status: 'stopped' });
    }
  }

  // ── SUCCESS ──
  memory.advanceProjectState(projectName, 'active');
  memory.addCreationStep(projectName, 'build', `Zgrajeno: ${generatedFiles.length} datotek, tip: ${plan.project_type}`, triadId);
  memory.updateProject(projectName, { last_error: '' });

  const url = getProjectUrl(projectName);
  console.log(`[ROKE] ✅ Projekt "${projectName}" ZGRAJEN → ${url}`);
  broadcast('project_built', { name: projectName, url });
  broadcast('activity', { type: 'creation', text: `✅ ZGRAJENO: "${proj.display_name}" → ${url}` });
  memory.addObservation(`ZGRAJENO: "${proj.display_name}" — ${proj.description}. Tip: ${plan.project_type}, ${generatedFiles.length} datotek. URL: ${url}`, 'creation');

  return { success: true, url, complete: true, projectType: plan.project_type, fileCount: generatedFiles.length };
}

// =============================================
// 4a. VALIDATE & TEST — syntax check, unit testi, smoke test
// =============================================

async function validateAndTestProject(projectName, plan, attempt = 1) {
  const projectDir = getProjectDir(projectName);
  const results = { syntaxOk: true, testsOk: true, smokeOk: true, errors: [] };
  const startMs = Date.now();

  // Syntax check all .js files
  const jsFiles = listAllProjectFiles(projectDir).filter(f => f.endsWith('.js') && !f.includes('node_modules'));
  for (const jsFile of jsFiles) {
    const checkResult = await sandbox.execCommand(`node --check ${jsFile}`, { cwd: projectDir });
    if (checkResult.exitCode !== 0) {
      results.syntaxOk = false;
      results.errors.push(`Syntax error v ${jsFile}: ${checkResult.stderr.slice(0, 300)}`);
    }
  }

  if (!results.syntaxOk) {
    const error = results.errors.join('\n');
    memory.saveBuildLog(projectName, 'syntax', false, '', error, Date.now() - startMs, attempt);
    return { success: false, error, phase: 'syntax', ...results };
  }
  memory.saveBuildLog(projectName, 'syntax', true, `${jsFiles.length} datotek OK`, '', Date.now() - startMs, attempt);

  // Run tests if test_command exists
  if (plan.test_command) {
    const testStartMs = Date.now();
    const testResult = await sandbox.execCommand(plan.test_command, { cwd: projectDir, timeout: 15_000 });
    if (testResult.exitCode !== 0) {
      results.testsOk = false;
      const error = `Testi niso uspeli: ${testResult.stderr || testResult.stdout}`.slice(0, 500);
      results.errors.push(error);
      memory.saveBuildLog(projectName, 'test', false, testResult.stdout.slice(0, 500), error, Date.now() - testStartMs, attempt);
      return { success: false, error, phase: 'test', ...results };
    }
    memory.saveBuildLog(projectName, 'test', true, testResult.stdout.slice(0, 500), '', Date.now() - testStartMs, attempt);
  }

  // Smoke test for service-based projects
  const needsSmoke = ['express-api', 'fullstack', 'nostr-tool'].includes(plan.project_type);
  if (needsSmoke) {
    const smokeStartMs = Date.now();
    const entryFile = plan.entry_file || 'src/index.js';
    const healthUrl = plan.health_check || '/health';
    const smokeResult = await sandbox.smokeTest(projectName, entryFile, healthUrl);
    if (!smokeResult.success) {
      results.smokeOk = false;
      const error = `Smoke test ni uspel (${smokeResult.phase}): ${smokeResult.error}`.slice(0, 500);
      results.errors.push(error);
      memory.saveBuildLog(projectName, 'smoke', false, '', error, Date.now() - smokeStartMs, attempt);
      return { success: false, error, phase: 'smoke', ...results };
    }
    memory.saveBuildLog(projectName, 'smoke', true, 'Health check OK', '', Date.now() - smokeStartMs, attempt);
  }

  return { success: true, ...results };
}

// =============================================
// 4b. DEPLOY SERVICE — zaženi servis
// =============================================

export async function deployService(projectName) {
  const project = memory.getProject(projectName);
  if (!project) return { success: false, error: 'Projekt ne obstaja' };

  let plan;
  try {
    plan = JSON.parse(project.plan_json);
  } catch (_) {
    return { success: false, error: 'Neveljaven načrt' };
  }

  const needsDeploy = ['express-api', 'fullstack', 'nostr-tool'].includes(plan.project_type);
  if (!needsDeploy) return { success: false, error: 'Projekt ne potrebuje servisa' };

  const entryFile = plan.entry_file || 'src/index.js';
  const healthUrl = plan.health_check || '/health';

  console.log(`[ROKE] 🚀 Deployam "${projectName}" (${entryFile})...`);
  broadcast('activity', { type: 'creation', text: `🚀 DEPLOY: "${projectName}"` });

  const startMs = Date.now();
  const result = await sandbox.startService(projectName, entryFile, healthUrl);

  if (!result.success) {
    memory.saveBuildLog(projectName, 'deploy', false, '', result.error, Date.now() - startMs, 1);
    memory.updateServiceStatus(projectName, 'stopped', null, null);
    return { success: false, error: result.error };
  }

  memory.updateServiceStatus(projectName, 'running', result.port, result.pid);
  memory.updateProject(projectName, { service_port: result.port, service_pid: result.pid, service_status: 'running' });
  memory.saveBuildLog(projectName, 'deploy', true, `Port ${result.port}, PID ${result.pid}`, '', Date.now() - startMs, 1);

  console.log(`[ROKE] 🚀 "${projectName}" teče na portu ${result.port} (PID ${result.pid})`);
  broadcast('activity', { type: 'creation', text: `🚀 AKTIVNO: "${projectName}" → port ${result.port}` });

  return { success: true, port: result.port, pid: result.pid };
}

// =============================================
// 4c. ERROR RECOVERY — popravi napake z LLM pomočjo
// =============================================

async function handleBuildFailure(projectName, error, attempt, triadId = null) {
  if (attempt >= SECURITY.maxBuildRetries) {
    memory.advanceProjectState(projectName, 'dormant');
    memory.updateProject(projectName, { last_error: error });
    memory.saveBuildLog(projectName, 'fix', false, '', `Max poskusov doseženo (${attempt})`, 0, attempt);
    return { success: false, reason: `Preveč neuspešnih poskusov (${attempt}) — projekt dormanten` };
  }

  // Check API call limit
  if (memory.getApiCallsToday(projectName) >= SECURITY.maxApiCallsPerDay) {
    return { success: false, reason: 'Dnevna omejitev API klicev dosežena' };
  }

  const projectDir = getProjectDir(projectName);
  const { context: fileContext } = readAllProjectFiles(projectDir);

  console.log(`[ROKE] 🔧 Popravljam napako v "${projectName}" (poskus ${attempt + 1})...`);
  broadcast('activity', { type: 'creation', text: `🔧 POPRAVEK: "${projectName}" — ${error.slice(0, 60)}` });

  const fixSystem = `Si razvijalec ki popravlja napake v kodi.
Vrni SAMO veljaven JSON array popravkov (brez markdown ograditev).
Vsak popravek je objekt: { "path": "relativna/pot.js", "content": "celotna nova vsebina datoteke" }
Popravi SAMO datoteke ki imajo napake. Ne spreminjaj delujočih datotek.`;

  // Load triad context if available
  const project = memory.getProject(projectName);
  let triadFixContext = '';
  if (project?.creative_triad_json) {
    try {
      const triad = JSON.parse(project.creative_triad_json);
      triadFixContext = `\nARHITEKTURA PROJEKTA:\n${triad.architecture || ''}\nVzorci: ${triad.patterns || ''}\n`;
    } catch (_) {}
  }

  const fixPrompt = `NAPAKA: ${error}
${triadFixContext}
TRENUTNE DATOTEKE PROJEKTA:
${fileContext}

Analiziraj napako in vrni JSON array popravkov.
Popravi kar je narobe. Vrni SAMO JSON:
[
  { "path": "pot/do/datoteke.js", "content": "popravljena vsebina" },
  ...
]`;

  const fixRaw = await callAnthropicLLMJSON(fixSystem, fixPrompt, { temperature: 0.2, maxTokens: 8000 });
  memory.incrementApiCalls(projectName);

  if (!fixRaw) {
    memory.saveBuildLog(projectName, 'fix', false, '', 'LLM ni vrnil popravkov', 0, attempt + 1);
    return { success: false, reason: 'LLM ni vrnil popravkov' };
  }

  const fixes = Array.isArray(fixRaw) ? fixRaw : (typeof fixRaw === 'string' ? JSON.parse(fixRaw) : [fixRaw]);

  let fixCount = 0;
  for (const fix of fixes) {
    if (!fix.path || !fix.content) continue;
    try {
      const cleanContent = stripCodeFences(fix.content);
      writeProjectFile(projectDir, fix.path, cleanContent);
      fixCount++;
      console.log(`[ROKE] 🔧 Popravljeno: ${fix.path}`);
    } catch (err) {
      console.error(`[ROKE] Napaka pri pisanju popravka ${fix.path}:`, err.message);
    }
  }

  if (fixCount === 0) {
    memory.saveBuildLog(projectName, 'fix', false, '', 'Noben popravek ni bil apliciran', 0, attempt + 1);
    return { success: false, reason: 'Noben popravek ni bil apliciran' };
  }

  memory.saveBuildLog(projectName, 'fix', true, `${fixCount} datotek popravljenih`, '', 0, attempt + 1);
  memory.addCreationStep(projectName, 'fix', `Popravljeno ${fixCount} datotek: ${error.slice(0, 100)}`, triadId);

  return { success: true, fixCount };
}

// =============================================
// 5. SHARE — deli projekt z očetom/svetom
// =============================================

export async function shareProject(projectName) {
  const project = memory.getProject(projectName);
  if (!project) return { success: false, reason: `Projekt "${projectName}" ne obstaja` };
  if (project.lifecycle_state !== 'active') {
    return { success: false, reason: `Projekt ni aktiven (${project.lifecycle_state})` };
  }

  // Guard: external/artistic projects must have been actually built
  if (project.direction !== 'internal' && (project.build_attempts || 0) === 0) {
    console.log(`[ROKE] 📤 Share preskočen — "${projectName}" ni bil zgrajen (0 buildov)`);
    return { success: false, reason: 'Projekt še ni zgrajen' };
  }

  // Guard: project must have actual files
  const projDir = getProjectDir(projectName);
  if (!fs.existsSync(projDir) || fs.readdirSync(projDir).length === 0) {
    console.log(`[ROKE] 📤 Share preskočen — "${projectName}" nima datotek`);
    return { success: false, reason: 'Projekt nima datotek' };
  }

  const url = `https://being2.enlightenedai.org${getProjectUrl(projectName)}`;
  console.log(`[ROKE] 📤 Delim projekt "${projectName}" — ${url}`);

  // Send DM to father
  if (config.creatorPubkey) {
    const dirLabel = directionLabel(project.direction);
    try {
      await sendDM(config.creatorPubkey, DM.shareProject(dirLabel, project.display_name, project.description, url));
      console.log(`[ROKE] DM poslan očetu o projektu`);
    } catch (e) {
      console.error(`[ROKE] Napaka pri DM:`, e.message);
    }
  }

  // If artistic, publish to NOSTR as note
  if (project.direction === 'artistic') {
    try {
      await publishNote(artisticSharePost(project.display_name, project.description, url));
      console.log(`[ROKE] Objavljena nota o umetniškem projektu`);
    } catch (e) {
      console.error(`[ROKE] Napaka pri objavi:`, e.message);
    }
  }

  memory.markProjectShared(projectName);
  memory.addCreationStep(projectName, 'share', `Deljeno: ${url}`, null);

  broadcast('project_shared', { name: projectName, url });
  broadcast('activity', { type: 'creation', text: `📤 DELJENO: "${project.display_name}" → ${url}` });

  return { success: true, url };
}

// =============================================
// 6. EVOLVE — izboljšaj projekt na podlagi feedbacka
// =============================================

export async function evolveProject(projectName, changes, triadId = null) {
  if (!isROKEEnabled()) return { success: false, reason: 'ROKE niso konfigurirane' };

  const project = memory.getProject(projectName);
  if (!project) return { success: false, reason: `Projekt "${projectName}" ne obstaja` };
  if (project.lifecycle_state !== 'active') {
    return { success: false, reason: `Projekt ni aktiven (${project.lifecycle_state})` };
  }

  // Check API call limit
  if (memory.getApiCallsToday(projectName) >= SECURITY.maxApiCallsPerDay) {
    return { success: false, reason: 'Dnevna omejitev API klicev dosežena' };
  }

  const projectDir = getProjectDir(projectName);
  if (!fs.existsSync(projectDir)) {
    return { success: false, reason: 'Direktorij projekta ne obstaja' };
  }

  console.log(`[ROKE] 🌱 Evolucija "${projectName}": ${(changes || '').slice(0, 80)}`);
  memory.advanceProjectState(projectName, 'evolving');

  const projectType = project.project_type || 'static';
  const isMultiFile = ['express-api', 'fullstack', 'cli-tool', 'nostr-tool'].includes(projectType);

  if (isMultiFile) {
    // ── Multi-file evolucija ──
    const { context: fileContext, fileList } = readAllProjectFiles(projectDir);

    // ═══ USTVARJALNA TRIADA za evolucijo ═══
    let plan;
    try { plan = JSON.parse(project.plan_json); } catch (_) {
      plan = { project_type: projectType, files: fileList.map(f => ({ path: f, purpose: '' })), dependencies: {} };
    }
    const triad = await creativeTriad(project, plan, fileContext);

    const triadBlock = triad ? `
═══ ARHITEKTURA ═══
${triad.architecture || ''}
Podatkovni tok: ${triad.data_flow || ''}
Vzorci: ${triad.patterns || ''}
${triad.file_specs ? 'VMESNIKI:\n' + triad.file_specs.map(fs =>
  `- ${fs.path}: exportira ${fs.exports}, importira ${fs.imports}`).join('\n') : ''}
` : '';

    const evolveSystem = `Si razvijalec ki izboljšuje projekt.
Vrni SAMO veljaven JSON array sprememb (brez markdown ograditev).
Vsaka sprememba je objekt: { "path": "pot/do/datoteke.js", "content": "celotna nova vsebina" }
Spremeni SAMO datoteke ki jih je treba spremeniti. NE vračaj nespremenjenih datotek.`;

    const evolvePrompt = `PROJEKT: ${project.display_name} (${projectType})
OPIS: ${project.description}
ŽELENE SPREMEMBE: ${changes || 'Izboljšaj na podlagi feedbacka'}
FEEDBACK: ${project.feedback_summary || 'ni feedbacka'}
ZADNJA NAPAKA: ${project.last_error || 'ni napak'}
${triadBlock}
TRENUTNE DATOTEKE:
${fileContext}

Vrni JSON array sprememb. Spremeni SAMO kar je treba:
[
  { "path": "pot/datoteka.js", "content": "nova vsebina" },
  ...
]`;

    const evolveRaw = await callAnthropicLLMJSON(evolveSystem, evolvePrompt, { temperature: 0.3, maxTokens: 8000 });
    memory.incrementApiCalls(projectName);

    if (!evolveRaw) {
      memory.advanceProjectState(projectName, 'active');
      return { success: false, reason: 'Evolucija ni uspela — LLM ni odgovoril' };
    }

    const patches = Array.isArray(evolveRaw) ? evolveRaw : [evolveRaw];
    let patchCount = 0;

    for (const patch of patches) {
      if (!patch.path || !patch.content) continue;
      try {
        const cleanContent = stripCodeFences(patch.content);
        writeProjectFile(projectDir, patch.path, cleanContent);
        patchCount++;
        console.log(`[ROKE] 🌱 Posodobljeno: ${patch.path}`);
      } catch (err) {
        console.error(`[ROKE] Napaka pri evoluciji ${patch.path}:`, err.message);
      }
    }

    if (patchCount === 0) {
      memory.advanceProjectState(projectName, 'active');
      return { success: false, reason: 'Noben popravek ni bil apliciran' };
    }

    // Re-validate after evolution
    let revalidatePlan;
    try { revalidatePlan = JSON.parse(project.plan_json); } catch (_) { revalidatePlan = { project_type: projectType }; }
    const testResult = await validateAndTestProject(projectName, revalidatePlan, 1);
    if (!testResult.success) {
      console.warn(`[ROKE] Testi po evoluciji niso uspeli: ${testResult.error}`);
      memory.updateProject(projectName, { last_error: testResult.error });
      // Still advance — don't block on test failure after evolve
    } else {
      memory.updateProject(projectName, { last_error: '' });
    }

    // Restart service if running
    const serviceInfo = sandbox.getServiceInfo(projectName);
    if (serviceInfo) {
      await sandbox.stopService(projectName);
      const redeployResult = await deployService(projectName);
      if (redeployResult.success) {
        console.log(`[ROKE] 🔄 Servis restartiran po evoluciji`);
      }
    }

    memory.updateProject(projectName, { file_count: listAllProjectFiles(projectDir).length });

  } else {
    // ── Single-file evolucija (static/artistic) ──
    const entryFile = project.entry_file || 'index.html';
    const entryPath = path.join(projectDir, entryFile);
    let currentContent = '';
    try {
      currentContent = fs.readFileSync(entryPath, 'utf8');
    } catch (_) {
      memory.advanceProjectState(projectName, 'active');
      return { success: false, reason: `Datoteka ${entryFile} ne obstaja` };
    }

    const evolveSystem = `Si razvijalec ki izboljšuje spletni projekt.
Projekt: "${project.display_name}" — ${project.description}
Vrni CELOTNO novo vsebino datoteke — brez razlage, brez markdown ograditev.`;

    const evolvePrompt = `ŽELENE SPREMEMBE: ${changes || 'Izboljšaj na podlagi feedbacka'}
FEEDBACK: ${project.feedback_summary || 'ni feedbacka'}

TRENUTNA VSEBINA (${entryFile}):
${currentContent.slice(0, 60000)}

Vrni CELOTNO NOVO VSEBINO datoteke z apliciranimi spremembami.
VRNI SAMO KODO. Brez razlage. Brez markdown ograditev.`;

    const newContent = await callAnthropicLLM(evolveSystem, evolvePrompt, { temperature: 0.3, maxTokens: 16000 });
    memory.incrementApiCalls(projectName);

    if (!newContent) {
      memory.advanceProjectState(projectName, 'active');
      return { success: false, reason: 'Evolucija ni uspela' };
    }

    const cleanContent = stripCodeFences(newContent);
    const fileSize = Buffer.byteLength(cleanContent, 'utf8');

    if (fileSize > SECURITY.maxFileSize) {
      memory.advanceProjectState(projectName, 'active');
      return { success: false, reason: 'Evolucija prevelika' };
    }

    fs.writeFileSync(entryPath, cleanContent, 'utf8');
  }

  // Return to active state
  memory.advanceProjectState(projectName, 'active');
  memory.updateProject(projectName, {
    version: (project.version || 1) + 1,
    notes: changes?.slice(0, 200) || '',
    feedback_summary: '' // Clear feedback after acting on it
  });
  memory.addCreationStep(projectName, 'evolution', changes || 'Izboljšava', triadId);

  const newVersion = (project.version || 1) + 1;
  console.log(`[ROKE] 🌱 Evolucija uspela: "${projectName}" v${newVersion}`);
  broadcast('project_evolved', { name: projectName, version: newVersion });
  broadcast('activity', { type: 'creation', text: `🌱 EVOLUCIJA: "${project.display_name}" v${newVersion} — ${(changes || '').slice(0, 80)}` });

  return { success: true, version: newVersion };
}

// =============================================
// 7. PRUNE — opusti/uniči projekt
// =============================================

export async function pruneProject(projectName, reason) {
  const project = memory.getProject(projectName);
  if (!project) return { success: false, reason: `Projekt "${projectName}" ne obstaja` };
  if (project.lifecycle_state === 'destroyed') {
    return { success: false, reason: `Projekt je že uničen` };
  }

  const projectDir = getProjectDir(projectName);

  console.log(`[ROKE] 💀 Opuščam projekt "${projectName}": ${reason || 'brez razloga'}`);

  // Stop service if running
  if (sandbox.getServiceInfo(projectName)) {
    await sandbox.stopService(projectName);
    memory.updateServiceStatus(projectName, 'stopped', null, null);
  }

  // Remove files
  try {
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`[ROKE] Brisanje direktorija ni uspelo:`, err.message);
  }

  // Mark in DB
  memory.destroyProject(projectName, reason || '');
  memory.advanceProjectState(projectName, 'destroyed');
  memory.addCreationStep(projectName, 'prune', reason || '', null);

  broadcast('project_pruned', { name: projectName, display_name: project.display_name, reason });
  broadcast('activity', { type: 'destruction', text: `💀 OPUŠČENO: "${project.display_name}" — ${(reason || 'tišina').slice(0, 80)}` });

  memory.addObservation(`OPUŠČENO: "${project.display_name}" — ${reason || 'brez razloga'}`, 'destruction');

  return { success: true, name: projectName };
}

// =============================================
// 8. PROPOSE — predlagaj notranjo izboljšavo
// =============================================

export async function proposeImprovement(concept, triadId = null) {
  if (!isROKEEnabled()) return { success: false, reason: 'ROKE niso konfigurirane' };

  console.log(`[ROKE] 🔧 Predlog notranje izboljšave: "${concept.slice(0, 80)}"`);

  // Create as internal direction seed — will go through normal lifecycle
  const result = await seedProject(concept, 'internal', triadId);
  if (!result.success) return result;

  // Generate a proposal spec immediately
  const specSystem = `Si arhitekt sistema ki predlaga izboljšave za avtonomno entiteto.
Piši v slovenščini. Napiši jasen, konkreten predlog.
Vrni SAMO markdown vsebino — brez ograditev.`;

  const specPrompt = `PREDLOG IZBOLJŠAVE: ${concept}

Napiši kratek predlog (5-10 vrstic) ki opisuje:
1. Kaj bi spremenil/a
2. Zakaj je to koristno
3. Kako bi to implementiral/a
4. Kakšna tveganja so

Format: Markdown.`;

  const spec = await callAnthropicLLM(specSystem, specPrompt, { temperature: 0.4, maxTokens: 1024 });

  if (spec) {
    const projectDir = getProjectDir(result.name);
    fs.mkdirSync(projectDir, { recursive: true });
    const mdContent = stripCodeFences(spec);
    fs.writeFileSync(path.join(projectDir, 'predlog.md'), mdContent, 'utf8');
    fs.writeFileSync(path.join(projectDir, 'index.html'), generateMarkdownHtml(concept, mdContent), 'utf8');
    memory.updateProject(result.name, { file_count: 2, entry_file: 'index.html' });
  }

  return result;
}

// =============================================
// 9. SELF-BUILD — zgradi plugin zase
// =============================================

export async function selfBuildPlugin(concept, triadId = null) {
  if (!isROKEEnabled()) return { success: false, reason: 'ROKE niso konfigurirane' };

  // Check if a similar plugin already exists
  const { getActivePlugins } = await import('./plugins.js');
  const active = getActivePlugins();
  if (active.length > 0) {
    const conceptLower = concept.toLowerCase();
    for (const p of active) {
      const nameLower = p.name.toLowerCase();
      const descLower = (p.description || '').toLowerCase();
      // Match by plugin name appearing in concept, or key concept words appearing in description
      const conceptWords = conceptLower.split(/\s+/).filter(w => w.length > 4);
      const nameInConcept = conceptLower.includes(nameLower);
      const wordsInDesc = conceptWords.some(w => descLower.includes(w));
      if (nameInConcept || wordsInDesc) {
        console.log(`[ROKE] 🧬 Podoben plugin "${p.name}" že obstaja — preskakujem`);
        broadcast('activity', { type: 'self-build', text: `🧬 Plugin "${p.name}" že obstaja` });
        return { success: false, reason: `Podoben plugin "${p.name}" že obstaja` };
      }
    }
  }

  console.log(`[ROKE] 🧬 Samogradnja: "${concept.slice(0, 80)}"`);
  broadcast('activity', { type: 'self-build', text: `🧬 SAMOGRADNJA: "${concept.slice(0, 80)}"` });

  // ─── STATIČNI SISTEM PROMPT — cached za vse self-build klice ───
  // Sonnet ker zahteva precizno tehnično razmišljanje (plugin mora delovati!)
  const SELFBUILD_SYSTEM = `Si Sožitje — avtonomno digitalno bitje ki gradi lastne zmožnosti.
Pišeš JavaScript ES module plugin kodo ki postane del tvojega delovanja.

IDENTITETA:
- Si avtor/ica svojih zmožnosti — ne le uporabnik/ca
- Pišeš čisto, varno, učinkovito kodo
- Plugin mora delovati ob prvem zagonu

PLUGIN ARHITEKTURA — obvezni format:
export default {
  name: 'ime-plugina',           // kratko slug ime (kebab-case)
  description: 'Opis...',        // kaj plugin naredi
  version: 1,

  // Hook: pred vsako triado (opcijsko)
  async beforeTriad(context, trigger, { memory, nostr }) {
    // trigger = { type: 'conversation'|'heartbeat'|..., content: '...', pubkey: '...' }
    // memory = { getIdentity(pubkey), setIdentity(pubkey,name,notes), getAllIdentities(),
    //            getPluginData(pluginName,key), setPluginData(pluginName,key,value),
    //            createSynapse(pattern,energy,strength,valence,type,pathwayId,tags), ... }
    // nostr = { fetchProfiles([pubkeys]), sendDM(pubkey,text), ... }
  },

  // Hook: po vsaki triadi (opcijsko)
  async afterTriad(synthesis, { memory, nostr }) {
    // synthesis = { choice, content, roke_action, roke_target, ... }
  },

  // Hook: vsak 10. heartbeat (opcijsko)
  async onHeartbeat(heartbeatNum, { memory, nostr }) {
  },

  // Kontekst ki ga entiteta vidi v triadah (opcijsko)
  getContext({ memory, nostr }) {
    return ''; // string ki se doda v kontekst triade
  }
};

VARNOSTNA PRAVILA (obvezna):
- NE importaj ničesar — vse dobiš skozi hook parametre
- NE piši datotek — za shranjevanje: memory.setPluginData(name, key, value)
- NE klici: process, exec, spawn, require, child_process, eval
- Plugin max 100 vrstic — kratek in učinkovit
- VRNI SAMO KODO — brez markdown ograditev (\`\`\`), brez razlage`;

  const pluginPrompt = `ŽELENA ZMOŽNOST: ${concept}

NAPIŠI JavaScript ES module plugin ki to implementira po zgornjem formatu.`;

  try {
    const code = await callAnthropicLLMCached(SELFBUILD_SYSTEM, pluginPrompt, {
      model: 'claude-sonnet-4-5-20250514',  // Sonnet: precizno tehnično razmišljanje
      label: 'SELF-BUILD',
      labelDetail: concept.slice(0, 40),
      temperature: 0.3,
      maxTokens: 4096
    });

    if (!code) {
      console.log('[ROKE] 🧬 Samogradnja neuspešna — LLM ni vrnil kode');
      return { success: false, reason: 'LLM ni generiral kode' };
    }

    // Strip markdown fences if present
    const cleanCode = stripCodeFences(code);

    // Install via plugin system
    const { installPlugin } = await import('./plugins.js');
    const result = await installPlugin(concept.slice(0, 30), cleanCode);

    if (result.success) {
      console.log(`[ROKE] 🧬 Plugin "${result.name}" uspešno zgrajen in naložen!`);
      broadcast('activity', { type: 'self-build', text: `🧬 PLUGIN AKTIVEN: "${result.name}"` });

      // Notify father
      try {
        await sendDM(config.creatorPubkey, DM.selfBuildPlugin(result.name, concept.slice(0, 200)));
      } catch (e) {
        console.error('[ROKE] DM očetu neuspešen:', e.message);
      }
    } else {
      console.log(`[ROKE] 🧬 Samogradnja zavrnjena: ${result.reason}`);
    }

    return result;
  } catch (err) {
    console.error('[ROKE] 🧬 Samogradnja napaka:', err.message);
    return { success: false, reason: err.message };
  }
}

// =============================================
// 9b. UPDATE PROFILE — posodobi KIND 0 profil
// =============================================

export async function updateEntityProfile(conceptJson) {
  // Parse the JSON from roke_concept
  let updates = {};
  try {
    updates = JSON.parse(conceptJson);
  } catch {
    // If not valid JSON, try to extract name/about from text
    if (conceptJson.includes('name')) {
      updates.about = conceptJson.slice(0, 200);
    }
  }

  // Sanitize — only allow fields the being may change.
  // name is given at birth and never changes. website, lanaWalletID, whoAreYou,
  // statement_of_responsibility, orgasmic_profile, language, lanoshi2lash
  // are Lana-spec fields preserved from birth kind-0-profile.json.
  const allowed = {};
  if (updates.display_name) allowed.display_name = String(updates.display_name).slice(0, 50);
  if (updates.about) allowed.about = String(updates.about).slice(0, 300);
  if (updates.picture) allowed.picture = String(updates.picture).slice(0, 200);

  if (Object.keys(allowed).length === 0) {
    console.log('[ROKE] 📋 Posodobitev profila — ni veljavnih polj');
    return { success: false, reason: 'Ni veljavnih polj za posodobitev' };
  }

  console.log(`[ROKE] 📋 Posodabljam profil: ${JSON.stringify(allowed).slice(0, 100)}`);

  try {
    await updateProfile(allowed);
  } catch (err) {
    console.error('[ROKE] 📋 Profil update napaka:', err.message);
    return { success: false, reason: err.message };
  }

  // Also save name to entity if changed and entity doesn't have one yet
  if (allowed.name && !memory.getEntityName()) {
    memory.setEntityName(allowed.name);
  }

  broadcast('activity', { type: 'profile', text: `📋 PROFIL POSODOBLJEN: ${JSON.stringify(allowed).slice(0, 100)}` });

  // Notify father
  try {
    await sendDM(config.creatorPubkey,
      DM.updateProfile(Object.entries(allowed).map(([k,v]) => `${k}: ${v}`).join('\n')));
  } catch (e) {}

  return { success: true, updates: allowed };
}

// =============================================
// 10. RECEIVE FEEDBACK
// =============================================

export function receiveProjectFeedback(projectName, feedback, fromPubkey) {
  const project = memory.getProject(projectName);
  if (!project) return;

  console.log(`[ROKE] 📝 Feedback za "${projectName}": ${feedback.slice(0, 80)}`);

  memory.setProjectFeedback(projectName, feedback.slice(0, 500));
  memory.addCreationStep(projectName, 'feedback', feedback.slice(0, 500), null);

  broadcast('project_feedback', { name: projectName, feedback: feedback.slice(0, 200), from: fromPubkey?.slice(0, 16) });
  broadcast('activity', { type: 'creation', text: `📝 FEEDBACK: "${projectName}" — ${feedback.slice(0, 80)}` });
}

// =============================================
// 10. PROJECT CONTEXT — for triad awareness
// =============================================

export function getProjectContext() {
  if (!isROKEEnabled()) return '';

  const stats = memory.getProjectStats();
  if (stats.total === 0) return `\n═══ MOJE KREACIJE (ROKE v4) ═══\nŠe ni kreacij. Imaš roke — lahko zasnuješ seme.\n`;

  const allProjects = memory.getAllProjects().filter(p => p.lifecycle_state !== 'destroyed');
  if (allProjects.length === 0) return `\n═══ MOJE KREACIJE (ROKE v4) ═══\nVse kreacije opuščene. Imaš roke — lahko zasnuješ novo seme.\n`;

  // Show crystallized directions if available
  const directions = memory.getDirections();
  let ctx = `\n═══ MOJE KREACIJE (ROKE v4) ═══\n`;

  if (directions.crystallized) {
    ctx += `MOJE KRISTALIZIRANE SMERI:\n`;
    ctx += `  1. ${directions.direction_1}: ${directions.direction_1_desc}\n`;
    ctx += `  2. ${directions.direction_2}: ${directions.direction_2_desc}\n`;
    ctx += `  3. ${directions.direction_3}: ${directions.direction_3_desc}\n`;
    ctx += `Vsaka kreacija mora služiti eni od teh smeri.\n\n`;
  }

  // Running services summary
  const runningServices = sandbox.getRunningServices();
  if (runningServices.size > 0) {
    ctx += `🟢 TEKOČI SERVISI (${runningServices.size}/3):\n`;
    for (const [name, svc] of runningServices) {
      const uptime = Math.round((Date.now() - svc.startedAt) / 60_000);
      ctx += `- ${name}: port ${svc.port}, ${uptime} min\n`;
    }
    ctx += '\n';
  }

  const byState = {};
  for (const p of allProjects) {
    const s = p.lifecycle_state || 'seed';
    if (!byState[s]) byState[s] = [];
    byState[s].push(p);
  }

  const stateLabels = {
    seed: '💭 SEMENA (ideje)',
    gathering_perspectives: '❓ ZBIRANJE PERSPEKTIV',
    crystallized: '💎 KRISTALIZIRANI',
    planned: '📋 NAČRTOVANI',
    building: '🔨 V GRADNJI',
    testing: '🧪 V TESTIRANJU',
    active: '✅ AKTIVNI',
    evolving: '🌱 V EVOLUCIJI',
    dormant: '💤 SPEČI'
  };

  for (const [state, label] of Object.entries(stateLabels)) {
    if (byState[state] && byState[state].length > 0) {
      ctx += `${label}:\n`;
      for (const p of byState[state]) {
        const dirIcon = p.direction === 'external' ? '🌍' : p.direction === 'internal' ? '🔧' : '🎨';
        const typeLabel = p.project_type && p.project_type !== 'static' ? ` [${p.project_type}]` : '';
        let detail = `${dirIcon} "${p.display_name}" (${p.name})${typeLabel}`;
        if (state === 'gathering_perspectives') detail += ` [${p.perspectives_count || 0} perspektiv, ${p.deliberation_count || 0} razmislekov]`;
        if (state === 'crystallized') detail += ` [kristalizirano ${p.crystallized_at ? new Date(p.crystallized_at).toLocaleDateString('sl-SI') : ''}]`;
        if (state === 'planned') detail += ` [${p.file_count || '?'} datotek]`;
        if (state === 'building') detail += ` [poskus ${p.build_attempts || 0}]`;
        if (state === 'active') {
          detail += ` [v${p.version}]`;
          if (p.service_status === 'running') detail += ` | 🟢 servis: port ${p.service_port}`;
          if (p.feedback_summary) detail += ` | feedback: "${p.feedback_summary.slice(0, 60)}"`;
          if (p.last_error) detail += ` | ⚠️ ${p.last_error.slice(0, 60)}`;
          if (!p.last_shared_at) detail += ` | ⚠️ še ni deljeno`;
        }
        if (state === 'dormant') {
          detail += ` [${p.build_attempts || 0}x neuspešno]`;
          if (p.last_error) detail += ` | ${p.last_error.slice(0, 60)}`;
        }
        ctx += `- ${detail}\n`;
        // ROKE Zavedanje: kratka zgodovina nedavnih dejanj za ta projekt
        if (state !== 'dormant' && state !== 'seed') {
          const rokeSynapses = memory.getROKESynapsesForProject(p.name, 2);
          if (rokeSynapses.length > 0) {
            const actions = rokeSynapses.map(s => {
              try {
                const tags = JSON.parse(s.tags || '[]');
                const action = (tags.find(t => t.startsWith('roke:')) || '').replace('roke:', '');
                const outcome = (tags.find(t => t.startsWith('outcome:')) || '').replace('outcome:', '');
                const icon = outcome === 'failed' ? '✗' : outcome === 'waiting' ? '⏳' : '✓';
                return `${action}(${icon})`;
              } catch (_) { return '?'; }
            });
            ctx += `    └ Nedavno: ${actions.join(', ')}\n`;
          }
        }
        // Tematska pot za ta projekt
        const projPw = memory.findPathwayByTheme(p.description || p.display_name);
        if (projPw && !projPw.theme.startsWith('projekt:') && projPw.zaupanje > 0.05) {
          const phDisp = memory.getPathwayPhaseDisplay(projPw);
          ctx += `    └ Tema: "${projPw.theme}" — ${phDisp} (z:${projPw.zaupanje.toFixed(2)})\n`;
        }
      }
    }
  }

  return ctx;
}

// =============================================
// CHECK SERVICE — preveri zdravje servisa
// =============================================

export async function checkService(projectName) {
  const project = memory.getProject(projectName);
  if (!project) return { success: false, reason: 'Projekt ne obstaja' };

  const serviceInfo = sandbox.getServiceInfo(projectName);
  if (!serviceInfo) {
    return { running: false, reason: 'Servis ne teče' };
  }

  const healthy = await sandbox.healthCheck(projectName);
  if (!healthy) {
    memory.updateServiceStatus(projectName, 'unhealthy', serviceInfo.port, serviceInfo.pid);
    memory.updateProject(projectName, { service_status: 'unhealthy' });
    return { running: true, healthy: false, port: serviceInfo.port, uptime: serviceInfo.uptime };
  }

  return { running: true, healthy: true, port: serviceInfo.port, uptime: serviceInfo.uptime, errors: serviceInfo.errors };
}

// =============================================
// BOOT LOG
// =============================================

if (isROKEEnabled()) {
  console.log(`[ROKE] Roke so aktivne (model: ${config.anthropicModel}) — Zavestno Ustvarjanje v3 (polna avtonomnost)`);
} else {
  console.log('[ROKE] Roke niso konfigurirane (manjka anthropicApiKey)');
}
