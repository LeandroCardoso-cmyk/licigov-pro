/**
 * Rodada consolidada — UX (C1 objeto do TR legado, C2 escopo do Edital sobrevive ao recarregamento, C3 calendário).
 * Regras puras + guardas de ligação (sem React/rede).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { pendingReasonText, trPendingFields, trStructuredUnavailableText, type TrParamViewModel } from "@/lib/contextReuse";
import { editalScopeToRecord } from "./regenerationGuard";
import { calendarItemOriginText, calendarReferenceHref, processIdFromSearch, processRouteSearch, tabFromSearch } from "@shared/operationalCalendar";

const src = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

describe("C1 — objeto completo pendente por TR legado", () => {
  const field: TrParamViewModel = {
    name: "processo.objetoCompleto", path: "objetoCompleto", type: "text", description: "Objeto completo", required: true, conditional: false,
    requiredWhenVariables: [], active: true, status: "UNSET", defaultEligible: false, pendingReason: { code: "LEGACY_TR_WITHOUT_OBJECT", trVersion: 2 },
  };
  it("continua pendente e explica por quê — sem prometer que o Edital usará o valor com o TR já emitido", () => {
    expect(trPendingFields([field]).map((f) => f.name)).toEqual(["processo.objetoCompleto"]);
    const t = pendingReasonText(field.pendingReason)!;
    expect(t).toContain("v2");
    expect(t).toContain("não altera o TR emitido");
    expect(t).toContain("continuará pendente");
    expect(t).toContain("versão do TR emitida depois deste registro");
    // A linhagem do TR emitido (digest dos parâmetros) não acompanha registro posterior: nunca prometer o contrário.
    expect(t).not.toMatch(/passa a usar este valor/);
    expect(pendingReasonText(undefined)).toBeNull();
  });
  it("seção mostra o motivo junto do campo", () => {
    const s = src("./TrStructuredParamsSection.tsx");
    expect(s).toContain("pendingReasonText(f.pendingReason)");
    expect(s).toContain('data-testid="tr-param-pending-reason"');
  });
});

describe("parâmetros estruturados indisponíveis", () => {
  it("só o motivo acionável aparece (escolher o escopo no Edital); motivos técnicos/de configuração ficam fora do TR", () => {
    expect(trStructuredUnavailableText("há modelos de Edital com catálogos diferentes: informe os parâmetros do Edital para escolher o modelo"))
      .toContain("na etapa Edital");
    for (const r of [
      "modelos institucionais não habilitados para esta organização", "módulo de modelos institucionais não integrado nesta instalação",
      "revisão vinculada ou catálogo tpl-catalog/2 indisponível", "vínculo do modelo do Edital em conflito ou inválido",
      "nenhum modelo institucional de Edital vigente para esta organização",
    ]) expect(trStructuredUnavailableText(r)).toBeNull();
  });
});

describe("C2 — escopo do Edital registrado antes da 1ª geração", () => {
  const none = { modality: null, form: null, platform: null };
  const chosen = { modality: "pregao", form: "eletronico", platform: "bll" } as const;

  it("registra só escolha explícita, completa, antes da geração e diferente da registrada", () => {
    expect(editalScopeToRecord({ effective: chosen, proposed: chosen, persisted: null, composed: null, recorded: null })).toEqual(chosen);
    expect(editalScopeToRecord({ effective: chosen, proposed: none, persisted: null, composed: null, recorded: null })).toBeNull();
    expect(editalScopeToRecord({ effective: { ...chosen, platform: null }, proposed: { ...chosen, platform: null }, persisted: null, composed: null, recorded: null })).toBeNull();
    expect(editalScopeToRecord({ effective: chosen, proposed: chosen, persisted: { modality: "pregao" }, composed: null, recorded: null })).toBeNull();
    expect(editalScopeToRecord({ effective: chosen, proposed: chosen, persisted: null, composed: chosen, recorded: null })).toBeNull();
    expect(editalScopeToRecord({ effective: chosen, proposed: chosen, persisted: null, composed: null, recorded: chosen })).toBeNull();
  });

  it("forma presencial não leva plataforma", () => {
    const pres = { modality: "pregao", form: "presencial", platform: "bll" } as const;
    expect(editalScopeToRecord({ effective: pres, proposed: pres, persisted: null, composed: null, recorded: null }))
      .toEqual({ modality: "pregao", form: "presencial", platform: null });
  });

  it("a tela reabre com o escopo registrado (persistido > composto > registrado) e o registra com CAS", () => {
    const s = src("./EditalWorkspace.tsx");
    expect(s).toContain("persisted ?? composedParams ?? recordedScope");
    expect(s).toContain("trpc.procurementProcess.recordEditalScope.useMutation({");
    expect(s).toContain("expectedValueHash: scopeQuery.data?.valueHash ?? null");
    // uma gravação por vez; o hash do resultado vira a base do próximo CAS; escolha que falhou não é reenviada sozinha; só operator+
    expect(s).toContain("recordScope.isPending || scopeKey === failedScopeKey");
    expect(s).toContain("editalScopeSelection.setData({ processId }, r.selection)");
    expect(s).toContain('hasRole("operator")');
  });
});

describe("C3 — calendário: sessão declarada na Configuração do certame", () => {
  it("explica a origem do evento derivado e abre o processo", () => {
    expect(calendarItemOriginText({ declaredIn: "certame_config" })).toContain("Configuração do certame");
    expect(calendarItemOriginText({})).toBeNull();
    expect(calendarReferenceHref("procurement_process", "abc/1")).toBe("/processos?processId=abc%2F1");
    expect(calendarReferenceHref("operation_record", "r1")).toBeNull();
    expect(calendarReferenceHref("procurement_process", null)).toBeNull();
    expect(processIdFromSearch("?processId=abc%2F1")).toBe("abc/1");
    expect(processIdFromSearch("?processId=%20")).toBeNull();
    expect(processIdFromSearch("")).toBeNull();
    // M8 — ida e volta da rota do processo aberto (só identificadores; aba desconhecida ⇒ visão geral)
    expect(processRouteSearch("abc/1", "tr")).toBe("?processId=abc%2F1&tab=tr");
    expect(processRouteSearch("p1", "overview")).toBe("?processId=p1");
    expect(processIdFromSearch(processRouteSearch("abc/1", "tr"))).toBe("abc/1");
    expect(tabFromSearch(processRouteSearch("p1", "edital"), ["overview", "tr", "edital"] as const)).toBe("edital");
    expect(tabFromSearch("?processId=p1&tab=../admin", ["overview", "tr"] as const)).toBeNull();
    expect(tabFromSearch("?processId=p1", ["overview", "tr"] as const)).toBeNull();
  });

  it("Centro de Operações navega para o processo e a página de processos abre pelo link", () => {
    expect(src("../department-operation/DepartmentOperationHome.tsx")).toContain("calendarReferenceHref(type, id)");
    expect(src("../../pages/ProcessoLicitatorio.tsx")).toContain("processIdFromSearch(window.location.search)");
    // M8 — reload: a URL acompanha processo e aba (replaceState) e o reload reabre os dois; processo alheio volta à lista.
    expect(src("../../pages/ProcessoLicitatorio.tsx")).toContain("processRouteSearch(activeProcessId, activeTab)");
    expect(src("../../pages/ProcessoLicitatorio.tsx")).toContain("tabFromSearch(window.location.search, STAGE_TABS.map((t) => t.key))");
    expect(src("../../pages/ProcessoLicitatorio.tsx")).toContain("processQuery.isSuccess && !processQuery.data?.process");
    expect(src("../department-operation/OperationalCalendar.tsx")).toContain("calendarItemOriginText(e)");
  });
});
