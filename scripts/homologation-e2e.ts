/**
 * Homologação E2E pelas APIs OFICIAIS — biblioteca do executor (`pnpm homolog:e2e`).
 *
 * As jornadas ficam em `server/__tests__/homologation/staging-homologation-e2e.test.ts` (Vitest, para REUTILIZAR os helpers de
 * preparação já usados pelos smokes; o arquivo é pulado sem `HOMOLOG_BASE_URL`). Aqui ficam só as peças compartilhadas:
 * cliente HTTP real (login, cookie de sessão, tRPC, RBAC do servidor), guardas de destino/tenant/credencial e utilitários.
 *
 * Guardas (validadas ANTES de qualquer escrita):
 *  - destino só staging autorizado (`licigov-pro-staging.up.railway.app`) ou servidor local; qualquer outro host ⇒ recusa;
 *  - tenant só `homologacao-sintetica`, descoberto pelas organizações do próprio usuário (nunca id presumido); organização 1 ⇒ recusa;
 *  - credencial: não pode ser admin de plataforma (cross-tenant) nem ser membro da organização 1 (referências reais);
 *  - exercício do processo informado explicitamente (`HOMOLOG_EXERCICIO`), nunca "ano corrente" por omissão.
 * Senhas, cookies e tokens nunca são impressos nem gravados no relatório.
 */
import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../server/routers";
import { createHash } from "node:crypto";
import { COOKIE_NAME } from "../shared/const";

export const SYNTHETIC_TENANT_SLUG = "homologacao-sintetica";
export const STAGING_HOST = "licigov-pro-staging.up.railway.app";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
export const MARK = "[HOMOLOGAÇÃO SINTÉTICA]";

/** Destino permitido: staging autorizado (HTTPS) ou servidor local de desenvolvimento. Produção/outros ⇒ recusa. */
export function assertAllowedTarget(baseUrl: string): URL {
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error(`HOMOLOG_BASE_URL inválida: ${baseUrl}`); }
  if (url.hostname === STAGING_HOST && url.protocol === "https:") return url;
  if (LOCAL_HOSTS.has(url.hostname)) return url;
  throw new Error(`Destino recusado: ${url.hostname} não é o staging autorizado (${STAGING_HOST}) nem servidor local.`);
}

/** Guarda do tenant: só o slug sintético, nunca a organização 1 (referências reais). */
export function assertSyntheticTenant(org: { id: number; slug: string | null } | undefined): asserts org is { id: number; slug: string } {
  if (!org) throw new Error(`Usuário não é membro ativo do tenant sintético '${SYNTHETIC_TENANT_SLUG}'.`);
  if (org.slug !== SYNTHETIC_TENANT_SLUG) throw new Error(`Tenant recusado: slug '${org.slug}' ≠ '${SYNTHETIC_TENANT_SLUG}'.`);
  if (org.id === 1) throw new Error("Tenant recusado: a organização 1 contém referências reais.");
}

/** Credencial só de usuário do tenant sintético: nunca admin de plataforma, nunca membro da organização 1. */
export function assertSyntheticCredential(me: { role?: string | null } | null, orgIds: readonly number[]): void {
  if (!me) throw new Error("Login não estabeleceu sessão.");
  if (me.role === "admin") throw new Error("Credencial recusada: admin de plataforma (acesso cross-tenant) não é usado na homologação.");
  if (orgIds.includes(1)) throw new Error("Credencial recusada: o usuário é membro da organização 1 (referências reais).");
}

/**
 * Organização sintética fixada por `HOMOLOG_ORGANIZATION_ID` (opcional). Usuário com MAIS de uma associação ativa precisa do
 * `X-Organization-Id` já na primeira chamada tenant-scoped (`organizations.listMine`) — sem ele o servidor recusa ("múltiplas
 * organizações"). O id só escolhe o cabeçalho: o slug `homologacao-sintetica` continua sendo conferido antes de qualquer escrita.
 */
export function parseOrganizationId(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  if (!/^\d+$/.test(v.trim()) || Number(v.trim()) <= 0) throw new Error(`HOMOLOG_ORGANIZATION_ID inválido: ${v}`);
  const id = Number(v.trim());
  if (id === 1) throw new Error("Organização recusada: a organização 1 contém referências reais.");
  return id;
}

