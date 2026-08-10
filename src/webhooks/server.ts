import Fastify,{LogController,type FastifyInstance}from"fastify";
import rateLimit from"@fastify/rate-limit";
import{timingSafeEqual}from"node:crypto";
import{createHash}from"node:crypto";
import type{JobQueue}from"../queue/job-queue.js";
import{verifyAmoWebhookSignature}from"../amocrm/chats-client.js";
import type{TelegramOnboardingService}from"../runtime/telegram-onboarding.js";
import type{AccountManagementService}from"../runtime/account-management.js";
import type{AmoChatsLifecycle}from"../amocrm/lifecycle.js";
declare module"fastify"{interface FastifyRequest{rawBody?:string}}
interface Options{
 queue:JobQueue;amoChannelSecret:string;whatsappVerifyToken?:string;
 verifyWhatsApp?:(raw:string,body:any,signature?:string)=>Promise<{valid:boolean;accountId?:string}>;
 verifyMax?:(accountId:string,secret?:string)=>Promise<boolean>;
 readiness?:()=>Promise<{ready:boolean;detail?:unknown}>;onboarding?:TelegramOnboardingService;
 accountManagement?:AccountManagementService;lifecycle?:AmoChatsLifecycle;adminToken?:string;
 logger?:any;bodyLimit?:number;rateLimitMax?:number;
}
export function buildWebhookServer(o:Options):FastifyInstance{
 const app=Fastify({loggerInstance:o.logger,bodyLimit:o.bodyLimit??2*1024*1024,logController:new LogController({disableRequestLogging:true})});
 void app.register(rateLimit,{max:o.rateLimitMax??300,timeWindow:"1 minute"});
 app.addContentTypeParser("application/json",{parseAs:"buffer"},(req,body,done)=>{try{req.rawBody=body.toString("utf8");done(null,JSON.parse(req.rawBody));}catch(e){done(e as Error,undefined);}});
 app.get("/health/live",async()=>({ok:true}));
 app.get("/health/ready",async(_req,reply)=>{const r=await(o.readiness?.()??Promise.resolve({ready:true}));return reply.code(r.ready?200:503).send(r);});
 app.post("/webhooks/amocrm/:scopeId",async(req,reply)=>{const scopeId=String((req.params as any).scopeId);if(!verifyAmoWebhookSignature(req.rawBody??"",header(req,"x-signature"),o.amoChannelSecret))return reply.code(401).send({error:"invalid signature"});const body:any=req.body;const id=String(body?.message?.message?.id??"");const conversation=String(body?.message?.conversation?.id??"");if(!id||!conversation)return reply.code(400).send({error:"invalid payload"});await o.queue.enqueue({kind:"amocrm.outbound",partitionKey:`amo:${scopeId}:${conversation}`,dedupeKey:`${scopeId}:${id}`,payload:{scopeId,body}});return reply.code(200).send({ok:true});});
 app.get("/webhooks/whatsapp",async(req,reply)=>{const q=req.query as Record<string,string>;if(q["hub.mode"]==="subscribe"&&safeEqual(q["hub.verify_token"],o.whatsappVerifyToken))return reply.type("text/plain").send(q["hub.challenge"]);return reply.code(403).send();});
 app.post("/webhooks/whatsapp",async(req,reply)=>{if(!o.verifyWhatsApp)return reply.code(503).send();const raw=req.rawBody??"";const verified=await o.verifyWhatsApp(raw,req.body,header(req,"x-hub-signature-256"));if(!verified.valid||!verified.accountId)return reply.code(401).send({error:"invalid signature"});await o.queue.enqueue({kind:"messenger.inbound",partitionKey:`whatsapp:${verified.accountId}:webhook`,dedupeKey:`${verified.accountId}:webhook:${createHash("sha256").update(raw).digest("hex")}`,payload:{adapterWebhook:true,messenger:"whatsapp",accountId:verified.accountId,body:req.body}});return reply.code(200).send({ok:true});});
 app.post("/webhooks/max/:accountId",async(req,reply)=>{const accountId=String((req.params as any).accountId);if(!o.verifyMax||!await o.verifyMax(accountId,header(req,"x-max-bot-api-secret")))return reply.code(401).send({error:"invalid secret"});const body:any=req.body;const eventId=String(body?.update_id??body?.message?.body?.mid??`${body?.update_type}:${body?.timestamp}`);const conversation=String(body?.message?.recipient?.chat_id??body?.chat_id??body?.message?.sender?.user_id??"unknown");await o.queue.enqueue({kind:"messenger.inbound",partitionKey:`max:${accountId}:${conversation}`,dedupeKey:`${accountId}:${eventId}`,payload:{adapterWebhook:true,messenger:"max",accountId,body}});return reply.code(200).send({ok:true});});
 if(o.onboarding){app.post("/admin/telegram/onboarding",{preHandler:admin(o.adminToken)},async(req,reply)=>reply.code(202).send(await o.onboarding!.start(req.body as any)));app.post("/admin/telegram/onboarding/:accountId/code",{preHandler:admin(o.adminToken)},async req=>o.onboarding!.submitCode(String((req.params as any).accountId),String((req.body as any).code)));app.post("/admin/telegram/onboarding/:accountId/password",{preHandler:admin(o.adminToken)},async req=>o.onboarding!.submitPassword(String((req.params as any).accountId),String((req.body as any).password)));}
 if(o.accountManagement)app.post("/admin/accounts",{preHandler:admin(o.adminToken)},async(req,reply)=>reply.code(201).send(await o.accountManagement!.create(req.body as any)));
 app.get("/admin/jobs/dead",{preHandler:admin(o.adminToken)},async req=>o.queue.deadLetters(Math.min(500,Number((req.query as any)?.limit??100))));
 app.post("/admin/jobs/:id/requeue",{preHandler:admin(o.adminToken)},async(req,reply)=>{const ok=await o.queue.requeueDead(Number((req.params as any).id));return ok?reply.send({ok:true}):reply.code(404).send({error:"dead job not found"});});
 if(o.lifecycle){app.post("/admin/accounts/:accountId/amocrm/connect",{preHandler:admin(o.adminToken)},async req=>({scopeId:await o.lifecycle!.connectAccount(String((req.params as any).accountId),(req.body as any)?.title)}));app.post("/admin/accounts/:accountId/amocrm/source",{preHandler:admin(o.adminToken)},async req=>{await o.lifecycle!.ensureSource(String((req.params as any).accountId),(req.body as any)?.pipelineId);return{ok:true};});}
 return app;
}
function admin(token?:string){return async(req:any,reply:any)=>{if(!safeEqual(header(req,"authorization"),token?`Bearer ${token}`:undefined))return reply.code(401).send({error:"unauthorized"});};}
function header(req:any,name:string):string|undefined{const v=req.headers[name];return Array.isArray(v)?v[0]:v;}
function safeEqual(a?:string,b?:string){if(!a||!b||a.length!==b.length)return false;return timingSafeEqual(Buffer.from(a),Buffer.from(b));}
