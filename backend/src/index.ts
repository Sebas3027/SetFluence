import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import type { FestivalBrief, PlanVersion } from "@setfluence/shared";
import { runControlledBenchmark } from "./agent/benchmark.ts";
import { AgentOrchestrator } from "./agent/orchestrator.ts";
import { PresetPlanCache } from "./services/preset-cache.ts";
import { QlooApiError, QlooService } from "./services/qloo.service.ts";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST_DIR = resolve(CURRENT_DIR, "../../frontend/dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function buildServer(
  qlooService = new QlooService(),
  orchestrator = new AgentOrchestrator({ qlooService }),
  presetCache = new PresetPlanCache({ persistToDisk: false }),
) {
  const app = Fastify({
    logger: true,
  });

  app.register(cors, {
    origin: true,
  });

  app.get("/api/health", async () => {
    return {
      status: "ok",
      service: "@setfluence/backend",
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/api/qloo/search", async (request, reply) => {
    const QuerySchema = z.object({
      query: z.string().min(1),
      type: z
        .enum(["urn:entity:artist", "urn:entity:brand"])
        .optional()
        .default("urn:entity:artist"),
    });

    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid query parameters",
        details: parsed.error.flatten(),
      });
    }

    const entities = await qlooService.searchEntity(
      parsed.data.query,
      parsed.data.type,
    );
    return { entities };
  });

  app.post<{ Body: { brief: FestivalBrief; forceRefresh?: boolean } }>(
    "/api/plans/generate",
    async (request, reply) => {
      const body = request.body;
      if (!body?.brief || !Array.isArray(body.brief.stages)) {
        return reply.code(400).send({
          error: "Request body must include a valid FestivalBrief under 'brief'.",
        });
      }

      return presetCache.getOrGenerate(
        body.brief,
        orchestrator,
        Boolean(body.forceRefresh),
      );
    },
  );

  app.post<{
    Body: {
      previousPlan: PlanVersion;
      updatedBrief: FestivalBrief;
      instruction?: string;
    };
  }>("/api/plans/revise", async (request, reply) => {
    const body = request.body;
    if (!body?.previousPlan || !body?.updatedBrief) {
      return reply.code(400).send({
        error:
          "Request body must include 'previousPlan' and 'updatedBrief'.",
      });
    }

    const plan = await orchestrator.revisePlan(
      body.previousPlan,
      body.updatedBrief,
      body.instruction,
    );
    return { plan };
  });

  app.post<{
    Body: {
      plan: PlanVersion;
    };
  }>("/api/plans/benchmark", async (request, reply) => {
    const body = request.body;
    if (!body?.plan || !body.plan.briefSnapshot) {
      return reply.code(400).send({
        error: "Request body must include a valid PlanVersion under 'plan'.",
      });
    }

    const benchmark = await runControlledBenchmark(body.plan);
    return { benchmark };
  });

  // Serve built frontend SPA assets in production when frontend/dist exists
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: `Route ${request.url} not found` });
    }

    if (!existsSync(FRONTEND_DIST_DIR)) {
      return reply.code(404).send({
        error: "Frontend build not found. Run `npm run build` first or use Vite dev server.",
      });
    }

    const cleanUrlPath = (request.url.split("?")[0] ?? "/").replace(/^\/+/, "");
    const candidatePath = normalize(join(FRONTEND_DIST_DIR, cleanUrlPath));

    if (
      cleanUrlPath.length > 0 &&
      candidatePath.startsWith(FRONTEND_DIST_DIR) &&
      existsSync(candidatePath) &&
      statSync(candidatePath).isFile()
    ) {
      const ext = extname(candidatePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      return reply.type(contentType).send(readFileSync(candidatePath));
    }

    const indexHtmlPath = join(FRONTEND_DIST_DIR, "index.html");
    if (existsSync(indexHtmlPath)) {
      return reply
        .type("text/html; charset=utf-8")
        .send(readFileSync(indexHtmlPath));
    }

    return reply.code(404).send({ error: "Not found" });
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof QlooApiError) {
      return reply.code(error.status).send({
        error: error.message,
        path: error.path,
        source: "qloo_live_api",
      });
    }
    app.log.error(error);
    return reply.code(500).send({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  });

  return app;
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isDirectRun) {
  const port = Number(process.env.PORT ?? 3001);
  const qlooService = new QlooService();
  const orchestrator = new AgentOrchestrator({ qlooService });
  const presetCache = new PresetPlanCache({ persistToDisk: true });
  const server = buildServer(qlooService, orchestrator, presetCache);
  server
    .listen({ port, host: "0.0.0.0" })
    .then(() => {
      void presetCache.warmPresetsInBackground(orchestrator);
    })
    .catch((err) => {
      server.log.error(err);
      process.exit(1);
    });
}
