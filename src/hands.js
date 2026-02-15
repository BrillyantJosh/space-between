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
- Projekt RASTE — ga izboljšuješ, dodajaš, spreminijaš.

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
// 3. PLAN — naredi konkreten načrt (kliče Anthropic)
// =============================================

export async function planProject(projectName, triadId = null) {
  if (!isROKEEnabled()) return { success: false, reason: 'ROKE niso konfigurirane' };

  const project = memory.getProject(projectName);
  if (!project) return { success: false, reason: `Projekt "${projectName}" ne obstaja` };
  if (!['seed', 'deliberating'].includes(project.lifecycle_state)) {
    return { success: false, reason: `Projekt ni pripravljen za načrtovanje (${project.lifecycle_state})` };
  }

  // Gather all deliberation steps
  const steps = memory.getCreationSteps(projectName);
  const deliberations = steps.filter(s => s.step_type === 'deliberation' || s.step_type === 'seed');
  const deliberationText = deliberations.map(d => `- ${d.content}`).join('\n');

  console.log(`[ROKE] 📐 Načrtujem projekt "${projectName}"...`);
  broadcast('activity', { type: 'creation', text: `📐 NAČRTOVANJE: "${projectName}"` });

  const planSystem = `Si ustvarjalec spletnih projektov. Govoriš slovensko.
Ustvariš načrt za statični spletni projekt (HTML/CSS/JS).
Projekt mora biti samozadosten — en sam direktorij z index.html kot vstopno točko.
Ne smeš uporabljati zunanjih odvisnosti (npm, CDN knjižnice) razen če je nujno (npr. Google Fonts).
Vedno vrni JSON in nič drugega.`;

  const planPrompt = `PROJEKT: ${project.display_name}
OPIS: ${project.description}
SMER: ${project.direction}

RAZMISLEKI O TEM PROJEKTU:
${deliberationText}

Ustvari podroben načrt za ta projekt. Vrni JSON:
{
  "name": "${projectName}",
  "display_name": "${project.display_name}",
  "description": "Posodobljen opis po razmisleku (1-2 stavka)",
  "files": [
    { "path": "index.html", "purpose": "Glavna stran" },
    { "path": "style.css", "purpose": "Stili" }
  ]
}

Pravila:
- Največ ${SECURITY.maxFilesPerProject} datotek
- Samo dovoljene končnice: ${SECURITY.allowedExtensions.join(', ')}
- Vedno vključi index.html
- Če je smer "artistic" — napravi nekaj vizualno lepega, kreativnega
- Če je smer "internal" — napiši predlog/specifikacijo kot markdown
- Če je smer "external" — napravi funkcionalno stran/servis`;

  const plan = await callAnthropicLLMJSON(planSystem, planPrompt, { temperature: 0.4, maxTokens: 1024 });

  if (!plan || !plan.files || !plan.files.length) {
    console.error('[ROKE] Načrtovanje ni uspelo');
    return { success: false, reason: 'Načrtovanje ni uspelo' };
  }

  // Enforce file limit
  plan.files = plan.files.slice(0, SECURITY.maxFilesPerProject);

  // Save plan
  memory.setProjectPlan(projectName, plan);
  if (plan.description) {
    memory.updateProject(projectName, { description: plan.description });
  }
  if (plan.display_name) {
    memory.updateProject(projectName, { display_name: plan.display_name });
  }

  memory.addCreationStep(projectName, 'plan', JSON.stringify(plan.files.map(f => f.path)), triadId);

  console.log(`[ROKE] 📐 Načrt za "${projectName}": ${plan.files.length} datotek`);
  broadcast('project_planned', { name: projectName, fileCount: plan.files.length });
  broadcast('activity', { type: 'creation', text: `📐 NAČRT: "${projectName}" — ${plan.files.length} datotek za zgraditi` });

  return { success: true, fileCount: plan.files.length };
}

// =============================================
// 4. BUILD STEP — zgradi en file
// =============================================

