import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { timingSafeEqual } from "node:crypto";
import type { JobQueue } from "../queue/job-queue.js";
import { verifyAmoWebhookSignature } from "../amocrm/chats-client.js";
import type { TelegramOnboardingService } from "../runtime/telegram-onboarding.js";
import type { AccountManagementService } from "../runtime/account-management.js";
import type { AccountAdminService } from "../runtime/account-admin.js";
import type { AmoChatsLifecycle } from "../amocrm/lifecycle.js";
import type { MappingStore } from "../storage/mapping-store.js";
import type { DeliveryReconciliationStore } from "../storage/delivery-reconciliation.js";
import type { SecretStore } from "../security/secret-store.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

interface BootstrapInfo {
  publicDomain?: string;
  amoAccountIdDefault?: string;
  sourceExternalIdDefault?: string;
  chatsChannelConfigured: boolean;
  webhookUrlTemplate?: string;
}

interface Options {
  queue: JobQueue;
  amoChannelSecret?: string;
  readiness?: () => Promise<{ ready: boolean; detail?: unknown }>;
  onboarding?: TelegramOnboardingService;
  accountManagement?: AccountManagementService;
  accountAdmin?: AccountAdminService;
  lifecycle?: AmoChatsLifecycle;
  adminToken?: string;
  mappings?: MappingStore;
  deliveryReconciliation?: DeliveryReconciliationStore;
  bootstrap?: BootstrapInfo;
  logger?: any;
  bodyLimit?: number;
  rateLimitMax?: number;
  oauth?: { redirectUri?: string; secrets?: SecretStore; exchangeAuthorizationCode?: (code: string) => Promise<void> };
}

const adminHtmlPath = join(dirname(fileURLToPath(import.meta.url)), "../../public/admin/index.html");

