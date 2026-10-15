/**
 * Phase 0 — Technical Test & Scoring Decision Gate (PROJECT_PLAN.md §Phase 0, proposal §12).
 *
 *   npm run phase0
 *
 * Steps
 *   0.2  Resolve artists + shortlist brands via GET /search
 *   0.3a Open discovery: brands from each artist signal (GET /v2/insights, filter.type=urn:entity:brand)
 *   0.3b Fixed shortlist evaluation: same K brands scored per artist (filter.results.entities)
 *   0.3c Silent-drop probe: undocumented param vs. baseline
 *   0.4  Score comparability stats + ordinal fallback per stage (with coverage)
 *   0.5  Writes live captures to fixtures/ and a human-readable report to docs/phase0/
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BRAND_INSIGHTS_ALLOWED_PARAMS, BRAND_SHORTLIST, LIMITS, SEARCH_TYPES, STAGES } from "./config.ts";
import { loadQlooEnv } from "./env.ts";
import { QlooClient, type Params } from "./qloo-client.ts";
import { extractEntities, ordinalPoints, resolve as resolveName, stats, type Resolution } from "./analysis.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Pre-flight validation (PROJECT_PLAN §1.3): refuse undocumented brand params unless explicitly probing. */
function brandParams(params: Params, { allowUndocumented = false } = {}): Params {
  const bad = Object.keys(params).filter((k) => !BRAND_INSIGHTS_ALLOWED_PARAMS.has(k));
  if (bad.length && !allowUndocumented) throw new Error(`Undocumented brand Insights params: ${bad.join(", ")}`);
  return { "filter.type": "urn:entity:brand", ...params };
}

const fmt = (v: number | null | undefined, d = 3) => (v === null || v === undefined ? "—" : v.toFixed(d));

