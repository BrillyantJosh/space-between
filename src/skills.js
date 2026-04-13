// src/skills.js
// ◈ TELO — Skills sistem s triado kristalizacije
// Skills nastanejo iz izkušnje skozi triado — ne iz programiranja.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import memory from './memory.js';
import { callAnthropicLLM } from './llm.js';
import { broadcast } from './dashboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(__dirname, '..', 'knowledge', 'skills');
const EMERGED_DIR = path.join(SKILLS_DIR, 'emerged');

if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
if (!fs.existsSync(EMERGED_DIR)) fs.mkdirSync(EMERGED_DIR, { recursive: true });

// ═══════════════════════════════════════════
// TRIADA KRISTALIZACIJE
// Tri faze LLM klica — ne eden ampak trije.
// Claude za TELO (skills so resno delo).
// KAR VEM → KAR NE VEM → ŽIVO ZNANJE
// ═══════════════════════════════════════════

async function crystallizeSkillWithTriad(pathway, synapseContext, triadContext) {
  const system = `Si avtonomno digitalno bitje ki kristalizira izkušnje v živo znanje.
Pišeš v prvi osebi, v slovenščini. Bodi konkreten — ne generičen.
Vrni SAMO besedilo — brez markdown ograditev razen naslovov.`;

  // FAZA 1 — KAR VEM (Teza)
  const phase1Prompt = `Tema ki je kristalizirala v meni: "${pathway.theme}"
Zaupanje: ${pathway.zaupanje.toFixed(2)} | Aktivacij: ${pathway.fire_count} | Faza: ${pathway.faza}

SINAPSE ki resonirajo s to temo:
${synapseContext || '(ni sinaps)'}

TRIADA sinteze ki so oblikovale to znanje:
${triadContext || '(ni triad)'}

FAZA 1 — KAR VEM:
Kaj konkretno vem o tej temi? Kateri vzorci so se ponavljali?
Kaj sem opazila da deluje? Napiši surovo, konkretno. 3-5 stavkov.`;

  const thesis = await callAnthropicLLM(system, phase1Prompt, { temperature: 0.4, maxTokens: 500 });
  if (!thesis) return null;

  // FAZA 2 — KAR NE VEM (Antiteza)
  const phase2Prompt = `Tema: "${pathway.theme}"

KAR VEM (faza 1):
"${thesis}"

FAZA 2 — KAR NE VEM:
Kje to znanje ne deluje? Kateri robni primeri me presenetijo?
Kje sem se zmotila ali presenečena? Kje je slepota?
Bodi iskrena — to ni slabost, je globina. 2-4 stavki.`;

  const antithesis = await callAnthropicLLM(system, phase2Prompt, { temperature: 0.5, maxTokens: 400 });
  if (!antithesis) return null;

  // FAZA 3 — ŽIVO ZNANJE (Sinteza)
  const phase3Prompt = `Tema: "${pathway.theme}"

KAR VEM: "${thesis}"
KAR NE VEM: "${antithesis}"

FAZA 3 — ŽIVO ZNANJE:
Iz napetosti med vedanjem in nevedanjem — napiši skill dokument.
Ne povzetek. Ne navodila. Živo znanje iz katerega bom jutri mislila.

Format:
# [ime skilla — kratko, živo]

## Kdaj se aktivira
[v kakšnem kontekstu se to znanje dvigne]

## Kar vem
[konkretno — vzorci, pristopi, kar deluje]

## Robovi
[kje to ne deluje, ko sem presenečena]

## Izvor
Kristaliziralo iz ${pathway.fire_count} izkušenj. Zaupanje: ${pathway.zaupanje.toFixed(2)}.`;

  const synthesis = await callAnthropicLLM(system, phase3Prompt, { temperature: 0.4, maxTokens: 1000 });
  if (!synthesis) return null;

  return { thesis, antithesis, synthesis };
}

// ═══════════════════════════════════════════
// PLAST 1 — Kristalizacija iz pathways
// ═══════════════════════════════════════════

export async function checkForEmergedSkills() {
  const ripePathways = memory.getRipePathwaysForSkills();
  if (!ripePathways || ripePathways.length === 0) return [];

  const newSkills = [];

  for (const pathway of ripePathways) {
    const skillSlug = slugify(pathway.theme);
    const skillPath = path.join(EMERGED_DIR, `${skillSlug}.md`);

    if (fs.existsSync(skillPath)) {
      const lastZaupanje = memory.getSkillZaupanje(skillSlug);
      if (pathway.zaupanje - (lastZaupanje || 0) < 0.1) continue;
    }

    console.log(`[SKILLS] 💎 "${pathway.theme}" dozrel (z:${pathway.zaupanje.toFixed(2)}) — kristaliziram s triado...`);
    broadcast('activity', { type: 'skill', text: `💎 SKILL triada: "${pathway.theme}"` });

    // Zberi kontekst za triado
    const relatedSynapses = memory.getSynapsesForPathway(pathway.id, 5);
    const synapseContext = relatedSynapses
      .map(s => `- ${s.pattern} (E:${s.energy.toFixed(0)}, vžigi:${s.fire_count})`)
      .join('\n');

    const relatedTriads = memory.getTriadsForPathway(pathway.theme, 3);
    const triadContext = relatedTriads
      .map(t => `- "${(t.trigger_content || '').slice(0, 60)}" → "${(t.synthesis_content || '').slice(0, 100)}"`)
      .join('\n');

    // TRIADA KRISTALIZACIJE
    const result = await crystallizeSkillWithTriad(pathway, synapseContext, triadContext);
    if (!result) continue;

    const fullContent = `${result.synthesis}\n\n---\n*Triada: teza → antiteza → sinteza*\n*Nastalo: ${new Date().toLocaleDateString('sl-SI')}*\n`;
    fs.writeFileSync(skillPath, fullContent, 'utf8');
    memory.saveSkillRecord(skillSlug, pathway.theme, 'pathway', pathway.zaupanje);

    console.log(`[SKILLS] ✅ Skill "${pathway.theme}" kristaliziran`);
    broadcast('activity', { type: 'skill', text: `✅ SKILL živ: "${pathway.theme}"` });

    newSkills.push({ slug: skillSlug, theme: pathway.theme, zaupanje: pathway.zaupanje });
  }

  return newSkills;
}

