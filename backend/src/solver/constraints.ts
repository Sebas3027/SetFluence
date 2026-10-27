import type {
  CandidateBrand,
  Constraint,
  FestivalBrief,
  NoiseLevel,
  StageBrief,
} from "@setfluence/shared";

const NOISE_RANK: Record<NoiseLevel, number> = {
  quiet: 1,
  moderate: 2,
  loud: 3,
};

export interface StageEligibilityResult {
  eligible: boolean;
  satisfiedConstraintIds: string[];
  blockingReasons: string[];
}

const normalizeCategory = (category: string): string =>
  category.trim().toLowerCase();

/**
 * Checks whether a candidate brand's known organizer activation facts violate a stage's ActivationFormat.
 * If the brand has no specific activation footprint/noise facts entered yet, it is treated as compatible.
 */
export function checkFormatCompatibility(
  stage: StageBrief,
  brand: CandidateBrand,
): { compatible: boolean; reason?: string } {
  const format = stage.activationFormat;
  if (!format) return { compatible: true };

  const facts = brand.organizerFacts;

  if (facts.operatingNoiseLevel) {
    const brandNoise = NOISE_RANK[facts.operatingNoiseLevel];
    const stageCeiling = NOISE_RANK[format.noiseLevelCeiling];
    if (brandNoise > stageCeiling) {
      return {
        compatible: false,
        reason: `Proposed activation noise level (${facts.operatingNoiseLevel}) exceeds stage "${stage.name}" ceiling (${format.noiseLevelCeiling} for ${format.name}).`,
      };
    }
  }

  if (
    facts.supportedSpaceFootprints &&
    facts.supportedSpaceFootprints.length > 0 &&
    !facts.supportedSpaceFootprints.includes(format.requiredSpaceFootprint)
  ) {
    return {
      compatible: false,
      reason: `Brand supported footprints (${facts.supportedSpaceFootprints.join(", ")}) do not match stage "${stage.name}" required footprint (${format.requiredSpaceFootprint} for ${format.name}).`,
    };
  }

  return { compatible: true };
}

/**
 * Detects contradictory hard rules in the organizer's brief (for example, a locked placement
 * for a brand whose category is banned or that is marked unavailable).
 * Never silently overrides a hard rule.
 */
