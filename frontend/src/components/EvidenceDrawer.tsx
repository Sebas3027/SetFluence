import type {
  Constraint,
  CrossDomainTouchstone,
  PlanVersion,
  StageAllocation,
} from "@setfluence/shared";

export interface EvidenceDrawerProps {
  plan: PlanVersion | null;
  stageId: string | null;
  comparedBrandId: string | null;
  onSelectComparedBrand: (brandId: string) => void;
  onClose: () => void;
}

function getTouchstoneIcon(domain: CrossDomainTouchstone["domain"]): string {
  switch (domain) {
    case "movie":
      return "🎬";
    case "tv_show":
      return "📺";
    case "video_game":
      return "🎮";
    case "book":
      return "📚";
    case "tag":
    default:
      return "🏷️";
  }
}

function formatRuleBadge(
  constraintId: string,
  constraints: Constraint[],
): string {
  if (constraintId === "format-envelope") {
    return "Zone Footprint & Sound Ceiling";
  }
  const found = constraints.find((c) => c.id === constraintId);
  if (!found) return constraintId.replace(/[-_]/g, " ");
  if (found.reason) return found.reason;
  const cat = (found.category ?? "").replace(/_/g, " ");
  if (found.type === "category_exclusivity") {
    return `Festival-wide ${cat} exclusivity`;
  }
  if (found.type === "category_ban") {
    return `No ${cat} sponsors`;
  }
  if (found.type === "locked_placement") {
    return `Locked stage placement`;
  }
  return found.id.replace(/[-_]/g, " ");
}

