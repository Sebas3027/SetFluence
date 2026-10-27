import type {
  CandidateBrand,
  EvidenceRecord,
  StageBrandEvaluation,
  StageBrief,
} from "@setfluence/shared";

export type StageBrandScoreMetrics = Omit<
  StageBrandEvaluation,
  "eligible" | "satisfiedConstraintIds" | "blockingReasons"
>;

/**
 * Aggregates artist-level Qloo evidence records into stage-level fit metrics for one (stage, brand) pair.
 *
 * Safeguards:
 * - Missing or unknown artist evidence (`ordinalPoints === null`) is ignored in the weighted average,
 *   never treated as 0.0 (last place).
 * - If `supportedArtistsCount === 0`, `relativeFitScore` is `null`.
 */
export function computeStageBrandFit(
  stage: StageBrief,
  brand: CandidateBrand,
  resolvedArtistIdsByStageArtistName: Record<string, string | null>,
  evidenceRecords: EvidenceRecord[],
): StageBrandScoreMetrics {
  const totalStageArtistsCount = stage.artists.length;
  const stageArtistEvidence: EvidenceRecord[] = [];

  let weightedOrdinalSum = 0;
  let totalOrdinalWeight = 0;
  let rawSum = 0;
  let rawCount = 0;
  let supportedArtistsCount = 0;

  for (const artistName of stage.artists) {
    const artistId = resolvedArtistIdsByStageArtistName[artistName] ?? null;
    if (!artistId) continue;

    const record = evidenceRecords.find(
      (ev) => ev.artistId === artistId && ev.brandId === brand.qlooId,
    );
    if (!record) continue;

    stageArtistEvidence.push(record);

    if (record.ordinalPoints !== null && record.status === "ok") {
      const weight = stage.artistWeights?.[artistName] ?? 1.0;
      if (weight > 0) {
        weightedOrdinalSum += record.ordinalPoints * weight;
        totalOrdinalWeight += weight;
        supportedArtistsCount++;
      }
    }

    if (record.rawScore !== null && record.status === "ok") {
      rawSum += record.rawScore;
      rawCount++;
    }
  }

  const relativeFitScore =
    supportedArtistsCount > 0 && totalOrdinalWeight > 0
      ? Number((weightedOrdinalSum / totalOrdinalWeight).toFixed(4))
      : null;

  const rawMeanScore =
    rawCount > 0 ? Number((rawSum / rawCount).toFixed(4)) : null;

  const coverageRatio =
    totalStageArtistsCount > 0
      ? Number((supportedArtistsCount / totalStageArtistsCount).toFixed(4))
      : 0;

  return {
    stageId: stage.id,
    brandId: brand.qlooId,
    relativeFitScore,
    rawMeanScore,
    supportedArtistsCount,
    totalStageArtistsCount,
    coverageRatio,
    artistEvidence: stageArtistEvidence,
  };
}
