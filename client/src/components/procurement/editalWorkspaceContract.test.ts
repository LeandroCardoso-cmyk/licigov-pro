/**
 * P0 EDITAL — Guarda de fonte do caminho vivo do Edital (padrão do projeto: varredura de fonte, sem
 * testing-library). Prova o contrato de UI que fecha o P0:
 *   - a ação "Gerar edital" chama o CANÔNICO `procurementProcess.generateNotice` (nunca o legado);
 *   - a tela consulta `editalSourceState` e exibe o alerta de desatualização (SOURCE_CHANGED);
 *   - a tela mostra explicabilidade mínima (GroundingNotice) e a origem contextual da minuta;
 *   - mantém a revisão humana obrigatória.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = readFileSync(path.join(ROOT, "client/src/components/procurement/EditalWorkspace.tsx"), "utf8");

describe("P0 · EditalWorkspace (caminho vivo canônico)", () => {
  it("aciona o canônico generateNotice e NÃO o pipeline legado documents.generate*", () => {
    expect(SRC).toContain("procurementProcess.generateNotice");
    expect(SRC).not.toMatch(/trpc\.documents\.generate/);
  });

  it("consulta o estado das fontes e exibe o alerta de desatualização (SOURCE_CHANGED)", () => {
    expect(SRC).toContain("procurementProcess.editalSourceState");
    expect(SRC).toContain('"source_changed"');
    expect(SRC).toContain("Documentos-base alterados");
  });

  it("mostra explicabilidade mínima (GroundingNotice) e a origem contextual da minuta", () => {
    expect(SRC).toContain("GroundingNotice");
    expect(SRC).toContain("Minuta gerada com base nos documentos do processo");
    expect(SRC).toMatch(/Fontes reaproveitadas|usedSources/);
  });

  it("preserva revisão humana obrigatória e tratamento de loading/erro sem perder estado", () => {
    expect(SRC).toContain("Revisão obrigatória");
    expect(SRC).toContain("generateNotice.isPending");
    expect(SRC).toContain("generateNotice.isError");
  });
});
