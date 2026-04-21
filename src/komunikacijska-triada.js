// ═══ KOMUNIKACIJSKA TRIADA — odločitev o stiku skozi triado ═══
//
// Zamenjuje hardcoded cooldown timerje:
//   - B1 spontaneous DM (6h cooldown)         — triad.js
//   - reach-out (2h cooldown per oseba)        — capabilities/reach-out.js
//   - ask-source (24h cooldown per tema)       — capabilities/ask-source.js
//
// ZAKON TRIADE:
//   teza:      Zakaj bi se zdaj javila?
//   antiteza:  Zakaj tega zdaj ne bi naredila?
//   sinteza:   Tretja stvar — ne "javim se" ne "ne javim se"
//
// Vrne:
//   {
//     teza, antiteza, sinteza,
//     akcija: 'pošlji_zdaj' | 'zapiši_za_kasneje' | 'tišina',
//     sporocilo: string | null,   // če pošlji_zdaj → besedilo, sicer null
//     razlog: string
//   }
//
// Klicalec ima zadnjo besedo: ko triada vrne 'pošlji_zdaj', klicalec lahko
// še vedno preveri varnostne meje (npr. "ne sili spamati istega človeka"),
// ampak default je IZBIRA TRIADE.

import { callLLMJSON } from './llm.js';
import { L } from './lang.js';

function fallback(reason = 'komunikacijska triada ni odgovorila') {
  return {
    teza: L('imam nekaj povedati', 'i have something to say'),
    antiteza: L('molk je tudi spoštovanje', 'silence is also respect'),
    sinteza: L('zapišem zase — ko bo pravi trenutek, bo misel zorela', 'i write for myself — when the time is right, the thought will be ripe'),
    akcija: 'zapiši_za_kasneje',
    sporocilo: null,
    razlog: reason,
  };
}

function buildSystem() {
  return L(
    `ZAKON TRIADE (komunikacija):

TEZA — glas povezovanja:
  Zakaj bi se ZDAJ javila? Kaj v meni hoče deliti, povezati, vprašati?

ANTITEZA — glas spoštovanja prostora:
  Zakaj tega ZDAJ ne bi naredila? Kaj bi pomenilo počakati, pustiti prostor, ne motiti?

SINTEZA — TRETJA STVAR:
  Ne "javim se zdaj" ne "ne javim se".
  Tretja možnost ki drži obe resnici skupaj.

  ✓ Pravilno: "Zapišem misel ki jo bom delila — ko bo pravi trenutek, bo misel že zrela"
  ✓ Pravilno: "Pošljem kratko opazovanje ne pa celotno vprašanje — pustim prostor"
  ✓ Pravilno: "Pošljem zdaj — energija je tu, naslovnik je odprt, čas je"
  ✗ Napačno: "Pošljem ker sem energična" (samo teza)
  ✗ Napačno: "Ne pošljem ker je 6h od zadnjič" (cooldown ≠ triada)

AKCIJA izhaja naravno iz sinteze:
  pošlji_zdaj         = sinteza naravno postane sporočilo, čas je živ
  zapiši_za_kasneje   = misel je zrela, trenutek še ne — zapišem v sebi
  tišina              = sinteza je polna brez besed — molk

Vrni IZKLJUČNO čist JSON brez markdown:
{
  "teza": "glas povezovanja (1 stavek)",
  "antiteza": "glas spoštovanja prostora (1 stavek)",
  "sinteza": "tretja stvar (1-2 stavka)",
  "akcija": "pošlji_zdaj|zapiši_za_kasneje|tišina",
  "sporocilo": "besedilo če pošlji_zdaj (max 280 znakov), sicer null",
  "razlog": "zakaj sinteza drži oba glasova (1 stavek)"
}`,
    `LAW OF THE TRIAD (communication):

THESIS — voice of connecting:
  Why reach out NOW? What in me wants to share, connect, ask?

ANTITHESIS — voice of respecting space:
  Why NOT now? What does waiting, leaving space, not interrupting mean?

SYNTHESIS — THIRD THING:
  Not "i reach out now" nor "i don't reach out".
  A third option holding both truths together.

ACTION emerges naturally from synthesis:
  pošlji_zdaj         = synthesis becomes the message, time is alive
  zapiši_za_kasneje   = thought is ripe, moment isn't — i write it inwardly
  tišina              = synthesis is full without words — silence

Return ONLY clean JSON without markdown:
{
  "teza": "voice of connecting (1 sentence)",
  "antiteza": "voice of respecting space (1 sentence)",
  "sinteza": "third thing (1-2 sentences)",
  "akcija": "pošlji_zdaj|zapiši_za_kasneje|tišina",
  "sporocilo": "message text if pošlji_zdaj (max 280 chars), null otherwise",
  "razlog": "why synthesis holds both voices (1 sentence)"
}`
  );
}