export function EvidenceDrawer({
  plan,
  stageId,
  comparedBrandId,
  onSelectComparedBrand,
  onClose,
}: EvidenceDrawerProps) {
  if (!plan || !stageId) return null;

  const allocation: StageAllocation | undefined = plan.allocations.find(
    (a) => a.stageId === stageId,
  );
  if (!allocation) return null;

  const stageBrief = plan.briefSnapshot.stages.find((s) => s.id === stageId);
  const primary = allocation.primarySponsor;

  // Determine the challenger brand for Head-to-Head comparison
  const otherCandidates = plan.candidatePool.filter(
    (b) => b.qlooId !== primary?.qlooId,
  );
  const defaultChallenger =
    allocation.alternativeSponsor ?? otherCandidates[0] ?? null;

  const activeChallenger =
    (comparedBrandId
      ? plan.candidatePool.find((b) => b.qlooId === comparedBrandId)
      : null) ?? defaultChallenger;

  const challengerEval = activeChallenger
    ? plan.matrix.find(
        (m) => m.stageId === stageId && m.brandId === activeChallenger.qlooId,
      )
    : undefined;

  const primaryFit = allocation.relativeFitScore;
  const challengerFit = challengerEval?.relativeFitScore ?? null;
  const netDelta =
    primaryFit !== null && challengerFit !== null
      ? primaryFit - challengerFit
      : null;

  const touchstones = allocation.activationBrief?.crossDomainTouchstones ?? [];
  const sampleQueryParams =
    allocation.artistEvidence[0]?.queryParameters ?? null;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="evidence-drawer"
        onClick={(e) => e.stopPropagation()}
        aria-label="Head-to-Head Duel & Qloo Provenance Drawer"
      >
        <header className="drawer-header">
          <div>
            <span className="eyebrow">
              Stage Sponsorship Proof · Qloo Taste AI & Deal Solver
            </span>
            <h2>
              {allocation.stageName} ×{" "}
              {primary ? primary.name : "Unfilled Slot"}
            </h2>
            <p className="drawer-subtitle">
              {stageBrief?.genreLabel} · Lineup:{" "}
              {stageBrief?.artists.join(", ")}
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            aria-label="Close evidence drawer"
          >
            ✕ Close
          </button>
        </header>

        {/* SECTION 1: AUDIENCE PERSONA & 4-HOP SIGNAL ROUTING TRACER */}
        <section className="drawer-section">
          <div className="section-title-row">
            <h3>1. Audience Profile & 4-Hop Decision Path</h3>
            <span className="provenance-pill provenance-qloo">
              VERIFIED QLOO + SOLVER PATH
            </span>
          </div>

          <div className="signal-tracer-grid">
            {/* HOP 1: STAGE ARTISTS */}
            <div className="tracer-hop-col">
              <span className="tracer-hop-label">HOP 1 · LINEUP ARTISTS</span>
              {stageBrief?.artists.map((artistName) => {
                const resolved = plan.resolvedArtists[artistName];
                return (
                  <div key={artistName} className="tracer-node-card">
                    <strong>{artistName}</strong>
                    <span
                      className={`status-pill status-${resolved?.status ?? "missing"}`}
                    >
                      {resolved?.status === "resolved"
                        ? "✓ Qloo Verified"
                        : (resolved?.status ?? "unresolved")}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* HOP 2: QLOO CROSS-DOMAIN BRIDGE */}
            <div className="tracer-hop-col">
              <span className="tracer-hop-label">
                HOP 2 · CROSS-DOMAIN DNA
              </span>
              <div className="tracer-node-card">
                <span className="small-caps-label">Shared Cultural Signals:</span>
                <div className="touchstone-chip-list">
                  {touchstones.length > 0 ? (
                    touchstones.map((t) => (
                      <span
                        key={`${t.domain}-${t.id}`}
                        className={`touchstone-chip touchstone-${t.domain}`}
                      >
                        {getTouchstoneIcon(t.domain)} {t.name}
                      </span>
                    ))
                  ) : (
                    <span className="mono-sub">
                      {allocation.activationBrief?.culturalTagsUsed
                        .map((tag) => `#${tag}`)
                        .join(" · ") || "Artist affinity signals"}
                    </span>
                  )}
                </div>
              </div>
              <div className="tracer-node-card">
                <span className="small-caps-label">Shortlist Fit Comparison:</span>
                <div className="mono-sub">
                  ★ {primary?.name ?? "None"}:{" "}
                  <strong>
                    {primaryFit !== null
                      ? `${primaryFit.toFixed(3)} pts`
                      : "N/A"}
                  </strong>
                </div>
                {activeChallenger && (
                  <div className="mono-sub">
                    ⚔️ {activeChallenger.name}:{" "}
                    <strong>
                      {challengerFit !== null
                        ? `${challengerFit.toFixed(3)} pts`
                        : "∅ Unknown"}
                    </strong>
                  </div>
                )}
              </div>
            </div>

            {/* HOP 3: DETERMINISTIC SOLVER GATE */}
            <div className="tracer-hop-col">
              <span className="tracer-hop-label">HOP 3 · DEAL GUARDRAILS</span>
              <div className="tracer-node-card">
                <span className="small-caps-label">Satisfied Rules:</span>
                <div className="tag-row">
                  {allocation.satisfiedConstraintIds.map((cid) => (
                    <span key={cid} className="rule-pill">
                      ✓ {formatRuleBadge(cid, plan.briefSnapshot.constraints)}
                    </span>
                  ))}
                </div>
                {challengerEval && !challengerEval.eligible && (
                  <div className="tracer-conflict-note">
                    ⛔ {activeChallenger?.name}:{" "}
                    {challengerEval.blockingReasons[0] ?? "Rule conflict"}
                  </div>
                )}
              </div>
            </div>

            {/* HOP 4: STAGE SLOT & FALLBACK */}
            <div className="tracer-hop-col">
              <span className="tracer-hop-label">HOP 4 · FINAL PLACEMENT</span>
              <div className="tracer-node-card primary-winner">
                <span className="small-caps-label">★ PRIMARY PARTNER</span>
                <strong>{primary?.name ?? "UNFILLED"}</strong>
                <div className="mono-sub">
                  {primaryFit !== null
                    ? `${primaryFit.toFixed(3)} pts (${allocation.supportedArtistsCount}/${allocation.totalStageArtistsCount} acts)`
                    : "No eligible candidate"}
                </div>
              </div>
              <div className="tracer-node-card fallback-standby">
                <span className="small-caps-label">⟳ STANDBY PARTNER</span>
                <strong>
                  {allocation.alternativeSponsor?.name ?? "None Available"}
                </strong>
                <div className="mono-sub">
                  Pre-vetted conflict-free backup
                </div>
              </div>
            </div>
          </div>

          {allocation.activationBrief?.stageTradeoffSummary && (
            <div className="tradeoff-callout-box">
              <strong>Cross-Stage Placement Summary:</strong>{" "}
              {allocation.activationBrief.stageTradeoffSummary}
            </div>
          )}
        </section>

        {/* SECTION 2: HEAD-TO-HEAD ARTIST PODIUM DUEL */}
        <section className="drawer-section">
          <div className="duel-section-header">
            <div>
              <h3>2. Artist-by-Artist Head-to-Head Comparison</h3>
              <span className="metric-sub">
                Relative fit points (0.000–1.000 pts) within the{" "}
                {plan.candidatePool.length}-brand shortlist
              </span>
            </div>

            {otherCandidates.length > 0 && (
              <label className="challenger-select-label">
                Compare Winner Against:
                <select
                  value={activeChallenger?.qlooId ?? ""}
                  onChange={(e) => onSelectComparedBrand(e.target.value)}
                >
                  {otherCandidates.map((cand) => (
                    <option key={cand.qlooId} value={cand.qlooId}>
                      {cand.name} ({cand.category.replace(/_/g, " ")})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="duel-summary-strip">
            <div className="duel-contestant is-winner">
              <span className="small-caps-label">★ STAGE WINNER</span>
              <div className="duel-contestant-name">
                <span>{primary?.name ?? "Unfilled"}</span>
                <span className="mono-score">
                  {primaryFit !== null ? `${primaryFit.toFixed(3)} pts` : "—"}
                </span>
              </div>
              <div className="duel-score-bar-wrap">
                <div
                  className="duel-score-bar-fill winner"
                  style={{
                    width: `${Math.round((primaryFit ?? 0) * 100)}%`,
                  }}
                />
              </div>
            </div>

            <div className="duel-contestant">
              <span className="small-caps-label">
                ⚔️ COMPARED BRAND{" "}
                {challengerEval && !challengerEval.eligible
                  ? "(BLOCKED BY RULE)"
                  : ""}
              </span>
              <div className="duel-contestant-name">
                <span>{activeChallenger?.name ?? "None"}</span>
                <span className="mono-score">
                  {challengerFit !== null
                    ? `${challengerFit.toFixed(3)} pts`
                    : "∅ Unknown"}
                </span>
              </div>
              <div className="duel-score-bar-wrap">
                <div
                  className="duel-score-bar-fill runner-up"
                  style={{
                    width: `${Math.round((challengerFit ?? 0) * 100)}%`,
                  }}
                />
              </div>
            </div>

            <div className="duel-delta-box">
              <span className="small-caps-label">NET SHORTLIST LEAD</span>
              <strong className="duel-delta-num">
                {netDelta !== null
                  ? `${netDelta >= 0 ? "+" : ""}${netDelta.toFixed(3)} pts`
                  : "N/A"}
              </strong>
              <span className="metric-sub">
                Coverage: {allocation.supportedArtistsCount}/
                {allocation.totalStageArtistsCount} artists
              </span>
            </div>
          </div>

          {allocation.artistEvidence.length > 0 && (
            <table className="evidence-table">
              <thead>
                <tr>
                  <th>Performing Artist</th>
                  <th>★ {primary?.name ?? "Winner"} (Rank · Fit Pts · Raw Qloo)</th>
                  <th>
                    ⚔️ {activeChallenger?.name ?? "Challenger"} (Rank · Fit Pts ·
                    Raw Qloo)
                  </th>
                  <th>Winner Point Lead</th>
                </tr>
              </thead>
              <tbody>
                {allocation.artistEvidence.map((winEv) => {
                  const chalEv = challengerEval?.artistEvidence.find(
                    (e) => e.artistId === winEv.artistId,
                  );
                  const rowDelta =
                    winEv.ordinalPoints !== null &&
                    chalEv?.ordinalPoints !== null &&
                    chalEv?.ordinalPoints !== undefined
                      ? winEv.ordinalPoints - chalEv.ordinalPoints
                      : null;

                  return (
                    <tr key={winEv.id}>
                      <td>
                        <strong>{winEv.artistName}</strong>
                        <div>
                          <span className="source-badge">
                            {winEv.sourceType === "live" ||
                            winEv.sourceType === "cached_live"
                              ? "Live Qloo API"
                              : "Test Fixture"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="podium-cell-line">
                          <span className="podium-rank-pill gold">
                            {winEv.ordinalRank !== null
                              ? `#${winEv.ordinalRank} of ${winEv.shortlistSize}`
                              : "—"}
                          </span>
                          <strong>
                            {winEv.ordinalPoints !== null
                              ? `${winEv.ordinalPoints.toFixed(3)} pts`
                              : "∅ Unknown"}
                          </strong>
                        </div>
                        <div className="mono-sub">
                          Raw Qloo Affinity:{" "}
                          {winEv.rawScore !== null
                            ? winEv.rawScore.toFixed(4)
                            : "∅"}
                        </div>
                      </td>
                      <td>
                        {chalEv ? (
                          <>
                            <div className="podium-cell-line">
                              <span className="podium-rank-pill silver">
                                {chalEv.ordinalRank !== null
                                  ? `#${chalEv.ordinalRank} of ${chalEv.shortlistSize}`
                                  : "—"}
                              </span>
                              <strong>
                                {chalEv.ordinalPoints !== null
                                  ? `${chalEv.ordinalPoints.toFixed(3)} pts`
                                  : "∅ Unknown"}
                              </strong>
                            </div>
                            <div className="mono-sub">
                              Raw Qloo Affinity:{" "}
                              {chalEv.rawScore !== null
                                ? chalEv.rawScore.toFixed(4)
                                : "∅"}
                            </div>
                          </>
                        ) : (
                          <span className="mono-sub">∅ Unknown</span>
                        )}
                      </td>
                      <td>
                        <strong
                          className={
                            rowDelta !== null && rowDelta >= 0
                              ? "delta-positive"
                              : "delta-negative"
                          }
                        >
                          {rowDelta !== null
                            ? `${rowDelta >= 0 ? "+" : ""}${rowDelta.toFixed(3)} pts`
                            : "—"}
                        </strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* SECTION 3: 3-LAYER PROVENANCE ACTIVATION BLUEPRINT */}
        {allocation.activationBrief && (
          <section className="drawer-section">
            <h3>3. On-Site Experience Blueprint & Provenance</h3>

            <div className="provenance-layer-stack">
              {/* Layer 1: Qloo Cross-Domain Signal */}
              <div className="provenance-layer-box">
                <div className="layer-box-header">
                  <span className="provenance-pill provenance-qloo">
                    1. QLOO CROSS-DOMAIN SIGNALS
                  </span>
                  <span className="mono-sub">
                    Movies, Gaming, Books & Subcultures
                  </span>
                </div>
                <p className="drawer-body-text">
                  {allocation.activationBrief.culturalRationale}
                </p>
                <div className="touchstone-chip-list">
                  {touchstones.map((t) => (
                    <span
                      key={`drawer-${t.domain}-${t.id}`}
                      className={`touchstone-chip touchstone-${t.domain}`}
                    >
                      {getTouchstoneIcon(t.domain)} {t.name}
                      {t.affinityScore !== null
                        ? ` (${t.affinityScore.toFixed(2)})`
                        : ""}
                    </span>
                  ))}
                  {allocation.activationBrief.culturalTagsUsed.map((tag) => (
                    <span key={tag} className="tag-pill">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Layer 2: Deterministic Solver Envelope */}
              <div className="provenance-layer-box">
                <div className="layer-box-header">
                  <span className="provenance-pill provenance-solver">
                    2. STAGE ZONE & COMMERCIAL COMPLIANCE
                  </span>
                  <span className="mono-sub">
                    ✓ {allocation.activationBrief.formatCompliance.notes}
                  </span>
                </div>
                <div className="envelope-mini-grid">
                  <div>
                    <span className="small-caps-label">Zone Format</span>
                    <strong>
                      {allocation.activationBrief.formatCompliance.formatName}
                    </strong>
                  </div>
                  <div>
                    <span className="small-caps-label">Space Footprint</span>
                    <strong className="upper-mono">
                      {
                        allocation.activationBrief.formatCompliance
                          .requiredSpaceFootprint
                      }
                    </strong>
                  </div>
                  <div>
                    <span className="small-caps-label">Acoustic Ceiling</span>
                    <strong className="upper-mono">
                      {
                        allocation.activationBrief.formatCompliance
                          .noiseLevelCeiling
                      }
                    </strong>
                  </div>
                </div>
              </div>

              {/* Layer 3: Grounded Creative Synthesis */}
              <div className="provenance-layer-box">
                <div className="layer-box-header">
                  <span className="provenance-pill provenance-gemini">
                    3. ON-SITE ACTIVATION CONCEPT
                  </span>
                  <span className="mono-sub">
                    Backed by{" "}
                    {allocation.activationBrief.groundingEvidenceIds.length}{" "}
                    Qloo artist-brand records
                  </span>
                </div>
                <strong className="blueprint-drawer-title">
                  ✦ {allocation.activationBrief.experienceTitle}
                </strong>
                <p className="drawer-body-text">
                  <strong>What Fans Experience:</strong>{" "}
                  {allocation.activationBrief.visitorExperience}
                </p>
                <p className="drawer-body-text">
                  <strong>Partner Role:</strong>{" "}
                  {allocation.activationBrief.sponsorRole}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* SECTION 4: COLLAPSIBLE TECHNICAL QLOO API PARAMETERS */}
        {sampleQueryParams && (
          <section className="drawer-section">
            <details className="technical-proof-details">
              <summary>
                Show Raw Qloo REST Query Parameters & Entity IDs (Technical
                Verification)
              </summary>
              <div className="technical-proof-body">
                <div className="mono-sub">
                  Resolved Stage Artist Qloo IDs:{" "}
                  {stageBrief?.artists
                    .map(
                      (a) =>
                        `${a}: ${plan.resolvedArtists[a]?.qlooId ?? "unresolved"}`,
                    )
                    .join(" | ")}
                </div>
                <pre className="code-block">
                  {JSON.stringify(sampleQueryParams, null, 2)}
                </pre>
              </div>
            </details>
          </section>
        )}
      </aside>
    </div>
  );
}