export function detectBriefConflicts(
  brief: FestivalBrief,
  candidatePool: CandidateBrand[],
): string[] {
  const conflicts: string[] = [];
  const activeConstraints = brief.constraints.filter((c) => c.active);
  const brandsById = new Map(candidatePool.map((b) => [b.qlooId, b]));
  const stagesById = new Map(brief.stages.map((s) => [s.id, s]));

  const lockedRules = activeConstraints.filter((c) => c.type === "locked_placement");
  const banRules = activeConstraints.filter((c) => c.type === "category_ban");
  const unavailabilityRules = activeConstraints.filter((c) => c.type === "availability");
  const exclusivityRules = activeConstraints.filter(
    (c) => c.type === "category_exclusivity" && c.scope === "festival",
  );

  // Check multiple conflicting locks on the same stage
  const locksByStage = new Map<string, Constraint[]>();
  for (const lock of lockedRules) {
    if (!lock.stageId) continue;
    const list = locksByStage.get(lock.stageId) ?? [];
    list.push(lock);
    locksByStage.set(lock.stageId, list);
  }
  for (const [stageId, stageLocks] of locksByStage.entries()) {
    const distinctBrands = new Set(stageLocks.map((l) => l.brandId).filter(Boolean));
    if (distinctBrands.size > 1) {
      const stageName = stagesById.get(stageId)?.name ?? stageId;
      conflicts.push(
        `Conflicting locked placements on stage "${stageName}": multiple brands (${[...distinctBrands].join(", ")}) locked to the same primary slot.`,
      );
    }
  }

  // Check each locked placement against availability, category bans, and stage format
  for (const lock of lockedRules) {
    if (!lock.stageId || !lock.brandId) continue;
    const stage = stagesById.get(lock.stageId);
    const brand = brandsById.get(lock.brandId);

    if (!brand) {
      conflicts.push(
        `Locked placement [${lock.id}] references unknown candidate brand ID "${lock.brandId}".`,
      );
      continue;
    }

    const stageName = stage?.name ?? lock.stageId;

    if (
      !brand.available ||
      unavailabilityRules.some((r) => r.brandId === brand.qlooId)
    ) {
      conflicts.push(
        `Locked placement conflict on "${stageName}": "${brand.name}" is locked [${lock.id}] but marked unavailable.`,
      );
    }

    for (const ban of banRules) {
      const appliesToStage =
        ban.scope === "festival" || ban.stageId === lock.stageId;
      if (
        appliesToStage &&
        ban.category &&
        normalizeCategory(ban.category) === normalizeCategory(brand.category)
      ) {
        conflicts.push(
          `Locked placement conflict on "${stageName}": "${brand.name}" (${brand.category}) is locked [${lock.id}], but category "${ban.category}" is prohibited by rule [${ban.id}].`,
        );
      }
    }

    if (stage) {
      const formatCheck = checkFormatCompatibility(stage, brand);
      if (!formatCheck.compatible) {
        conflicts.push(
          `Locked placement conflict on "${stageName}": "${brand.name}" is locked [${lock.id}], but ${formatCheck.reason}`,
        );
      }
    }
  }

  // Check if multiple locked placements violate festival-wide category exclusivity
  for (const excl of exclusivityRules) {
    const lockedBrandsWithStages = lockedRules
      .map((l) => ({
        lock: l,
        brand: l.brandId ? brandsById.get(l.brandId) : undefined,
      }))
      .filter((item): item is { lock: Constraint; brand: CandidateBrand } =>
        Boolean(item.brand && item.lock.stageId),
      );

    if (excl.category && excl.category !== "*") {
      const matchingLocks = lockedBrandsWithStages.filter(
        (item) =>
          normalizeCategory(item.brand.category) === normalizeCategory(excl.category!),
      );
      const distinctStages = new Set(matchingLocks.map((m) => m.lock.stageId));
      if (distinctStages.size > 1) {
        conflicts.push(
          `Locked placements (${matchingLocks.map((m) => m.brand.name).join(", ")}) violate festival-wide category exclusivity [${excl.id}] for category "${excl.category}".`,
        );
      }
    } else {
      // Wildcard festival category exclusivity: no two stages may share any category
      const byCategory = new Map<string, string[]>();
      for (const item of lockedBrandsWithStages) {
        const cat = normalizeCategory(item.brand.category);
        const list = byCategory.get(cat) ?? [];
        list.push(item.brand.name);
        byCategory.set(cat, list);
      }
      for (const [cat, names] of byCategory.entries()) {
        if (names.length > 1) {
          conflicts.push(
            `Locked placements (${names.join(", ")}) violate festival-wide category exclusivity [${excl.id}] for category "${cat}".`,
          );
        }
      }
    }
  }

  return conflicts;
}

/**
 * Evaluates whether a single candidate brand is eligible for a single stage under all stage-applicable hard rules.
 * A locked placement does NOT bypass availability, category bans, or format constraints.
 */
export function evaluateStageCandidateEligibility(
  stage: StageBrief,
  brand: CandidateBrand,
  constraints: Constraint[],
): StageEligibilityResult {
  const activeConstraints = constraints.filter((c) => c.active);
  const satisfiedConstraintIds: string[] = [];
  const blockingReasons: string[] = [];

  // 1. Availability check
  const availabilityConstraints = activeConstraints.filter(
    (c) => c.type === "availability" && c.brandId === brand.qlooId,
  );
  if (!brand.available || availabilityConstraints.length > 0) {
    const ruleTag = availabilityConstraints[0]
      ? ` [${availabilityConstraints[0].id}]`
      : "";
    blockingReasons.push(`Candidate "${brand.name}" is marked unavailable${ruleTag}.`);
  } else {
    for (const c of activeConstraints.filter((r) => r.type === "availability")) {
      satisfiedConstraintIds.push(c.id);
    }
  }

  // 2. Category bans (festival-wide or stage-specific)
  for (const c of activeConstraints) {
    if (c.type !== "category_ban") continue;
    const applies = c.scope === "festival" || c.stageId === stage.id;
    if (!applies) continue;

    if (
      c.category &&
      normalizeCategory(c.category) === normalizeCategory(brand.category)
    ) {
      blockingReasons.push(
        `Category "${brand.category}" is prohibited on ${c.scope === "festival" ? "all stages" : `stage "${stage.name}"`} [${c.id}].`,
      );
    } else {
      satisfiedConstraintIds.push(c.id);
    }
  }

  // 3. Locked placements on this stage
  const stageLocks = activeConstraints.filter(
    (c) => c.type === "locked_placement" && c.stageId === stage.id,
  );
  for (const lock of stageLocks) {
    if (lock.brandId !== brand.qlooId) {
      blockingReasons.push(
        `Stage "${stage.name}" has a locked placement reserved for another sponsor [${lock.id}].`,
      );
    } else {
      satisfiedConstraintIds.push(lock.id);
    }
  }

  // 4. Activation format compatibility (stage ceiling vs known brand facts + explicit format_mismatch constraints)
  const formatCheck = checkFormatCompatibility(stage, brand);
  if (!formatCheck.compatible && formatCheck.reason) {
    blockingReasons.push(formatCheck.reason);
  }

  for (const c of activeConstraints) {
    if (c.type !== "format_mismatch") continue;
    const applies = c.scope === "festival" || c.stageId === stage.id;
    if (applies && c.brandId === brand.qlooId) {
      blockingReasons.push(
        c.reason ??
          `Candidate "${brand.name}" does not meet activation format requirements on "${stage.name}" [${c.id}].`,
      );
    } else if (applies) {
      satisfiedConstraintIds.push(c.id);
    }
  }

  return {
    eligible: blockingReasons.length === 0,
    satisfiedConstraintIds: [...new Set(satisfiedConstraintIds)],
    blockingReasons,
  };
}

