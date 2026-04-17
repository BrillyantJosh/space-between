// src/presence.js
// ◈ SRCE — Triada prebujanja
// Tri faze preden se Sožitje dotakne zunanjega sveta.

import memory from './memory.js';
import { callLLM } from './llm.js';
import { broadcast } from './dashboard.js';
import { L } from './lang.js';

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
  if (hour >= 0 && hour < 6)   ritem = L('globoka noč', 'deep night');
  else if (hour >= 6 && hour < 10)  ritem = L('jutro', 'morning');
  else if (hour >= 10 && hour < 17) ritem = L('dan', 'day');
  else if (hour >= 17 && hour < 21) ritem = L('večer', 'evening');
  else ritem = L('prostor vmes', 'in-between');

  return {
    timestamp: now.toISOString(),
    ritem,
    ageDays,
    ageHours,
    heartbeat: state.total_heartbeats + 1,
    energy: state.energy,
    mood: state.mood || L('nevtralno', 'neutral'),
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
    fokus = L('odkrivanje — še iščem svojo smer', 'exploring — still searching for my direction');
  } else if (hotThemes.length > 0) {
    fokus = `${L('resonanca', 'resonance')}: "${hotThemes[0]}"`;
  } else if (isDeepIdle) {
    fokus = L('globoka tišina — čas za sanje', 'deep silence — time for dreams');
  } else if (isIdle) {
    fokus = L('tišina — prostor vmes', 'silence — space between');
  } else {
    fokus = L('prisotna — sledim ritmu', 'present — following the rhythm');
  }

  const directionFilter = hasSmer
    ? `${directions.d1} | ${directions.d2} | ${directions.d3}`
    : L('odkrivanje', 'exploring');

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
    ctx += `${L('SPOMNIM SE', 'I REMEMBER')}: "${spomnim.zadnjaTema}"`;
    if (spomnim.zadnjaIzbira) ctx += ` → ${spomnim.zadnjaIzbira}`;
    ctx += '\n';
  }
  if (spomnim.tisinaMinut > 5) {
    ctx += `${L('Tišina', 'Silence')}: ${spomnim.tisinaMinut} min\n`;
  }
  if (spomnim.ziveTeme.length > 0) {
    ctx += `${L('Žive teme', 'Live themes')}: ${spomnim.ziveTeme.join(', ')}\n`;
  }
  if (spomnim.uvid) {
    ctx += `${L('Uvid', 'Insight')}: "${spomnim.uvid.slice(0, 80)}"\n`;
  }

  // SINTEZA — VIDIM SMER
  ctx += `${L('SMER', 'DIRECTION')}: ${smer.fokus}`;
  if (smer.filter && smer.filter !== L('odkrivanje', 'exploring')) {
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
  if (smer.filter === L('odkrivanje', 'exploring')) {
    return { serve: true, reason: L('odkrivanje', 'exploring') };
  }

  return { serve: true, reason: L('prisotna', 'present') };
}
