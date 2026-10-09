/**
 * Bridge Edital → Modelos Institucionais (UI): lógica pura, card (SSR) e guardas estruturais do workspace e do detalhe do modelo.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  NOT_BOUND_MESSAGE, bridgeAllowsGeneration, scopeLabel, trPinOf, type TemplateResolutionView, type TrCandidateView,
} from "@/lib/editalTemplateBridge";

let Card: typeof import("./EditalTemplateBridgeCard").default;
beforeAll(async () => {
  (globalThis as { React?: unknown }).React = React;
  Card = (await import("./EditalTemplateBridgeCard")).default;
});
const h = (props: object) => renderToStaticMarkup(React.createElement(Card as React.ComponentType<never>, props as never));
const read = (rel: string) => readFileSync(path.resolve(rel), "utf8");

const HASH = "e62297e1" + "a".repeat(56);
const BOUND: TemplateResolutionView = {
  status: "BOUND",
  template: { bindingId: "tb1", identityId: "ti1", displayName: "Edital — Pregão Eletrônico — BLL", revisionId: "tr1", revision: 1, semanticHash: HASH, scope: { modality: "pregao", form: "eletronica", platform: "bll" } },
};
const tr = (over: Partial<TrCandidateView> = {}): TrCandidateView => ({ documentId: "od2", title: "Termo de Referência", version: 2, contentHash: "c".repeat(64), status: "emitido", createdAt: "2026-10-01T00:00:00Z", current: true, ...over });

describe("lógica pura", () => {
  it("rótulo do escopo e pin exato do TR (só o vigente; hash vem do servidor)", () => {
    expect(scopeLabel({ modality: "pregao", form: "eletronica", platform: "bll" })).toBe("Pregão · Eletrônica · BLL");
    expect(trPinOf(tr())).toEqual({ documentId: "od2", version: 2, contentHash: "c".repeat(64) });
    expect(trPinOf(tr({ current: false }))).toBeNull();      // obsoleto nunca vira pin
    expect(trPinOf(undefined)).toBeNull();
  });
  it("gate: CONFLICT/INVALID bloqueiam; BOUND exige TR exato; demais seguem o fluxo atual", () => {
    expect(bridgeAllowsGeneration({ status: "CONFLICT", bindingIds: ["a", "b"] }, null).allowed).toBe(false);
    expect(bridgeAllowsGeneration({ status: "INVALID", codes: ["X"] }, null).allowed).toBe(false);
    expect(bridgeAllowsGeneration(BOUND, null).allowed).toBe(false);
    expect(bridgeAllowsGeneration(BOUND, trPinOf(tr())).allowed).toBe(true);
    for (const r of [undefined, { status: "FEATURE_OFF" } as const, { status: "NOT_BOUND", reason: "NO_BINDING" } as const]) expect(bridgeAllowsGeneration(r, null).allowed).toBe(true);
  });
});

describe("EditalTemplateBridgeCard", () => {
  it("BOUND: mostra modelo, revisão·hash curto, escopo e a seleção do TR oficial exato", () => {
    const html = h({ resolution: BOUND, candidates: [tr(), tr({ documentId: "od1", version: 1, current: false })], selectedTrId: "od2", onSelectTr: () => undefined });
    for (const t of ["Modelo institucional aplicado", "Edital — Pregão Eletrônico — BLL", "Revisão 1 · e62297e1", "Pregão · Eletrônica · BLL", "TR oficial exato", "v2", "cccccccc", "obsoleta"]) expect(html, t).toContain(t);
    expect(html).toMatch(/name="edital-tr-pin"[^>]*checked/);
    expect(html).toMatch(/disabled=""[^>]*name="edital-tr-pin"|name="edital-tr-pin"[^>]*disabled=""/);   // a versão obsoleta não é selecionável
  });
  it("BOUND sem TR oficial emitido: TR_OFICIAL_EXATO_NECESSARIO", () => {
    expect(h({ resolution: BOUND, candidates: [], selectedTrId: null, onSelectTr: () => undefined })).toContain("TR_OFICIAL_EXATO_NECESSARIO");
  });
  it("NOT_BOUND: mensagem de fluxo governado atual; FEATURE_OFF/parâmetros incompletos: nada", () => {
    expect(h({ resolution: { status: "NOT_BOUND", reason: "NO_BINDING" }, candidates: [], selectedTrId: null, onSelectTr: () => undefined })).toContain(NOT_BOUND_MESSAGE);
    expect(h({ resolution: { status: "FEATURE_OFF" }, candidates: [], selectedTrId: null, onSelectTr: () => undefined })).toBe("");
    expect(h({ resolution: { status: "NOT_BOUND", reason: "PARAMETERS_INCOMPLETE" }, candidates: [], selectedTrId: null, onSelectTr: () => undefined })).toBe("");
  });
  it("CONFLICT/INVALID: alerta de bloqueio", () => {
    expect(h({ resolution: { status: "CONFLICT", bindingIds: ["a"] }, candidates: [], selectedTrId: null, onSelectTr: () => undefined })).toContain("Conflito de vínculos");
    expect(h({ resolution: { status: "INVALID", codes: ["BINDING_REVISION_NOT_PUBLISHED"] }, candidates: [], selectedTrId: null, onSelectTr: () => undefined })).toContain("BINDING_REVISION_NOT_PUBLISHED");
  });
});

describe("guardas estruturais", () => {
  const ws = read("client/src/components/procurement/EditalWorkspace.tsx");
  it("o workspace EXISTENTE é reutilizado: mesma tela, mesmo DraftEditor/promoção; sem novo editor nem escolha de motor no cliente", () => {
    expect(ws).toContain("<DraftEditor");
    expect(ws).toContain("<OfficialPromotionSection");
    expect(ws).toContain("trpc.procurementProcess.editalTemplateResolution.useQuery");
    expect(ws).toContain("trpc.procurementProcess.editalTrCandidates.useQuery");
    expect(ws).toContain("trpc.procurementProcess.generateNotice.useMutation");
    expect(ws).not.toMatch(/institutionalTemplates\.compose|compose\.generate/);   // o motor é decidido pelo servidor (generateNotice)
    expect(ws).not.toMatch(/localStorage|sessionStorage/);
  });
  it("em BOUND envia o pin EXATO do TR (nunca latest) e o botão deixa claro o motor", () => {
    expect(ws).toContain("officialPins: { TR: trPin }");
    expect(ws).toContain("Gerar edital com modelo institucional");
    expect(ws).toContain("!bridgeGate.allowed");
    expect(ws).toContain("|| !!regenerationBlock}");
  });
  it("detalhe do modelo: resolve é invalidado após criar/desativar vínculo e o escopo incompleto não vira conclusão global", () => {
    const d = read("client/src/pages/InstitutionalTemplateDetail.tsx");
    expect((d.match(/utils\.institutionalTemplates\.bindings\.resolve\.invalidate\(\)/g) ?? []).length).toBe(2);
    expect(d).toContain("Resolução para o escopo informado abaixo");
    expect(d).toContain("enabled && !!detail.data && scopeComplete");
    expect(d).toContain("Isto não indica que o modelo esteja sem vínculo");
  });
});