/**
 * Validates cross-stage festival constraints for a complete tuple of stage assignments:
 * 1. Brand uniqueness: A single brand cannot be primary sponsor on multiple stages unless explicitly locked to them.
 * 2. Festival-wide category exclusivity: At most one stage can be assigned a brand from an exclusive category.
 */
export function isFestivalAssignmentFeasible(
  assignment: Array<{ stageId: string; brand: CandidateBrand | null }>,
  constraints: Constraint[],
): { feasible: boolean; satisfiedExclusivityIds: string[]; violationReasons: string[] } {
  const activeConstraints = constraints.filter((c) => c.active);
  const violationReasons: string[] = [];
  const satisfiedExclusivityIds: string[] = [];

  const lockedBrandStages = new Map<string, Set<string>>();
  for (const c of activeConstraints) {
    if (c.type === "locked_placement" && c.brandId && c.stageId) {
      const set = lockedBrandStages.get(c.brandId) ?? new Set<string>();
      set.add(c.stageId);
      lockedBrandStages.set(c.brandId, set);
    }
  }

  // 1. Check duplicate brand across multiple stages
  const stagesByBrandId = new Map<string, string[]>();
  for (const slot of assignment) {
    if (!slot.brand) continue;
    const list = stagesByBrandId.get(slot.brand.qlooId) ?? [];
    list.push(slot.stageId);
    stagesByBrandId.set(slot.brand.qlooId, list);
  }

  for (const [brandId, stageIds] of stagesByBrandId.entries()) {
    if (stageIds.length > 1) {
      const lockedSet = lockedBrandStages.get(brandId);
      const allLocked = stageIds.every((sid) => lockedSet?.has(sid));
      if (!allLocked) {
        violationReasons.push(
          `Brand "${brandId}" cannot be assigned as primary partner on multiple stages (${stageIds.join(", ")}).`,
        );
      }
    }
  }

  // 2. Check festival-wide category exclusivity
  const exclusivityRules = activeConstraints.filter(
    (c) => c.type === "category_exclusivity" && c.scope === "festival",
  );

  for (const rule of exclusivityRules) {
    const categoryCounts = new Map<string, string[]>();
    for (const slot of assignment) {
      if (!slot.brand) continue;
      const cat = normalizeCategory(slot.brand.category);
      if (
        !rule.category ||
        rule.category === "*" ||
        normalizeCategory(rule.category) === cat
      ) {
        const list = categoryCounts.get(cat) ?? [];
        list.push(slot.brand.name);
        categoryCounts.set(cat, list);
      }
    }

    let violated = false;
    for (const [cat, brandNames] of categoryCounts.entries()) {
      if (brandNames.length > 1) {
        violated = true;
        violationReasons.push(
          `Festival-wide category exclusivity [${rule.id}] violated for category "${cat}" (${brandNames.join(", ")}).`,
        );
      }
    }

    if (!violated) {
      satisfiedExclusivityIds.push(rule.id);
    }
  }

  return {
    feasible: violationReasons.length === 0,
    satisfiedExclusivityIds,
    violationReasons,
  };
}