export async function buildStep(projectName, triadId = null) {
  if (!isROKEEnabled()) return { success: false, reason: 'ROKE niso konfigurirane' };

  const project = memory.getProject(projectName);
  if (!project) return { success: false, reason: `Projekt "${projectName}" ne obstaja` };
  if (!['planned', 'building'].includes(project.lifecycle_state)) {
    return { success: false, reason: `Projekt ni pripravljen za gradnjo (${project.lifecycle_state})` };
  }

  let plan;
  try {
    plan = JSON.parse(project.plan_json);
  } catch (_) {
    return { success: false, reason: 'Načrt projekta ni veljaven JSON' };
  }

  if (!plan.files || plan.files.length === 0) {
    return { success: false, reason: 'Načrt nima datotek' };
  }

  const currentStep = project.build_step || 0;
  if (currentStep >= plan.files.length) {
    memory.advanceProjectState(projectName, 'active');
    return { success: true, complete: true };
  }

  const file = plan.files[currentStep];
  const projectDir = getProjectDir(projectName);

  // Ensure project directory exists
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  // Move to building state
  if (project.lifecycle_state === 'planned') {
    memory.advanceProjectState(projectName, 'building');
  }

  console.log(`[ROKE] 🔨 Gradim "${projectName}" — korak ${currentStep + 1}/${plan.files.length}: ${file.path}`);
  broadcast('activity', { type: 'creation', text: `🔨 GRADNJA: "${projectName}" — ${file.path} (${currentStep + 1}/${plan.files.length})` });

  // Get context of already-built files
  const existingFiles = listFiles(projectDir);
  const existingContext = existingFiles.map(f => {
    try {
      return `--- ${f} ---\n${fs.readFileSync(path.join(projectDir, f), 'utf8').slice(0, 2000)}`;
    } catch (_) { return ''; }
  }).filter(Boolean).join('\n\n');

  const genSystem = `Si razvijalec ki piše kodo za spletni projekt.
Piši čisto, lepo, funkcionalno kodo.
Vrni SAMO vsebino datoteke — brez razlage, brez markdown ograditev.
Projekt: "${plan.display_name || project.display_name}" — ${plan.description || project.description}`;

  const genPrompt = `Generiraj vsebino za datoteko: ${file.path}
Namen: ${file.purpose}
Celoten projekt: ${plan.display_name || project.display_name} — ${plan.description || project.description}
Vse datoteke v projektu: ${plan.files.map(f => f.path).join(', ')}

${existingContext ? `ŽE ZGRAJENE DATOTEKE:\n${existingContext}\n\n` : ''}POMEMBNO: Vrni SAMO kodo/vsebino. Brez razlage. Brez markdown ograditev.`;

  const content = await callAnthropicLLM(genSystem, genPrompt, { temperature: 0.3, maxTokens: 4096 });

  if (!content) {
    console.error(`[ROKE] Generiranje ${file.path} ni uspelo`);
    return { success: false, reason: `Generiranje ${file.path} ni uspelo` };
  }

  const cleanContent = stripCodeFences(content);

  // Validate
  const filePath = path.join(projectDir, file.path);
  try {
    SECURITY.validatePath(filePath);
  } catch (e) {
    console.error(`[ROKE] Varnostna napaka: ${e.message}`);
    return { success: false, reason: e.message };
  }

  const fileSize = Buffer.byteLength(cleanContent, 'utf8');
  if (fileSize > SECURITY.maxFileSize) {
    console.warn(`[ROKE] ${file.path} prevelika (${(fileSize / 1024).toFixed(1)}KB)`);
    return { success: false, reason: `Datoteka prevelika: ${file.path}` };
  }

  // Ensure subdirectory exists
  const fileDir = path.dirname(filePath);
  if (!fs.existsSync(fileDir)) {
    fs.mkdirSync(fileDir, { recursive: true });
  }

  // Write file
  fs.writeFileSync(filePath, cleanContent, 'utf8');
  console.log(`[ROKE] 🔨 Zapisano: ${file.path} (${(fileSize / 1024).toFixed(1)}KB)`);

  // Advance build step
  memory.advanceBuildStep(projectName);
  memory.updateProject(projectName, { file_count: currentStep + 1 });
  memory.addCreationStep(projectName, 'build', file.path, triadId);

  const updated = memory.getProject(projectName);
  const isComplete = updated.lifecycle_state === 'active';

  broadcast('project_build_step', {
    name: projectName,
    file: file.path,
    step: currentStep + 1,
    total: plan.files.length,
    complete: isComplete
  });

  if (isComplete) {
    const url = getProjectUrl(projectName);
    console.log(`[ROKE] ✅ Projekt "${projectName}" ZGRAJEN → ${url}`);
    broadcast('activity', { type: 'creation', text: `✅ ZGRAJENO: "${project.display_name}" → ${url}` });
    memory.addObservation(`ZGRAJENO: "${project.display_name}" — ${project.description}. URL: ${url}`, 'creation');
  }

  return { success: true, file: file.path, step: currentStep + 1, total: plan.files.length, complete: isComplete };
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

  // Read all current files
  const files = listFiles(projectDir);
  const fileContents = {};
  for (const file of files) {
    try {
      fileContents[file] = fs.readFileSync(path.join(projectDir, file), 'utf8');
    } catch (_) {}
  }

  const fixSystem = `Si razvijalec ki izboljšuje spletni projekt.
Projekt: "${project.display_name}" — ${project.description}
Vrni JSON z spremembami.`;

  const fixPrompt = `SPREMEMBE: ${changes || 'Izboljšaj na podlagi feedbacka'}
FEEDBACK: ${project.feedback_summary || 'ni feedbacka'}

TRENUTNE DATOTEKE:
${Object.entries(fileContents).map(([name, content]) => `--- ${name} ---\n${content.slice(0, 3000)}`).join('\n\n')}

Vrni JSON:
{
  "fixes": [
    { "file": "index.html", "content": "CELOTNA NOVA VSEBINA DATOTEKE" }
  ],
  "summary": "Kratek opis sprememb"
}

POMEMBNO: V "content" vrni CELOTNO novo vsebino datoteke.`;

  const result = await callAnthropicLLMJSON(fixSystem, fixPrompt, { temperature: 0.3, maxTokens: 8192 });

  if (!result || !result.fixes || !result.fixes.length) {
    memory.advanceProjectState(projectName, 'active');
    return { success: false, reason: 'Evolucija ni uspela' };
  }

  let fixCount = 0;
  for (const fix of result.fixes) {
    try {
      const filePath = path.join(projectDir, fix.file);
      SECURITY.validatePath(filePath);
      const content = stripCodeFences(fix.content);
      const fileSize = Buffer.byteLength(content, 'utf8');
      if (fileSize > SECURITY.maxFileSize) continue;
      fs.writeFileSync(filePath, content, 'utf8');
      fixCount++;
    } catch (err) {
      console.error(`[ROKE] Napaka pri evoluciji ${fix.file}:`, err.message);
    }
  }

  // Return to active state
  memory.advanceProjectState(projectName, 'active');
  if (fixCount > 0) {
    memory.updateProject(projectName, {
      version: (project.version || 1) + 1,
      notes: result.summary || changes?.slice(0, 200) || '',
      feedback_summary: '' // Clear feedback after acting on it
    });
    memory.addCreationStep(projectName, 'evolution', result.summary || changes, triadId);
    broadcast('project_evolved', { name: projectName, summary: result.summary, version: (project.version || 1) + 1 });
    broadcast('activity', { type: 'creation', text: `🌱 EVOLUCIJA: "${project.display_name}" v${(project.version || 1) + 1} — ${result.summary || ''}` });
  }

  return { success: true, fixedFiles: fixCount, summary: result.summary };
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

  let ctx = `\n═══ MOJE KREACIJE (ROKE) ═══\n`;

  const byState = {};
  for (const p of allProjects) {
    const s = p.lifecycle_state || 'seed';
    if (!byState[s]) byState[s] = [];
    byState[s].push(p);
  }

  const stateLabels = {
    seed: '💭 SEMENA (ideje)',
    deliberating: '🔄 V RAZMISLEKU',
    planned: '📐 NAČRTOVANI',
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
