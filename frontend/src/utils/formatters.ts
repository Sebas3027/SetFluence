import type {
  Constraint,
  PlanVersion,
  StageAllocation,
  StageBrief,
  StageCapacityTier,
} from "@setfluence/shared";

export function formatCategoryLabel(category: string): string {
  return category
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function formatSourceLabel(source: string): string {
  if (source === "supplied") return "Organizer Shortlist";
  if (source === "discovered") return "Stage Qloo Match";
  return "Organizer + Qloo";
}

export function formatStageTierLabel(
  tier?: StageCapacityTier,
  stageId?: string,
): string {
  const effective =
    tier ??
    (stageId === "stage-1"
      ? "headliner_arena"
      : stageId === "stage-2"
        ? "secondary_stage"
        : "intimate_tent");
  if (effective === "headliner_arena") return "Main Headliner Arena (25k+ cap)";
  if (effective === "secondary_stage") return "Secondary Stage (8k–15k cap)";
  return "Intimate Tent & Lounge (2k–5k cap)";
}

export function formatConstraintTypeLabel(type: Constraint["type"]): string {
  switch (type) {
    case "category_exclusivity":
      return "Category Exclusivity";
    case "category_ban":
      return "Category Restriction";
    case "locked_placement":
      return "Locked Placement";
    case "availability":
      return "Sponsor Availability";
    case "format_mismatch":
      return "Zone Format Rule";
  }
}

export function resolveFanActivityOptions(
  stage: StageBrief,
  alloc: StageAllocation,
): string[] {
  const existing = alloc.activationBrief?.fanActivityOptions;
  if (existing && existing.length >= 3) {
    return existing;
  }

  const brandName = alloc.primarySponsor?.name ?? "Partner";
  const categoryLabel = alloc.primarySponsor
    ? formatCategoryLabel(alloc.primarySponsor.category).toLowerCase()
    : "lifestyle";
  const formatName =
    alloc.activationBrief?.formatCompliance.formatName ??
    stage.activationFormat?.name ??
    "Interactive Fan Zone";
  const footprint =
    alloc.activationBrief?.formatCompliance.requiredSpaceFootprint ??
    stage.activationFormat?.requiredSpaceFootprint ??
    "10x10m";
  const topTags =
    alloc.activationBrief?.culturalTagsUsed.slice(0, 2).join(" & ") ||
    stage.genreLabel;
  const artistList = stage.artists.slice(0, 2).join(" and ");

  return [
    `Interactive ${formatName} (${footprint}): Could invite ${stage.name} fans between ${artistList} sets to customize limited-edition ${brandName} ${categoryLabel} pieces inspired by ${topTags} motifs.`,
    `Artist-Curated Lounge & Listening Drop: Might host an intimate ${brandName} pre-set warm-up session or visual photo studio celebrating ${stage.genreLabel} culture with instant digital keepsakes.`,
    `Crowd-Triggered Stage Moment: Could pair ${brandName} on-site check-ins at ${stage.name} with exclusive viewing-deck upgrades, custom festival merch drops, or post-set artist playlists.`,
  ];
}

export function renderMarkdownBrief(plan: PlanVersion): string {
  const lines: string[] = [
    `# ${plan.briefSnapshot.name} — Sponsorship Partnership Deck (v${plan.versionNumber})`,
    `- **Location:** ${plan.briefSnapshot.location}`,
    `- **Generated At:** ${plan.createdAt}`,
    `- **Summary:** ${plan.agentSummary}`,
    ``,
    `> Cultural scores represent *shortlist fit scores* (0.580–1.000 Fit), combining Qloo artist-to-brand affinity with stage shortlist rank.`,
    ``,
  ];

  for (const alloc of plan.allocations) {
    const stageBrief =
      plan.briefSnapshot.stages.find((s) => s.id === alloc.stageId) ??
      plan.briefSnapshot.stages[0]!;
    lines.push(`## ${alloc.stageName}`);
    lines.push(
      `- **Primary Partner:** ${alloc.primarySponsor ? `${alloc.primarySponsor.name} (${formatCategoryLabel(alloc.primarySponsor.category)})` : "UNFILLED"}`,
    );
    lines.push(
      `- **Standby Partner:** ${alloc.alternativeSponsor ? `${alloc.alternativeSponsor.name} (${formatCategoryLabel(alloc.alternativeSponsor.category)})` : "None"}`,
    );
    lines.push(
      `- **Stage Fit Score:** ${alloc.relativeFitScore !== null ? `${alloc.relativeFitScore.toFixed(3)} Fit` : "N/A"} (${alloc.supportedArtistsCount}/${alloc.totalStageArtistsCount} artists covered)`,
    );
    if (alloc.activationBrief) {
      lines.push(
        `- **Suggested Activation Direction:** ${alloc.activationBrief.experienceTitle}`,
      );
      lines.push(
        `  - *Overview:* ${alloc.activationBrief.visitorExperience}`,
      );
      const fanOptions = resolveFanActivityOptions(stageBrief, alloc);
      fanOptions.forEach((opt, idx) => {
        lines.push(`  - *Option ${idx + 1}:* ${opt}`);
      });
      lines.push(`  - *Partner Role:* ${alloc.activationBrief.sponsorRole}`);
      if (alloc.activationBrief.stageTradeoffSummary) {
        lines.push(
          `  - *Cross-Stage Fit:* ${alloc.activationBrief.stageTradeoffSummary}`,
        );
      }
    }
    lines.push(
      `- **Commercial Next Step:** ${alloc.unansweredCommercialQuestion}`,
    );
    lines.push(``);
  }

  return lines.join("\n");
}
