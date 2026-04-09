// ═══ SPOSOBNOST: write-knowledge ═══
// Zapiše spoznanje v zunanji spomin (knowledge/ datoteke).
// Trajna zunanja memorija izven sinaptičnega razpada.

export default {
  name: 'write-knowledge',
  description: 'Zapišem spoznanje o osebi, temi ali sebi v trajen zunanji spomin',
  when: 'Ko se naučiš kaj vrednega o osebi, temi ali sebi kar bi rada ohranila — izven normalnega sinaptičnega razpada',
  conversationAllowed: true,
  heartbeatAllowed: true,
  blocking: false,

  async execute(params, context) {
    const { memory, KNOWLEDGE_DIR, fs, path } = context;
    const { roke_target, roke_concept } = params;
    if (!roke_target || !roke_concept) return { outcome: 'skipped', detail: 'manjka target ali concept' };

    const safeTarget = roke_target.replace(/\.md$/, '').replace(/\.\./g, '').replace(/^\//, '');
    const knowledgeFile = path.join(KNOWLEDGE_DIR, safeTarget + '.md');
    if (!knowledgeFile.startsWith(KNOWLEDGE_DIR)) throw new Error('Invalid knowledge target path');

    fs.mkdirSync(path.dirname(knowledgeFile), { recursive: true });
    const timestamp = new Date().toISOString().slice(0, 16);
    const entry = `\n\n## Spoznanje (${timestamp})\n${roke_concept.trim()}`;
    fs.appendFileSync(knowledgeFile, entry, 'utf8');

    memory.addObservation(`Zapisala sem v zunanji spomin: ${safeTarget}`, 'roke_write_knowledge');
    console.log(`[ROKE] write-knowledge: → ${safeTarget}.md`);
    return { outcome: 'success', detail: `Zapisano v ${safeTarget}.md` };
  }
};