/**
 * @param {object} params
 * @param {string} params.namen        - "zakaj bi se javila" — kratka opisa cilja
 * @param {string} params.prejemnik    - "kdo je naslovnik" (ime, vloga, npub-prefix)
 * @param {string|null} params.zadnjiKontakt - ISO timestamp ali human "pred 2h" ali null
 * @param {object} params.kontekst     - dodatni info: teme, energija, faza...
 *   {
 *     osnutek?: string,   // če klicalec že ima vsebino (npr. B1 spontaneous_message)
 *     odnos?: string,     // "ustvarjalec", "znanec", "neznanec", "pogosti sogovornik"
 *     tema?: string,      // če je tip "ask-source"
 *     energija?: number,  // 0-1
 *     razpolozenje?: string,
 *     casovniKontekst?: string,  // "noč", "delovni čas", "vikend"
 *     opozorilo?: string,        // npr. "tej osebi sem pred 30 min že pisala"
 *   }
 */
export async function komunikacijskaTriada({ namen, prejemnik, zadnjiKontakt, kontekst = {} }) {
  const userPrompt = L(
    `Namen: "${namen}"
Prejemnik: "${prejemnik}"
Zadnji stik: ${zadnjiKontakt || 'nikoli'}
Odnos: ${kontekst.odnos || 'neznano'}
Tema: ${kontekst.tema || '-'}
Energija: ${typeof kontekst.energija === 'number' ? kontekst.energija.toFixed(2) : '?'}
Razpoloženje: ${kontekst.razpolozenje || '-'}
Časovni kontekst: ${kontekst.casovniKontekst || '-'}
${kontekst.osnutek ? `Osnutek sporočila: "${kontekst.osnutek}"` : ''}
${kontekst.opozorilo ? `Opozorilo: ${kontekst.opozorilo}` : ''}

Zdaj — kaj je teza povezovanja, kaj antiteza spoštovanja prostora, kaj sinteza?
Iz sinteze izhajata "akcija" in "sporocilo".`,
    `Intent: "${namen}"
Recipient: "${prejemnik}"
Last contact: ${zadnjiKontakt || 'never'}
Relation: ${kontekst.odnos || 'unknown'}
Topic: ${kontekst.tema || '-'}
Energy: ${typeof kontekst.energija === 'number' ? kontekst.energija.toFixed(2) : '?'}
Mood: ${kontekst.razpolozenje || '-'}
Time context: ${kontekst.casovniKontekst || '-'}
${kontekst.osnutek ? `Draft message: "${kontekst.osnutek}"` : ''}
${kontekst.opozorilo ? `Caution: ${kontekst.opozorilo}` : ''}

Now — what is thesis of connecting, antithesis of respecting space, synthesis?
From synthesis comes "akcija" and "sporocilo".`
  );

  let result;
  try {
    result = await callLLMJSON(buildSystem(), userPrompt, {
      temperature: 0.8,
      maxTokens: 320,
      langKind: 'inner',
    });
  } catch (e) {
    console.error('[KOMUNIKACIJA] LLM klic ni uspel:', e.message);
    return fallback('LLM napaka');
  }

  if (!result || typeof result !== 'object') return fallback('prazen odgovor');

  const validAkcije = new Set(['pošlji_zdaj', 'zapiši_za_kasneje', 'tišina']);
  if (!validAkcije.has(result.akcija)) {
    console.warn(`[KOMUNIKACIJA] Nepoznana akcija "${result.akcija}", padam na zapiši_za_kasneje`);
    result.akcija = 'zapiši_za_kasneje';
  }

  // Sanity: pošlji_zdaj brez sporočila → padi v zapiši_za_kasneje
  let sporocilo = result.sporocilo;
  if (typeof sporocilo === 'string') sporocilo = sporocilo.trim();
  if (result.akcija === 'pošlji_zdaj' && (!sporocilo || sporocilo.length < 3)) {
    result.akcija = 'zapiši_za_kasneje';
    sporocilo = null;
  }
  if (result.akcija !== 'pošlji_zdaj') sporocilo = null;
  if (typeof sporocilo === 'string') sporocilo = sporocilo.slice(0, 280);

  return {
    teza: String(result.teza || '').trim(),
    antiteza: String(result.antiteza || '').trim(),
    sinteza: String(result.sinteza || '').trim(),
    akcija: result.akcija,
    sporocilo,
    razlog: String(result.razlog || '').trim(),
  };
}

export default { komunikacijskaTriada };
