/**
 * M8 pós-homologação — acompanhamento da geração (ETP/TR) quando a resposta não chega: só "em processamento" e desfecho
 * desconhecido viram acompanhamento; conflito real continua erro (matriz com as mensagens REAIS do servidor).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { generationFollowUp, followUpStatus, GENERATION_FOLLOW_UP_LIMIT_MS } from "./generationFollowUp";

describe("generationFollowUp — processamento × conflito real", () => {
  it.each([
    ["CONFLICT", "GENERATION_IN_PROGRESS: Geração idêntica já está em processamento para esta chave — aguarde a conclusão.", "follow"],
    ["CONFLICT", "Geração idêntica já está em processamento para esta chave — aguarde a conclusão.", "follow"], // servidor anterior
    [undefined, "Failed to fetch", "follow"], // resposta não chegou (corte de rede/proxy, 499/502/504)
    [null, "Unexpected end of JSON input", "follow"],
    ["CONFLICT", "Idempotency-Key reutilizada com payload diferente — geração recusada.", "error"],
    ["CONFLICT", "O rascunho mudou desde o carregamento — recarregue e revise antes de substituir.", "error"],
    ["CONFLICT", "O rascunho já foi criado por outra operação — recarregue.", "error"],
    ["CONFLICT", "HUMAN_EDIT_WOULD_BE_OVERWRITTEN: o rascunho tem conteúdo humano.", "error"],
    ["PRECONDITION_FAILED", "OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE: documento emitido.", "error"],
    ["FORBIDDEN", "Esta ação requer papel mínimo 'operator' na organização.", "error"],
    ["NOT_FOUND", "Processo não encontrado nesta organização.", "error"],
    ["INTERNAL_SERVER_ERROR", "falha do provider", "error"],
  ] as const)("%s · %s ⇒ %s", (code, message, plan) => {
    expect(generationFollowUp(code, message)).toBe(plan);
  });
});

describe("followUpStatus — conclusão pela leitura canônica, polling com teto", () => {
  const base = { contentHash: "h1", updatedAt: "2026-10-27T12:44:00.000Z" };
  it("sem acompanhamento ⇒ idle", () => expect(followUpStatus(null, base, 0)).toBe("idle"));
  it("rascunho inalterado ⇒ following até o teto; depois expired (nunca reenvia sozinho)", () => {
    const a = { base, since: 1_000 };
    expect(followUpStatus(a, base, 1_000 + GENERATION_FOLLOW_UP_LIMIT_MS - 1)).toBe("following");
    expect(followUpStatus(a, base, 1_000 + GENERATION_FOLLOW_UP_LIMIT_MS)).toBe("expired");
  });
  it("rascunho novo (hash ou updatedAt) ⇒ done; primeira geração (antes sem rascunho) também", () => {
    expect(followUpStatus({ base, since: 0 }, { contentHash: "h2", updatedAt: "2026-10-27T12:45:20.000Z" }, 5)).toBe("done");
    expect(followUpStatus({ base: { contentHash: null, updatedAt: null }, since: 0 }, { contentHash: "h1", updatedAt: "x" }, 5)).toBe("done");
    expect(followUpStatus({ base: { contentHash: null, updatedAt: null }, since: 0 }, { contentHash: null, updatedAt: null }, 5)).toBe("following");
  });
  it("rascunho que some não é tratado como concluído", () => {
    expect(followUpStatus({ base, since: 0 }, { contentHash: null, updatedAt: null }, 5)).toBe("following");
  });
});

describe("telas de geração — usam o acompanhamento e não exibem o 409 de processamento como erro", () => {
  for (const file of ["TRWorkspace.tsx", "ETPWorkspace.tsx"]) {
    it(file, () => {
      const src = fs.readFileSync(path.join(__dirname, file), "utf8");
      expect(src).toContain("useGenerationFollowUp(reviewable.data?.draft");
      expect(src).toContain("refetchInterval: () => followInterval.current");
      expect(src).toMatch(/generationFollowUp\(e\.data\?\.code, e\.message\) === "follow"\) followUp\.start/);
      expect(src).toContain("followUp.following || !!regenerationBlock");
      expect(src).toContain("<GenerationFollowUpNotice");
      expect(src).toContain("domainErrorMessage(");
    });
  }
});
