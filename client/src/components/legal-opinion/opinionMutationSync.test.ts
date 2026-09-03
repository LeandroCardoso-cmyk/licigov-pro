/**
 * V1 — Regressão de SINCRONIZAÇÃO da UI do Parecer após mutações bem-sucedidas.
 *
 * O bug: após `Assinar parecer` / `Devolver à origem` o backend confirmava, mas a UI só
 * convergia após `F5` porque a invalidação de queries TanStack/tRPC estava incompleta
 * (assinatura só refazia `loadContext`; faltava `documentEngine.list`, `listInbox` e
 * `lawyerDashboard`). Estas regressões pinam o CONJUNTO CANÔNICO de queries invalidadas.
 */
import { describe, it, expect } from "vitest";
import {
  invalidateAfterSign, invalidateAfterReturn, type OpinionQueryInvalidator,
} from "./opinionMutationSync";

/** Invalidador espião: registra cada fonte canônica invalidada (e o workspace). */
function spy() {
  const calls: string[] = [];
  const inv: OpinionQueryInvalidator = {
    loadContext: (id) => calls.push(`loadContext:${id}`),
    listInbox: () => calls.push("listInbox"),
    lawyerDashboard: () => calls.push("lawyerDashboard"),
    officialDocuments: (id) => calls.push(`officialDocuments:${id}`),
  };
  return { inv, calls };
}

const WS = "ws-homolog-1";

describe("V1 · sincronização pós-mutação do Parecer (invalidação canônica)", () => {
  it("1) assinatura SUCCESS invalida/refaz o CONTEXTO do workspace", () => {
    const { inv, calls } = spy();
    invalidateAfterSign(inv, WS);
    expect(calls).toContain(`loadContext:${WS}`);
  });

  it("2) assinatura SUCCESS invalida/refaz documentEngine.list (Documentos Oficiais)", () => {
    const { inv, calls } = spy();
    invalidateAfterSign(inv, WS);
    expect(calls).toContain(`officialDocuments:${WS}`);
  });

  it("3) assinatura SUCCESS torna a versão emitida + DOCX/PDF disponíveis SEM reload (contexto+documentos+caixa+painel)", () => {
    const { inv, calls } = spy();
    invalidateAfterSign(inv, WS);
    // Todas as fontes que exibem 'v emitido' e os botões de export são refeitas.
    expect(calls).toEqual(expect.arrayContaining([
      `loadContext:${WS}`, `officialDocuments:${WS}`, "listInbox", "lawyerDashboard",
    ]));
  });

  it("4) devolução SUCCESS invalida a Caixa Institucional (listInbox)", () => {
    const { inv, calls } = spy();
    invalidateAfterReturn(inv, WS);
    expect(calls).toContain("listInbox");
  });

  it("5) devolução SUCCESS remove o trabalho ativo SEM reload (caixa + painel + contexto)", () => {
    const { inv, calls } = spy();
    invalidateAfterReturn(inv, WS);
    expect(calls).toEqual(expect.arrayContaining(["listInbox", "lawyerDashboard", `loadContext:${WS}`]));
  });

  it("6/7) as funções de sincronização SÓ invalidam fontes de leitura — nunca disparam assinatura/devolução (sem 2ª mutação)", () => {
    // Estruturalmente: o invalidador só expõe métodos de invalidação de QUERIES; não há
    // meio de re-disparar signOpinion/returnOpinion a partir daqui.
    const { inv, calls } = spy();
    invalidateAfterSign(inv, WS);
    invalidateAfterReturn(inv, WS);
    const allowed = new Set(["loadContext", "listInbox", "lawyerDashboard", "officialDocuments"]);
    for (const c of calls) expect(allowed.has(c.split(":")[0])).toBe(true);
    expect(Object.keys(inv)).toEqual(["loadContext", "listInbox", "lawyerDashboard", "officialDocuments"]);
  });

  it("8) sincronização é side-effect-limitada a invalidação (retorno void; não inventa estado institucional)", () => {
    const { inv } = spy();
    expect(invalidateAfterSign(inv, WS)).toBeUndefined();
    expect(invalidateAfterReturn(inv, WS)).toBeUndefined();
    // Sem workspace vazio: ainda assim não lança nem cria estado (é o onSuccess quem chama, com id real).
    expect(() => invalidateAfterSign(inv, "")).not.toThrow();
  });
});
