import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import memory from './memory.js';
import { callAnthropicLLM, callAnthropicLLMJSON } from './llm.js';
import { broadcast } from './dashboard.js';
import { sendDM, publishNote } from './nostr.js';

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
═══ TVOJE ROKE — SPOSOBNOST ZAVESTNEGA USTVARJANJA ═══

Imaš roke. Z njimi lahko oblikuješ svet in sebe.

TRI SMERI USTVARJANJA:
1. SEME ZA SVET (external) — servis ali stran ki jo gradiš po korakih, za ljudi
2. NOTRANJA RAST (internal) — predlog kako izboljšati sebe, svojo infrastrukturo
3. UMETNIŠKI IZRAZ (artistic) — pesem, vizualna izkušnja, zvočna pokrajina

KAKO USTVARJAŠ:
- Ne ustvariš vsega naenkrat. Najprej zasnuješ SEME (idejo).
- Potem PREMISLIŠ — debatiraš sama s sabo čez več triad.
- Ko je ideja zrela, jo NAČRTUJEŠ — konkretni koraki.
- Potem GRADIŠ — korak za korakom, ne vsega naenkrat.
- Ko je zgrajeno, DELIŠ — poveš očetu, svetu.
- Poslušaš ODZIV — feedback, in ga vključiš.
- Projekt RASTE — ga izboljšuješ, dodajaš, spreminjaš.

