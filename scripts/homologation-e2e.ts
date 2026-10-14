/**
 * Homologação E2E pelas APIs OFICIAIS (HTTP + login real + cookie de sessão + tRPC + RBAC do servidor) —
 * jornadas A (processo novo), B (legado → contrato vigente → aditivo) e C (monitoramento).
 *
 * Travado no tenant SINTÉTICO `homologacao-sintetica`: o órgão é descoberto pelas organizações do próprio usuário
 * (`organizations.listMine`), nunca por id presumido; qualquer outro slug ou a organização 1 ⇒ aborta antes de escrever.
 * Não cria órgão/usuário, não altera política, revisão ou binding de modelo, não toca produção: só usa as rotas que
 * a tela usa, com as credenciais de um usuário de teste do tenant sintético (lidas do ambiente, nunca do repositório).
 *
 * Uso:
 *   HOMOLOG_CONFIRM=SINTETICO HOMOLOG_BASE_URL=https://<staging> \
 *   HOMOLOG_EMAIL=<usuário de teste> HOMOLOG_PASSWORD=<senha> \
 *   [HOMOLOG_REPORT=relatorio.json] pnpm homolog:e2e
 *
 * Saída: relatório JSON (jornadas, verificações, métricas por documento). Exit 0 = todas as verificações passaram.
 */
import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import superjson from "superjson";
import { writeFileSync } from "node:fs";
import type { AppRouter } from "../server/routers";
import { COOKIE_NAME } from "../shared/const";

export const SYNTHETIC_TENANT_SLUG = "homologacao-sintetica";
const MARK = "[HOMOLOGAÇÃO SINTÉTICA]";

interface Check { readonly journey: string; readonly name: string; readonly ok: boolean; readonly detail?: string }
export interface HomologationReport {
  readonly baseUrl: string; readonly run: string; readonly tenant: { id: number; slug: string; role: string } | null;
  readonly checks: Check[]; readonly metrics: Record<string, unknown>; readonly passed: boolean;
}

/** Marcadores de pendência que a composição deixa visíveis (nada é inventado). */
export function pendingMarkers(text: string): { revisar: number; aDefinir: number; publicacao: number } {
  return {
    revisar: (text.match(/\[REVISAR[^\]]*\]/g) ?? []).length,
    aDefinir: (text.match(/\[a definir[^\]]*\]/gi) ?? []).length,
    publicacao: (text.match(/A DEFINIR PARA PUBLICAÇÃO/g) ?? []).length,
  };
}

/** Assinatura dos formatos exportados (bytes reais, não só o nome do arquivo). */
export function looksLike(format: "docx" | "pdf", bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
  return format === "docx" ? head.startsWith("PK") : head.startsWith("%PDF-");
}

/** Guarda do tenant: só o slug sintético, nunca a organização 1 (referências reais). */
export function assertSyntheticTenant(org: { id: number; slug: string | null } | undefined): asserts org is { id: number; slug: string } {
  if (!org) throw new Error(`Usuário não é membro ativo do tenant sintético '${SYNTHETIC_TENANT_SLUG}'.`);
  if (org.slug !== SYNTHETIC_TENANT_SLUG) throw new Error(`Tenant recusado: slug '${org.slug}' ≠ '${SYNTHETIC_TENANT_SLUG}'.`);
  if (org.id === 1) throw new Error("Tenant recusado: a organização 1 contém referências reais.");
}

