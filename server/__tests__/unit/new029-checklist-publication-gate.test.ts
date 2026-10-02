/**
 * NEW-029 — gate de publicação da Contratação Direta pelo checklist de documentos obrigatórios (regra pura).
 */
import { describe, it, expect } from "vitest";
import { checklistPublicationGate } from "../../domain/requiredDocumentEvidence";

const WS = "ws-new029";
const ok = { status: "validado", documentReference: `contratacao_direta/${WS}/1-doc.pdf`, contentHash: "a".repeat(64) };
const doc = (name: string, over: Partial<typeof ok> & { required?: boolean } = {}) => ({ name, required: true, ...ok, ...over });

describe("NEW-029 — checklist validado antes de publicar", () => {
  it("checklist ausente ⇒ CHECKLIST_NOT_CONFIGURED", () => {
    expect(checklistPublicationGate([], WS)).toEqual({ ok: false, code: "CHECKLIST_NOT_CONFIGURED" });
  });
  it("todos os obrigatórios validados com evidência ⇒ ok; opcional pendente não bloqueia", () => {
    expect(checklistPublicationGate([doc("DFD"), doc("Opcional", { required: false, status: "pendente" })], WS)).toEqual({ ok: true });
  });
  it.each([
    ["pendente", { status: "pendente" }],
    ["anexado (sem validação)", { status: "anexado" }],
    ["validado legado s3://anexo sem hash", { documentReference: "s3://anexo", contentHash: "" }],
    ["evidência de OUTRO workspace", { documentReference: "contratacao_direta/outro-ws/1-doc.pdf" }],
  ])("%s ⇒ CHECKLIST_PENDING com o nome do documento", (_label, over) => {
    expect(checklistPublicationGate([doc("DFD"), doc("Proposta do fornecedor", over)], WS))
      .toEqual({ ok: false, code: "CHECKLIST_PENDING", pending: ["Proposta do fornecedor"] });
  });
});
