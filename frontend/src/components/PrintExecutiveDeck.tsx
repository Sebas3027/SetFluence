import type { PlanVersion } from "@setfluence/shared";
import {
  formatCategoryLabel,
  formatSourceLabel,
  formatStageTierLabel,
  resolveFanActivityOptions,
} from "../utils/formatters.ts";

export interface PrintExecutiveDeckProps {
  plan: PlanVersion;
  normalizeFit: (score: number | null | undefined) => number | null;
}

export function PrintExecutiveDeck({
  plan,
  normalizeFit,
}: PrintExecutiveDeckProps) {
  return (
    <section
      className="print-only-executive-deck"
      aria-label="Printable 3-Stage Executive Sponsorship Deck"
    >
      {/* Deck Header / Executive Summary */}
      <header className="print-deck-header">
        <div className="print-deck-brand-row">
          <div className="print-logo-box">
            <svg
              width="36"
              height="36"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect width="32" height="32" rx="8" fill="#18181B" />
              <rect
                x="6"
                y="7"
                width="11"
                height="11"
                rx="3.5"
                fill="#A7F3D0"
                fillOpacity="0.9"
              />
              <rect
                x="15"
                y="7"
                width="11"
                height="11"
                rx="3.5"
                fill="#BAE6FD"
                fillOpacity="0.9"
              />
              <rect
                x="10.5"
                y="14"
                width="11"
                height="11"
                rx="3.5"
                fill="#DDD6FE"
                fillOpacity="0.94"
              />
              <circle cx="16" cy="15.5" r="2.2" fill="#18181B" />
            </svg>
            <div>
              <strong>SetFluence Sponsorship Studio</strong>
              <span>Qloo Cultural AI + Deterministic Constraint Solver</span>
            </div>
          </div>
          <div className="print-deck-meta">
            <strong>Plan v{plan.versionNumber}</strong>
            <span>{plan.briefSnapshot.location}</span>
          </div>
        </div>

        <h1>
          {plan.briefSnapshot.name} — 3-Stage Executive Partnership Deck
        </h1>
        <p className="print-deck-summary">{plan.agentSummary}</p>

        {/* Cross-Stage Allocation Overview Table */}
        <table className="print-summary-table">
          <thead>
            <tr>
              <th>Stage & Capacity Tier</th>
              <th>Lineup & Genre</th>
              <th>Recommended Partner</th>
              <th>Stage Fit Score</th>
              <th>Standby Backup</th>
            </tr>
          </thead>
          <tbody>
            {plan.briefSnapshot.stages.map((st) => {
              const alloc = plan.allocations.find((a) => a.stageId === st.id);
              const fit = normalizeFit(alloc?.relativeFitScore ?? null);
              return (
                <tr key={st.id}>
                  <td>
                    <strong>{st.name}</strong>
                    <br />
                    <small>
                      {formatStageTierLabel(
                        st.activationFormat?.stageTier,
                        st.id,
                      )}
                    </small>
                  </td>
                  <td>
                    <strong>{st.genreLabel}</strong>
                    <br />
                    <small>{st.artists.join(", ")}</small>
                  </td>
                  <td>
                    {alloc?.primarySponsor ? (
                      <>
                        <strong>{alloc.primarySponsor.name}</strong>
                        <br />
                        <small>
                          {formatCategoryLabel(alloc.primarySponsor.category)} ·{" "}
                          {formatSourceLabel(alloc.primarySponsor.source)}
                        </small>
                      </>
                    ) : (
                      <strong>UNFILLED</strong>
                    )}
                  </td>
                  <td>
                    <strong>
                      {fit !== null ? `${fit.toFixed(3)} Fit` : "—"}
                    </strong>
                    <br />
                    <small>
                      {alloc?.supportedArtistsCount ?? 0}/
                      {alloc?.totalStageArtistsCount ?? st.artists.length}{" "}
                      artists
                    </small>
                  </td>
                  <td>
                    {alloc?.alternativeSponsor ? (
                      <>
                        <strong>{alloc.alternativeSponsor.name}</strong>
                        <br />
                        <small>
                          {formatCategoryLabel(
                            alloc.alternativeSponsor.category,
                          )}
                        </small>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Active Commercial Rules */}
        <div className="print-rules-box">
          <strong>Active Commercial & Exclusivity Rules: </strong>
          {plan.briefSnapshot.constraints
            .filter((c) => c.active)
            .map((c) => c.reason)
            .join(" · ") || "None"}
        </div>
      </header>

      {/* Full Stage-by-Stage Briefs (All 3 Stages) */}
      {plan.briefSnapshot.stages.map((st, stageIdx) => {
        const alloc = plan.allocations.find((a) => a.stageId === st.id);
        if (!alloc) return null;

        const stFit = normalizeFit(alloc.relativeFitScore);
        const runnerUp = alloc.alternativeSponsor;
        const runnerUpEval = runnerUp
          ? plan.matrix.find(
              (m) => m.stageId === st.id && m.brandId === runnerUp.qlooId,
            )
          : undefined;
        const fanOptions = resolveFanActivityOptions(st, alloc);

        return (
          <article key={st.id} className="print-stage-page">
            <div className="print-stage-header">
              <div>
                <span className="print-stage-kicker">
                  STAGE {stageIdx + 1} OF {plan.briefSnapshot.stages.length} ·{" "}
                  {st.genreLabel.toUpperCase()}
                </span>
                <h2>
                  {st.name} —{" "}
                  {alloc.primarySponsor
                    ? `${alloc.primarySponsor.name} Partnership Brief`
                    : "Unfilled Stage Slot"}
                </h2>
                <p className="print-stage-sub">
                  Lineup: <strong>{st.artists.join(", ")}</strong> ·{" "}
                  {formatStageTierLabel(
                    st.activationFormat?.stageTier,
                    st.id,
                  )}{" "}
                  · Footprint:{" "}
                  {st.activationFormat?.requiredSpaceFootprint ?? "10x10m"}
                </p>
              </div>
              <div className="print-stage-score-box">
                <span>STAGE FIT SCORE</span>
                <strong>
                  {stFit !== null ? `${stFit.toFixed(3)} Fit` : "—"}
                </strong>
                <small>Standby: {runnerUp ? runnerUp.name : "None"}</small>
              </div>
            </div>

            {alloc.activationBrief?.stageTradeoffSummary && (
              <div className="print-tradeoff-banner">
                <strong>Cross-Stage Placement Rationale:</strong>{" "}
                {alloc.activationBrief.stageTradeoffSummary}
              </div>
            )}

            {/* Artist-by-Artist Qloo Affinity Table */}
            {alloc.artistEvidence.length > 0 && (
              <div className="print-section-block">
                <h3>
                  Qloo Artist-by-Artist Affinity Proof (
                  {alloc.primarySponsor?.name ?? "Winner"} vs.{" "}
                  {runnerUp?.name ?? "Standby"})
                </h3>
                <table className="print-artist-table">
                  <thead>
                    <tr>
                      <th>Performing Artist</th>
                      <th>
                        {alloc.primarySponsor?.name ?? "Winner"} Fit & Rank
                      </th>
                      <th>{runnerUp?.name ?? "Standby"} Fit & Rank</th>
                      <th>Artist Fit Lead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alloc.artistEvidence.map((winEv) => {
                      const chalEv = runnerUpEval?.artistEvidence.find(
                        (e) => e.artistId === winEv.artistId,
                      );
                      const wScore = normalizeFit(winEv.ordinalPoints);
                      const cScore = normalizeFit(
                        chalEv?.ordinalPoints ?? null,
                      );
                      const diff =
                        wScore !== null && cScore !== null
                          ? wScore - cScore
                          : null;
                      return (
                        <tr key={winEv.id}>
                          <td>
                            <strong>{winEv.artistName}</strong>
                          </td>
                          <td>
                            <strong>
                              {wScore !== null
                                ? `${wScore.toFixed(3)} Fit`
                                : "—"}
                            </strong>{" "}
                            {winEv.ordinalRank !== null
                              ? `(Rank #${winEv.ordinalRank})`
                              : ""}
                          </td>
                          <td>
                            {cScore !== null
                              ? `${cScore.toFixed(3)} Fit`
                              : "—"}{" "}
                            {chalEv?.ordinalRank !== null &&
                            chalEv?.ordinalRank !== undefined
                              ? `(Rank #${chalEv.ordinalRank})`
                              : ""}
                          </td>
                          <td>
                            {diff !== null
                              ? `${diff >= 0 ? "+" : ""}${diff.toFixed(3)} Fit`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Suggested Activation Spec Sheet & 3 Fan Immersion Options */}
            {alloc.activationBrief && (
              <div className="print-section-block">
                <h3>
                  Suggested Activation Spec Sheet:{" "}
                  {alloc.activationBrief.experienceTitle}
                </h3>
                <p className="print-lead-copy">
                  {alloc.activationBrief.visitorExperience}
                </p>
                <p className="print-tags-line">
                  <strong>Qloo Cultural & Lifestyle Signals:</strong>{" "}
                  {alloc.activationBrief.culturalTagsUsed
                    .map((t) => `#${t}`)
                    .join("  ")}
                </p>

                <div className="print-fan-options-grid">
                  {fanOptions.map((opt, idx) => (
                    <div key={idx} className="print-fan-option-box">
                      <strong>Fan Immersion Option {idx + 1}</strong>
                      <p>{opt}</p>
                    </div>
                  ))}
                </div>

                <div className="print-commercial-footer">
                  <div>
                    <strong>Suggested Partner Role:</strong>{" "}
                    {alloc.activationBrief.sponsorRole}
                  </div>
                  <div>
                    <strong>Commercial Verification Next Step:</strong>{" "}
                    {alloc.unansweredCommercialQuestion}
                  </div>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
