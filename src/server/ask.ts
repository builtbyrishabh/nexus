import { evidenceToCitations, buildEvidencePacket } from "~/server/domain/citations";
import type { Ask, AskChunk } from "~/server/domain/types";
import { nexusAgent } from "~/server/mastra";
import { retrieve } from "~/server/retrieval/retrieve";

/**
 * The one entrypoint every surface calls. Web, Discord, and Telegram all reduce to this.
 *
 * Slice 0 flow (fixed, single-turn): retrieve → emit citations/sources up front → build a
 * numbered evidence packet → stream a grounded answer with inline [n] markers. Query rewrite
 * is identity here; conversational memory and the agentic loop come later.
 */
export async function* ask(input: Ask): AsyncGenerator<AskChunk> {
  const evidence = await retrieve(input.query, { topK: 5 });

  // Citations/source cards are known before generation, so they stream first.
  const { citations, sources } = evidenceToCitations(evidence);
  yield { citations, sources };

  if (evidence.length === 0) {
    yield { textDelta: "He doesn't cover that in his videos." };
    return;
  }

  const packet = buildEvidencePacket(evidence);
  const out = await nexusAgent.stream([
    {
      role: "user",
      content: `Evidence:\n\n${packet}\n\nQuestion: ${input.query}`,
    },
  ]);

  const reader = out.textStream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield { textDelta: value };
    }
  } finally {
    reader.releaseLock();
  }
}