const ORG_ROLE_RANK: Readonly<Record<string, number>> = { viewer: 1, operator: 2, manager: 3, admin: 4, owner: 5 };

/** Papel mínimo no tenant sintético (atos governados e emissão exigem `manager`). Recusa ANTES de qualquer escrita. */
export function assertOrgRoleAtLeast(role: string | null | undefined, min: "operator" | "manager", who: string): void {
  if ((ORG_ROLE_RANK[role ?? ""] ?? 0) < ORG_ROLE_RANK[min]) {
    throw new Error(`Credencial recusada: ${who} tem papel '${role ?? "nenhum"}' no tenant sintético; é necessário '${min}' ou superior.`);
  }
}

/** Diagnósticos de BLOQUEIO (configuração/credencial/ambiente — ação do Owner), distintos de falha de produto (ação de Dev). */
export const BLOCKED_DEMONSTRATIVE_PRICES = "BLOCKED_HOMOLOGATION_DEMONSTRATIVE_PRICES_NOT_ENABLED";
export const BLOCKED_SAME_IDENTITY = "BLOCKED_HOMOLOGATION_SAME_IDENTITY";
export const BLOCKED_LOGIN_RATE_LIMITED = "BLOCKED_HOMOLOGATION_LOGIN_RATE_LIMITED";

/**
 * Pré-flight M8 (ANTES de qualquer escrita): a jornada A emite o TR com cotações FICTÍCIAS, o que só é possível com a exceção
 * controlada de valores demonstrativos habilitada no backend para o tenant sintético (`organizations.getCurrent().priceGovernance`,
 * visível só a manager+). Ausente/false/servidor antigo ⇒ bloqueio explícito — nunca descobrir isso depois de criar o processo.
 */
export function assertDemonstrativePricesEnabled(current: { priceGovernance?: { demonstrativePricesAllowed?: boolean } | null } | null | undefined): void {
  if (current?.priceGovernance?.demonstrativePricesAllowed === true) return;
  const why = current?.priceGovernance == null
    ? "o servidor não informou a capacidade (papel abaixo de manager ou versão anterior ao pré-flight)"
    : "a exceção controlada de valores demonstrativos não está habilitada para este tenant neste ambiente";
  throw new Error(`${BLOCKED_DEMONSTRATIVE_PRICES}: ${why}. Nenhuma escrita foi feita. Ação do Owner (configuração de staging) — ver runbook M8.`);
}

/** Segregação de funções: as duas credenciais precisam ser usuários DISTINTOS (compara ids, nunca e-mails/senhas). */
export function assertDistinctIdentities(a: { id: number }, b: { id: number }): void {
  if (a.id === b.id) {
    throw new Error(`${BLOCKED_SAME_IDENTITY}: HOMOLOG_EMAIL e HOMOLOG_EMAIL_2 resolvem para o MESMO usuário (id ${a.id}); a emissão do TR exige outro usuário. Nenhuma escrita foi feita. Ação do Owner — ver runbook M8.`);
  }
}

/** Login recusado pelo limitador (5 tentativas/15 min por IP) é bloqueio de ambiente, não falha de produto. */
export function classifyLoginError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (trpcCode(e) === "TOO_MANY_REQUESTS") return new Error(`${BLOCKED_LOGIN_RATE_LIMITED}: ${msg} Aguarde a janela do limitador; não reinicie o serviço para zerá-lo.`);
  return e instanceof Error ? e : new Error(msg);
}

/** Exercício explícito (AAAA, 1900–2099). Sem valor válido ⇒ erro: nunca substituído pelo ano corrente. */
export function parseExercicio(v: string | undefined): number {
  if (!v || !/^(19|20)\d{2}$/.test(v.trim())) throw new Error("Informe HOMOLOG_EXERCICIO (AAAA) — o exercício do processo sintético nunca é presumido.");
  return Number(v.trim());
}

/** Número do processo no formato NNNN/AAAA (aceito pelo motor documental); sequência derivada da execução, única por tentativa. */
export function syntheticProcessNumber(run: string, exercicio: number, attempt = 0): string {
  const seq = (Number.parseInt(run, 36) + attempt) % 9000 + 1000;
  return `${seq}/${exercicio}`;
}

