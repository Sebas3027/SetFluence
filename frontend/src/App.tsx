import { useState } from "react";
import type {
  Constraint,
  ConstraintType,
  FestivalBrief,
  PlanVersion,
  SpaceFootprint,
  StageCapacityTier,
} from "@setfluence/shared";
import { generatePlan, revisePlan } from "./api.ts";
import { AgentTimeline } from "./components/AgentTimeline.tsx";
import { BenchmarkComparison } from "./components/BenchmarkComparison.tsx";
import { PrintExecutiveDeck } from "./components/PrintExecutiveDeck.tsx";
import { SponsorMatrix } from "./components/SponsorMatrix.tsx";
import { KNOWN_SPONSOR_CATEGORIES, PRESET_BRIEFS } from "./data/presets.ts";
import {
  formatCategoryLabel,
  formatConstraintTypeLabel,
  formatSourceLabel,
  formatStageTierLabel,
  renderMarkdownBrief,
  resolveFanActivityOptions,
} from "./utils/formatters.ts";

type ActiveView = "setup" | "stage" | "matrix" | "benchmark" | "audit";

export function App() {
  const [brief, setBrief] = useState<FestivalBrief>(PRESET_BRIEFS[0]!.brief);
  const [planHistory, setPlanHistory] = useState<PlanVersion[]>([]);
  const [activeVersionIdx, setActiveVersionIdx] = useState<number>(0);
  const [activeView, setActiveView] = useState<ActiveView>("setup");
  const [selectedStageId, setSelectedStageId] = useState<string>("stage-1");
  const [comparedBrandByStage, setComparedBrandByStage] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasUnappliedSetupEdits, setHasUnappliedSetupEdits] =
    useState<boolean>(false);

  // Form helpers for adding a brand
  const [newBrandName, setNewBrandName] = useState<string>("");
  const [newBrandCategory, setNewBrandCategory] = useState<string>("footwear");

  // Structured 3-Part Commercial Rule Builder state
  const [ruleBuilderType, setRuleBuilderType] = useState<
    "category_exclusivity" | "category_ban" | "locked_placement" | "availability"
  >("category_ban");
  const [ruleBuilderCategory, setRuleBuilderCategory] =
    useState<string>("energy_drink");
  const [ruleBuilderBrandName, setRuleBuilderBrandName] =
    useState<string>("Nike");
  const [ruleBuilderScope, setRuleBuilderScope] = useState<string>("festival");

  const [revisionInstruction, setRevisionInstruction] = useState<string>("");

  const activePlan = planHistory[activeVersionIdx] ?? null;

  const availableCategories = Array.from(
    new Set([
      ...KNOWN_SPONSOR_CATEGORIES,
      ...brief.preferredCategories,
      ...brief.suppliedBrands.map((b) => b.category),
    ]),
  );

  function handleSelectPreset(presetId: string) {
    const found = PRESET_BRIEFS.find((p) => p.id === presetId);
    if (!found) return;
    setBrief(structuredClone(found.brief));
    setPlanHistory([]);
    setActiveVersionIdx(0);
    setActiveView("setup");
    setSelectedStageId(found.brief.stages[0]?.id ?? "stage-1");
    setComparedBrandByStage({});
    setHasUnappliedSetupEdits(false);
    setErrorMessage(null);
  }

  async function handleGenerateInitialPlan() {
    setLoading(true);
    setErrorMessage(null);
    try {
      const plan = await generatePlan(brief);
      setPlanHistory([plan]);
      setActiveVersionIdx(0);
      setBrief(plan.briefSnapshot);
      setSelectedStageId(plan.briefSnapshot.stages[0]?.id ?? "stage-1");
      setHasUnappliedSetupEdits(false);
      setActiveView("stage");
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Failed to generate proposal from live Qloo API.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function executeRevision(
    updatedBrief: FestivalBrief,
    instruction?: string,
  ) {
    if (!activePlan) {
      setBrief(updatedBrief);
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const revised = await revisePlan(activePlan, updatedBrief, instruction);
      const nextHistory = [...planHistory, revised];
      setPlanHistory(nextHistory);
      setActiveVersionIdx(nextHistory.length - 1);
      setBrief(revised.briefSnapshot);
      setHasUnappliedSetupEdits(false);
      setRevisionInstruction("");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to revise proposal.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleStageArtistsChange(stageId: string, rawText: string) {
    const artists = rawText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setBrief((prev) => ({
      ...prev,
      stages: prev.stages.map((st) =>
        st.id === stageId ? { ...st, artists } : st,
      ),
    }));
    if (activePlan) setHasUnappliedSetupEdits(true);
  }

  function handleStageFormatChange(
    stageId: string,
    field: "requiredSpaceFootprint" | "stageTier",
    value: SpaceFootprint | StageCapacityTier,
  ) {
    setBrief((prev) => ({
      ...prev,
      stages: prev.stages.map((st) => {
        if (st.id !== stageId) return st;
        const currentFormat = st.activationFormat ?? {
          id: `fmt-${st.id}`,
          name: "Flagship Experience Pavilion",
          requiredSpaceFootprint: "medium" as const,
          noiseLevelCeiling: "moderate" as const,
          stageTier: "headliner_arena" as const,
        };
        return {
          ...st,
          activationFormat: {
            ...currentFormat,
            [field]: value,
          },
        };
      }),
    }));
    if (activePlan) setHasUnappliedSetupEdits(true);
  }

  function handleAddSuppliedBrand(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newBrandName.trim();
    if (!trimmed) return;
    setBrief((prev) => ({
      ...prev,
      suppliedBrands: [
        ...prev.suppliedBrands,
        {
          name: trimmed,
          category: newBrandCategory.trim() || "footwear",
          available: true,
        },
      ],
    }));
    setNewBrandName("");
    if (activePlan) setHasUnappliedSetupEdits(true);
  }

  function handleMarkSponsorUnavailable(brandId: string, brandName: string) {
    const nextBrief: FestivalBrief = {
      ...brief,
      suppliedBrands: brief.suppliedBrands.map((sb) =>
        sb.name.toLowerCase() === brandName.toLowerCase()
          ? { ...sb, available: false }
          : sb,
      ),
      constraints: [
        ...brief.constraints,
        {
          id: `unavail-${brandId}-${Date.now()}`,
          type: "availability",
          scope: "festival",
          brandId,
          active: true,
          reason: `Marked "${brandName}" unavailable.`,
        },
      ],
    };
    void executeRevision(nextBrief);
  }

  function handleToggleStageLock(
    stageId: string,
    stageName: string,
    brandId: string,
    brandName: string,
  ) {
    const existingLock = brief.constraints.find(
      (c) =>
        c.active &&
        c.type === "locked_placement" &&
        c.stageId === stageId &&
        c.brandId === brandId,
    );

    let nextConstraints: Constraint[];
    if (existingLock) {
      nextConstraints = brief.constraints.filter(
        (c) => c.id !== existingLock.id,
      );
    } else {
      nextConstraints = [
        ...brief.constraints.filter(
          (c) => !(c.type === "locked_placement" && c.stageId === stageId),
        ),
        {
          id: `lock-${stageId}-${brandName.toLowerCase().replace(/\s+/g, "-")}`,
          type: "locked_placement",
          scope: "stage",
          stageId,
          brandId,
          active: true,
          reason: `Locked "${brandName}" to ${stageName}.`,
        },
      ];
    }

    void executeRevision({ ...brief, constraints: nextConstraints });
  }

  function handleQuickBanCategory(stageId: string, category: string) {
    const stageObj = brief.stages.find((s) => s.id === stageId);
    const stageLabel = stageObj?.name ?? stageId;
    const nextConstraint: Constraint = {
      id: `ban-${category}-${stageId}-${Date.now()}`,
      type: "category_ban",
      scope: "stage",
      stageId,
      category,
      active: true,
      reason: `No ${formatCategoryLabel(category)} sponsors on ${stageLabel}.`,
    };
    void executeRevision({
      ...brief,
      constraints: [...brief.constraints, nextConstraint],
    });
  }

  /**
   * Structured 3-Part Rule Builder in Brief & Setup:
   * Updates `brief` locally WITHOUT automatically triggering a simulation/rematch.
   */
  function handleAddStructuredRule(e: React.FormEvent) {
    e.preventDefault();
    let nextConstraint: Constraint;

    if (ruleBuilderType === "category_exclusivity") {
      const cat = ruleBuilderCategory;
      nextConstraint = {
        id: `excl-${cat}-festival-${Date.now()}`,
        type: "category_exclusivity",
        scope: "festival",
        category: cat,
        active: true,
        reason: `At most one primary ${formatCategoryLabel(cat)} sponsor across the festival.`,
      };
    } else if (ruleBuilderType === "category_ban") {
      const cat = ruleBuilderCategory;
      const isFestival = ruleBuilderScope === "festival";
      const stageObj = brief.stages.find((s) => s.id === ruleBuilderScope);
      const scopeLabel = isFestival
        ? "across the entire festival"
        : `on ${stageObj?.name ?? ruleBuilderScope}`;
      nextConstraint = {
        id: `ban-${cat}-${ruleBuilderScope}-${Date.now()}`,
        type: "category_ban",
        scope: isFestival ? "festival" : "stage",
        ...(isFestival ? {} : { stageId: ruleBuilderScope }),
        category: cat,
        active: true,
        reason: `Restrict ${formatCategoryLabel(cat)} sponsors ${scopeLabel}.`,
      };
    } else if (ruleBuilderType === "locked_placement") {
      const targetStageId =
        ruleBuilderScope === "festival"
          ? (brief.stages[0]?.id ?? "stage-1")
          : ruleBuilderScope;
      const stageObj = brief.stages.find((s) => s.id === targetStageId);
      const matchedCandidate = activePlan?.candidatePool.find(
        (b) => b.name.toLowerCase() === ruleBuilderBrandName.toLowerCase(),
      );
      const brandIdOrName = matchedCandidate?.qlooId ?? ruleBuilderBrandName;
      nextConstraint = {
        id: `lock-${targetStageId}-${ruleBuilderBrandName.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
        type: "locked_placement",
        scope: "stage",
        stageId: targetStageId,
        brandId: brandIdOrName,
        active: true,
        reason: `Lock "${ruleBuilderBrandName}" to ${stageObj?.name ?? targetStageId}.`,
      };
    } else {
      // availability / exclude brand
      const matchedCandidate = activePlan?.candidatePool.find(
        (b) => b.name.toLowerCase() === ruleBuilderBrandName.toLowerCase(),
      );
      const brandIdOrName = matchedCandidate?.qlooId ?? ruleBuilderBrandName;
      nextConstraint = {
        id: `unavail-${ruleBuilderBrandName.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
        type: "availability",
        scope: "festival",
        brandId: brandIdOrName,
        active: true,
        reason: `Exclude "${ruleBuilderBrandName}" from available sponsors.`,
      };
    }

    setBrief((prev) => ({
      ...prev,
      ...(ruleBuilderType === "availability"
        ? {
            suppliedBrands: prev.suppliedBrands.map((sb) =>
              sb.name.toLowerCase() === ruleBuilderBrandName.toLowerCase()
                ? { ...sb, available: false }
                : sb,
            ),
          }
        : {}),
      constraints: [...prev.constraints, nextConstraint],
    }));

    if (activePlan) {
      setHasUnappliedSetupEdits(true);
    }
  }

  /**
   * Removing a constraint from the Setup view only updates local brief state without auto-retriggering.
   */
  function handleRemoveConstraint(constraintId: string) {
    setBrief((prev) => ({
      ...prev,
      constraints: prev.constraints.filter((c) => c.id !== constraintId),
    }));
    if (activePlan) {
      setHasUnappliedSetupEdits(true);
    }
  }

  function handleSelectStageFromMatrix(stageId: string, brandId: string) {
    setSelectedStageId(stageId);
    setComparedBrandByStage((prev) => ({
      ...prev,
      [stageId]: brandId,
    }));
    setActiveView("stage");
  }

  function handleDownloadMarkdown() {
    if (!activePlan) return;
    const md = renderMarkdownBrief(activePlan);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${brief.name.toLowerCase().replace(/\s+/g, "-")}-v${activePlan.versionNumber}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Active stage data for Stage Focus View
  const activeStageBrief =
    (activePlan ? activePlan.briefSnapshot : brief).stages.find(
      (s) => s.id === selectedStageId,
    ) ?? brief.stages[0]!;

  const activeStageAllocation = activePlan?.allocations.find(
    (a) => a.stageId === activeStageBrief.id,
  );

  const hasLegacyZeroScore = Boolean(
    activePlan?.matrix.some((m) =>
      m.artistEvidence.some((e) => e.ordinalPoints === 0),
    ),
  );

  function normalizeFit(score: number | null | undefined): number | null {
    if (score === null || score === undefined) return null;
    if (!hasLegacyZeroScore) return score;
    return Math.round((0.58 + 0.42 * score) * 1000) / 1000;
  }

  const hasExplicitStageTargets = Boolean(
    activePlan?.candidatePool.some(
      (b) => b.source === "discovered" && b.targetStageIds && b.targetStageIds.length > 0,
    ),
  );

  function isBrandTargetedForStage(
    plan: PlanVersion,
    stageId: string,
    brandId: string,
  ): boolean {
    const brand = plan.candidatePool.find((b) => b.qlooId === brandId);
    if (!brand) return false;
    if (brand.source !== "discovered") return true;
    if (hasExplicitStageTargets) {
      return Boolean(brand.targetStageIds?.includes(stageId));
    }
    const alloc = plan.allocations.find((a) => a.stageId === stageId);
    if (
      alloc?.primarySponsor?.qlooId === brandId ||
      alloc?.alternativeSponsor?.qlooId === brandId
    ) {
      return true;
    }
    const evals = plan.matrix
      .filter((m) => m.brandId === brandId && m.relativeFitScore !== null)
      .sort((x, y) => (y.relativeFitScore ?? -1) - (x.relativeFitScore ?? -1));
    return evals[0]?.stageId === stageId;
  }

  // Build ranked leaderboard of candidate brands evaluated FOR THIS STAGE
  const stageBrandRows = activePlan
    ? activePlan.candidatePool
        .filter(
          (brand) =>
            isBrandTargetedForStage(activePlan, activeStageBrief.id, brand.qlooId) &&
            activePlan.matrix.some(
              (m) =>
                m.stageId === activeStageBrief.id && m.brandId === brand.qlooId,
            ),
        )
        .map((brand) => {
          const ev = activePlan.matrix.find(
            (m) =>
              m.stageId === activeStageBrief.id && m.brandId === brand.qlooId,
          );
          const isWinner =
            activeStageAllocation?.primarySponsor?.qlooId === brand.qlooId;
          const isStandby =
            activeStageAllocation?.alternativeSponsor?.qlooId === brand.qlooId;

          const festivalExclusivityRule =
            activePlan.briefSnapshot.constraints.find(
              (c) =>
                c.active &&
                c.type === "category_exclusivity" &&
                c.scope === "festival" &&
                c.category?.toLowerCase() === brand.category.toLowerCase(),
            );
          const otherStageCategoryWinner = festivalExclusivityRule
            ? activePlan.allocations.find(
                (a) =>
                  a.stageId !== activeStageBrief.id &&
                  a.primarySponsor &&
                  a.primarySponsor.category.toLowerCase() ===
                    brand.category.toLowerCase(),
              )
            : undefined;

          const crossStageBlockReason =
            !isWinner && otherStageCategoryWinner
              ? `${formatCategoryLabel(brand.category)} exclusivity won by ${otherStageCategoryWinner.primarySponsor?.name} on ${otherStageCategoryWinner.stageName}`
              : null;

          const directBlockReason =
            ev && !ev.eligible && ev.blockingReasons.length > 0
              ? ev.blockingReasons[0]!.replace(/_/g, " ")
              : null;

          const effectiveBlockReason =
            directBlockReason ?? crossStageBlockReason;

          return {
            brand,
            ev,
            score: normalizeFit(ev?.relativeFitScore ?? null),
            isWinner,
            isStandby,
            effectiveBlockReason,
          };
        })
        .sort((a, b) => {
          if (a.isWinner) return -1;
          if (b.isWinner) return 1;
          return (b.score ?? -1) - (a.score ?? -1);
        })
    : [];

  // Determine which rival brand is currently compared against the stage winner
  const primarySponsor = activeStageAllocation?.primarySponsor ?? null;
  const requestedChallengerId = comparedBrandByStage[activeStageBrief.id];
  const defaultChallenger =
    activeStageAllocation?.alternativeSponsor ??
    stageBrandRows.find((r) => r.brand.qlooId !== primarySponsor?.qlooId)
      ?.brand ??
    null;

  const comparedBrand =
    (requestedChallengerId && requestedChallengerId !== primarySponsor?.qlooId
      ? stageBrandRows.find((r) => r.brand.qlooId === requestedChallengerId)
          ?.brand
      : null) ?? defaultChallenger;

  const comparedBrandRow = stageBrandRows.find(
    (r) => r.brand.qlooId === comparedBrand?.qlooId,
  );

  const primaryScore = normalizeFit(
    activeStageAllocation?.relativeFitScore ?? null,
  );
  const comparedScore = comparedBrandRow?.score ?? null;
  const netMargin =
    primaryScore !== null && comparedScore !== null
      ? primaryScore - comparedScore
      : null;

  const isStageLocked = brief.constraints.some(
    (c) =>
      c.active &&
      c.type === "locked_placement" &&
      c.stageId === activeStageBrief.id &&
      c.brandId === primarySponsor?.qlooId,
  );

  const selectableBrandNames = Array.from(
    new Set([
      ...brief.suppliedBrands.map((b) => b.name),
      ...(activePlan ? activePlan.candidatePool.map((b) => b.name) : []),
    ]),
  );

  return (
    <div className="desktop-app-shell">
      {/* =====================================================================
          LEFT SIDEBAR NAVIGATION (Linear / Attio Desktop Style)
         ===================================================================== */}
      <aside className="app-sidebar no-print" aria-label="Workspace Sidebar">
        <div className="sidebar-brand-header">
          <div className="brand-logo-svg-wrap" aria-hidden="true">
            <svg
              width="32"
              height="32"
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
          </div>
          <div>
            <strong className="brand-title">SetFluence</strong>
            <span className="brand-subtitle">Sponsorship Studio</span>
          </div>
        </div>

        {/* Scenario Switcher */}
        <div className="sidebar-scenario-box">
          <label className="sidebar-section-label" htmlFor="preset-select">
            FESTIVAL SCENARIO
          </label>
          <select
            id="preset-select"
            className="sidebar-select"
            value={brief.id}
            disabled={loading}
            onChange={(e) => handleSelectPreset(e.target.value)}
          >
            {PRESET_BRIEFS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn-primary full-width sidebar-run-btn"
            disabled={loading}
            onClick={() => void handleGenerateInitialPlan()}
          >
            {loading
              ? "Running Qloo & Solver..."
              : activePlan
                ? "Re-Run Qloo Match"
                : "Run Qloo Match"}
          </button>
        </div>

        {/* Navigation Sections */}
        <nav className="sidebar-nav">
          <div className="sidebar-group">
            <span className="sidebar-section-label">CONFIGURATION</span>
            <button
              type="button"
              className={`sidebar-nav-item ${activeView === "setup" ? "active" : ""}`}
              onClick={() => setActiveView("setup")}
            >
              <span className="nav-item-label">Festival Brief & Rules</span>
              <span className="sidebar-pill-neutral">
                {brief.constraints.length} rules
              </span>
            </button>
          </div>

          <div className="sidebar-group">
            <span className="sidebar-section-label">STAGES (FOCUS VIEW)</span>
            {(activePlan ? activePlan.briefSnapshot.stages : brief.stages).map(
              (st, idx) => {
                const alloc = activePlan?.allocations.find(
                  (a) => a.stageId === st.id,
                );
                const winner = alloc?.primarySponsor;
                const isSelected =
                  activeView === "stage" && activeStageBrief.id === st.id;

                return (
                  <button
                    key={st.id}
                    type="button"
                    className={`sidebar-stage-item ${isSelected ? "active" : ""}`}
                    onClick={() => {
                      setSelectedStageId(st.id);
                      setActiveView("stage");
                    }}
                  >
                    <div className="sidebar-stage-top">
                      <span className="stage-index-dot">{idx + 1}</span>
                      <span className="sidebar-stage-name">{st.name}</span>
                    </div>
                    <div className="sidebar-stage-bottom">
                      <span className="sidebar-stage-genre">
                        {st.genreLabel}
                      </span>
                      {activePlan ? (
                        winner ? (
                          <span className="sidebar-winner-pill">
                            {winner.name}
                          </span>
                        ) : (
                          <span className="sidebar-unfilled-pill">
                            Unfilled
                          </span>
                        )
                      ) : (
                        <span className="sidebar-pending-pill">Ready</span>
                      )}
                    </div>
                  </button>
                );
              },
            )}
          </div>

          <div className="sidebar-group">
            <span className="sidebar-section-label">FESTIVAL VIEWS</span>
            <button
              type="button"
              className={`sidebar-nav-item ${activeView === "matrix" ? "active" : ""}`}
              disabled={!activePlan}
              onClick={() => setActiveView("matrix")}
            >
              <span className="nav-item-label">Brand × Stage Matrix</span>
              {activePlan && (
                <span className="sidebar-pill-neutral">
                  {activePlan.briefSnapshot.suppliedBrands.length}×3
                </span>
              )}
            </button>

            <button
              type="button"
              className={`sidebar-nav-item ${activeView === "benchmark" ? "active" : ""}`}
              disabled={!activePlan}
              onClick={() => setActiveView("benchmark")}
            >
              <span className="nav-item-label">LLM vs. Qloo Benchmark</span>
              {activePlan && (
                <span className="sidebar-pill-neutral">A/B</span>
              )}
            </button>

            <button
              type="button"
              className={`sidebar-nav-item ${activeView === "audit" ? "active" : ""}`}
              disabled={!activePlan}
              onClick={() => setActiveView("audit")}
            >
              <span className="nav-item-label">Qloo & Solver Audit</span>
              {activePlan && (
                <span className="sidebar-pill-neutral">
                  {activePlan.actionHistory.length}
                </span>
              )}
            </button>
          </div>
        </nav>

        {/* Sidebar Footer: Version History & Export */}
        <div className="sidebar-footer">
          {planHistory.length > 1 && (
            <div className="sidebar-versions">
              <span className="sidebar-section-label">PLAN REVISIONS</span>
              <div className="version-tabs">
                {planHistory.map((pv, idx) => (
                  <button
                    key={pv.versionId}
                    type="button"
                    className={`version-tab ${idx === activeVersionIdx ? "active" : ""}`}
                    onClick={() => setActiveVersionIdx(idx)}
                  >
                    v{pv.versionNumber}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activePlan && (
            <div className="sidebar-export-row">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={handleDownloadMarkdown}
              >
                Export .md
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => window.print()}
              >
                Print PDF
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* =====================================================================
          MAIN WORKSPACE FRAME (Top Command Bar + Active View Canvas)
         ===================================================================== */}
      <main className="app-main-frame">
        {/* TOP COMMAND & STATUS BAR */}
        <header className="top-command-bar no-print">
          <div className="command-bar-left">
            <span className="breadcrumb-project">{brief.name}</span>
            <span className="breadcrumb-sep">/</span>
            <strong className="breadcrumb-current">
              {activeView === "setup" && "Festival Brief & Rules"}
              {activeView === "stage" &&
                `${activeStageBrief.name} (${activeStageBrief.genreLabel})`}
              {activeView === "matrix" && "Brand × Stage Comparison Matrix"}
              {activeView === "benchmark" &&
                "Controlled LLM vs. Qloo Grounding Benchmark"}
              {activeView === "audit" && "Qloo API & Solver Audit Log"}
            </strong>

            <div className="active-rules-strip">
              {brief.constraints.map((c) => (
                <span
                  key={c.id}
                  className="top-rule-chip"
                  title={c.reason ?? c.id}
                >
                  {formatConstraintTypeLabel(c.type)}:{" "}
                  <strong>
                    {formatCategoryLabel(c.category ?? c.brandId ?? c.scope)}
                  </strong>
                </span>
              ))}
            </div>

            {hasUnappliedSetupEdits && (
              <span className="unapplied-edits-pill">
                Unapplied Setup Edits — Click 'Re-Run Qloo Match' to apply
              </span>
            )}
          </div>

          {activePlan && (
            <form
              className="command-revision-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!revisionInstruction.trim()) return;
                void executeRevision(brief, revisionInstruction);
              }}
            >
              <input
                type="text"
                placeholder="Simulate change (e.g. 'Mark Red Bull unavailable' or 'Ban energy_drink on Dance Arena')"
                value={revisionInstruction}
                onChange={(e) => setRevisionInstruction(e.target.value)}
              />
              <button
                type="submit"
                className="btn-secondary btn-sm"
                disabled={loading || !revisionInstruction.trim()}
              >
                {loading ? "Simulating..." : "Simulate"}
              </button>
            </form>
          )}
        </header>

        {/* PROMINENT LIVE SIMULATION / RECALCULATION BANNER */}
        {loading && (
          <div className="live-simulation-banner no-print" role="status">
            <div className="simulation-progress-bar" />
            <div className="simulation-banner-content">
              <span className="simulation-pulse-dot" />
              <div>
                <strong>
                  Recalculating Stage Allocations & Qloo Cultural Affinities...
                </strong>
                <span>
                  Running deterministic constraint solver across all stages and
                  shortlist candidates.
                </span>
              </div>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="alert-box alert-error no-print" role="alert">
            <strong>Live Qloo API / Server Error:</strong> {errorMessage}
          </div>
        )}

        {activePlan && activePlan.unresolvedConflicts.length > 0 && (
          <div className="alert-box alert-warning no-print">
            <strong>Commercial Rule Conflict Detected:</strong>{" "}
            {activePlan.unresolvedConflicts.join(" · ")}
          </div>
        )}

        {/* ===================================================================
            VIEW 1: FESTIVAL BRIEF & RULES SETUP
           =================================================================== */}
        {activeView === "setup" && (
          <div className="workspace-scroll-pane">
            <div className="setup-columns-grid">
              {/* COLUMN 1: FESTIVAL & STAGES */}
              <div className="surface-card">
                <div className="card-section-header">
                  <span className="pastel-badge badge-lavender">STEP 1</span>
                  <h2>Stages, Lineups & Physical Envelopes</h2>
                </div>
                <p className="muted-text">
                  Configure the 3 stages, performing artists, stage capacity
                  tier, and activation zone footprint.
                </p>

                <div className="field-row">
                  <label>
                    Festival Name
                    <input
                      type="text"
                      value={brief.name}
                      onChange={(e) => {
                        setBrief({ ...brief, name: e.target.value });
                        if (activePlan) setHasUnappliedSetupEdits(true);
                      }}
                    />
                  </label>
                  <label>
                    Location
                    <input
                      type="text"
                      value={brief.location}
                      onChange={(e) => {
                        setBrief({ ...brief, location: e.target.value });
                        if (activePlan) setHasUnappliedSetupEdits(true);
                      }}
                    />
                  </label>
                </div>

                <div className="stage-editors">
                  {brief.stages.map((stage) => (
                    <div
                      key={`${brief.id}-${stage.id}`}
                      className="stage-editor-box"
                    >
                      <div className="stage-editor-top">
                        <strong>{stage.name}</strong>
                        <span className="pastel-badge badge-sky">
                          {stage.genreLabel}
                        </span>
                      </div>
                      <label className="small-label">
                        Performing Artists (comma-separated)
                        <input
                          type="text"
                          defaultValue={stage.artists.join(", ")}
                          onBlur={(e) =>
                            handleStageArtistsChange(stage.id, e.target.value)
                          }
                        />
                      </label>
                      <div className="format-selectors">
                        <label className="small-label">
                          Stage Tier & Crowd Capacity
                          <select
                            value={
                              stage.activationFormat?.stageTier ??
                              (stage.id === "stage-1"
                                ? "headliner_arena"
                                : stage.id === "stage-2"
                                  ? "secondary_stage"
                                  : "intimate_tent")
                            }
                            onChange={(e) =>
                              handleStageFormatChange(
                                stage.id,
                                "stageTier",
                                e.target.value as StageCapacityTier,
                              )
                            }
                          >
                            <option value="headliner_arena">
                              Main Headliner Arena (25k+ cap)
                            </option>
                            <option value="secondary_stage">
                              Secondary Stage (8k–15k cap)
                            </option>
                            <option value="intimate_tent">
                              Intimate Tent & Lounge (2k–5k cap)
                            </option>
                          </select>
                        </label>
                        <label className="small-label">
                          Space Footprint
                          <select
                            value={
                              stage.activationFormat?.requiredSpaceFootprint ??
                              "medium"
                            }
                            onChange={(e) =>
                              handleStageFormatChange(
                                stage.id,
                                "requiredSpaceFootprint",
                                e.target.value as SpaceFootprint,
                              )
                            }
                          >
                            <option value="compact">
                              Compact (Express Kiosk)
                            </option>
                            <option value="medium">
                              Medium (Interactive Pop-Up)
                            </option>
                            <option value="large">
                              Large (Flagship Pavilion)
                            </option>
                          </select>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* COLUMN 2: CANDIDATE BRAND POOL */}
              <div className="surface-card">
                <div className="card-section-header">
                  <span className="pastel-badge badge-mint">STEP 2</span>
                  <h2>
                    Target Brand Pool ({brief.suppliedBrands.length}) + Stage
                    Qloo Discovery
                  </h2>
                </div>
                <p className="muted-text">
                  Your supplied target brands are evaluated across all stages
                  for exclusivity routing, while Qloo discovers additional
                  stage-specific brands tailored to each stage's lineup.
                </p>

                <div className="brand-chip-list">
                  {brief.suppliedBrands.map((b) => (
                    <span
                      key={b.name}
                      className={`brand-chip ${b.available === false ? "chip-unavailable" : ""}`}
                    >
                      <strong>{b.name}</strong>
                      <small>{formatCategoryLabel(b.category)}</small>
                    </span>
                  ))}
                </div>

                <form className="inline-form" onSubmit={handleAddSuppliedBrand}>
                  <input
                    type="text"
                    placeholder="Brand name (e.g. Vans)"
                    value={newBrandName}
                    onChange={(e) => setNewBrandName(e.target.value)}
                  />
                  <select
                    value={newBrandCategory}
                    onChange={(e) => setNewBrandCategory(e.target.value)}
                  >
                    {availableCategories.map((cat) => (
                      <option key={cat} value={cat}>
                        {formatCategoryLabel(cat)}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn-secondary">
                    + Add Brand
                  </button>
                </form>
              </div>

              {/* COLUMN 3: STRUCTURED COMMERCIAL GUARDRAILS */}
              <div className="surface-card setup-launch-column">
                <div>
                  <div className="card-section-header">
                    <span className="pastel-badge badge-peach">STEP 3</span>
                    <h2>Commercial Rules ({brief.constraints.length})</h2>
                  </div>
                  <p className="muted-text">
                    Build structured deal guardrails below. Changes made here
                    are staged locally until you click{" "}
                    <strong>Run Qloo Match</strong>.
                  </p>

                  <div className="constraints-list">
                    {brief.constraints.map((c) => (
                      <div key={c.id} className="constraint-item">
                        <div>
                          <span className="constraint-type">
                            {formatConstraintTypeLabel(c.type)}
                          </span>
                          <div className="constraint-desc">
                            {c.reason ??
                              `${c.scope === "festival" ? "Festival-wide" : c.stageId}: ${formatCategoryLabel(c.category ?? c.brandId ?? "")}`}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn-ghost-sm"
                          disabled={loading}
                          onClick={() => handleRemoveConstraint(c.id)}
                          title="Remove rule"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Structured 3-Part Rule Builder */}
                  <form
                    className="structured-rule-builder"
                    onSubmit={handleAddStructuredRule}
                  >
                    <span className="small-caps-label">
                      ADD COMMERCIAL GUARDRAIL
                    </span>

                    <div className="rule-builder-grid">
                      <label className="small-label">
                        1. Rule Type
                        <select
                          value={ruleBuilderType}
                          onChange={(e) => {
                            const nextType = e.target
                              .value as typeof ruleBuilderType;
                            setRuleBuilderType(nextType);
                            if (nextType === "category_exclusivity") {
                              setRuleBuilderScope("festival");
                            } else if (
                              nextType === "locked_placement" &&
                              ruleBuilderScope === "festival"
                            ) {
                              setRuleBuilderScope(
                                brief.stages[0]?.id ?? "stage-1",
                              );
                            }
                          }}
                        >
                          <option value="category_ban">
                            Restrict / Ban Category
                          </option>
                          <option value="category_exclusivity">
                            Category Exclusivity (Max 1 Stage)
                          </option>
                          <option value="locked_placement">
                            Lock Sponsor to Stage
                          </option>
                          <option value="availability">
                            Exclude Specific Brand
                          </option>
                        </select>
                      </label>

                      {ruleBuilderType === "category_ban" ||
                      ruleBuilderType === "category_exclusivity" ? (
                        <label className="small-label">
                          2. Target Category
                          <select
                            value={ruleBuilderCategory}
                            onChange={(e) =>
                              setRuleBuilderCategory(e.target.value)
                            }
                          >
                            {availableCategories.map((cat) => (
                              <option key={cat} value={cat}>
                                {formatCategoryLabel(cat)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <label className="small-label">
                          2. Target Sponsor Brand
                          <select
                            value={ruleBuilderBrandName}
                            onChange={(e) =>
                              setRuleBuilderBrandName(e.target.value)
                            }
                          >
                            {selectableBrandNames.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      <label className="small-label">
                        3. Scope
                        <select
                          value={
                            ruleBuilderType === "category_exclusivity" ||
                            ruleBuilderType === "availability"
                              ? "festival"
                              : ruleBuilderScope
                          }
                          disabled={
                            ruleBuilderType === "category_exclusivity" ||
                            ruleBuilderType === "availability"
                          }
                          onChange={(e) => setRuleBuilderScope(e.target.value)}
                        >
                          {ruleBuilderType !== "locked_placement" && (
                            <option value="festival">
                              Entire Festival (All Stages)
                            </option>
                          )}
                          {brief.stages.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} Only
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <button
                      type="submit"
                      className="btn-secondary full-width"
                      disabled={loading}
                    >
                      + Stage Rule in Brief
                    </button>
                  </form>
                </div>

                <div className="launch-cta-box">
                  <button
                    type="button"
                    className="btn-primary btn-lg full-width"
                    disabled={loading}
                    onClick={() => void handleGenerateInitialPlan()}
                  >
                    {loading
                      ? "Evaluating Lineup & Running Solver..."
                      : activePlan && hasUnappliedSetupEdits
                        ? "Apply Staged Changes & Re-Run Qloo Match"
                        : "Run Qloo Match & Open Stage View"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            VIEW 2: SINGLE-STAGE FOCUS WORKSPACE (Master-Detail Split View)
           =================================================================== */}
        {activeView === "stage" && (
          <>
            {!activePlan ? (
              <div className="empty-stage-state">
                <div className="surface-card empty-state-card">
                  <span className="pastel-badge badge-lavender">
                    {activeStageBrief.name} · {activeStageBrief.genreLabel}
                  </span>
                  <h2>Ready to Evaluate {activeStageBrief.name}</h2>
                  <p className="muted-text">
                    Lineup: <strong>{activeStageBrief.artists.join(", ")}</strong>
                  </p>
                  <button
                    type="button"
                    className="btn-primary btn-lg"
                    disabled={loading}
                    onClick={() => void handleGenerateInitialPlan()}
                  >
                    {loading
                      ? "Querying Live Qloo API..."
                      : "Run Qloo Match Now"}
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={`stage-master-detail-split ${loading ? "is-recalculating" : ""}`}
              >
                {/* LEFT/CENTER PANE: VISUAL STAGE DATA & SPEC SHEET */}
                <div className="stage-center-pane">
                  {/* 1. Stage Header Strip */}
                  <div className="surface-card stage-focus-header-card">
                    <div className="stage-focus-title-row">
                      <div>
                        <div className="stage-focus-badges">
                          <span className="pastel-badge badge-lavender">
                            {activeStageBrief.genreLabel}
                          </span>
                          {activeStageBrief.activationFormat && (
                            <span className="pastel-badge badge-sky">
                              {formatStageTierLabel(
                                activeStageBrief.activationFormat.stageTier,
                                activeStageBrief.id,
                              )}{" "}
                              ·{" "}
                              {
                                activeStageBrief.activationFormat
                                  .requiredSpaceFootprint
                              }{" "}
                              footprint
                            </span>
                          )}
                        </div>
                        <h1 className="stage-focus-h1">
                          {activeStageBrief.name}
                        </h1>
                      </div>

                      {/* Quick Stage Switcher Pills */}
                      <div className="stage-quick-pills no-print">
                        {activePlan.briefSnapshot.stages.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className={`stage-switch-pill ${s.id === activeStageBrief.id ? "active" : ""}`}
                            onClick={() => setSelectedStageId(s.id)}
                          >
                            {s.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="stage-artists-strip">
                      <span className="small-caps-label">LINEUP ARTISTS:</span>
                      {activeStageBrief.artists.map((artistName) => {
                        const resolved = activePlan.resolvedArtists[artistName];
                        return (
                          <span key={artistName} className="artist-verified-chip">
                            <strong>{artistName}</strong>
                            <small>
                              {resolved?.status === "resolved"
                                ? "Qloo Verified"
                                : "Unresolved"}
                            </small>
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  {/* 2. Winning Partner & Deal Action Bar (Pastel Sage Mint) */}
                  {activeStageAllocation && (
                    <div
                      className={`surface-card partner-hero-card ${!primarySponsor ? "unfilled" : ""}`}
                    >
                      <div className="partner-hero-top">
                        <div>
                          <span className="pastel-badge badge-mint">
                            {primarySponsor
                              ? "RECOMMENDED STAGE PARTNER"
                              : "UNFILLED STAGE SLOT"}
                          </span>
                          <h2 className="partner-hero-name">
                            {primarySponsor
                              ? primarySponsor.name
                              : "No Eligible Sponsor Available"}
                          </h2>
                          {primarySponsor && (
                            <div className="partner-meta-pills">
                              <span className="meta-pill">
                                {formatCategoryLabel(primarySponsor.category)}
                              </span>
                              <span className="meta-pill">
                                {formatSourceLabel(primarySponsor.source)}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="partner-hero-metrics">
                          <div className="metric-box">
                            <span className="small-caps-label">
                              STAGE FIT SCORE
                            </span>
                            <strong className="metric-big-num">
                              {primaryScore !== null
                                ? `${primaryScore.toFixed(3)} Fit`
                                : "—"}
                            </strong>
                            <small>
                              {activeStageAllocation.supportedArtistsCount}/
                              {activeStageAllocation.totalStageArtistsCount}{" "}
                              artists covered
                            </small>
                          </div>

                          <div className="metric-box">
                            <span className="small-caps-label">
                              STANDBY BACKUP
                            </span>
                            <strong className="metric-standby-name">
                              {activeStageAllocation.alternativeSponsor
                                ? activeStageAllocation.alternativeSponsor.name
                                : "None"}
                            </strong>
                            <small>Pre-vetted across all stages</small>
                          </div>
                        </div>
                      </div>

                      {activeStageAllocation.activationBrief
                        ?.stageTradeoffSummary && (
                        <div className="cross-stage-summary-bar">
                          <strong>Placement Fit Summary:</strong>{" "}
                          {
                            activeStageAllocation.activationBrief
                              .stageTradeoffSummary
                          }
                        </div>
                      )}

                      {!primarySponsor &&
                        activeStageAllocation.blockingReasons.length > 0 && (
                          <div className="blocking-box">
                            <strong>Blocked:</strong>{" "}
                            {activeStageAllocation.blockingReasons.join(" · ")}
                          </div>
                        )}

                      {primarySponsor && (
                        <div className="partner-actions-bar no-print">
                          <span className="small-caps-label">
                            INSTANT STAGE SIMULATIONS:
                          </span>
                          <div className="quick-actions-row">
                            <button
                              type="button"
                              className="btn-action"
                              disabled={loading}
                              onClick={() =>
                                handleToggleStageLock(
                                  activeStageBrief.id,
                                  activeStageBrief.name,
                                  primarySponsor.qlooId,
                                  primarySponsor.name,
                                )
                              }
                            >
                              {isStageLocked ? "Unlock Deal" : "Lock Deal"}
                            </button>
                            <button
                              type="button"
                              className="btn-action btn-danger-outline"
                              disabled={loading}
                              onClick={() =>
                                handleMarkSponsorUnavailable(
                                  primarySponsor.qlooId,
                                  primarySponsor.name,
                                )
                              }
                            >
                              Simulate Drop-Out
                            </button>
                            <button
                              type="button"
                              className="btn-action"
                              disabled={loading}
                              onClick={() =>
                                handleQuickBanCategory(
                                  activeStageBrief.id,
                                  primarySponsor.category,
                                )
                              }
                            >
                              Restrict{" "}
                              {formatCategoryLabel(primarySponsor.category)}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. Visual Artist-by-Artist Affinity Breakdown */}
                  {activeStageAllocation &&
                    activeStageAllocation.artistEvidence.length > 0 && (
                      <div className="surface-card">
                        <div className="duel-card-header">
                          <div>
                            <span className="pastel-badge badge-sky">
                              QLOO ARTIST AFFINITY PROOF
                            </span>
                            <h3>
                              Artist-by-Artist Breakdown:{" "}
                              {primarySponsor?.name ?? "Winner"} vs.{" "}
                              {comparedBrand?.name ?? "Challenger"}
                            </h3>
                          </div>

                          {netMargin !== null && (
                            <div className="net-margin-pill">
                              <span>Net Stage Lead:</span>
                              <strong>
                                {netMargin >= 0 ? "+" : ""}
                                {netMargin.toFixed(3)} Fit
                              </strong>
                            </div>
                          )}
                        </div>

                        <div className="callout-highlight-banner">
                          <strong>Head-to-Head Comparison:</strong> Showing how
                          each performing artist on{" "}
                          <strong>{activeStageBrief.name}</strong> ranks{" "}
                          <strong>{primarySponsor?.name}</strong> against{" "}
                          <strong>
                            {comparedBrand?.name ?? "the runner-up"}
                          </strong>{" "}
                          across this stage's{" "}
                          <strong>{stageBrandRows.length} evaluated brands</strong>
                          . Select any brand in the right-hand leaderboard to
                          switch the challenger.
                        </div>

                        <div className="artist-duel-rows">
                          {activeStageAllocation.artistEvidence.map((winEv) => {
                            const chalEv =
                              comparedBrandRow?.ev?.artistEvidence.find(
                                (e) => e.artistId === winEv.artistId,
                              );
                            const winFit = normalizeFit(winEv.ordinalPoints);
                            const chalFit = normalizeFit(
                              chalEv?.ordinalPoints ?? null,
                            );
                            const rowLead =
                              winFit !== null && chalFit !== null
                                ? winFit - chalFit
                                : null;

                            const effectivePoolSize =
                              stageBrandRows.length > 0
                                ? stageBrandRows.length
                                : winEv.shortlistSize;

                            return (
                              <div
                                key={winEv.id}
                                className="artist-duel-row-card"
                              >
                                <div className="artist-duel-top">
                                  <div>
                                    <strong className="artist-row-name">
                                      {winEv.artistName}
                                    </strong>
                                    <span className="artist-source-tag">
                                      {winEv.sourceType === "live" ||
                                      winEv.sourceType === "cached_live"
                                        ? "Live Qloo Signal"
                                        : "Fixture Signal"}
                                    </span>
                                  </div>
                                  {rowLead !== null && (
                                    <span
                                      className={`artist-lead-badge ${rowLead >= 0 ? "positive" : "negative"}`}
                                    >
                                      {primarySponsor?.name}{" "}
                                      {rowLead >= 0 ? "+" : ""}
                                      {rowLead.toFixed(3)} Fit
                                    </span>
                                  )}
                                </div>

                                {/* Winner Bar */}
                                <div className="brand-bar-comparison-line">
                                  <div className="brand-bar-label">
                                    <span className="rank-chip winner">
                                      {winEv.ordinalRank !== null
                                        ? `#${Math.min(winEv.ordinalRank, effectivePoolSize ?? winEv.ordinalRank)}/${effectivePoolSize}`
                                        : "—"}
                                    </span>
                                    <strong>{primarySponsor?.name}</strong>
                                  </div>
                                  <div className="brand-bar-track">
                                    <div
                                      className="brand-bar-fill winner"
                                      style={{
                                        width: `${Math.round((winFit ?? 0) * 100)}%`,
                                      }}
                                    />
                                  </div>
                                  <div className="brand-bar-numbers">
                                    <strong>
                                      {winFit !== null
                                        ? `${winFit.toFixed(3)} Fit`
                                        : "—"}
                                    </strong>
                                  </div>
                                </div>

                                {/* Compared Challenger Bar */}
                                {comparedBrand && (
                                  <div className="brand-bar-comparison-line">
                                    <div className="brand-bar-label">
                                      <span className="rank-chip challenger">
                                        {chalEv?.ordinalRank !== null &&
                                        chalEv?.ordinalRank !== undefined
                                          ? `#${Math.min(chalEv.ordinalRank, effectivePoolSize ?? chalEv.ordinalRank)}/${effectivePoolSize}`
                                          : "—"}
                                      </span>
                                      <span>{comparedBrand.name}</span>
                                    </div>
                                    <div className="brand-bar-track">
                                      <div
                                        className="brand-bar-fill challenger"
                                        style={{
                                          width: `${Math.round((chalFit ?? 0) * 100)}%`,
                                        }}
                                      />
                                    </div>
                                    <div className="brand-bar-numbers">
                                      <span>
                                        {chalFit !== null
                                          ? `${chalFit.toFixed(3)} Fit`
                                          : "—"}
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  {/* 4. Suggestive Activation Spec Sheet & 3 Immersion Options */}
                  {activeStageAllocation?.activationBrief && (
                    <div className="surface-card activation-spec-card">
                      <div className="duel-card-header">
                        <div>
                          <span className="pastel-badge badge-lavender">
                            SUGGESTED ACTIVATION DIRECTIONS (BRAINSTORM SPEC)
                          </span>
                          <h3>
                            {
                              activeStageAllocation.activationBrief
                                .experienceTitle
                            }
                          </h3>
                        </div>
                        <span className="pastel-badge badge-mint">
                          Envelope Fit Verified
                        </span>
                      </div>

                      <p className="muted-text">
                        Exploratory creative starting points grounded in{" "}
                        <strong>{activeStageBrief.name}</strong>'s Qloo cultural
                        tags and physical stage envelope.
                      </p>

                      <div className="spec-sheet-grid">
                        <div className="spec-field-box">
                          <span className="small-caps-label">
                            STAGE ENVELOPE & CAPACITY TIER
                          </span>
                          <strong>
                            {formatStageTierLabel(
                              activeStageAllocation.activationBrief
                                .formatCompliance.stageTier ??
                                activeStageBrief.activationFormat?.stageTier,
                              activeStageBrief.id,
                            )}
                          </strong>
                          <span className="spec-sub">
                            Zone Format:{" "}
                            <strong>
                              {
                                activeStageAllocation.activationBrief
                                  .formatCompliance.formatName
                              }
                            </strong>{" "}
                            · Footprint:{" "}
                            <strong>
                              {
                                activeStageAllocation.activationBrief
                                  .formatCompliance.requiredSpaceFootprint
                              }
                            </strong>
                          </span>
                        </div>

                        <div className="spec-field-box">
                          <span className="small-caps-label">
                            QLOO MUSIC & LIFESTYLE TAGS
                          </span>
                          <div className="tag-row">
                            {activeStageAllocation.activationBrief
                              .culturalTagsUsed.length > 0 ? (
                              activeStageAllocation.activationBrief.culturalTagsUsed.map(
                                (tag) => (
                                  <span key={tag} className="tag-pill">
                                    #{tag}
                                  </span>
                                ),
                              )
                            ) : (
                              <span className="tag-pill">
                                #{activeStageBrief.genreLabel}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="spec-field-box spec-field-full">
                          <span className="small-caps-label">
                            SUGGESTED ON-SITE FAN IMMERSION OPTIONS (SELECT OR
                            COMBINE)
                          </span>
                          <p className="spec-direction-lead">
                            {
                              activeStageAllocation.activationBrief
                                .visitorExperience
                            }
                          </p>
                          <div className="fan-options-grid">
                            {resolveFanActivityOptions(
                              activeStageBrief,
                              activeStageAllocation,
                            ).map((optionText, idx) => (
                              <div key={idx} className="fan-option-card">
                                <span className="fan-option-badge">
                                  Option {idx + 1}
                                </span>
                                <p>{optionText}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="spec-field-box spec-field-full">
                          <span className="small-caps-label">
                            SUGGESTED PARTNER ROLE & COMMERCIAL VERIFICATION
                          </span>
                          <p>
                            {activeStageAllocation.activationBrief.sponsorRole}
                          </p>
                          <small className="commercial-check-note">
                            Commercial check before sign-off:{" "}
                            {
                              activeStageAllocation.unansweredCommercialQuestion
                            }
                          </small>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* RIGHT PANE: INTERACTIVE STAGE BRAND LEADERBOARD */}
                <aside
                  className="stage-right-inspector no-print"
                  aria-label="Stage Brand Leaderboard"
                >
                  <div className="inspector-sticky-header">
                    <span className="small-caps-label">
                      {activeStageBrief.name.toUpperCase()} SHORTLIST RANKINGS
                    </span>
                    <h3>
                      Stage-Evaluated Brands ({stageBrandRows.length})
                    </h3>
                    <div className="callout-highlight-banner compact">
                      <strong>Click any brand below</strong> to compare it
                      head-to-head against{" "}
                      <strong>{primarySponsor?.name ?? "the winner"}</strong>{" "}
                      across all stage artists.
                    </div>
                  </div>

                  <div className="leaderboard-list">
                    {stageBrandRows.map((row, idx) => {
                      const isCompared =
                        comparedBrand?.qlooId === row.brand.qlooId &&
                        !row.isWinner;

                      let statusBadgeClass = "badge-neutral";
                      let statusText = "Eligible";
                      if (row.isWinner) {
                        statusBadgeClass = "badge-mint";
                        statusText = "Stage Winner";
                      } else if (row.effectiveBlockReason) {
                        statusBadgeClass = "badge-peach";
                        statusText = "Rule Blocked";
                      } else if (row.isStandby) {
                        statusBadgeClass = "badge-sky";
                        statusText = "Standby";
                      }

                      return (
                        <button
                          key={row.brand.qlooId}
                          type="button"
                          className={`leaderboard-item ${row.isWinner ? "is-winner" : ""} ${isCompared ? "is-compared" : ""} ${row.effectiveBlockReason ? "is-blocked" : ""}`}
                          onClick={() => {
                            if (!row.isWinner) {
                              setComparedBrandByStage((prev) => ({
                                ...prev,
                                [activeStageBrief.id]: row.brand.qlooId,
                              }));
                            }
                          }}
                        >
                          <div className="leaderboard-item-top">
                            <div className="leaderboard-brand-title">
                              <span className="leaderboard-rank">
                                #{idx + 1}
                              </span>
                              <strong>{row.brand.name}</strong>
                              <small>
                                {formatCategoryLabel(row.brand.category)}
                              </small>
                            </div>
                            <span className={`pastel-badge ${statusBadgeClass}`}>
                              {statusText}
                            </span>
                          </div>

                          <div className="leaderboard-score-row">
                            <div className="leaderboard-mini-track">
                              <div
                                className={`leaderboard-mini-fill ${row.isWinner ? "winner" : row.effectiveBlockReason ? "blocked" : "normal"}`}
                                style={{
                                  width: `${Math.round((row.score ?? 0) * 100)}%`,
                                }}
                              />
                            </div>
                            <strong className="leaderboard-pts">
                              {row.score !== null
                                ? `${row.score.toFixed(3)} Fit`
                                : "—"}
                            </strong>
                          </div>

                          <div className="leaderboard-source-row">
                            <span className="leaderboard-source-tag">
                              {row.brand.source === "supplied"
                                ? "Organizer Target Pool"
                                : "Qloo Stage Discovery"}
                            </span>
                          </div>

                          {row.effectiveBlockReason && (
                            <div className="leaderboard-block-note">
                              Blocked: {row.effectiveBlockReason}
                            </div>
                          )}

                          {isCompared && (
                            <div className="comparing-active-tag">
                              Comparing against {primarySponsor?.name}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </aside>
              </div>
            )}
          </>
        )}

        {/* ===================================================================
            VIEW 3: BRAND × STAGE MATRIX
           =================================================================== */}
        {activeView === "matrix" && activePlan && (
          <div className="workspace-scroll-pane">
            <SponsorMatrix
              plan={activePlan}
              onInspectCell={(stageId, brandId) =>
                handleSelectStageFromMatrix(stageId, brandId)
              }
            />
          </div>
        )}

        {/* ===================================================================
            VIEW 4: CONTROLLED LLM VS. QLOO BENCHMARK
           =================================================================== */}
        {activeView === "benchmark" && activePlan && (
          <div className="workspace-scroll-pane">
            <BenchmarkComparison
              plan={activePlan}
              onInspectStage={(stageId) => {
                setSelectedStageId(stageId);
                setActiveView("stage");
              }}
            />
          </div>
        )}

        {/* ===================================================================
            VIEW 5: QLOO & SOLVER AUDIT LOG
           =================================================================== */}
        {activeView === "audit" && activePlan && (
          <div className="workspace-scroll-pane">
            <AgentTimeline
              versionNumber={activePlan.versionNumber}
              agentSummary={activePlan.agentSummary}
              actionHistory={activePlan.actionHistory}
              diffLog={activePlan.diffLog}
            />
          </div>
        )}

        {/* ===================================================================
            PRINT-ONLY EXECUTIVE SPONSORSHIP DECK (ALL 3 STAGES + SUMMARY)
           =================================================================== */}
        {activePlan && (
          <PrintExecutiveDeck plan={activePlan} normalizeFit={normalizeFit} />
        )}
      </main>
    </div>
  );
}

