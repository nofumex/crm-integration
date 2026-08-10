import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { MessageRouter } from "../router/message-router.js";
import { verifyAmoWebhookSignature } from "../amocrm/chats-client.js";
import type { WhatsAppAdapter } from "../adapters/whatsapp-adapter.js";
import type { MaxAdapter } from "../adapters/max-adapter.js";

declare module "fastify" { interface FastifyRequest { rawBody?: string } }

interface WebhookServerOptions {
  router: MessageRouter;
  amoWebhookSecret: string;
  whatsapp?: WhatsAppAdapter;
  whatsappVerifyToken?: string;
  max?: MaxAdapter;
  maxAccountId?: string;
  maxWebhookSecret?: string;
  logger?: any;
}

export function buildWebhookServer(options: WebhookServerOptions): FastifyInstance {
  const app = Fastify({ loggerInstance: options.logger });
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    try { request.rawBody = body.toString("utf8"); done(null, JSON.parse(request.rawBody)); }
    catch (error) { done(error as Error, undefined); }
  });

  app.get("/health", async () => ({ ok: true }));
  app.post("/webhooks/amocrm/:scopeId", async (request, reply) => {
    if (!verifyAmoWebhookSignature(request.rawBody ?? "", header(request, "x-signature"), options.amoWebhookSecret)) return reply.code(401).send({ error: "invalid signature" });
    await options.router.routeAmoOutbound(request.body);
    return reply.code(200).send({ ok: true });
  });
  app.get("/webhooks/whatsapp", async (request, reply) => {
    const q = request.query as Record<string,string>;
    if (q["hub.mode"] === "subscribe" && safeEqual(q["hub.verify_token"], options.whatsappVerifyToken)) return reply.type("text/plain").send(q["hub.challenge"]);
    return reply.code(403).send();
  });
  app.post("/webhooks/whatsapp", async (request, reply) => {
    if (!options.whatsapp?.verifyWebhook(request.rawBody ?? "", header(request, "x-hub-signature-256"))) return reply.code(401).send({ error: "invalid signature" });
    await options.whatsapp.acceptWebhook(request.body);
    return reply.code(200).send({ ok: true });
  });
  app.post("/webhooks/max", async (request, reply) => {
    if (!safeEqual(header(request, "x-max-bot-api-secret"), options.maxWebhookSecret)) return reply.code(401).send({ error: "invalid secret" });
    if (!options.max || !options.maxAccountId) return reply.code(503).send({ error: "MAX adapter not configured" });
    await options.max.acceptUpdate(request.body, options.maxAccountId);
    return reply.code(200).send({ ok: true });
  });
  return app;
}

function header(request: any, name: string): string | undefined { const value = request.headers[name]; return Array.isArray(value) ? value[0] : value; }
function safeEqual(a?: string, b?: string): boolean { if (!a || !b || a.length !== b.length) return false; return timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