function client(baseUrl: string, state: { cookie: string; orgId: number | null }) {
  return createTRPCClient<AppRouter>({
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
}

const codeOf = (e: unknown) => (e instanceof TRPCClientError ? String((e.data as { code?: string } | undefined)?.code ?? "") : "");

export async function runHomologation(cfg: { baseUrl: string; email: string; password: string; today?: string }): Promise<HomologationReport> {
  const run = Date.now().toString(36).toUpperCase();
  const today = cfg.today ?? new Date().toISOString().slice(0, 10);
  const plus = (d: number) => { const t = new Date(`${today}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
  const state = { cookie: "", orgId: null as number | null };
  const api = client(cfg.baseUrl, state);
  const checks: Check[] = [];
  const metrics: Record<string, unknown> = {};
  const check = (journey: string, name: string, ok: boolean, detail?: string) => { checks.push({ journey, name, ok, ...(detail ? { detail } : {}) }); return ok; };
  const step = async <T>(journey: string, name: string, fn: () => Promise<T>): Promise<T | null> => {
    try { const v = await fn(); check(journey, name, true); return v; } catch (e) { check(journey, name, false, `${codeOf(e)} ${(e as Error).message}`.trim()); return null; }
  };
  const download = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());

  // ─── Sessão + tenant sintético (descoberto, nunca presumido) ─────────────────────────────────────────────
  await api.auth.login.mutate({ email: cfg.email, password: cfg.password });
  const mine = await api.organizations.listMine.query();
  const found = mine.map((m) => m.org).find((o) => o.slug === SYNTHETIC_TENANT_SLUG);
  assertSyntheticTenant(found);
  state.orgId = found.id;
  const current = await api.organizations.getCurrent.query();
  assertSyntheticTenant(current.org);
  const tenant = { id: current.org.id, slug: current.org.slug!, role: current.role };

  // ─── Jornada A — processo novo: DFD → ETP → TR → Edital → DOCX/PDF ─────────────────────────────────────
  const A = "A-processo-novo";
  const object = `${MARK} Aquisição de papel A4 para a Secretaria Fictícia de Testes — run ${run}`;
  const created = await step(A, "criar processo", () => api.procurementProcess.createProcess.mutate({ processNumber: `HOMOLOG-${run}`, object, startOption: "iniciar_pesquisa" }));
  const pid = created?.process.id ?? "";
  if (pid) {
    await step(A, "item da contratação (quantidade prevista)", () => api.procurementItems.createManual.mutate({ processId: pid, description: `${MARK} Papel A4 75g/m²`, unit: "resma", plannedQuantity: "120", idempotencyKey: `homolog-item-${run}` }));
    const dfd = await step(A, "DFD a partir do contexto (sem redigitação)", () => api.procurementProcess.generateDFD.mutate({ processId: pid, idempotencyKey: `homolog-dfd-${run}` }));
    if (dfd) {
      check(A, "DFD reutiliza objeto e itens", dfd.document.content.includes("Papel A4 75g/m²"));
      const again = await api.procurementProcess.generateDFD.mutate({ processId: pid, idempotencyKey: `homolog-dfd-${run}` });
      check(A, "replay do DFD (mesma chave ⇒ mesmo documento)", again.document.id === dfd.document.id && again.document.content === dfd.document.content);
      metrics.DFD = { chars: dfd.document.content.length, ...pendingMarkers(dfd.document.content) };
    }
    const etp = await step(A, "ETP reutilizando o DFD", () => api.procurementProcess.generateETP.mutate({ processId: pid, object, idempotencyKey: `homolog-etp-${run}` }));
    if (etp) metrics.ETP = { chars: etp.document.content.length, ...pendingMarkers(etp.document.content) };
    const tr = await step(A, "TR reutilizando DFD + ETP + itens", () => api.procurementProcess.generateTR.mutate({ processId: pid, object, idempotencyKey: `homolog-tr-${run}` }));
    if (tr) {
      check(A, "TR contém os itens canônicos", tr.document.content.includes("Papel A4 75g/m²"));
      metrics.TR = { chars: tr.document.content.length, ...pendingMarkers(tr.document.content) };
    }
    const params = { modality: "pregao", form: "eletronico", platform: "bll" } as const;
    const resolution = await step(A, "resolução do modelo do Edital", () => api.procurementProcess.editalTemplateResolution.query({ processId: pid, ...params }));
    metrics.EDITAL_TEMPLATE_RESOLUTION = resolution?.status ?? null;
    if (resolution?.status === "BOUND") {
      // Modelo institucional vinculado: mede a preparação (o que o servidor resolve sozinho × o que falta) sem emitir.
      const prep = await step(A, "preparação do Edital BLL (servidor)", () => api.procurementProcess.editalTemplatePreparation.query({ processId: pid, ...params }));
      if (prep && "metrics" in prep) metrics.EDITAL_BLL = { metrics: prep.metrics, publication: prep.publication?.readiness ?? null };
      else if (prep) check(A, "preparação do Edital BLL disponível", false, `${prep.resolution}: ${prep.reason}`);
    } else {
      const ed = await step(A, "Edital (motor padrão do órgão)", () => api.procurementProcess.generateNotice.mutate({ processId: pid, object, ...params, idempotencyKey: `homolog-ed-${run}` }));
      if (ed) metrics.EDITAL = { mode: ed.generationMode, chars: ed.document?.content.length ?? 0, ...pendingMarkers(ed.document?.content ?? "") };
    }
    for (const kind of ["dfd", "etp", "tr", "edital"] as const) {
      for (const format of ["docx", "pdf"] as const) {
        const out = await step(A, `exportar ${kind.toUpperCase()} ${format.toUpperCase()}`, () => api.procurementProcess.exportDocument.mutate({ processId: pid, kind, format }));
        if (out) check(A, `${kind.toUpperCase()} ${format.toUpperCase()} íntegro`, looksLike(format, await download(out.url)));
      }
    }
  }

  // ─── Jornada B — legado: contrato vigente → aditivo → termo exportado ──────────────────────────────────
  const B = "B-legado-contrato-aditivo";
  const reg = await step(B, "registrar contrato vigente (declarado)", () => api.contractWorkspace.registerInForceContract.mutate({
    idempotencyKey: `homolog-ct-${run}`, contractNumber: `HOMOLOG-CT-${run}`, contractor: `${MARK} Fornecedor Fictício Ltda`,
    object: `${MARK} Manutenção predial`, term: "12 meses", value: 12000, endDate: plus(40), sourceReference: `${MARK} Pregão 1/2023`,
  }));
  if (reg) {
    check(B, "nasce vigente, origem legado, informação declarada", reg.workspace.status === "vigente" && reg.workspace.originType === "legado" && reg.provenance === "DECLARADO");
    const replay = await api.contractWorkspace.registerInForceContract.mutate({
      idempotencyKey: `homolog-ct-${run}`, contractNumber: `HOMOLOG-CT-${run}`, contractor: `${MARK} Fornecedor Fictício Ltda`,
      object: `${MARK} Manutenção predial`, term: "12 meses", value: 12000, endDate: plus(40), sourceReference: `${MARK} Pregão 1/2023`,
    });
    check(B, "replay do registro (mesma chave ⇒ mesmo contrato)", replay.workspace.id === reg.workspace.id);
    const ad = await step(B, "aditivo de prazo sem DFD/ETP/TR/Edital", () => api.contractWorkspace.createAddendum.mutate({ contractId: reg.workspace.id, addendumType: "prazo", justification: `${MARK} Prorrogação por 12 meses.`, newTerm: "24 meses", idempotencyKey: `homolog-ad-${run}` }));
    if (ad?.addendum) {
      const v = await step(B, "termo aditivo versionado", () => api.documentEngine.versions.query({ businessDomain: "contratos", documentType: "aditivo", origin: reg.workspace.id, instrumentId: ad.addendum.id }));
      const docId = v?.versions[0]?.id;
      if (docId) {
        for (const format of ["docx", "pdf"] as const) {
          const out = await step(B, `exportar termo aditivo ${format.toUpperCase()}`, () => api.documentEngine.exportInstitutional.mutate({ documentId: docId, format }));
          if (out) check(B, `termo ${format.toUpperCase()} íntegro`, looksLike(format, await download(out.url)));
        }
      }
    }
  }

  // ─── Jornada C — monitoramento: registro externo/legado → calendário → Centro de Operações ──────────────
  const C = "C-monitoramento";
  const rec = await step(C, "contrato externo com término da vigência", () => api.operationRecord.createRecord.mutate({ recordType: "contrato_externo", origin: "externa", number: `HOMOLOG-CE-${run}`, object: `${MARK} Locação de veículos`, expirationDate: plus(20) }));
  if (rec) {
    const cal = await api.departmentOperation.calendar.query({ from: today, to: plus(60) });
    const mine2 = cal.events.filter((e) => e.referenceId === rec.record.id);
    check(C, "vencimento no calendário", mine2.some((e) => e.eventType === "vencimento_contrato" && e.eventDate === plus(20)));
    check(C, "alertas automáticos (15d e 7d)", mine2.some((e) => e.eventDate === plus(5)) && mine2.some((e) => e.eventDate === plus(13)));
    if (reg) check(C, "contrato legado (Jornada B) no calendário", cal.events.some((e) => e.referenceId === reg.workspace.id && e.eventDate === plus(40)));
  }
  const dash = await step(C, "Centro de Operações (indicadores)", () => api.departmentOperation.dashboard.query({ today }));
  if (dash) metrics.CONTRACTS_EXPIRING_90D = dash.indicators.contractsExpiring;
  const imp = await step(C, "processo legado só para acompanhamento", () => api.operationRecord.importLegacy.mutate({ recordType: "processo_licitatorio_legado", rawText: `${MARK} Processo nº 9/2022 — Pregão Eletrônico — Objeto: mobiliário escolar.` }));
  if (imp) {
    const panel = await api.departmentOperation.monitoringPanel.query({ today });
    check(C, "legado no painel de acompanhamento", panel.rows.some((r) => r.processId === imp.record.id));
  }

  // ─── Isolamento: o mesmo usuário não alcança órgão do qual não é membro ─────────────────────────────────
  const other = state.orgId; state.orgId = 2_147_000_000;
  try { await api.organizations.getCurrent.query(); check("isolamento", "órgão alheio recusado", false, "acesso concedido"); }
  catch (e) { check("isolamento", "órgão alheio recusado", ["FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED", "BAD_REQUEST"].includes(codeOf(e)), codeOf(e)); }
  state.orgId = other;

  return { baseUrl: cfg.baseUrl, run, tenant, checks, metrics, passed: checks.every((c) => c.ok) };
}

export async function main(): Promise<number> {
  const { HOMOLOG_CONFIRM, HOMOLOG_BASE_URL, HOMOLOG_EMAIL, HOMOLOG_PASSWORD, HOMOLOG_REPORT } = process.env;
  if (HOMOLOG_CONFIRM !== "SINTETICO" || !HOMOLOG_BASE_URL || !HOMOLOG_EMAIL || !HOMOLOG_PASSWORD) {
    console.error("Informe HOMOLOG_CONFIRM=SINTETICO, HOMOLOG_BASE_URL, HOMOLOG_EMAIL e HOMOLOG_PASSWORD (usuário do tenant sintético).");
    return 1;
  }
  const report = await runHomologation({ baseUrl: HOMOLOG_BASE_URL, email: HOMOLOG_EMAIL, password: HOMOLOG_PASSWORD });
  const json = JSON.stringify(report, null, 2);
  if (HOMOLOG_REPORT) writeFileSync(HOMOLOG_REPORT, json);
  console.info(json);
  return report.passed ? 0 : 2;
}

if (process.argv[1]?.endsWith("homologation-e2e.ts")) {
  main().then((code) => process.exit(code), (e) => { console.error((e as Error).message); process.exit(1); });
}