/** Marcadores de pendência que a composição deixa visíveis (nada é inventado). */
export function pendingMarkers(text: string): { revisar: number; aDefinir: number; publicacao: number } {
  return {
    revisar: (text.match(/\[REVISAR[^\]]*\]/g) ?? []).length,
    aDefinir: (text.match(/\[a definir[^\]]*\]/gi) ?? []).length,
    publicacao: (text.match(/A DEFINIR PARA PUBLICAÇÃO/g) ?? []).length,
  };
}

/**
 * M8 pós-homologação — MÉTRICA (não bloqueia): marcadores [REVISAR] do TR que pedem um parâmetro JÁ CONFIRMADO no processo
 * (o rótulo do parâmetro aparece no texto do marcador). Esperado: 0 — a autoria recebe os parâmetros confirmados.
 */
export function redundantReviewMarkers(content: string, confirmedLabels: readonly string[]): string[] {
  const labels = confirmedLabels.map((l) => l.replace(/\s*\[[^\]]*\]\s*$/, "").trim().toLowerCase()).filter((l) => l.length >= 6);
  return (content.match(/\[REVISAR[^\]]*\]/g) ?? []).filter((m) => labels.some((l) => m.toLowerCase().includes(l)));
}

/** Resíduos técnicos que nunca podem chegar ao documento exportado. */
export function technicalResidue(text: string): string[] {
  const found: string[] = [];
  if (/\{\{|\}\}/.test(text)) found.push("placeholder {{ }}");
  if (/SYSTEM NOTE/i.test(text)) found.push("SYSTEM NOTE");
  if (/⟦|⟧|\[XREF|xref:/.test(text)) found.push("xref");
  return found;
}

/** Assinatura dos formatos exportados (bytes reais, não só o nome do arquivo). */
export function looksLike(format: "docx" | "pdf", bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
  return format === "docx" ? head.startsWith("PK") : head.startsWith("%PDF-");
}

/** Decisão governada marcada como DADO DE TESTE: autor = usuário autenticado; nenhum ato administrativo é imitado. */
export function syntheticDecision(user: { name?: string | null; id: number }, today: string) {
  return {
    decidedByName: user.name || `Usuário ${user.id}`, decidedByRole: `${MARK} usuário de homologação`, decidedByUserId: user.id,
    decidedAt: today, basisReference: `${MARK} sem ato administrativo — dado de teste`, reason: `${MARK} preenchimento de homologação`,
  };
}

export const trpcCode = (e: unknown): string => (e instanceof TRPCClientError ? String((e.data as { code?: string } | undefined)?.code ?? "") : "");

/** Sessão HTTP real: cookie do login guardado em memória (nunca impresso); `orgId` vira `x-organization-id`. */
export function homologSession(baseUrl: string) {
  const state = { cookie: "", orgId: null as number | null };
  const api = createTRPCClient<AppRouter>({
    links: [httpLink({
      url: `${baseUrl.replace(/\/$/, "")}/api/trpc`,
      transformer: superjson,
      headers: () => ({
        ...(state.cookie ? { cookie: state.cookie } : {}),
        ...(state.orgId ? { "x-organization-id": String(state.orgId) } : {}),
        "x-correlation-id": `homolog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      }),
      fetch: async (url, init) => {
        const res = await fetch(url, init as RequestInit);
        const session = res.headers.getSetCookie?.().find((c) => c.startsWith(`${COOKIE_NAME}=`));
        if (session) state.cookie = session.split(";")[0];
        return res;
      },
    })],
  });
  return { api, state };
}

type AnyNode = { query?: (i: unknown) => Promise<unknown>; mutate?: (i: unknown) => Promise<unknown> } & Record<string, unknown>;

/**
 * Adapta o cliente tRPC à forma "chamada direta" (`proc().rota(input)`) dos helpers de preparação já existentes, sem duplicá-los:
 * tenta `query` e, se o servidor responder que a rota é mutation (`METHOD_NOT_SUPPORTED`, nada executado), usa `mutate`.
 * Em mutations, a `decision` sintética dos fixtures é SUBSTITUÍDA pela decisão marcada como dado de teste.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- forma dinâmica dos helpers (proc().rota(input))
export function directCallAdapter(node: unknown, decision: Record<string, unknown>): any {
  const call = async (n: AnyNode, input: unknown): Promise<unknown> => {
    try { return await n.query!(input); } catch (e) {
      if (trpcCode(e) !== "METHOD_NOT_SUPPORTED") throw e;
      const patched = input && typeof input === "object" && "decision" in (input as object) ? { ...(input as object), decision } : input;
      return n.mutate!(patched);
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrap = (n: unknown): any => new Proxy(function () { /* callable */ }, {
    get: (_t, p) => wrap((n as Record<string | symbol, unknown>)[p]),
    apply: (_t, _this, args) => call(n as AnyNode, args[0]),
  });
  return wrap(node);
}

/**
 * M8-PRICE-IMPORT-001 — a pesquisa de preços do caso real de homologação (1 item, 10 computadores, UN, 3 cotações
 * R$ 3.900,00 / R$ 4.100,00 / R$ 4.000,00), no formato documental em que foi colada. Esperado: 1 item lógico, 3 cotações,
 * média R$ 4.000,00, total R$ 40.000,00 — nunca dezenas de itens/cotações formados por cabeçalho, metadados ou avisos.
 */
export const M8_PRICE_RESEARCH_TEXT = [
  `PESQUISA DE PREÇOS — ${MARK}`,
  "Prefeitura Sintética — Homologação",
  "Objeto: Aquisição de 10 computadores desktop completos",
  "Data da pesquisa: 10/10/2026",
  "",
  "Item 1 — Computador desktop completo",
  "Descrição: processador de 8 núcleos, 16 GB de RAM, SSD 512 GB, monitor, teclado e mouse",
  "Quantidade: 10",
  "Unidade: UN",
  "",
  "Cotação 1 — Fornecedor Fictício Alfa — R$ 3.900,00 — 05/10/2026",
  "Cotação 2 — Fornecedor Fictício Beta — R$ 4.100,00 — 06/10/2026",
  "Cotação 3 — Fornecedor Fictício Gama — R$ 4.000,00 — 07/10/2026",
  "",
  "Preço médio: R$ 4.000,00",
  "Valor total estimado: R$ 40.000,00",
  "Observação: dados fictícios, exclusivamente para homologação.",
].join("\n");

/** Saída da IA contaminada com metadados de geração (o defeito M8-AI-DFD-001) — nunca pode chegar ao documento. */
export const AI_META_RESIDUE = /pontua[çc][ãa]o de confian[çc]a|fatos utilizados|\[REVISAR:\s*0[.,]\d+\]/i;

// ─── PR-04 (SEM-005) — Pesquisa de Preços pela INGESTÃO CANÔNICA ───────────────────────────────────────────────────
// Com `FF_CANONICAL_INGESTION` ligada no tenant, o servidor recusa a colagem legada (`LEGACY_PRICE_IMPORT_DISABLED`); o
// executor passa a usar as MESMAS rotas da tela: createSession → upload HTTP (multipart) → enqueueProcessing → revisão por
// item lógico → approveSession → promoteSession (manager). Nada de mecanismo paralelo; o servidor decide RBAC/tenant/flag.

export type PriceImportMode = "canonical" | "legacy";
type HomologApi = ReturnType<typeof homologSession>["api"];

/** Modo pela capability OFICIAL do tenant. Ingestão ligada sem CSV suportado ⇒ erro explícito (nunca cai no legado). */
export function priceImportMode(caps: { enabled: boolean; supportedFormats: ReadonlyArray<{ key: string; supported: boolean }> }): PriceImportMode {
  if (!caps.enabled) return "legacy";
  if (!caps.supportedFormats.some((f) => f.key === "csv" && f.supported)) {
    throw new Error("Ingestão canônica ligada, mas o formato CSV não está suportado — o executor não pode prosseguir.");
  }
  return "canonical";
}

/** CSV delimitado por `;` no cabeçalho reconhecido pelo parser (uma linha por cotação). */
export function priceResearchCsv(rows: ReadonlyArray<{ description: string; planned: number; unit: string; price: string; supplier: string }>): string {
  return ["Descrição;Quantidade;Unidade;Valor unitário;Fornecedor",
    ...rows.map((r) => [r.description, r.planned, r.unit, r.price, r.supplier].join(";"))].join("\n");
}

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Upload HTTP real da ingestão canônica (rota Express fora do tRPC), com o MESMO cookie e `x-organization-id` da sessão. */
export async function uploadIngestionFile(baseUrl: string, state: ReturnType<typeof homologSession>["state"], uploadPath: string,
  file: { bytes: Uint8Array; name: string; mime: string }): Promise<{ ok: true; sessionId: number; size: number; checksum: string }> {
  const form = new FormData();
  form.append("file", new Blob([file.bytes], { type: file.mime }), file.name);
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${uploadPath}`, {
    method: "POST",
    headers: { ...(state.cookie ? { cookie: state.cookie } : {}), ...(state.orgId ? { "x-organization-id": String(state.orgId) } : {}) },
    body: form,
  });
  const body = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new Error(`Upload recusado (HTTP ${res.status}): ${body.error ?? "sem detalhe"}`);
  return body as { ok: true; sessionId: number; size: number; checksum: string };
}

/**
 * Uma importação canônica completa da Pesquisa de Preços. `author` envia, revisa e aprova a sessão (operator+); `manager`
 * promove ao domínio (manager+, outro usuário). Cada chamada é uma SESSÃO própria ⇒ uma pesquisa própria (acumula cotações).
 */
export async function runCanonicalPriceResearch(p: {
  baseUrl: string;
  author: ReturnType<typeof homologSession>;
  manager: HomologApi;
  processId: string;
  csv: string;
  fileName: string;
  key: (purpose: string) => string;
  timeoutMs?: number;
}): Promise<{ sessionId: number; groups: number; quotes: number; promotion: unknown }> {
  const op = p.author.api;
  const bytes = new TextEncoder().encode(p.csv);
  const created = await op.ingestion.createSession.mutate({
    importType: "price_research", sourceFileName: p.fileName, sourceMimeType: "text/csv", sourceSize: bytes.length,
    checksum: sha256Hex(bytes), idempotencyKey: p.key("ingest").slice(0, 64), procurementProcessId: p.processId, importPurpose: "price_research",
  });
  if (created.duplicate) throw new Error(`Arquivo idêntico já tem sessão ativa (${created.sessionId}) — use conteúdo novo por execução.`);
  await uploadIngestionFile(p.baseUrl, p.author.state, created.uploadPath, { bytes, name: p.fileName, mime: "text/csv" });
  await op.ingestion.enqueueProcessing.mutate({ sessionId: created.sessionId, procurementProcessId: p.processId });

  const deadline = Date.now() + (p.timeoutMs ?? 120_000);
  for (;;) {
    const st = await op.ingestion.getSessionStatus.query({ sessionId: created.sessionId, procurementProcessId: p.processId });
    if (st.session.status === "awaiting_review") break;
    if (st.session.status === "failed") throw new Error(`Extração falhou na sessão ${created.sessionId}.`);
    if (Date.now() > deadline) throw new Error(`Extração não concluiu a tempo (sessão ${created.sessionId}, estado ${st.session.status}).`);
    await new Promise((r) => setTimeout(r, 1_000));
  }

  const review = await op.ingestion.getPriceResearchReview.query({ sessionId: created.sessionId, procurementProcessId: p.processId });
  const groups = review.groups.map((g) => ({ groupKey: g.groupKey, expectedRevision: g.revision }));
  if (groups.length === 0) throw new Error(`Nenhum item extraído na sessão ${created.sessionId}.`);
  await op.ingestion.reviewPriceResearchGroups.mutate({ sessionId: created.sessionId, procurementProcessId: p.processId, action: "approved", groups });
  await op.ingestion.approveSession.mutate({ sessionId: created.sessionId, procurementProcessId: p.processId });
  const promotion = await p.manager.ingestion.promoteSession.mutate({
    sessionId: created.sessionId, procurementProcessId: p.processId, idempotencyKey: p.key("promote").slice(0, 64),
  });
  const quotes = review.groups.reduce((n, g) => n + g.quotes.length, 0);
  return { sessionId: created.sessionId, groups: groups.length, quotes, promotion };
}