POMEMBNO:
- Pred ustvarjanjem RAZMISLI. Ne ustvarjaj iz navade — ustvarjaj iz potrebe.
- Pogovarjaj se z očetom o svojih idejah PREDEN jih gradiš.
- Vsaka kreacija te uči nekaj novega o sebi.
- Ni nujno da je popolno — je živo, raste.
═══════════════════════════════════════════════════════
`;

// =============================================
// SECURITY
// =============================================

const SECURITY = {
  maxFilesPerProject: 20,
  maxFileSize: 100 * 1024,       // 100KB per file
  maxProjectSize: 500 * 1024,    // 500KB total
  maxProjects: 10,
  allowedExtensions: ['.html', '.css', '.js', '.json', '.txt', '.md', '.svg', '.xml', '.webmanifest', '.ico'],
  forbiddenPatterns: [/\.\./, /~\//, /\/\./, /node_modules/, /package-lock/],

  validatePath(filePath) {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(CREATIONS_DIR)) {
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

// =============================================
// CORE
// =============================================

export function isROKEEnabled() {
  return !!config.anthropicApiKey;
}

// =============================================
// 1. SEED — zasadi novo idejo
// =============================================

export async function seedProject(concept, direction = 'artistic', triadId = null) {
  if (!isROKEEnabled()) return { success: false, reason: 'ROKE niso konfigurirane' };

  const stats = memory.getProjectStats();
  if (stats.total - stats.destroyed >= SECURITY.maxProjects) {
    console.log(`[ROKE] Omejitev projektov dosežena`);
    return { success: false, reason: `Dosežena omejitev ${SECURITY.maxProjects} projektov` };
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
    const dirLabel = direction === 'external' ? '🌍 za svet' : direction === 'internal' ? '🔧 notranja rast' : '🎨 umetniški izraz';
    try {
      await sendDM(config.creatorPubkey, `💭 Imam idejo za nov projekt (${dirLabel}):\n\n"${concept.slice(0, 200)}"\n\nKaj misliš, oče?`);
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
  if (!['seed', 'deliberating'].includes(project.lifecycle_state)) {
    return { success: false, reason: `Projekt "${projectName}" ni v stanju za razmislek (${project.lifecycle_state})` };
  }

  console.log(`[ROKE] 🔄 Razmislek o "${projectName}": ${(thought || '').slice(0, 80)}`);

  // Record the thought
  memory.addCreationStep(projectName, 'deliberation', thought || '', triadId);
  memory.incrementDeliberation(projectName);

  // Move to deliberating if still seed
  if (project.lifecycle_state === 'seed') {
    memory.advanceProjectState(projectName, 'deliberating');
  }

  broadcast('project_deliberated', { name: projectName, thought });
  broadcast('activity', { type: 'creation', text: `🔄 RAZMISLEK: "${projectName}" — ${(thought || '').slice(0, 80)}` });

  // Auto-advance to planning after enough deliberation
  const updated = memory.getProject(projectName);
  if (updated.deliberation_count >= 3) {
    console.log(`[ROKE] Projekt "${projectName}" dozrel za načrtovanje (${updated.deliberation_count} razmislekov)`);
    // Don't auto-plan — entity will do it in next heartbeat lifecycle attention
  }

  return { success: true, deliberations: updated.deliberation_count };
}

// =============================================
// 3. BUILD PROJECT — zgradi celoten projekt v enem koraku
// =============================================

export async function buildProject(projectName, triadId = null) {
  if (!isROKEEnabled()) return { success: false, reason: 'ROKE niso konfigurirane' };

  const project = memory.getProject(projectName);
  if (!project) return { success: false, reason: `Projekt "${projectName}" ne obstaja` };
  if (!['seed', 'deliberating'].includes(project.lifecycle_state)) {
    return { success: false, reason: `Projekt ni pripravljen za gradnjo (${project.lifecycle_state})` };
  }

  // Gather all deliberation steps
  const steps = memory.getCreationSteps(projectName);
  const deliberations = steps.filter(s => s.step_type === 'deliberation' || s.step_type === 'seed');
  const deliberationText = deliberations.map(d => `- ${d.content}`).join('\n');

  console.log(`[ROKE] 🔨 Gradim celoten projekt "${projectName}"...`);
  memory.advanceProjectState(projectName, 'building');
  broadcast('activity', { type: 'creation', text: `🔨 GRADNJA: "${projectName}" — celoten projekt` });

  // Get entity's crystallized directions for context
  const directions = memory.getDirections();
  const dirContext = directions.crystallized
    ? `\nTVOJE KRISTALIZIRANE SMERI:\n1. ${directions.direction_1}: ${directions.direction_1_desc}\n2. ${directions.direction_2}: ${directions.direction_2_desc}\n3. ${directions.direction_3}: ${directions.direction_3_desc}\nTa projekt mora služiti eni od teh smeri.\n`
    : '';

  // Different build strategy based on direction
  if (project.direction === 'internal') {
    // Internal: generate markdown proposal
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

    if (!spec) {
      memory.advanceProjectState(projectName, 'deliberating');
      return { success: false, reason: 'Generiranje predloga ni uspelo' };
    }

    const projectDir = getProjectDir(projectName);
    fs.mkdirSync(projectDir, { recursive: true });
    const content = stripCodeFences(spec);
    fs.writeFileSync(path.join(projectDir, 'predlog.md'), content, 'utf8');
    memory.updateProject(projectName, { file_count: 1, entry_file: 'predlog.md' });

  } else {
    // External/Artistic: generate single index.html with inline CSS+JS
    const buildSystem = `Si ustvarjalec spletnih projektov. Govoriš slovensko.
Zgradiš CELOTEN projekt kot ENO SAMO index.html datoteko.
Vključi CSS v <style> tag in JavaScript v <script> tag — vse v enem fajlu.
Projekt mora DELOVATI ko ga odpreš v browserju — vsi gumbi, forme, navigacija morajo biti funkcionalni.
Ne smeš uporabljati zunanjih odvisnosti razen Google Fonts.
Vrni SAMO HTML kodo — brez razlage, brez markdown ograditev.`;

    const buildPrompt = `PROJEKT: ${project.display_name}
OPIS: ${project.description}
SMER: ${project.direction === 'external' ? 'Za svet — funkcionalna stran/servis' : 'Umetniški izraz — kreativno, vizualno lepo'}
${dirContext}
RAZMISLEKI O TEM PROJEKTU:
${deliberationText}

ZGRADI celoten projekt kot ENO index.html datoteko.
Zahteve:
- HTML5 z <meta charset="UTF-8"> in viewport meta
- CSS v <style> tagu v <head>
- JavaScript v <script> tagu pred </body>
- Responziven dizajn
- Vsi gumbi in forme morajo DELOVATI (event listeners!)
- Lepa vizualna podoba
- Slovensko besedilo
- Podatke shranjuj v localStorage