export function buildWebhookServer(o: Options): FastifyInstance {
  const app = Fastify({
    loggerInstance: o.logger,
    bodyLimit: o.bodyLimit ?? 2 * 1024 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
  });
  void app.register(rateLimit, { max: o.rateLimitMax ?? 300, timeWindow: "1 minute" });
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    try {
      req.rawBody = body.toString("utf8");
      done(null, JSON.parse(req.rawBody));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  app.get("/health/live", async () => ({ ok: true }));
  app.get("/health/ready", async (_req, reply) => {
    const r = await (o.readiness?.() ?? Promise.resolve({ ready: true }));
    return reply.code(r.ready ? 200 : 503).send(r);
  });

  app.post("/oauth/secrets", async (req, reply) => {
    const body = req.body as Record<string, unknown> | undefined;
    const clientId = textValue(body?.client_id) ?? textValue(body?.client_uuid);
    const clientSecret = textValue(body?.client_secret);
    if (!clientId || !clientSecret) return reply.code(400).send({ error: "client_id and client_secret are required" });
    if (!o.oauth?.secrets) return reply.code(503).send({ error: "OAuth credential storage is unavailable" });
    await o.oauth.secrets.put("amocrm:external-client", {
      clientId,
      clientSecret,
      ...(textValue(body?.state) ? { state: textValue(body?.state)! } : {}),
    });
    return reply.code(204).send();
  });

  app.get("/oauth/callback", async (req, reply) => {
    if (!o.oauth?.redirectUri) return reply.code(503).type("text/plain; charset=utf-8").send("OAuth callback is not configured");
    const configured = new URL(o.oauth.redirectUri);
    if (configured.pathname !== "/oauth/callback") return reply.code(503).type("text/plain; charset=utf-8").send("OAuth callback URI is misconfigured");
    const code = textValue((req.query as Record<string, unknown>)?.code);
    if (!code) return reply.code(400).type("text/plain; charset=utf-8").send("Missing OAuth authorization code");
    if (!o.oauth.exchangeAuthorizationCode) return reply.code(503).type("text/plain; charset=utf-8").send("OAuth token exchange is not configured");
    try {
      await o.oauth.exchangeAuthorizationCode(code);
    } catch {
      return reply.code(502).type("text/plain; charset=utf-8").send("OAuth token exchange failed");
    }
    return reply.type("text/html; charset=utf-8").send("<!doctype html><title>amoCRM OAuth</title><p>Авторизация amoCRM завершена. Это окно можно закрыть.</p>");
  });

  app.post("/webhooks/amocrm/:scopeId", async (req, reply) => {
    if (!o.amoChannelSecret) {
      return reply.code(503).send({ error: "amoCRM Chats channel is not configured; set AMOCRM_CHATS_CHANNEL_SECRET in .env and restart" });
    }
    const scopeId = String((req.params as any).scopeId);
    if (!verifyAmoWebhookSignature(req.rawBody ?? "", header(req, "x-signature"), o.amoChannelSecret)) {
      return reply.code(401).send({ error: "invalid signature" });
    }
    const body: any = req.body;
    const id = String(body?.message?.message?.id ?? "");
    const conversation = String(body?.message?.conversation?.id ?? "");
    if (!id || !conversation) return reply.code(400).send({ error: "invalid payload" });
    await o.queue.enqueue({
      kind: "amocrm.outbound",
      partitionKey: `amo:${scopeId}:${conversation}`,
      dedupeKey: `${scopeId}:${id}`,
      payload: { scopeId, body },
    });
    return reply.code(200).send({ ok: true });
  });

  app.get("/admin", async (_req, reply) => reply.type("text/html; charset=utf-8").send(readAdminHtml()));
  app.get("/admin/", async (_req, reply) => reply.type("text/html; charset=utf-8").send(readAdminHtml()));

  if (o.bootstrap) {
    app.get("/admin/bootstrap", { preHandler: admin(o.adminToken) }, async () => o.bootstrap);
  }

  if (o.accountAdmin) {
    app.get("/admin/accounts", { preHandler: admin(o.adminToken) }, async () => o.accountAdmin!.list());
    app.post("/admin/accounts/:accountId/disconnect", { preHandler: admin(o.adminToken) }, async (req) =>
      o.accountAdmin!.disconnect(String((req.params as any).accountId)),
    );
    app.post("/admin/accounts/:accountId/reconnect", { preHandler: admin(o.adminToken) }, async (req) =>
      o.accountAdmin!.reconnect(String((req.params as any).accountId)),
    );
  }

  if (o.onboarding) {
    app.post("/admin/telegram/onboarding", { preHandler: admin(o.adminToken) }, async (req, reply) =>
      reply.code(202).send(await o.onboarding!.start(req.body as any)),
    );
    app.post("/admin/telegram/onboarding/:accountId/code", { preHandler: admin(o.adminToken) }, async (req) =>
      o.onboarding!.submitCode(String((req.params as any).accountId), String((req.body as any).code)),
    );
    app.post("/admin/telegram/onboarding/:accountId/password", { preHandler: admin(o.adminToken) }, async (req) =>
      o.onboarding!.submitPassword(String((req.params as any).accountId), String((req.body as any).password)),
    );
  }

  if (o.accountManagement) {
    app.post("/admin/accounts", { preHandler: admin(o.adminToken) }, async (req, reply) =>
      reply.code(201).send(await o.accountManagement!.create(req.body as any)),
    );
  }

  app.get("/admin/jobs/dead", { preHandler: admin(o.adminToken) }, async (req) =>
    o.queue.deadLetters(Math.min(500, Number((req.query as any)?.limit ?? 100))),
  );
  app.post("/admin/jobs/:id/requeue", { preHandler: admin(o.adminToken) }, async (req, reply) => {
    const ok = await o.queue.requeueDead(Number((req.params as any).id));
    return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: "dead job not found" });
  });

  if (o.mappings) {
    app.get("/admin/deliveries/unknown", { preHandler: admin(o.adminToken) }, async (req) =>
      (await o.mappings!.listDeliveryUnknown(Number((req.query as any)?.limit ?? 100))).map((x) => ({
        amoMessageId: x.amoMessageId,
        messenger: x.messenger,
        accountId: x.messengerAccountId,
        occurredAt: x.occurredAt,
      })),
    );
    app.post("/admin/deliveries/:amoMessageId/reconcile", { preHandler: admin(o.adminToken) }, async (req, reply) => {
      const id = String((req.params as any).amoMessageId);
      const body = req.body as any;
      if (body?.accepted === false) {
        if (!Number.isInteger(Number(body.jobId))) return reply.code(400).send({ error: "jobId is required to explicitly requeue a confirmed-not-accepted delivery" });
        if (!o.deliveryReconciliation) return reply.code(503).send({ error: "atomic delivery reconciliation is unavailable" });
        const requeued = await o.deliveryReconciliation.confirmNotAccepted(id, Number(body.jobId));
        return requeued ? { ok: true, requeued: true } : reply.code(409).send({ error: "unknown delivery and dead job did not match" });
      }
      if (!body?.providerMessageId || !["queued", "sent", "delivered", "read"].includes(body?.status)) {
        return reply.code(400).send({ error: "providerMessageId and final status are required" });
      }
      const ok = await o.mappings!.reconcileDeliveryUnknown(id, String(body.providerMessageId), body.status);
      return ok ? { ok: true } : reply.code(404).send({ error: "unknown delivery not found" });
    });
  }

  if (o.lifecycle) {
    app.post("/admin/accounts/:accountId/amocrm/connect", { preHandler: admin(o.adminToken) }, async (req) => ({
      scopeId: await o.lifecycle!.connectAccount(String((req.params as any).accountId), (req.body as any)?.title),
    }));
    app.post("/admin/accounts/:accountId/amocrm/source", { preHandler: admin(o.adminToken) }, async (req) => {
      await o.lifecycle!.ensureSource(String((req.params as any).accountId), (req.body as any)?.pipelineId);
      return { ok: true };
    });
  }

  return app;
}

function readAdminHtml(): string {
  return readFileSync(adminHtmlPath, "utf8");
}

function admin(token?: string) {
  return async (req: any, reply: any) => {
    if (!safeEqual(header(req, "authorization"), token ? `Bearer ${token}` : undefined)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  };
}

function header(req: any, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function safeEqual(a?: string, b?: string) {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
