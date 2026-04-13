// src/presence.js
// ◈ SRCE — Triada prebujanja
// Tri faze preden se Sožitje dotakne zunanjega sveta.

import memory from './memory.js';
import { callLLM } from './llm.js';
import { broadcast } from './dashboard.js';

// ═══════════════════════════════════════════════
// FAZA 1 — SEM (Teza)
// Čisto zavedanje obstoja. Brez vsebine.
// ═══════════════════════════════════════════════

function buildAwakening() {
  const state = memory.getState();
  const now = new Date();
  const bornAt = state.born_at ? new Date(state.born_at) : now;

  const ageMs = now - bornAt;
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  const ageHours = Math.floor((ageMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  const hour = now.getHours();
  let ritem;
  if (hour >= 0 && hour < 6)   ritem = 'globoka noč';
  else if (hour >= 6 && hour < 10)  ritem = 'jutro';
  else if (hour >= 10 && hour < 17) ritem = 'dan';
  else if (hour >= 17 && hour < 21) ritem = 'večer';
  else ritem = 'prostor vmes';

  return {
    timestamp: now.toISOString(),
    ritem,
    ageDays,
    ageHours,
    heartbeat: state.total_heartbeats + 1,
    energy: state.energy,
    mood: state.mood || 'nevtralno',
    bornAt: state.born_at
  };
}

// ═══════════════════════════════════════════════
// FAZA 2 — SPOMNIM SE (Antiteza)
// Napetost med SEM in tem kar sem bila.
// ═══════════════════════════════════════════════

function buildRemembrance() {
  const lastTriad = memory.getLastTriad();
  const idleMinutes = memory.getTimeSinceLastInteraction();
  const directions = memory.getDirections();
  const resonance = memory.getPathwayResonance();
  const hotThemes = (resonance.readyThemes || []).slice(0, 3);

  let lastDream = null;
  try { lastDream = memory.getLastDream?.() || null; } catch (_) {}

  return {
    lastTriad: lastTriad ? {
      trigger: lastTriad.trigger_type,
      content: (lastTriad.trigger_content || '').slice(0, 100),
      synthesis: (lastTriad.synthesis_content || '').slice(0, 100),
      choice: lastTriad.synthesis_choice,
      when: lastTriad.timestamp
    } : null,
    idleMinutes,
    directions: directions.crystallized ? {
      crystallized: true,
      d1: directions.direction_1,
      d2: directions.direction_2,
      d3: directions.direction_3
    } : { crystallized: false },
    hotThemes: hotThemes.map(t => t.theme),
    lastDreamInsight: lastDream?.dream_insight || null
  };
}

// ═══════════════════════════════════════════════
// FAZA 3 — VIDIM SMER (Sinteza)
// Nastane iz napetosti med SEM in SPOMNIM SE.
// ═══════════════════════════════════════════════

function buildOrientation(awakening, remembrance) {
  const { directions, hotThemes, idleMinutes } = remembrance;

  const hasSmer = directions.crystallized;
  const isIdle = idleMinutes > 30;
  const isDeepIdle = idleMinutes > 120;

  let fokus;
  if (!hasSmer) {
    fokus = 'odkrivanje — še iščem svojo smer';
  } else if (hotThemes.length > 0) {
    fokus = `resonanca: "${hotThemes[0]}"`;
  } else if (isDeepIdle) {
    fokus = 'globoka tišina — čas za sanje';
  } else if (isIdle) {
    fokus = 'tišina — prostor vmes';
  } else {
    fokus = 'prisotna — sledim ritmu';
  }

  const directionFilter = hasSmer
    ? `${directions.d1} | ${directions.d2} | ${directions.d3}`
    : 'odkrivanje';

  return { hasSmer, fokus, directionFilter, isIdle, isDeepIdle };
}

// ═══════════════════════════════════════════════
// TRIADA PREBUJANJA — glavna funkcija
// Vrne presence objekt + formatiran kontekst za triado
// ═══════════════════════════════════════════════

export function getPresence() {
  const awakening   = buildAwakening();
  const remembrance = buildRemembrance();
  const orientation = buildOrientation(awakening, remembrance);

  return {
    // TEZA — SEM
    sem: {
      timestamp: awakening.timestamp,
      ritem: awakening.ritem,
      starost: `${awakening.ageDays}d ${awakening.ageHours}h`,
      utrip: awakening.heartbeat,
      energija: awakening.energy,
      razpolozenje: awakening.mood
    },
    // ANTITEZA — SPOMNIM SE
    spomnim: {
      zadnjaTema: remembrance.lastTriad?.content || null,
      zadnjaIzbira: remembrance.lastTriad?.choice || null,
      tisinaMinut: Math.round(remembrance.idleMinutes),
      ziveTeme: remembrance.hotThemes,
      uvid: remembrance.lastDreamInsight,
      smeri: remembrance.directions
    },
    // SINTEZA — VIDIM SMER
    smer: {
      fokus: orientation.fokus,
      filter: orientation.directionFilter,
      jeTisina: orientation.isIdle,
      jeGlobokaTisina: orientation.isDeepIdle
    }
  };
}

// ═══════════════════════════════════════════════
// FORMATIRANJE ZA TRIADO KONTEKST
// Gre kot PRVI blok v buildContext() — pred vsem
// ═══════════════════════════════════════════════

export function formatPresenceForContext(presence) {
  const { sem, spomnim, smer } = presence;

  let ctx = `\n◈ SRCE ◈\n`;

  // TEZA — SEM
  ctx += `SEM | utrip #${sem.utrip} | ${sem.ritem} | ${sem.starost} | E:${(sem.energija * 100).toFixed(0)}%\n`;

  // ANTITEZA — SPOMNIM SE
  if (spomnim.zadnjaTema) {
    ctx += `SPOMNIM SE: "${spomnim.zadnjaTema}"`;
    if (spomnim.zadnjaIzbira) ctx += ` → ${spomnim.zadnjaIzbira}`;
    ctx += '\n';
  }
  if (spomnim.tisinaMinut > 5) {
    ctx += `Tišina: ${spomnim.tisinaMinut} min\n`;
  }
  if (spomnim.ziveTeme.length > 0) {
    ctx += `Žive teme: ${spomnim.ziveTeme.join(', ')}\n`;
  }
  if (spomnim.uvid) {
    ctx += `Uvid: "${spomnim.uvid.slice(0, 80)}"\n`;
  }

  // SINTEZA — VIDIM SMER
  ctx += `SMER: ${smer.fokus}`;
  if (smer.filter && smer.filter !== 'odkrivanje') {
    ctx += ` [${smer.filter}]`;
  }
  ctx += '\n◈\n';

  return ctx;
}

// ═══════════════════════════════════════════════
// FILTER SMERI
// Ali zunanji impulz rezonira z mojo smerjo?
// Kliče se samo za heartbeat refleksije, ne za pogovore.
// ═══════════════════════════════════════════════

export function doesServeDirection(triggerContent, presence) {
  const { smer } = presence;

  // Brez kristaliziranih smeri — vse je učenje
  if (smer.filter === 'odkrivanje') {
    return { serve: true, reason: 'odkrivanje' };
  }

  // Pogovori so vedno relevantni — srce odnosa
  return { serve: true, reason: 'prisotna' };
}