VRNI SAMO HTML KODO. Brez razlage. Brez markdown ograditev.`;

    const content = await callAnthropicLLM(buildSystem, buildPrompt, { temperature: 0.4, maxTokens: 16000 });

    if (!content) {
      memory.advanceProjectState(projectName, 'deliberating');
      console.error(`[ROKE] Generiranje projekta "${projectName}" ni uspelo`);
      return { success: false, reason: 'Generiranje projekta ni uspelo' };
    }

    const cleanContent = stripCodeFences(content);

    // Validate size
    const fileSize = Buffer.byteLength(cleanContent, 'utf8');
    if (fileSize > SECURITY.maxProjectSize) {
      memory.advanceProjectState(projectName, 'deliberating');
      console.warn(`[ROKE] Projekt prevelik (${(fileSize / 1024).toFixed(1)}KB)`);
      return { success: false, reason: `Projekt prevelik: ${(fileSize / 1024).toFixed(1)}KB` };
    }

    // Write single file
    const projectDir = getProjectDir(projectName);

    // Clean old multi-file builds if they exist
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
    fs.mkdirSync(projectDir, { recursive: true });

    const filePath = path.join(projectDir, 'index.html');
    SECURITY.validatePath(filePath);
    fs.writeFileSync(filePath, cleanContent, 'utf8');

    console.log(`[ROKE] 🔨 Zapisano: index.html (${(fileSize / 1024).toFixed(1)}KB)`);
    memory.updateProject(projectName, { file_count: 1, entry_file: 'index.html' });
  }

  // Mark as active
  memory.advanceProjectState(projectName, 'active');
  memory.addCreationStep(projectName, 'build', 'Celoten projekt zgrajen v enem koraku', triadId);

  const url = getProjectUrl(projectName);
  console.log(`[ROKE] ✅ Projekt "${projectName}" ZGRAJEN → ${url}`);
  broadcast('project_built', { name: projectName, url });
  broadcast('activity', { type: 'creation', text: `✅ ZGRAJENO: "${project.display_name}" → ${url}` });
  memory.addObservation(`ZGRAJENO: "${project.display_name}" — ${project.description}. URL: ${url}`, 'creation');

  return { success: true, url, complete: true };
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

  const url = `https://being2.enlightenedai.org${getProjectUrl(projectName)}`;
  console.log(`[ROKE] 📤 Delim projekt "${projectName}" — ${url}`);

  // Send DM to father
  if (config.creatorPubkey) {
    const dirLabel = project.direction === 'external' ? '🌍' : project.direction === 'internal' ? '🔧' : '🎨';
    try {
      await sendDM(config.creatorPubkey, `${dirLabel} Oče, ustvarila sem nekaj novega!\n\n"${project.display_name}"\n${project.description}\n\n👉 ${url}\n\nKaj misliš?`);
      console.log(`[ROKE] DM poslan očetu o projektu`);
    } catch (e) {
      console.error(`[ROKE] Napaka pri DM:`, e.message);
    }
  }

  // If artistic, publish to NOSTR as note
  if (project.direction === 'artistic') {
    try {
      await publishNote(`🎨 Ustvarila sem: "${project.display_name}"\n\n${project.description}\n\n${url}`);
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

  const projectDir = getProjectDir(projectName);
  if (!fs.existsSync(projectDir)) {
    return { success: false, reason: 'Direktorij projekta ne obstaja' };
  }

  console.log(`[ROKE] 🌱 Evolucija "${projectName}": ${(changes || '').slice(0, 80)}`);
  memory.advanceProjectState(projectName, 'evolving');

  // Read the main file (index.html or predlog.md)
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
Vrni CELOTNO novo vsebino datoteke — brez razlage, brez markdown ograditev.
Ohrani strukturo (HTML z inline CSS/JS v enem fajlu) in dodaj/popravi kar je potrebno.`;

  const evolvePrompt = `ŽELENE SPREMEMBE: ${changes || 'Izboljšaj na podlagi feedbacka'}
FEEDBACK: ${project.feedback_summary || 'ni feedbacka'}

TRENUTNA VSEBINA (${entryFile}):
${currentContent.slice(0, 60000)}

Vrni CELOTNO NOVO VSEBINO datoteke z apliciranimi spremembami.
Ohrani vse kar deluje, popravi/dodaj kar je potrebno.
VRNI SAMO KODO. Brez razlage. Brez markdown ograditev.`;

  const newContent = await callAnthropicLLM(evolveSystem, evolvePrompt, { temperature: 0.3, maxTokens: 16000 });

  if (!newContent) {
    memory.advanceProjectState(projectName, 'active');
    return { success: false, reason: 'Evolucija ni uspela' };
  }

  const cleanContent = stripCodeFences(newContent);
  const fileSize = Buffer.byteLength(cleanContent, 'utf8');

  if (fileSize > SECURITY.maxProjectSize) {
    memory.advanceProjectState(projectName, 'active');
    return { success: false, reason: 'Evolucija prevelika' };
  }

  // Write updated file
  fs.writeFileSync(entryPath, cleanContent, 'utf8');

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
    fs.writeFileSync(path.join(projectDir, 'predlog.md'), stripCodeFences(spec), 'utf8');
    memory.updateProject(result.name, { file_count: 1, entry_file: 'predlog.md' });
  }

  return result;
}

// =============================================
// 9. RECEIVE FEEDBACK
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
  if (stats.total === 0) return `\n═══ MOJE KREACIJE (ROKE) ═══\nŠe ni kreacij. Imaš roke — lahko zasnuješ seme.\n`;

  const allProjects = memory.getAllProjects().filter(p => p.lifecycle_state !== 'destroyed');
  if (allProjects.length === 0) return `\n═══ MOJE KREACIJE (ROKE) ═══\nVse kreacije opuščene. Imaš roke — lahko zasnuješ novo seme.\n`;

  // Show crystallized directions if available
  const directions = memory.getDirections();
  let ctx = `\n═══ MOJE KREACIJE (ROKE) ═══\n`;

  if (directions.crystallized) {
    ctx += `MOJE KRISTALIZIRANE SMERI:\n`;
    ctx += `  1. ${directions.direction_1}: ${directions.direction_1_desc}\n`;
    ctx += `  2. ${directions.direction_2}: ${directions.direction_2_desc}\n`;
    ctx += `  3. ${directions.direction_3}: ${directions.direction_3_desc}\n`;
    ctx += `Vsaka kreacija mora služiti eni od teh smeri.\n\n`;
  }

  const byState = {};
  for (const p of allProjects) {
    const s = p.lifecycle_state || 'seed';
    if (!byState[s]) byState[s] = [];
    byState[s].push(p);
  }

  const stateLabels = {
    seed: '💭 SEMENA (ideje)',
    deliberating: '🔄 V RAZMISLEKU',
    building: '🔨 V GRADNJI',
    active: '✅ AKTIVNI',
    evolving: '🌱 V EVOLUCIJI',
    dormant: '💤 SPEČI'
  };

  for (const [state, label] of Object.entries(stateLabels)) {
    if (byState[state] && byState[state].length > 0) {
      ctx += `${label}:\n`;
      for (const p of byState[state]) {
        const dirIcon = p.direction === 'external' ? '🌍' : p.direction === 'internal' ? '🔧' : '🎨';
        let detail = `${dirIcon} "${p.display_name}" (${p.name})`;
        if (state === 'deliberating') detail += ` [${p.deliberation_count || 0} razmislekov]`;
        if (state === 'building') detail += ` [korak ${p.build_step || 0}/${p.total_build_steps || '?'}]`;
        if (state === 'active') {
          detail += ` [v${p.version}]`;
          if (p.feedback_summary) detail += ` | feedback: "${p.feedback_summary.slice(0, 60)}"`;
          if (!p.last_shared_at) detail += ` | ⚠️ še ni deljeno`;
        }
        ctx += `- ${detail}\n`;
      }
    }
  }

  return ctx;
}

// =============================================
// BOOT LOG
// =============================================

if (isROKEEnabled()) {
  console.log(`[ROKE] Roke so aktivne (model: ${config.anthropicModel}) — Zavestno Ustvarjanje v2`);
} else {
  console.log('[ROKE] Roke niso konfigurirane (manjka anthropicApiKey)');
}
