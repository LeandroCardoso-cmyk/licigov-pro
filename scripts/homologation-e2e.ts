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
