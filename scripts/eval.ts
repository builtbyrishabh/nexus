import "./_env";

import { runEvalSuite } from "~/server/evals/run";
import type { EvalSummary } from "~/server/evals/summary";

/**
 * Run the golden-set evals. Three modes:
 *   pnpm eval            → baseline retrieval (rerank off), gates via exit code
 *   pnpm eval --rerank   → rerank on, gates via exit code
 *   pnpm eval --compare  → run both and print the rerank lift (informational; always exits 0)
 *
 * The gate (nonzero exit on failure) is what makes "don't advance a tier until its evals pass"
 * enforceable in CI, not just aspirational.
 */

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function printSummary(label: string, s: EvalSummary): void {
  console.log(`\n${label}`);
  console.log(`  faithfulness      ${pct(s.means.faithfulness)}`);
  console.log(`  answer relevancy  ${pct(s.means.answerRelevancy)}`);
  console.log(`  context precision ${pct(s.means.contextPrecision)}`);
  console.log(`  refusal accuracy  ${pct(s.refusalAccuracy)}`);
  console.log(`  graded ${s.scored}/${s.total} · ${s.passed ? "PASS ✓" : `FAIL ✗ (${s.failures.join(", ")})`}`);
}

function printLift(off: EvalSummary, on: EvalSummary): void {
  const delta = (a: number, b: number) => {
    const d = b - a;
    return `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}pt`;
  };
  console.log(`\nrerank lift (on − off)`);
  console.log(`  faithfulness      ${delta(off.means.faithfulness, on.means.faithfulness)}`);
  console.log(`  answer relevancy  ${delta(off.means.answerRelevancy, on.means.answerRelevancy)}`);
  console.log(`  context precision ${delta(off.means.contextPrecision, on.means.contextPrecision)}`);
}

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has("--compare")) {
    console.log("Running golden set: rerank off vs on…");
    const [off, on] = await Promise.all([
      runEvalSuite({ rerank: false }),
      runEvalSuite({ rerank: true }),
    ]);
    printSummary("rerank OFF", off.summary);
    printSummary("rerank ON", on.summary);
    printLift(off.summary, on.summary);
    process.exit(0);
  }

  const rerank = args.has("--rerank");
  console.log(`Running golden set (rerank ${rerank ? "on" : "off"})…`);
  const { summary } = await runEvalSuite({ rerank });
  printSummary(rerank ? "rerank ON" : "baseline", summary);
  process.exit(summary.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
