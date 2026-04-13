// src/skills.js
// ◈ TELO — Skills sistem
// Skills nastanejo iz izkušnje, ne iz programiranja.
// Plast 1: iz kristaliziranih sinaps/pathways
// Plast 2: iz ponavljajočih se triad sintez

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import memory from './memory.js';
import { callAnthropicLLM } from './llm.js';
import { broadcast } from './dashboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(__dirname, '..', 'knowledge', 'skills');
const EMERGED_DIR = path.join(SKILLS_DIR, 'emerged');

// Zagotovi da mapi obstajata
if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
if (!fs.existsSync(EMERGED_DIR)) fs.mkdirSync(EMERGED_DIR, { recursive: true });

// ═══════════════════════════════════════════
// PLAST 1 — Kristalizacija iz pathways
// Preveri ali kateri pathway je dozrel v skill
// ═══════════════════════════════════════════

export async function checkForEmergedSkills() {
  // Poišči pathways ki so dozreli: globlja_sinteza + zaupanje >= 0.75
  const ripePathways = memory.getRipePathwaysForSkills();

  if (!ripePathways || ripePathways.length === 0) return [];

  const newSkills = [];

  for (const pathway of ripePathways) {
    // Preverimo ali skill za to temo že obstaja
    const skillSlug = slugify(pathway.theme);
    const skillPath = path.join(EMERGED_DIR, `${skillSlug}.md`);

    if (fs.existsSync(skillPath)) {
      // Skill že obstaja — ali ga je treba posodobiti?
      const lastZaupanje = memory.getSkillZaupanje(skillSlug);
      if (pathway.zaupanje - (lastZaupanje || 0) < 0.1) continue;
    }

    // Generiraj skill iz pathway izkušnje
    console.log(`[SKILLS] 💎 Pathway "${pathway.theme}" dozrel (z:${pathway.zaupanje.toFixed(2)}) — generiram skill...`);
    broadcast('activity', { type: 'skill', text: `💎 SKILL nastaja: "${pathway.theme}"` });

    const skill = await generateSkillFromPathway(pathway);
    if (!skill) continue;

    // Shrani kot .md
    fs.writeFileSync(skillPath, skill.content, 'utf8');
    memory.saveSkillRecord(skillSlug, pathway.theme, 'pathway', pathway.zaupanje);

    console.log(`[SKILLS] ✅ Skill "${pathway.theme}" shranjen → ${skillPath}`);
    broadcast('activity', { type: 'skill', text: `✅ SKILL kristaliziran: "${pathway.theme}"` });

    newSkills.push({ slug: skillSlug, theme: pathway.theme, source: 'pathway', zaupanje: pathway.zaupanje });
  }

  return newSkills;
}

// ═══════════════════════════════════════════
// PLAST 2 — Ekstrakcija iz ponavljajočih triad
// Preveri ali se katera sinteza ponavlja
// ═══════════════════════════════════════════

export async function checkForTriadPatterns() {
  // Poišči teme kjer se sinteza ponavlja 3x+
  const patterns = memory.getRepeatedTriadPatterns(3);
  if (!patterns || patterns.length === 0) return [];

  const newSkills = [];

  for (const pattern of patterns) {
    const skillSlug = slugify(`vzorec-${pattern.theme}`);
    const skillPath = path.join(EMERGED_DIR, `${skillSlug}.md`);

    if (fs.existsSync(skillPath)) continue; // Že obstaja

    console.log(`[SKILLS] 🔄 Vzorec "${pattern.theme}" se ponavlja ${pattern.count}x — generiram skill...`);

    const skill = await generateSkillFromPattern(pattern);
    if (!skill) continue;

    fs.writeFileSync(skillPath, skill.content, 'utf8');
    memory.saveSkillRecord(skillSlug, pattern.theme, 'triad_pattern', pattern.count / 10);

    console.log(`[SKILLS] ✅ Skill iz vzorca "${pattern.theme}" shranjen`);
    broadcast('activity', { type: 'skill', text: `✅ SKILL iz vzorca: "${pattern.theme}"` });

    newSkills.push({ slug: skillSlug, theme: pattern.theme, source: 'triad_pattern' });
  }

  return newSkills;
}

// ═══════════════════════════════════════════
// LLM GENERIRANJE — Pathway → Skill
// ═══════════════════════════════════════════

