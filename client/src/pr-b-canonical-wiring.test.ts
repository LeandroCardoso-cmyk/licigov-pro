/**
 * PR B — Guarda arquitetural do corte controlado para o pipeline canônico.
 *
 * Verifica, por varredura de fonte (padrão do projeto, sem testing-library):
 * - /processos serve o fluxo canônico (ProcessoLicitatorio);
 * - a jornada Processo → DFD → ETP → TR → Edital é montada num único shell;
 * - rotas legadas redirecionam à jornada canônica; /test* saíram da aplicação;
 * - toda entrada visível da sidebar conduz a uma rota registrada;
 * - a Central consome a modalidade real do processo canônico (não "" hardcoded).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const APP = read("client/src/App.tsx");
const LAYOUT = read("client/src/components/DashboardLayout.tsx");
const SHELL = read("client/src/pages/ProcessoLicitatorio.tsx");
const CENTRAL_SERVICE = read("server/services/departmentOperationService.ts");

describe("PR B · roteamento canônico do Processo Licitatório", () => {
  it("/processos serve o shell canônico (ProcessoLicitatorio)", () => {
    expect(APP).toContain('import ProcessoLicitatorio from "./pages/ProcessoLicitatorio"');
    expect(APP).toContain("withAuthenticatedShell(ProcessoLicitatorio)");
  });

  it("não importa mais as telas legadas do pipeline de processo", () => {
    expect(APP).not.toMatch(/import\s+Dashboard\s+from/);
    expect(APP).not.toMatch(/import\s+NewProcess\s+from/);
    expect(APP).not.toMatch(/import\s+ProcessDetails\s+from/);
    expect(APP).not.toMatch(/import\s+TestPage\d?\s+from/);
  });
});

describe("PR B · rotas legadas e de teste fora da experiência", () => {
  it("nenhuma rota /test* é registrada", () => {
    expect(APP).not.toMatch(/path=\{?"\/test\d?"/);
  });

  it("URLs legadas de processo redirecionam à jornada canônica", () => {
    // /novo-processo e /processo/:id → /processos ; /modulos → /dashboard
    expect(APP).toContain('<Redirect to="/processos" replace />');
    expect(APP).toContain('<Redirect to="/dashboard" replace />');
    expect(APP).toMatch(/path=\{?"\/novo-processo"\}?\s+component=\{\(\)\s*=>\s*<Redirect to="\/processos"/);
    expect(APP).toMatch(/path="\/processo\/:id"\s+component=\{\(\)\s*=>\s*<Redirect to="\/processos"/);
  });
});

describe("PR B · jornada única Processo → DFD → ETP → TR → Edital", () => {
  it("o shell monta os workspaces canônicos das etapas", () => {
    for (const w of ["DFDWorkspace", "ETPWorkspace", "TRWorkspace", "EditalWorkspace"]) {
      expect(SHELL).toContain(`import ${w} from "@/components/procurement/${w}"`);
      expect(SHELL).toContain(`<${w} `);
    }
  });

  it("DFD, ETP, TR e Edital são abas internas (não itens de menu)", () => {
    // Não podem existir entradas de sidebar dedicadas a esses documentos.
    for (const label of ['label: "DFD"', 'label: "ETP"', 'label: "TR"', 'label: "Edital"']) {
      expect(LAYOUT).not.toContain(label);
    }
    // Mas existem como abas dentro do shell.
    expect(SHELL).toMatch(/label:\s*"DFD"/);
    expect(SHELL).toMatch(/label:\s*"Edital"/);
  });
});

describe("PR B · integridade da navegação da sidebar", () => {
  it("toda entrada visível da sidebar conduz a uma rota registrada", () => {
    const paths = Array.from(LAYOUT.matchAll(/path:\s*"([^"]+)"/g)).map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      const registered =
        APP.includes(`path={"${p}"}`) || APP.includes(`path="${p}"`);
      expect(registered, `Rota da sidebar sem destino em App.tsx: ${p}`).toBe(true);
    }
  });
});

describe("PR B · Central consome a fonte canônica (modalidade real)", () => {
  it("não usa mais modality vazio hardcoded para o processo canônico", () => {
    expect(CENTRAL_SERVICE).toContain("p.modality ?? \"\"");
    expect(CENTRAL_SERVICE).not.toMatch(/object:\s*p\.object,\s*modality:\s*"",/);
  });
});