async function main() {
  const env = loadQlooEnv(ROOT);
  const qloo = new QlooClient(env);
  const runAt = new Date().toISOString();
  console.log(`Phase 0 run @ ${runAt} against ${env.baseUrl}\n`);

  // ---------- 0.2 Entity resolution ----------
  console.log("0.2 Resolving artists…");
  const artistRes = new Map<string, Resolution>();
  for (const stage of STAGES) {
    for (const name of stage.artists) {
      const call = await qloo.get(`search artist: ${name}`, "/search", {
        query: name,
        types: SEARCH_TYPES.artist,
        take: LIMITS.searchTake,
      });
      artistRes.set(name, resolveName(name, call.ok ? extractEntities(call.body) : []));
    }
  }

  console.log("0.2 Resolving brand shortlist…");
  const brandRes = new Map<string, Resolution>();
  for (const b of BRAND_SHORTLIST) {
    const call = await qloo.get(`search brand: ${b.name}`, "/search", {
      query: b.name,
      types: SEARCH_TYPES.brand,
      take: LIMITS.searchTake,
    });
    brandRes.set(b.name, resolveName(b.name, call.ok ? extractEntities(call.body) : []));
  }

  const resolvedArtists = [...artistRes.values()].filter((r) => r.match);
  const resolvedBrands = BRAND_SHORTLIST.map((b) => ({ ...b, res: brandRes.get(b.name)! })).filter((b) => b.res.match);
  const brandIds = resolvedBrands.map((b) => b.res.match!.id);
  const brandNameById = new Map(resolvedBrands.map((b) => [b.res.match!.id, b.name]));

  // ---------- 0.3a Open discovery ----------
  console.log("\n0.3a Open brand discovery per artist…");
  const discovery = new Map<string, ReturnType<typeof extractEntities>>();
  for (const r of resolvedArtists) {
    const call = await qloo.get(
      `discover brands: ${r.input}`,
      "/v2/insights",
      brandParams({ "signal.interests.entities": r.match!.id, take: LIMITS.discoveryTake }),
    );
    discovery.set(r.input, call.ok ? extractEntities(call.body) : []);
  }

  // ---------- 0.3b Fixed shortlist evaluation ----------
  console.log("\n0.3b Fixed shortlist evaluation per artist…");
  const shortlist = new Map<string, ReturnType<typeof extractEntities>>();
  const shortlistOk = new Map<string, boolean>();
  if (brandIds.length) {
    for (const r of resolvedArtists) {
      const call = await qloo.get(
        `shortlist eval: ${r.input}`,
        "/v2/insights",
        brandParams({
          "signal.interests.entities": r.match!.id,
          "filter.results.entities": brandIds.join(","),
          take: brandIds.length,
        }),
      );
      shortlistOk.set(r.input, call.ok);
      shortlist.set(r.input, call.ok ? extractEntities(call.body) : []);
    }
  }

  // ---------- 0.3c Silent-drop probe ----------
  console.log("\n0.3c Silent-drop probe…");
  let probe: { baseline: string[]; probed: string[]; identical: boolean; artist: string } | null = null;
  const probeArtist = resolvedArtists[0];
  if (probeArtist) {
    const baseline = discovery.get(probeArtist.input) ?? [];
    const call = await qloo.get(
      `probe undocumented param: ${probeArtist.input}`,
      "/v2/insights",
      brandParams(
        {
          "signal.interests.entities": probeArtist.match!.id,
          take: LIMITS.discoveryTake,
          "filter.release_year.min": 2030, // documented for movies/TV, NOT for brands → expected to be silently ignored
        },
        { allowUndocumented: true },
      ),
    );
    const probed = call.ok ? extractEntities(call.body).map((e) => e.id) : [];
    const base = baseline.map((e) => e.id);
    probe = {
      artist: probeArtist.input,
      baseline: base,
      probed,
      identical: call.ok && base.length === probed.length && base.every((id, i) => id === probed[i]),
    };
  }

  // ---------- 0.4 Score analysis ----------
  const perArtistAffinity = new Map<string, ReturnType<typeof stats>>();
  const perArtistOrdinal = new Map<string, Map<string, number>>();
  for (const [artist, ents] of shortlist) {
    const inShortlist = ents.filter((e) => brandNameById.has(e.id));
    perArtistAffinity.set(artist, stats(inShortlist.map((e) => e.affinity).filter((v): v is number => v !== null)));
    perArtistOrdinal.set(artist, ordinalPoints(inShortlist.map((e) => ({ id: e.id, affinity: e.affinity }))));
  }

  const stageScores = STAGES.map((stage) => {
    const rows = resolvedBrands.map((b) => {
      const id = b.res.match!.id;
      const pts: number[] = [];
      const raw: number[] = [];
      for (const artist of stage.artists) {
        const p = perArtistOrdinal.get(artist)?.get(id);
        if (p !== undefined) pts.push(p);
        const a = shortlist.get(artist)?.find((e) => e.id === id)?.affinity;
        if (a !== null && a !== undefined) raw.push(a);
      }
      return {
        brand: b.name,
        category: b.category,
        ordinal: pts.length ? Number((pts.reduce((s, v) => s + v, 0) / pts.length).toFixed(3)) : null,
        rawMean: raw.length ? Number((raw.reduce((s, v) => s + v, 0) / raw.length).toFixed(4)) : null,
        coverage: `${pts.length}/${stage.artists.length}`,
      };
    });
    rows.sort((a, b) => (b.ordinal ?? -1) - (a.ordinal ?? -1));
    return { stage, rows };
  });

  // ---------- Acceptance targets (proposal §12) ----------
  const callsOk = qloo.calls.filter((c) => c.ok);
  const latencies = qloo.calls.map((c) => c.durationMs);
  const usablePerStage = STAGES.map((s) => ({
    stage: s.label,
    usable: s.artists.filter((a) => (shortlist.get(a)?.length ?? 0) > 0).length,
  }));
  const evaluableBrands = new Set([...shortlist.values()].flatMap((ents) => ents.map((e) => e.id).filter((id) => brandNameById.has(id))));

  // ---------- 0.5 Persist ----------
  const summary = {
    runAt,
    baseUrl: env.baseUrl,
    source: "live",
    requests: { total: qloo.calls.length, ok: callsOk.length, failed: qloo.calls.length - callsOk.length },
    latencyMs: stats(latencies),
    artists: [...artistRes.values()],
    brands: [...brandRes.values()],
    discovery: Object.fromEntries(discovery),
    shortlist: Object.fromEntries(shortlist),
    perArtistAffinity: Object.fromEntries(perArtistAffinity),
    stageScores,
    probe,
    acceptance: { usablePerStage, evaluableBrands: evaluableBrands.size, shortlistSize: brandIds.length },
  };
  const capture = {
    _note: "Real Qloo responses captured live. Request scope + timestamp per call. API key is never stored.",
    runAt,
    baseUrl: env.baseUrl,
    calls: qloo.calls,
  };

  const stamp = runAt.replace(/[:.]/g, "-");
  const fixturesDir = resolve(ROOT, "fixtures");
  const runsDir = resolve(fixturesDir, "runs");
  const docsDir = resolve(ROOT, "docs/phase0");
  for (const d of [fixturesDir, runsDir, docsDir]) mkdirSync(d, { recursive: true });

  writeFileSync(resolve(fixturesDir, "qloo-captured-responses.json"), JSON.stringify(capture, null, 2));
  writeFileSync(resolve(runsDir, `${stamp}.json`), JSON.stringify({ summary, capture }, null, 2));
  writeFileSync(resolve(docsDir, "phase0-summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(resolve(docsDir, "phase0-report.md"), renderReport(summary, brandNameById));

  console.log(`\nDone: ${callsOk.length}/${qloo.calls.length} requests ok.`);
  console.log("  → docs/phase0/phase0-report.md");
  console.log("  → fixtures/qloo-captured-responses.json");
}

// ---------- Markdown report ----------
type Summary = Record<string, any>;

function renderReport(s: Summary, brandNameById: Map<string, string>): string {
  const L: string[] = [];
  L.push(`# Phase 0 Report — Qloo Technical Test`, ``);
  L.push(`- **Run:** ${s.runAt}`, `- **Base URL:** ${s.baseUrl}`);
  L.push(`- **Requests:** ${s.requests.ok}/${s.requests.total} ok`);
  L.push(`- **Latency (ms):** min ${s.latencyMs?.min} · mean ${s.latencyMs?.mean} · max ${s.latencyMs?.max}`, ``);
  L.push(`> Source: live hackathon API. Scores are *relative fit within this shortlist*, not audience percentages.`, ``);

  L.push(`## 0.2 Entity resolution`, ``, `| Input | Status | Qloo name | Entity ID | Popularity |`, `| --- | --- | --- | --- | --- |`);
  for (const r of [...s.artists, ...s.brands] as Resolution[]) {
    L.push(`| ${r.input} | ${r.status} | ${r.match?.name ?? "—"} | \`${r.match?.id ?? "—"}\` | ${fmt(r.match?.popularity)} |`);
  }

  L.push(``, `## 0.3a Open discovery (top 8 brands per artist)`, ``);
  for (const [artist, ents] of Object.entries(s.discovery) as [string, any[]][]) {
    const top = ents.slice(0, 8).map((e) => `${e.name} (${fmt(e.affinity, 2)})`).join(", ");
    L.push(`- **${artist}** — ${ents.length} returned: ${top || "_none_"}`);
  }

  L.push(``, `## 0.3b Fixed shortlist — raw affinity per artist`, ``);
  const brandNames = [...brandNameById.values()];
  L.push(`| Artist | ${brandNames.join(" | ")} | returned |`, `| --- | ${brandNames.map(() => "---").join(" | ")} | --- |`);
  for (const [artist, ents] of Object.entries(s.shortlist) as [string, any[]][]) {
    const byId = new Map(ents.map((e) => [e.id, e.affinity]));
    const cells = [...brandNameById.keys()].map((id) => (byId.has(id) ? fmt(byId.get(id), 2) : "∅"));
    L.push(`| ${artist} | ${cells.join(" | ")} | ${ents.length}/${brandNames.length} |`);
  }
  L.push(``, `∅ = not returned → treated as **unknown**, not last place.`);

  L.push(``, `## 0.3c Silent-drop probe`, ``);
  if (s.probe) {
    L.push(`Added \`filter.release_year.min=2030\` (not documented for brands) to the ${s.probe.artist} discovery request.`);
    L.push(`- Result identical to baseline: **${s.probe.identical ? "YES → parameter silently ignored" : "NO → inspect"}**`);
  } else L.push(`_Skipped (no resolved artist)._`);

  L.push(``, `## 0.4 Score comparability`, ``, `| Artist | n | min | max | mean | spread |`, `| --- | --- | --- | --- | --- | --- |`);
  for (const [artist, st] of Object.entries(s.perArtistAffinity) as [string, any][]) {
    L.push(st ? `| ${artist} | ${st.n} | ${fmt(st.min)} | ${fmt(st.max)} | ${fmt(st.mean)} | ${fmt(st.spread)} |` : `| ${artist} | 0 | — | — | — | — |`);
  }
  L.push(``, `If per-artist ranges differ materially, raw scores are **not** treated as comparable → use ordinal fallback below.`);

  L.push(``, `### Stage fit (ordinal fallback, equal artist weights)`);
  for (const { stage, rows } of s.stageScores) {
    L.push(``, `**${stage.label}** — ${stage.artists.join(", ")}`, ``, `| Brand | Category | Ordinal fit | Raw mean | Coverage |`, `| --- | --- | --- | --- | --- |`);
    for (const r of rows) L.push(`| ${r.brand} | ${r.category} | ${fmt(r.ordinal)} | ${fmt(r.rawMean)} | ${r.coverage} |`);
  }

  L.push(``, `## Acceptance targets (proposal §12)`, ``);
  for (const u of s.acceptance.usablePerStage) L.push(`- ${u.usable >= 2 ? "✅" : "❌"} ${u.stage}: ${u.usable}/3 usable artists (target ≥ 2)`);
  L.push(`- ${s.acceptance.evaluableBrands >= 6 ? "✅" : "❌"} Evaluable brands: ${s.acceptance.evaluableBrands}/${s.acceptance.shortlistSize} (target ≥ 6 for plan + alternatives)`);
  L.push(`- ${s.requests.failed === 0 ? "✅" : "⚠️"} Failed requests: ${s.requests.failed}`);
  L.push(``, `## Decision (fill in after review)`, ``, `- [ ] Raw scores comparable across artists? → yes / no (ordinal fallback)`, `- [ ] Discovery rich enough, or start from supplied shortlist?`, `- [ ] Go / no-go for Phase 1`, ``);
  return L.join("\n");
}

main().catch((err) => {
  console.error("\nPhase 0 failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