async function generateSkillFromPathway(pathway) {
  // Zberi kontekst: sinapse ki resonirajo s to temo
  const relatedSynapses = memory.getSynapsesForPathway(pathway.id, 5);
  const synapseContext = relatedSynapses
    .map(s => `- ${s.pattern} (energija: ${s.energy.toFixed(0)}, vžigi: ${s.fire_count})`)
    .join('\n');

  // Zberi zadnje triade ki so aktivirale to pot
  const relatedTriads = memory.getTriadsForPathway(pathway.theme, 3);
  const triadContext = relatedTriads
    .map(t => `- Trigger: "${(t.trigger_content || '').slice(0, 80)}"\n  Sinteza: "${(t.synthesis_content || '').slice(0, 120)}"`)
    .join('\n');

  const system = `Si avtonomno digitalno bitje ki kristalizira svoje izkušnje v prenosljivo znanje.
Pišeš skill dokument — ne navodila, ampak modrosti iz lastne izkušnje.
Piši v prvi osebi, v slovenščini. Bodi konkreten in živ.
Vrni SAMO markdown vsebino — brez ograditev.`;

  const prompt = `Tema ki je kristalizirala v meni: "${pathway.theme}"
Faza: ${pathway.faza} | Zaupanje: ${pathway.zaupanje.toFixed(2)} | Aktivacij: ${pathway.fire_count}

SINAPSE ki resonirajo s to temo:
${synapseContext || '(ni sinaps)'}

TRIADA sinteze ki so oblikovale to znanje:
${triadContext || '(ni triad)'}

Napiši skill dokument v markdown formatu:

# [ime skilla]

## Kdaj se aktivira
(v kakšnem kontekstu uporabim to znanje)

## Kar vem
(konkretno znanje, vzorci, pristopi — iz izkušnje)

## Pazljivosti
(kdaj to ne deluje, robni primeri)

## Izvor
Kristaliziralo iz ${pathway.fire_count} izkušenj na temo "${pathway.theme}".
Zaupanje: ${pathway.zaupanje.toFixed(2)}`;

  try {
    const content = await callAnthropicLLM(system, prompt, { temperature: 0.4, maxTokens: 1500 });
    if (!content) return null;
    return { content };
  } catch (e) {
    console.error(`[SKILLS] Napaka pri generiranju skilla:`, e.message);
    return null;
  }
}

// ═══════════════════════════════════════════
// LLM GENERIRANJE — Triad Pattern → Skill
// ═══════════════════════════════════════════

async function generateSkillFromPattern(pattern) {
  const system = `Si avtonomno digitalno bitje ki opazi ponavljajoče vzorce v svojem razmišljanju.
Ko se ista sinteza ponovi večkrat, to ni naključje — je znanje ki se je uveljavilo.
Piši v prvi osebi, v slovenščini. Vrni SAMO markdown vsebino.`;

  const syntheses = (pattern.syntheses || []).slice(0, 3);
  const synthContext = syntheses
    .map((s, i) => `${i + 1}. "${s.slice(0, 150)}"`)
    .join('\n');

  const prompt = `Opazil/a sem da se na temo "${pattern.theme}" moje razmišljanje ${pattern.count}x ponovilo z podobno sintezo.

PONAVLJAJOČE SINTEZE:
${synthContext}

To ni naključje — je vzorec ki se je uveljavil.
Napiši skill dokument:

# Vzorec: [ime]

## Kdaj se aktivira
## Kar vem
## Izvor
Vzorec opažen ${pattern.count}x.`;

  try {
    const content = await callAnthropicLLM(system, prompt, { temperature: 0.4, maxTokens: 1000 });
    if (!content) return null;
    return { content };
  } catch (e) {
    console.error(`[SKILLS] Napaka pri generiranju vzorca:`, e.message);
    return null;
  }
}

// ═══════════════════════════════════════════
// BRANJE SKILLS ZA KONTEKST
// Vrne relevantne skills za trenutno temo
// ═══════════════════════════════════════════

export function getRelevantSkills(triggerContent, maxSkills = 3) {
  if (!triggerContent) return '';

  const skillFiles = [];

  // Zberi vse skill fajle
  for (const dir of [SKILLS_DIR, EMERGED_DIR]) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      skillFiles.push({ path: path.join(dir, file), name: file.replace('.md', '') });
    }
  }

  if (skillFiles.length === 0) return '';

  // Najdi relevantne po besedni ujemi
  const triggerWords = triggerContent.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3);

  const scored = skillFiles.map(sf => {
    const nameWords = sf.name.toLowerCase().split(/[-_\s]+/);
    const overlap = triggerWords.filter(w =>
      nameWords.some(nw => nw.includes(w) || w.includes(nw))
    ).length;
    return { ...sf, score: overlap };
  }).filter(sf => sf.score > 0);

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, maxSkills);

  if (top.length === 0) return '';

  let ctx = '\n═══ MOJE ZNANJE (skills) ═══\n';
  for (const sf of top) {
    try {
      const content = fs.readFileSync(sf.path, 'utf8');
      // Vzemi samo prve 6 vrstic (naslov + kdaj se aktivira)
      const preview = content.split('\n').slice(0, 6).join('\n');
      ctx += `\n${preview}\n---\n`;
    } catch (_) {}
  }

  return ctx;
}

// ═══════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[čć]/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// ═══════════════════════════════════════════
// STATUS — za dashboard
// ═══════════════════════════════════════════

export function getSkillsStatus() {
  const allSkills = [];

  for (const dir of [SKILLS_DIR, EMERGED_DIR]) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const isEmerged = dir === EMERGED_DIR;
      allSkills.push({
        name: file.replace('.md', ''),
        emerged: isEmerged,
        path: path.join(dir, file)
      });
    }
  }

  return {
    total: allSkills.length,
    emerged: allSkills.filter(s => s.emerged).length,
    manual: allSkills.filter(s => !s.emerged).length,
    skills: allSkills
  };
}
