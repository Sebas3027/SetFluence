import type { PlanVersion } from "@setfluence/shared";

export interface SponsorMatrixProps {
  plan: PlanVersion;
  onInspectCell: (stageId: string, brandId: string) => void;
}

function formatCategoryLabel(category: string): string {
  return category
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatSourceLabel(source: string): string {
  if (source === "supplied") return "Organizer";
  if (source === "discovered") return "Qloo Discovered";
  return "Organizer + Qloo";
}

function formatStageTierLabel(tier?: string, stageId?: string): string {
  const effective =
    tier ??
    (stageId === "stage-1"
      ? "headliner_arena"
      : stageId === "stage-2"
        ? "secondary_stage"
        : "intimate_tent");
  if (effective === "headliner_arena") return "Main Headliner Arena (25k+)";
  if (effective === "secondary_stage") return "Secondary Stage (8k–15k)";
  return "Intimate Tent (2k–5k)";
}

export function SponsorMatrix({ plan, onInspectCell }: SponsorMatrixProps) {
  const stages = plan.briefSnapshot.stages;
  const allBrands = plan.candidatePool;

  const hasLegacyZeroScore = plan.matrix.some((m) =>
    m.artistEvidence.some((e) => e.ordinalPoints === 0),
  );

  function normalizeFit(score: number | null): number | null {
    if (score === null) return null;
    if (!hasLegacyZeroScore) return score;
    return Math.round((0.58 + 0.42 * score) * 1000) / 1000;
  }

  // Part 1: Cross-stage brands are the organizer-supplied target brands evaluated across all stages
  const crossStageBrands = allBrands.filter(
    (b) =>
      b.source !== "discovered" &&
      (!b.targetStageIds || b.targetStageIds.length === 0),
  );

  // Part 2: Stage-specific Qloo discoveries grouped by stage
  const discoveredBrands = allBrands.filter((b) => b.source === "discovered");
  const hasExplicitStageTargets = discoveredBrands.some(
    (b) => b.targetStageIds && b.targetStageIds.length > 0,
  );

  const stageSpecificByStageId = new Map<string, typeof allBrands>();
  for (const stage of stages) {
    if (hasExplicitStageTargets) {
      stageSpecificByStageId.set(
        stage.id,
        discoveredBrands.filter(
          (b) => b.targetStageIds && b.targetStageIds.includes(stage.id),
        ),
      );
    } else {
      // Fallback if backend process was started prior to targetStageIds tagging:
      // assign each discovered brand to the stage where it has the highest Qloo fit (or won/standby)
      const stageMatched = discoveredBrands.filter((b) => {
        const alloc = plan.allocations.find((a) => a.stageId === stage.id);
        if (
          alloc?.primarySponsor?.qlooId === b.qlooId ||
          alloc?.alternativeSponsor?.qlooId === b.qlooId
        ) {
          return true;
        }
        const evalsForBrand = plan.matrix
          .filter((m) => m.brandId === b.qlooId && m.relativeFitScore !== null)
          .sort(
            (x, y) => (y.relativeFitScore ?? -1) - (x.relativeFitScore ?? -1),
          );
        return evalsForBrand[0]?.stageId === stage.id;
      });
      stageSpecificByStageId.set(stage.id, stageMatched);
    }
  }

  function renderCellStatus(stageId: string, brand: (typeof allBrands)[number]) {
    const ev = plan.matrix.find(
      (m) => m.stageId === stageId && m.brandId === brand.qlooId,
    );
    const alloc = plan.allocations.find((a) => a.stageId === stageId);

    const isWinner = alloc?.primarySponsor?.qlooId === brand.qlooId;
    const isStandby = alloc?.alternativeSponsor?.qlooId === brand.qlooId;

    const festivalExclusivityRule = plan.briefSnapshot.constraints.find(
      (c) =>
        c.active &&
        c.type === "category_exclusivity" &&
        c.scope === "festival" &&
        c.category?.toLowerCase() === brand.category.toLowerCase(),
    );
    const otherStageCategoryWinner = festivalExclusivityRule
      ? plan.allocations.find(
          (a) =>
            a.stageId !== stageId &&
            a.primarySponsor &&
            a.primarySponsor.category.toLowerCase() ===
              brand.category.toLowerCase(),
        )
      : undefined;

    const crossStageBlockReason =
      !isWinner && otherStageCategoryWinner
        ? `${formatCategoryLabel(brand.category)} exclusivity awarded to ${otherStageCategoryWinner.primarySponsor?.name} on ${otherStageCategoryWinner.stageName}`
        : null;

    const directBlockReason =
      ev && !ev.eligible && ev.blockingReasons.length > 0
        ? ev.blockingReasons[0]!.replace(/_/g, " ")
        : null;

    const effectiveBlockReason = directBlockReason ?? crossStageBlockReason;

    let cellStateClass = "state-eligible";
    let stateLabel = "ELIGIBLE";

    if (isWinner) {
      cellStateClass = "state-winner";
      stateLabel = "WINNER";
    } else if (effectiveBlockReason) {
      cellStateClass = "state-blocked";
      stateLabel = "RULE BLOCKED";
    } else if (isStandby) {
      cellStateClass = "state-standby";
      stateLabel = "STANDBY";
    } else if (!ev || ev.relativeFitScore === null) {
      cellStateClass = "state-unknown";
      stateLabel = "UNSCANNED";
    }

    return {
      ev,
      isWinner,
      isStandby,
      effectiveBlockReason,
      cellStateClass,
      stateLabel,
    };
  }

  return (
    <section
      className="matrix-panel"
      aria-label="Sponsor by Stage Compliance Heatmap"
    >
      <div className="matrix-panel-header">
        <div>
          <span className="eyebrow">
            Part 1 · Cross-Stage Exclusivity & Routing Matrix
          </span>
          <h3>
            Organizer Target Brands Across All Stages ({crossStageBrands.length}{" "}
            Brands × {stages.length} Stages)
          </h3>
        </div>
        <div className="matrix-legend">
          <span className="legend-pill legend-winner">Stage Winner</span>
          <span className="legend-pill legend-standby">Standby Partner</span>
          <span className="legend-pill legend-blocked">
            Blocked by Deal Rule
          </span>
          <span className="legend-pill legend-eligible">Eligible Fit</span>
        </div>
      </div>

      <div className="callout-highlight-banner">
        <strong>Interactive Cross-Stage Routing:</strong> Your{" "}
        <strong>{crossStageBrands.length} organizer target brands</strong> are
        evaluated across all {stages.length} stages so the solver can arbitrate
        festival-wide category exclusivity. Click any cell below to inspect the{" "}
        <strong>Head-to-Head Artist Comparison</strong> on that stage.
      </div>

      <div className="matrix-scroll-wrap">
        <table className="sponsor-matrix-table">
          <thead>
            <tr>
              <th className="matrix-corner-th">
                Organizer Target Brand ({crossStageBrands.length})
              </th>
              {stages.map((st) => (
                <th key={st.id} className="matrix-stage-th">
                  <span className="matrix-stage-name">{st.name}</span>
                  <span className="matrix-stage-genre">{st.genreLabel}</span>
                  {st.activationFormat && (
                    <span className="matrix-stage-format">
                      {formatStageTierLabel(st.activationFormat.stageTier, st.id)} ·{" "}
                      {st.activationFormat.requiredSpaceFootprint} footprint
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {crossStageBrands.map((brand) => (
              <tr key={brand.qlooId}>
                <td className="matrix-brand-td">
                  <div className="matrix-brand-name-row">
                    <strong>{brand.name}</strong>
                    {!brand.available && (
                      <span className="unavail-mini-tag">UNAVAILABLE</span>
                    )}
                  </div>
                  <div className="matrix-brand-meta">
                    <span className="mono-tag">
                      {formatCategoryLabel(brand.category)}
                    </span>
                    <span className="source-mini-tag">Organizer Pool</span>
                  </div>
                </td>

                {stages.map((stage) => {
                  const {
                    ev,
                    effectiveBlockReason,
                    cellStateClass,
                    stateLabel,
                  } = renderCellStatus(stage.id, brand);

                  return (
                    <td key={stage.id} className="matrix-cell-td">
                      <button
                        type="button"
                        className={`matrix-cell-btn ${cellStateClass}`}
                        disabled={!ev}
                        onClick={() => onInspectCell(stage.id, brand.qlooId)}
                        title={`Click to compare ${brand.name} on ${stage.name}`}
                      >
                        <div className="matrix-cell-top">
                          <span className="matrix-state-badge">
                            {stateLabel}
                          </span>
                          <span className="matrix-score-readout">
                            {ev && ev.relativeFitScore !== null
                              ? `${(normalizeFit(ev.relativeFitScore) ?? ev.relativeFitScore).toFixed(3)} Fit`
                              : "—"}
                          </span>
                        </div>

                        <div className="matrix-cell-sub">
                          {ev ? (
                            <span>
                              {ev.supportedArtistsCount}/
                              {ev.totalStageArtistsCount} lineup artists covered
                            </span>
                          ) : (
                            <span>—</span>
                          )}
                        </div>

                        {effectiveBlockReason && (
                          <div className="matrix-block-reason">
                            Blocked: {effectiveBlockReason}
                          </div>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* PART 2: STAGE-SPECIFIC QLOO DISCOVERIES */}
      <div className="stage-discoveries-section">
        <div className="matrix-panel-header">
          <div>
            <span className="eyebrow">
              Part 2 · Stage-Tailored Qloo Brand Discoveries
            </span>
            <h3>
              Stage-Specific Discovered Candidates (Matched to Each Stage's
              Lineup)
            </h3>
          </div>
        </div>
        <p className="matrix-helper-text">
          Unlike the shared organizer pool above, these brands were discovered
          from Qloo specifically for an individual stage's performing artists
          and genre profile. Click any card to compare it on its target stage.
        </p>

        <div className="stage-discovery-columns">
          {stages.map((stage) => {
            const stageDiscovered = stageSpecificByStageId.get(stage.id) ?? [];
            return (
              <div key={stage.id} className="stage-discovery-col-card">
                <div className="stage-discovery-col-header">
                  <div>
                    <strong>{stage.name}</strong>
                    <span className="matrix-stage-genre">
                      {stage.genreLabel} · {stage.artists.join(", ")}
                    </span>
                  </div>
                  <span className="pastel-badge badge-sky">
                    {stageDiscovered.length} Qloo Matches
                  </span>
                </div>

                {stageDiscovered.length === 0 ? (
                  <p className="muted-text">
                    No stage-exclusive Qloo discoveries added for this stage.
                  </p>
                ) : (
                  <div className="stage-discovery-items">
                    {stageDiscovered.map((brand) => {
                      const {
                        ev,
                        effectiveBlockReason,
                        cellStateClass,
                        stateLabel,
                      } = renderCellStatus(stage.id, brand);

                      return (
                        <button
                          key={brand.qlooId}
                          type="button"
                          className={`matrix-cell-btn ${cellStateClass}`}
                          onClick={() => onInspectCell(stage.id, brand.qlooId)}
                        >
                          <div className="matrix-cell-top">
                            <div>
                              <strong>{brand.name}</strong>{" "}
                              <small className="mono-tag">
                                ({formatCategoryLabel(brand.category)})
                              </small>
                            </div>
                            <span className="matrix-score-readout">
                              {ev && ev.relativeFitScore !== null
                                ? `${(normalizeFit(ev.relativeFitScore) ?? ev.relativeFitScore).toFixed(3)} Fit`
                                : "—"}
                            </span>
                          </div>
                          <div className="matrix-cell-top">
                            <span className="matrix-state-badge">
                              {stateLabel}
                            </span>
                            <span className="matrix-cell-sub">
                              {ev
                                ? `${ev.supportedArtistsCount}/${ev.totalStageArtistsCount} stage artists`
                                : ""}
                            </span>
                          </div>
                          {effectiveBlockReason && (
                            <div className="matrix-block-reason">
                              Blocked: {effectiveBlockReason}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
