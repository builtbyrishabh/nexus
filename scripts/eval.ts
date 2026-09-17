import "./_env";

import { env } from "~/env";
import { runEvalSuite } from "~/server/evals/run";
import { AXES, type CaseResult, type EvalSummary } from "~/server/evals/summary";

const LABEL_WIDTH = 17;
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const row = (label: string, value: string) =>
  console.log(`  ${label.padEnd(LABEL_WIDTH)} ${value}`);

function printSummary(summary: EvalSummary): void {
  for (const axis of AXES) row(axis.label, pct(summary.means[axis.key]));
  row("refusal accuracy", pct(summary.refusalAccuracy));
  row("citation accuracy", pct(summary.citationAccuracy));
  console.log(
    `  graded ${summary.scored}/${summary.total} · ${summary.passed ? "PASS ✓" : `FAIL ✗ (${summary.failures.join(", ")})`}`,
  );
}

function printCases(results: CaseResult[]): void {
  for (const result of results) {
    const decision = result.expectRefusal
      ? result.refused
        ? "refused ✓"
        : "ANSWERED ✗ (expected refusal)"
      : result.refused
        ? "REFUSED ✗ (expected answer)"
        : "answered ✓";
    const scores = result.scores
      ? AXES.map(
          (axis) =>
            `${axis.label.split(" ").pop()}=${result.scores![axis.key].toFixed(2)}`,
        ).join(" ")
      : "";
    console.log(`\n▸ ${result.id} · ${decision} ${scores}`);
    for (const citation of result.citations ?? []) {
      console.log(`    [${citation.timestamp ?? "—"}] ${citation.title}`);
    }
    console.log(`  ${(result.answer ?? "").replace(/\n+/g, "\n  ")}`);
  }
}

async function main() {
  if (!env.EVAL_USER_ID) {
    throw new Error("EVAL_USER_ID is not set");
  }
  const verbose = process.argv.slice(2).includes("--verbose");
  console.log("Running golden set…");
  const { results, summary } = await runEvalSuite({
    userId: env.EVAL_USER_ID,
  });
  if (verbose) printCases(results);
  printSummary(summary);
  process.exit(summary.passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
