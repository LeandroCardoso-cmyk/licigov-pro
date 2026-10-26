/**
 * Rodada consolidada — UX (C1 objeto do TR legado, C2 escopo do Edital sobrevive ao recarregamento, C3 calendário).
 * Regras puras + guardas de ligação (sem React/rede).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { pendingReasonText, trPendingFields, trStructuredUnavailableText, type TrParamViewModel } from "@/lib/contextReuse";
import { editalScopeToRecord } from "./regenerationGuard";
import { calendarItemOriginText, calendarReferenceHref, processIdFromSearch } from "@shared/operationalCalendar";

const src = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

describe("C1 — objeto completo pendente por TR legado", () => {
  const field: TrParamViewModel = {
    name: "processo.objetoCompleto", path: "objetoCompleto", type: "text", description: "Objeto completo", required: true, conditional: false,
    requiredWhenVariables: [], active: true, status: "UNSET", defaultEligible: false, pendingReason: { code: "LEGACY_TR_WITHOUT_OBJECT", trVersion: 2 },
  };
  it("continua pendente e explica por quê, sem dizer que o TR emitido muda", () => {
    expect(trPendingFields([field]).map((f) => f.name)).toEqual(["processo.objetoCompleto"]);
    const t = pendingReasonText(field.pendingReason)!;
    expect(t).toContain("v2");
    expect(t).toContain("o TR emitido não é alterado");
    expect(pendingReasonText(undefined)).toBeNull();
  });
  it("seção mostra o motivo junto do campo", () => {
    const s = src("./TrStructuredParamsSection.tsx");
    expect(s).toContain("pendingReasonText(f.pendingReason)");
    expect(s).toContain('data-testid="tr-param-pending-reason"');
  });
});

describe("parâmetros estruturados indisponíveis", () => {
  it("motivo acionável aparece; recurso não habilitado/integrado fica silencioso", () => {
    expect(trStructuredUnavailableText("há modelos de Edital com catálogos diferentes: informe os parâmetros do Edital para escolher o modelo"))
      .toContain("informe os parâmetros do Edital");
    expect(trStructuredUnavailableText("modelos institucionais não habilitados para esta organização")).toBeNull();
    expect(trStructuredUnavailableText("módulo de modelos institucionais não integrado nesta instalação")).toBeNull();
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
    expect(s).toContain("trpc.procurementProcess.recordEditalScope.useMutation()");
    expect(s).toContain("expectedValueHash: scopeQuery.data?.valueHash ?? null");
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
  });

  it("Centro de Operações navega para o processo e a página de processos abre pelo link", () => {
    expect(src("../department-operation/DepartmentOperationHome.tsx")).toContain("calendarReferenceHref(type, id)");
    expect(src("../../pages/ProcessoLicitatorio.tsx")).toContain("processIdFromSearch(window.location.search)");
    expect(src("../department-operation/OperationalCalendar.tsx")).toContain("calendarItemOriginText(e)");
  });
});
