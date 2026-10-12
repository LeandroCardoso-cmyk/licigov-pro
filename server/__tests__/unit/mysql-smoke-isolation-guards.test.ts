/**
 * Guardas de ISOLAMENTO dos smokes MySQL (estado compartilhado). Invariantes — não texto de implementação:
 *
 *  1. Nenhum identificador de órgão FIXO (`const ORG… = 9xxxxx`) é definido por mais de um arquivo: dois arquivos com o mesmo id de
 *     tenant colidem (PK de `organizations`, ledgers, idempotência) quando a suíte roda em paralelo ou sobre um banco reutilizado.
 *  2. Todo arquivo que MUTA o estado GLOBAL de `legal_reference_*` (instala/apaga o reference set) declara a exclusão mútua
 *     `useGlobalFixtureLock("legal_reference")`; sem ela dois arquivos concorrentes colidem (set duplicado, set removido sob os pés do outro).
 *  3. Arquivos que afirmam o comportamento "SEM banco" declaram `useNoDatabase()` — o resultado não pode depender de `DATABASE_URL` do ambiente.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DIR = path.resolve(import.meta.dirname, "..", "integration");
const files = readdirSync(DIR).filter((f) => f.endsWith(".test.ts"));
const read = (f: string) => readFileSync(path.join(DIR, f), "utf8");

describe("isolamento dos smokes MySQL — guardas", () => {
  it("ids de órgão fixos não são compartilhados entre arquivos de smoke", () => {
    const owners = new Map<string, Set<string>>();
    for (const f of files.filter((x) => x.includes("mysql-smoke"))) {
      for (const m of read(f).matchAll(/^\s*const\s+(ORG[A-Z0-9_]*)\s*=\s*(\d[\d_]{5,})\s*;/gm)) {
        const id = m[2].replace(/_/g, "");
        if (!owners.has(id)) owners.set(id, new Set());
        owners.get(id)!.add(f);
      }
    }
    expect(owners.size, "a varredura precisa enxergar os ids fixos dos smokes").toBeGreaterThan(30);
    const shared = [...owners].filter(([, fs]) => fs.size > 1).map(([id, fs]) => `${id}: ${[...fs].join(", ")}`);
    expect(shared, `ids de órgão compartilhados:\n${shared.join("\n")}`).toEqual([]);
  });

  it("quem muta legal_reference_* global declara useGlobalFixtureLock('legal_reference')", () => {
    const MUTATES = /installGovernedLegalReferenceV1\(|approveAndActivateReferenceSet\(|DELETE FROM legal_reference_sets/;
    const missing = files.filter((f) => MUTATES.test(read(f)) && !/useGlobalFixtureLock\(\s*"legal_reference"\s*\)/.test(read(f)));
    // o teste do orquestrador de predeploy só usa o instalador com portas/mocks (sem MySQL): não é fixture global
    expect(missing.filter((f) => f !== "predeploy-release-orchestrator.test.ts"), `sem lock: ${missing.join(", ")}`).toEqual([]);
  });

  it("os testes de degradação 'sem banco' não dependem de DATABASE_URL (useNoDatabase)", () => {
    const NO_DB = [
      "rc3-document-engine", "rc351-kernel-refinement", "rc421-production-readiness", "sprint481-kg-wiring", "sprint49-copilots",
      "sprint50-workspace", "sprint501-business-domains", "sprint51-procurement", "sprint5op-department-operation", "sprint5w-contracts",
      "sprint5x-institutional-request", "sprint5y-legal-opinion", "sprint5z-direct-procurement",
    ];
    for (const n of NO_DB) expect(read(`${n}.test.ts`), n).toMatch(/^useNoDatabase\(\);/m);
  });
});
