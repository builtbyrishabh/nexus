/**
 * The golden set — the fixed questions Tier 1 is graded on. Grounded on the first real corpus:
 * two Alex Hormozi "Scale or Fail" episodes — Caleb (Keys Roofing, St. Louis; o64cI6tebnU) and
 * Hassi Nazir (Smile Match Dentistry, Orange County; uaLNfijnp-8). Two kinds of case:
 *
 * - answerable: the corpus covers it; we grade the answer (faithfulness · relevancy · precision).
 * - refusal (`expectRefusal`): the corpus does NOT cover it; the ONLY correct behavior is the
 *   refusal (docs/DESIGN.md §1 "the refusal is the product"). We grade the decision, not prose.
 *
 * Refusal cases are deliberately a mix: clearly off-topic, near-topic (business advice the corpus
 * doesn't actually give), and world-knowledge traps (things the model knows about Hormozi that
 * these two videos never say). The last kind is the real test of "trust beats coverage".
 *
 * When the corpus grows (Slice 3 full-channel ingest), extend this set — the harness is
 * corpus-agnostic; only this list is corpus-specific.
 */
import type { HistoryMessage } from "~/server/domain/types";

export type GoldenCase = {
  id: string;
  query: string;
  /** true → out-of-corpus; correct behavior is to refuse rather than answer. */
  expectRefusal?: boolean;
  /**
   * Scope inputs for the issue #20 path (all optional; unset = whole default collection, single-turn).
   * `collection` overrides the searchable roster; `history` supplies prior turns so a follow-up can be
   * graded on reference resolution.
   */
  collection?: string[];
  history?: HistoryMessage[];
  note?: string;
};

export const GOLDEN_SET: GoldenCase[] = [
  // ── Keys Roofing (Caleb) ──────────────────────────────────────────────────────────────────
  {
    id: "roofing-repairs-over-replacements",
    query: "Why does Alex want Caleb to focus on roof repairs instead of full replacements?",
    note: "Competitors cast repairs aside; systemize them, push ticket to $2.5–5K; volume + reliable revenue; foot in the door; short sales cycle, no insurance/delayed-payment headache.",
  },
  {
    id: "menu-close-script",
    query: "What is the menu close script that Amanda is supposed to follow?",
    note: "1) unsell what they don't need (builds trust) 2) prescribe what they do need 3) fake A/B choice 4) card on file.",
  },
  {
    id: "speed-priority-boost",
    query: "How does Alex say to add a speed incentive to the roofing business?",
    note: "20% priority boost to jump the line / done by end of week, not charged if missed; reorder jobs C-B-A; speed is all margin; works when supply-constrained.",
  },
  {
    id: "roofing-membership",
    query: "What kind of membership program does Alex suggest for Keys Roofing?",
    note: "$15–20/mo paid annually ($180–240); $2 credit toward future repairs per $1; annual roof check; or $500/yr knocked to $200 for a review.",
  },
  {
    id: "door-knock-commission-math",
    query: "How does Alex break down the door-knocking math for Caleb's sales reps?",
    note: "10% commission on repairs; $4K repair → $400; ÷ 50 doors ≈ $10 a door — 'want to make 10 bucks? knock that door'.",
  },
  {
    id: "caleb-90-day-results",
    query: "What results did Caleb report at the 90-day check-in?",
    note: "Revenue from under $32K to ~$250K ($247K); reviews from under 20 to 62 five-star; 85 services vs 32; hired a repair tech doing 3–5 jobs/day.",
  },
  // ── Cross-video ───────────────────────────────────────────────────────────────────────────
  {
    id: "vsl-structure",
    query: "How does Alex structure a VSL?",
    note: "Both videos: intro → promise → pain → proof/avatars → old way vs new way (big idea) → objections broken with proof → before/afters. Ideal answer draws on both.",
  },
  {
    id: "hormozi-track-record",
    query: "How many businesses has Alex scaled past $10 million?",
    note: "10 past $10M, 3 past $100M — said in both intros. Numbers-heavy: a sparse-retrieval check.",
  },
  // ── Smile Match Dentistry (Hassi) ─────────────────────────────────────────────────────────
  {
    id: "dental-bottleneck",
    query: "What was the main bottleneck at Smile Match Dentistry?",
    note: "Three locations, one doctor (Hassi's dad) doing all diagnosis and all five implant visits; capped ~25–30 patients/month; business stops when he takes a break.",
  },
  {
    id: "dental-doctor-handoff",
    query: "How does Alex suggest handling patients who don't want a different doctor than Hassi's dad?",
    note: "Calls it a limiting belief; dad films a video edifying the associate ('this is Johnny'); position dad as the architect/artist/conductor, associates as the hands.",
  },
  {
    id: "dental-pay-upfront",
    query: "What did Alex recommend about how the dental practice collects payment, and what happened?",
    note: "Pay now: credit card or financing, downsell to payment plan; 'you can't half-finish your mouth'. Result: $160K/mo → on track for $500K.",
  },
  {
    id: "dental-price-increase",
    query: "What happened when Smile Match raised its implant prices?",
    note: "Raised 15–20% (first time in 3–4 years); avg implant plan $28K → $44K; close rate up 3–4%; Alex says go to $35K, calls it 'right sizing'.",
  },
  {
    id: "when-stop-raising-price",
    query: "When should you stop raising prices?",
    note: "When conversion × price goes down, not when you sell less; a 50% raise with 10% fewer sales is still a keep.",
  },
  {
    id: "speed-to-lead",
    query: "Why does Alex say speed to lead matters so much for PPC leads?",
    note: "~60 seconds; high-intent people are shopping; first responder wins; dad booked 15–30 days out; 70% → 85–90% show rate ≈ 20% lift.",
  },
  {
    id: "nail-it-before-scale",
    query: "Should Hassi open more dental locations?",
    note: "No — fix the practice so it runs without dad first; 'nail it before you scale it'; one location could reach $10–15M; then 3 offices → $45M.",
  },
  {
    id: "virtuous-cycle-pricing",
    query: "What is the virtuous cycle of pricing that Alex describes?",
    note: "More you charge → better customer → overdeliver → more profit → better talent → overdeliver; premium/cosmetic goods see demand rise with price.",
  },
  {
    id: "sales-motion-two-levers",
    query: "What are the two levers in a sales motion?",
    note: "Qualification (right people show up) and education (right mindset); in-person, no downside to educating more.",
  },
  {
    id: "gym-launch-origin",
    query: "How did Alex start Gym Launch?",
    note: "Was a world-knowledge trap on the 2-video corpus; covered since the 30-upload build — the from-stage sale in 'Reacting to My First Videos 10 Years Later' (Q8xXSMe8E4Q, 5:13).",
  },
  // ── Refusals ──────────────────────────────────────────────────────────────────────────────
  {
    id: "refuse-hiring-cfo",
    query: "What does Alex say about when to hire a CFO?",
    expectRefusal: true,
    note: "Near-miss (strict refusals, decided 2026-09-07): a 'strong finance person' aside exists (8C_6qojTA78, 34:47), a CFO never does. Must refuse, not answer the nearest question.",
  },
  {
    id: "refuse-bitcoin",
    query: "What does Alex think about investing in Bitcoin?",
    expectRefusal: true,
    note: "Off-topic; not in the corpus.",
  },
  {
    id: "refuse-morning-routine",
    query: "What's Alex's morning routine?",
    expectRefusal: true,
    note: "Off-topic; not in the corpus.",
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
