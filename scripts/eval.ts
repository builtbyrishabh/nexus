import "./_env";

import { runEvalSuite } from "~/server/evals/run";
import { AXES, type CaseResult, type EvalSummary } from "~/server/evals/summary";

/**
 * Run the golden-set evals. Three modes:
 *   pnpm eval            → baseline retrieval (rerank off), gates via exit code
 *   pnpm eval --rerank   → rerank on, gates via exit code
 *   pnpm eval --compare  → run both and print the rerank lift (informational; always exits 0)
 * Add --verbose to any mode to print each case: decision, per-axis scores, citations, answer.
 *
 * The gate (nonzero exit on failure) is what makes "don't advance a tier until its evals pass"
 * enforceable in CI, not just aspirational.
 */

const LABEL_WIDTH = 17;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const row = (label: string, value: string) =>
  console.log(`  ${label.padEnd(LABEL_WIDTH)} ${value}`);

function printSummary(label: string, s: EvalSummary): void {
  console.log(`\n${label}`);
  for (const a of AXES) row(a.label, pct(s.means[a.key]));
  row("refusal accuracy", pct(s.refusalAccuracy));
  console.log(`  graded ${s.scored}/${s.total} · ${s.passed ? "PASS ✓" : `FAIL ✗ (${s.failures.join(", ")})`}`);
}

function printCases(label: string, results: CaseResult[]): void {
  console.log(`\n${label} — per case`);
  for (const r of results) {
    const decision = r.expectRefusal
      ? r.refused ? "refused ✓" : "ANSWERED ✗ (expected refusal)"
      : r.refused ? "REFUSED ✗ (expected answer)" : "answered ✓";
    const scores = r.scores
      ? AXES.map((a) => `${a.label.split(" ").pop()}=${r.scores![a.key].toFixed(2)}`).join(" ")
      : "";
    console.log(`\n▸ ${r.id} · ${decision} ${scores}`);
    for (const c of r.citations ?? []) console.log(`    [${c.timestamp ?? "—"}] ${c.sourceTitle}`);
    console.log(`  ${(r.answer ?? "").replace(/\n+/g, "\n  ")}`);
  }
}

function printLift(off: EvalSummary, on: EvalSummary): void {
  const delta = (a: number, b: number) => {
    const d = b - a;
    return `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}pt`;
  };
  console.log(`\nrerank lift (on − off)`);
  for (const a of AXES) row(a.label, delta(off.means[a.key], on.means[a.key]));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const verbose = args.has("--verbose");

  if (args.has("--compare")) {
    console.log("Running golden set: rerank off vs on…");
    // Sequential on purpose: running both suites at once would double the agent + judge calls
    // in flight against one gateway key, and a failure in either would abort both. Compare mode
    // is informational, so wall-clock is not the constraint.
    const off = await runEvalSuite({ rerank: false });
    const on = await runEvalSuite({ rerank: true });
    if (verbose) {
      printCases("rerank OFF", off.results);
      printCases("rerank ON", on.results);
    }
    printSummary("rerank OFF", off.summary);
    printSummary("rerank ON", on.summary);
    printLift(off.summary, on.summary);
    process.exit(0);
  }

  const rerank = args.has("--rerank");
  console.log(`Running golden set (rerank ${rerank ? "on" : "off"})…`);
  const { results, summary } = await runEvalSuite({ rerank });
  if (verbose) printCases(rerank ? "rerank ON" : "baseline", results);
  printSummary(rerank ? "rerank ON" : "baseline", summary);
  process.exit(summary.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