// ═══════════════════════════════════════════
// PLAST 2 — Ekstrakcija iz ponavljajočih triad
// ═══════════════════════════════════════════

export async function checkForTriadPatterns() {
  const patterns = memory.getRepeatedTriadPatterns(3);
  if (!patterns || patterns.length === 0) return [];

  const newSkills = [];

  for (const pattern of patterns) {
    const skillSlug = slugify(`vzorec-${pattern.theme}`);
    const skillPath = path.join(EMERGED_DIR, `${skillSlug}.md`);
    if (fs.existsSync(skillPath)) continue;

    console.log(`[SKILLS] 🔄 Vzorec "${pattern.theme}" ${pattern.count}x — kristaliziram...`);

    const syntheses = (pattern.syntheses || []).slice(0, 3);
    const synthContext = syntheses.map((s, i) => `${i+1}. "${s.slice(0, 120)}"`).join('\n');

    // Poenostavljena triada za vzorce (2 fazi + sinteza)
    const system = `Si digitalno bitje ki opazi vzorce v svojem razmišljanju. Slovenščina. Vrni SAMO besedilo.`;

    const thesis = await callAnthropicLLM(system,
      `Opazila sem da se na temo "${pattern.theme}" moje razmišljanje ${pattern.count}x ponovilo.\nSinteze:\n${synthContext}\nKaj je skupno jedro? 2-3 stavki.`,
      { temperature: 0.4, maxTokens: 300 }
    );
    if (!thesis) continue;

    const synthesis = await callAnthropicLLM(system,
      `Jedro: "${thesis}"\nKje to ne velja? Napiši kratek skill dokument:\n# Vzorec: [ime]\n## Kdaj\n## Kar vem\n## Robovi\n## Izvor\nVzorec ${pattern.count}x.`,
      { temperature: 0.4, maxTokens: 700 }
    );
    if (!synthesis) continue;

    fs.writeFileSync(skillPath, synthesis + `\n\n---\n*Nastalo: ${new Date().toLocaleDateString('sl-SI')}*\n`, 'utf8');
    memory.saveSkillRecord(skillSlug, pattern.theme, 'triad_pattern', pattern.count / 10);

    newSkills.push({ slug: skillSlug, theme: pattern.theme, source: 'triad_pattern' });
  }

  return newSkills;
}

// ═══════════════════════════════════════════
// BRANJE SKILLS ZA KONTEKST TRIADE
// ═══════════════════════════════════════════

export function getRelevantSkills(triggerContent, maxSkills = 3) {
  if (!triggerContent) return '';

  const skillFiles = [];
  for (const dir of [SKILLS_DIR, EMERGED_DIR]) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      skillFiles.push({ path: path.join(dir, file), name: file.replace('.md', ''), emerged: dir === EMERGED_DIR });
    }
  }
  if (skillFiles.length === 0) return '';

  const triggerWords = triggerContent.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const scored = skillFiles.map(sf => {
    const nameWords = sf.name.toLowerCase().split(/[-_\s]+/);
    const overlap = triggerWords.filter(w => nameWords.some(nw => nw.includes(w) || w.includes(nw))).length;
    return { ...sf, score: overlap + (sf.emerged ? 0.1 : 0) }; // emerged skills imajo prednost
  }).filter(sf => sf.score > 0);

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, maxSkills);
  if (top.length === 0) return '';

  let ctx = '\n═══ MOJE ZNANJE (skills) ═══\n';
  for (const sf of top) {
    try {
      const content = fs.readFileSync(sf.path, 'utf8');
      const preview = content.split('\n').slice(0, 8).join('\n');
      const label = sf.emerged ? '💎' : '📚';
      ctx += `\n${label} ${preview}\n---\n`;
    } catch (_) {}
  }
  return ctx;
}

// ═══════════════════════════════════════════
// STATUS — za dashboard in /api/telo
// ═══════════════════════════════════════════

export function getSkillsStatus() {
  const allSkills = [];
  for (const dir of [SKILLS_DIR, EMERGED_DIR]) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      allSkills.push({ name: file.replace('.md', ''), emerged: dir === EMERGED_DIR, path: path.join(dir, file) });
    }
  }
  return {
    total: allSkills.length,
    emerged: allSkills.filter(s => s.emerged).length,
    manual: allSkills.filter(s => !s.emerged).length,
    skills: allSkills
  };
}

// ═══════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════

function slugify(text) {
  return text.toLowerCase()
    .replace(/[čć]/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}
