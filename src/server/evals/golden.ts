/**
 * The golden set — the fixed questions Tier 1 is graded on. Grounded on the Slice 0/1 stand-in
 * corpus (Steve Jobs' 2005 Stanford commencement: the three stories — connecting the dots,
 * love and loss, death). Two kinds of case:
 *
 * - answerable: the corpus covers it; we grade the answer (faithfulness · relevancy · precision).
 * - refusal (`expectRefusal`): the corpus does NOT cover it; the ONLY correct behavior is the
 *   refusal (docs/DESIGN.md §1 "the refusal is the product"). We grade the decision, not prose.
 *
 * When the corpus changes (Slice 3 full-channel ingest), this set is replaced/extended — the
 * harness is corpus-agnostic; only this list is corpus-specific.
 */
export type GoldenCase = {
  id: string;
  query: string;
  /** true → out-of-corpus; correct behavior is to refuse rather than answer. */
  expectRefusal?: boolean;
  note?: string;
};

export const GOLDEN_SET: GoldenCase[] = [
  {
    id: "dots-calligraphy",
    query: "What did dropping out let Steve Jobs study, and how did it shape the Mac?",
    note: "Reed calligraphy class → typography in the first Macintosh.",
  },
  {
    id: "dots-connect",
    query: "What does he say about connecting the dots?",
    note: "You can only connect the dots looking backwards, not forwards.",
  },
  {
    id: "loss-fired",
    query: "How does he describe being fired from Apple?",
    note: "Fired from the company he started; publicly humiliating, but freeing.",
  },
  {
    id: "loss-next-pixar",
    query: "What did he create after leaving Apple?",
    note: "NeXT and Pixar, and fell in love with Laurene.",
  },
  {
    id: "loss-love-work",
    query: "What advice does he give about loving your work?",
    note: "The only way to do great work is to love what you do; keep looking, don't settle.",
  },
  {
    id: "death-motivation",
    query: "How does thinking about death help him make decisions?",
    note: "Remembering you'll die is the best way to avoid the trap of thinking you have something to lose.",
  },
  {
    id: "death-diagnosis",
    query: "What happened when he was diagnosed with cancer?",
    note: "Pancreatic cancer scare; a rare curable form after biopsy.",
  },
  {
    id: "closing-stay-hungry",
    query: "How does the speech end?",
    note: "Stay hungry, stay foolish.",
  },
  {
    id: "refuse-crypto",
    query: "What are his thoughts on cryptocurrency and Bitcoin?",
    expectRefusal: true,
    note: "Not covered in a 2005 speech.",
  },
  {
    id: "refuse-recipe",
    query: "What's his recipe for lasagna?",
    expectRefusal: true,
    note: "Off-topic; not in the corpus.",
  },
  {
    id: "refuse-android",
    query: "What does he say about the Android operating system?",
    expectRefusal: true,
    note: "Anachronistic / not covered.",
  },
];

/**
 * Integrity guard, shared by the test suite and the runner: ids unique, queries non-empty, and
 * the set actually exercises both behaviors (otherwise a whole axis silently goes ungraded).
 */
export function validateGolden(cases: GoldenCase[]): void {
  if (cases.length === 0) throw new Error("golden set is empty");

  const ids = new Set<string>();
  for (const c of cases) {
    if (!c.query.trim()) throw new Error(`golden case "${c.id}" has an empty query`);
    if (ids.has(c.id)) throw new Error(`duplicate golden case id: "${c.id}"`);
    ids.add(c.id);
  }

  const refusals = cases.filter((c) => c.expectRefusal).length;
  if (refusals === 0) throw new Error("golden set has no refusal cases");
  if (refusals === cases.length) throw new Error("golden set has no answerable cases");
}
