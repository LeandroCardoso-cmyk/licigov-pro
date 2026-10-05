/**
 * R9 / SEM-054 — resolução humana de identidade ambígua: a tela só envia o que o servidor aceita, nada vem
 * pré-selecionado e cancelar não chama nada.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  canResolveIdentity, identityKeyHashFromReason, identityResolutionBlocker, resolveIdentityInput,
  IDENTITY_REASON_PREFIX, IDENTITY_EFFECT_NOTE,
} from "./itemIdentityView";

const HASH = "a".repeat(64);
const item = { sourceState: "review_required", sourceStateReason: `${IDENTITY_REASON_PREFIX}${HASH}` };

describe("SEM-054 — itemIdentityView", () => {
  it("só itens review_required com chave de identidade legível podem ser resolvidos", () => {
    expect(identityKeyHashFromReason(`${IDENTITY_REASON_PREFIX}${HASH}`)).toBe(HASH);
    expect(identityKeyHashFromReason(`${IDENTITY_REASON_PREFIX}curto`)).toBeNull();
    expect(identityKeyHashFromReason("fonte_alterada:xyz")).toBeNull();
    expect(identityKeyHashFromReason(null)).toBeNull();
    expect(canResolveIdentity(item)).toBe(true);
    expect(canResolveIdentity({ ...item, sourceState: "source_changed" })).toBe(false);
    expect(canResolveIdentity({ sourceState: "review_required", sourceStateReason: "outro" })).toBe(false);
  });
  it("nada pré-selecionado e motivo obrigatório: sem escolha, sem alvo ou sem motivo ⇒ bloqueado e sem corpo", () => {
    expect(identityResolutionBlocker({ choice: null, targetItemId: null, reason: "motivo válido" })).toMatch(/Escolha como resolver/);
    expect(identityResolutionBlocker({ choice: "link_existing", targetItemId: null, reason: "motivo válido" })).toMatch(/Selecione o item/);
    expect(identityResolutionBlocker({ choice: "new_item", targetItemId: null, reason: "abc" })).toMatch(/mín\. 5/);
    expect(resolveIdentityInput("p1", item, { choice: null, targetItemId: null, reason: "motivo válido" })).toBeNull();
    expect(resolveIdentityInput("p1", item, { choice: "new_item", targetItemId: null, reason: "  " })).toBeNull();
  });
  it("corpo da chamada: vincular envia o alvo; item novo envia null; motivo aparado", () => {
    expect(resolveIdentityInput("p1", item, { choice: "link_existing", targetItemId: "it-9", reason: "  mesmo produto, outra marca " }))
      .toEqual({ processId: "p1", logicalKeyHash: HASH, targetItemId: "it-9", reason: "mesmo produto, outra marca" });
    expect(resolveIdentityInput("p1", item, { choice: "new_item", targetItemId: "it-9", reason: "produto distinto" }))
      .toEqual({ processId: "p1", logicalKeyHash: HASH, targetItemId: null, reason: "produto distinto" });
    expect(resolveIdentityInput("p1", { sourceStateReason: "sem-chave" }, { choice: "new_item", targetItemId: null, reason: "produto distinto" })).toBeNull();
  });
  it("a tela declara o efeito, não pré-seleciona opção e só chama a mutação no 'Confirmar resolução'", () => {
    expect(IDENTITY_EFFECT_NOTE).toMatch(/append-only/);
    expect(IDENTITY_EFFECT_NOTE).toMatch(/Não aprova nem rejeita/);
    const src = readFileSync(path.resolve(import.meta.dirname, "ItemIdentityResolve.tsx"), "utf8");
    expect(src).toMatch(/useState<IdentityChoice \| null>\(null\)/); // nada pré-selecionado
    expect(src.match(/resolve\.mutate\(/g)).toHaveLength(1);
    expect(src).toMatch(/onClick=\{onClose\}[^>]*>Cancelar/); // cancelar só fecha
    const ws = readFileSync(path.resolve(import.meta.dirname, "ItemIntelligenceWorkspace.tsx"), "utf8");
    expect(ws).toMatch(/canResolveIdentity\(it\)/);
    expect(ws).toMatch(/<ItemIdentityResolve/);
  });
});
