import { useEffect, useState } from "react";
import type { BenchmarkComparisonResult, PlanVersion } from "@setfluence/shared";
import { runBenchmark } from "../api.ts";
import { formatCategoryLabel, formatSourceLabel } from "../utils/formatters.ts";

export interface BenchmarkComparisonProps {
  plan: PlanVersion;
  onInspectStage: (stageId: string) => void;
}

export function BenchmarkComparison({
  plan,
  onInspectStage,
}: BenchmarkComparisonProps) {
  const [benchmark, setBenchmark] = useState<BenchmarkComparisonResult | null>(
    null,
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadBenchmark() {
      setLoading(true);
      setError(null);
      try {
        const result = await runBenchmark(plan);
        if (!cancelled) {
          setBenchmark(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to run controlled benchmark comparison.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadBenchmark();
    return () => {
      cancelled = true;
    };
  }, [plan]);

  return (
    <section
      className="benchmark-panel"
      aria-label="Controlled LLM vs. Qloo Grounding Benchmark"
    >
      <div className="matrix-panel-header">
        <div>
          <span className="eyebrow">
            Phase 6 · Controlled Grounding Benchmark (Condition A vs. Condition B)
          </span>
          <h3>
            Ungrounded LLM Baseline vs. SetFluence + Qloo Cultural AI (Plan v
            {plan.versionNumber})
          </h3>
        </div>
        <span className="pastel-badge badge-lavender">
          Identical Solver & Constraints
        </span>
      </div>

      <div className="callout-highlight-banner">
        <strong>Fair Experimental Design:</strong> Both{" "}
        <strong>Condition A (Ungrounded LLM)</strong> and{" "}
        <strong>Condition B (SetFluence + Qloo)</strong> receive the exact same{" "}
        <strong>{plan.briefSnapshot.name}</strong> brief, candidate pool, and{" "}
        <strong>deterministic Phase 2 constraint solver</strong>. Constraint
        compliance is credited strictly to the solver; differences below isolate
        the impact of empirical Qloo artist-to-brand affinity and cultural tag
        grounding.
      </div>

      {loading && (
        <div className="surface-card">
          <p className="muted-text">
            Running controlled Condition A (Ungrounded LLM + Solver) against
            Condition B (Qloo-Grounded SetFluence)...
          </p>
        </div>
      )}

      {error && (
        <div className="alert-box alert-error" role="alert">
          <strong>Benchmark Error:</strong> {error}
        </div>
      )}

      {benchmark && !loading && (
        <>
          {/* 4 Summary KPI Cards */}
          <div className="benchmark-kpi-grid">
            <div className="benchmark-kpi-card">
              <span className="small-caps-label">
                CLAIM-TO-SOURCE TRACEABILITY
              </span>
              <div className="benchmark-kpi-duel">
                <strong className="kpi-qloo-val">
                  {benchmark.metrics.qlooTraceableClaimsPct}% Qloo
                </strong>
                <span className="kpi-vs">vs.</span>
                <span className="kpi-ungrounded-val">
                  {benchmark.metrics.ungroundedTraceableClaimsPct}% LLM
                </span>
              </div>
              <small>
                Every SetFluence score & tag links to a retrieved Qloo evidence
                ID
              </small>
            </div>

            <div className="benchmark-kpi-card">
              <span className="small-caps-label">
                STAGE WINNER AGREEMENT / SHIFT
              </span>
              <div className="benchmark-kpi-duel">
                <strong className="kpi-primary-val">
                  {benchmark.metrics.totalStages -
                    benchmark.metrics.stageWinnerAgreementCount}
                  /{benchmark.metrics.totalStages} Stages Shifted
                </strong>
              </div>
              <small>
                {benchmark.metrics.stageWinnerAgreementCount} stage(s) agreed ·{" "}
                {benchmark.metrics.totalStages -
                  benchmark.metrics.stageWinnerAgreementCount}{" "}
                overturned by Qloo artist data
              </small>
            </div>

            <div className="benchmark-kpi-card">
              <span className="small-caps-label">
                TOP-3 SHORTLIST CONCORDANCE
              </span>
              <div className="benchmark-kpi-duel">
                <strong className="kpi-primary-val">
                  {benchmark.metrics.meanRankOverlapPct}% Overlap
                </strong>
              </div>
              <small>
                +{benchmark.metrics.qlooStageSpecificDiscoveriesCount} stage-specific
                brands discovered via Qloo
              </small>
            </div>

            <div className="benchmark-kpi-card">
              <span className="small-caps-label">
                SOLVER CONSTRAINT VIOLATIONS
              </span>
              <div className="benchmark-kpi-duel">
                <strong className="kpi-qloo-val">
                  {benchmark.metrics.solverConstraintViolationsBoth} in Both
                </strong>
              </div>
              <small>
                Both conditions use our deterministic Phase 2 constraint solver
              </small>
            </div>
          </div>

          {/* Stage-by-Stage Side-by-Side Comparison Cards */}
          <div className="benchmark-stages-list">
            {benchmark.stageComparisons.map((sc, idx) => (
              <div key={sc.stageId} className="surface-card benchmark-stage-card">
                <div className="duel-card-header">
                  <div>
                    <span className="small-caps-label">
                      STAGE {idx + 1} · {sc.genreLabel.toUpperCase()} ·{" "}
                      {sc.artists.join(", ")}
                    </span>
                    <h3>{sc.stageName}</h3>
                  </div>
                  <div className="benchmark-header-actions">
                    <span
                      className={`pastel-badge ${sc.agreedOnWinner ? "badge-sky" : "badge-lavender"}`}
                    >
                      {sc.agreedOnWinner
                        ? "AGREED ON STAGE WINNER"
                        : "DIVERGED — QLOO ARTIST SIGNAL OVERRIDE"}
                    </span>
                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      onClick={() => onInspectStage(sc.stageId)}
                    >
                      Inspect Stage Proof
                    </button>
                  </div>
                </div>

                <div className="benchmark-condition-columns">
                  {/* Condition A: Ungrounded LLM */}
                  <div className="benchmark-condition-box condition-a">
                    <div className="condition-box-header">
                      <span className="pastel-badge badge-neutral">
                        CONDITION A · UNGROUNDED LLM + SOLVER
                      </span>
                      <span className="mono-tag">0 Evidence Records</span>
                    </div>

                    <div className="condition-winner-row">
                      <div>
                        <strong>
                          {sc.ungroundedWinner
                            ? sc.ungroundedWinner.name
                            : "Unfilled"}
                        </strong>
                        {sc.ungroundedWinner && (
                          <span className="condition-cat">
                            {formatCategoryLabel(sc.ungroundedWinner.category)}
                          </span>
                        )}
                      </div>
                      <span className="condition-fit-pill">
                        {sc.ungroundedFitScore !== null
                          ? `${sc.ungroundedFitScore.toFixed(3)} Est.`
                          : "—"}
                      </span>
                    </div>

                    <p className="condition-rationale">
                      {sc.ungroundedRationale}
                    </p>

                    <div className="condition-footer-meta">
                      <span>
                        Standby:{" "}
                        <strong>
                          {sc.ungroundedStandby
                            ? sc.ungroundedStandby.name
                            : "None"}
                        </strong>
                      </span>
                      <span>Source: Parametric Genre Prior</span>
                    </div>
                  </div>

                  {/* Condition B: SetFluence + Qloo */}
                  <div className="benchmark-condition-box condition-b">
                    <div className="condition-box-header">
                      <span className="pastel-badge badge-mint">
                        CONDITION B · SETFLUENCE + QLOO AI + SOLVER
                      </span>
                      <span className="mono-tag">
                        {sc.qlooEvidenceCount} Qloo Signals
                      </span>
                    </div>

                    <div className="condition-winner-row">
                      <div>
                        <strong>
                          {sc.qlooWinner ? sc.qlooWinner.name : "Unfilled"}
                        </strong>
                        {sc.qlooWinner && (
                          <span className="condition-cat">
                            {formatCategoryLabel(sc.qlooWinner.category)} ·{" "}
                            {formatSourceLabel(sc.qlooWinner.source)}
                          </span>
                        )}
                      </div>
                      <span className="condition-fit-pill qloo">
                        {sc.qlooFitScore !== null
                          ? `${sc.qlooFitScore.toFixed(3)} Fit`
                          : "—"}
                      </span>
                    </div>

                    <p className="condition-rationale">
                      {sc.qlooKeySignalSummary}
                    </p>

                    <div className="condition-footer-meta">
                      <span>
                        Standby:{" "}
                        <strong>
                          {sc.qlooStandby ? sc.qlooStandby.name : "None"}
                        </strong>
                      </span>
                      <span>
                        Top-3 Rank Overlap: {sc.top3OverlapCount}/3 Brands
                      </span>
                    </div>
                  </div>
                </div>

                <div className="benchmark-verdict-bar">
                  <strong>Why It Matters:</strong> {sc.divergenceExplanation}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
