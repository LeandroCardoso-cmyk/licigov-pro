/**
 * Troca de revisão num escopo já vinculado = substituição ATÔMICA (replacesBindingId) — nunca "desativar" e depois "criar" (janela sem vínculo).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { replaceableBinding, type BindingLike } from "@/lib/institutionalTemplatesView";

const scope = { modality: "pregao", form: "eletronica", platform: "bll" };
const b = (id: string, over: Partial<BindingLike> = {}): BindingLike => ({ id, active: true, documentKind: "edital", pinnedRevisionId: "r1", scope, ...over });

describe("replaceableBinding", () => {
  it("escopo idêntico (5 dimensões; ausente ≡ vazio) e ativo ⇒ é o vínculo a substituir", () => {
    expect(replaceableBinding([b("a")], "edital", { ...scope })?.id).toBe("a");
    expect(replaceableBinding([b("a", { scope: { ...scope, regime: undefined } })], "edital", { ...scope, regime: "" })?.id).toBe("a");
  });
  it("inativo, outro tipo, outro escopo ou ambíguo (2 ativos) ⇒ nenhum (nunca escolhe por conta própria)", () => {
    expect(replaceableBinding([b("a", { active: false })], "edital", scope)).toBeNull();
    expect(replaceableBinding([b("a", { documentKind: "tr" })], "edital", scope)).toBeNull();
    expect(replaceableBinding([b("a")], "edital", { ...scope, platform: "outra" })).toBeNull();
    expect(replaceableBinding([b("a"), b("c")], "edital", scope)).toBeNull();
  });
});

describe("tela de vínculos", () => {
  const SRC = readFileSync(path.resolve("client/src/pages/InstitutionalTemplateDetail.tsx"), "utf8");
  it("envia replacesBindingId quando há vínculo ativo no mesmo escopo e avisa que a troca é atômica", () => {
    expect(SRC).toContain("replacesBindingId: replaced.id");
    expect(SRC).toContain('data-testid="binding-replace-notice"');
    expect(SRC).toContain("SUBSTITUÍDO numa única operação atômica");
  });
  it("não permite 'substituir' pela própria revisão já vinculada", () => {
    expect(SRC).toContain("bindRev === replaced.pinnedRevisionId");
  });
});
