/**
 * PR B.2.2 — Guardas ESTÁTICAS da UI de ingestão canônica (varredura de fonte; padrão do projeto,
 * sem testing-library). Cobrem os requisitos de UI que não se testam por lógica pura:
 * dropzone REAL (não textarea-como-upload), ausência de base64/binário em tRPC, upload multipart
 * via fetch/FormData, gating por capability, ausência de promoção ao domínio, linguagem
 * institucional (sem frases impróprias), acessibilidade básica, e legado preservado/congelado.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/**
 * Remove comentários (bloco e linha inteira) para as varreduras que buscam USO no código —
 * documentar "nunca use base64" ou citar as frases proibidas num comentário é legítimo e não
 * deve derrubar a guarda.
 */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ING_COMPONENTS_DIR = "client/src/components/ingestion";
const ING_HOOKS_DIR = "client/src/hooks/ingestion";
const ING_LIB_DIR = "client/src/lib/ingestion";

function filesIn(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir))
    .filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.endsWith(".test.ts"))
    .map((f) => `${dir}/${f}`);
}
const ALL_ING = [...filesIn(ING_COMPONENTS_DIR), ...filesIn(ING_HOOKS_DIR), ...filesIn(ING_LIB_DIR)];

const DROPZONE = read(`${ING_COMPONENTS_DIR}/FileDropzone.tsx`);
const LAUNCHER = read(`${ING_COMPONENTS_DIR}/DocumentIngestionLauncher.tsx`);
const ORCHESTRATOR = read(`${ING_HOOKS_DIR}/useSupervisedIngestion.ts`);
const PESQUISA = read("client/src/components/procurement/PesquisaPrecosWorkspace.tsx");
const DFD = read("client/src/components/procurement/DFDWorkspace.tsx");
const ETP = read("client/src/components/procurement/ETPWorkspace.tsx");

describe("B.2.2 · dropzone é upload REAL (não textarea)", () => {
  it("FileDropzone usa <input type=\"file\"> real", () => {
    expect(DROPZONE).toMatch(/type="file"/);
    expect(DROPZONE).toMatch(/onDrop=/);
  });
  it("não usa <textarea> como substituto de upload no dropzone", () => {
    expect(DROPZONE).not.toMatch(/<textarea/i);
  });
  it("é acessível por teclado (role/tabIndex/aria + foco visível)", () => {
    expect(DROPZONE).toMatch(/role="button"/);
    expect(DROPZONE).toMatch(/tabIndex=/);
    expect(DROPZONE).toMatch(/aria-label=/);
    expect(DROPZONE).toMatch(/onKeyDown=/);
    expect(DROPZONE).toMatch(/focus-visible:ring/);
  });
});

describe("B.2.2 · sem base64 e sem binário em tRPC (upload multipart via fetch)", () => {
  it("nenhum arquivo de ingestão usa FileReader/readAsDataURL/base64", () => {
    for (const f of ALL_ING) {
      const src = codeOnly(read(f));
      expect(src, `${f} não pode usar FileReader`).not.toMatch(/FileReader|readAsDataURL/);
      expect(src, `${f} não pode usar base64`).not.toMatch(/base64|toDataURL/i);
    }
  });
  it("o upload é multipart via fetch + FormData com credenciais", () => {
    expect(ORCHESTRATOR).toMatch(/new FormData\(\)/);
    expect(ORCHESTRATOR).toMatch(/fetch\(/);
    expect(ORCHESTRATOR).toMatch(/credentials:\s*"include"/);
    expect(ORCHESTRATOR).toMatch(/\/api\/ingestion\/upload|created\.uploadPath|uploadPath/);
  });
});

describe("B.2.2 · gating por capability (sem flag → interface não exposta)", () => {
  it("o launcher retorna null quando não habilitado", () => {
    expect(LAUNCHER).toMatch(/if\s*\(!enabled[\s\S]{0,40}\)\s*return null/);
  });
  it("cada workspace consulta useIngestionCapabilities", () => {
    for (const [name, src] of [["Pesquisa", PESQUISA], ["DFD", DFD], ["ETP", ETP]] as const) {
      expect(src, `${name} deve gatear por capability`).toMatch(/useIngestionCapabilities/);
    }
  });
});

describe("B.2.2 · sem promoção ao domínio a partir da ingestão", () => {
  it("nada em client/src/{components,hooks,lib}/ingestion escreve no domínio (documents/processes/saveDFD/…)", () => {
    for (const f of ALL_ING) {
      const src = read(f);
      expect(src, `${f}`).not.toMatch(/trpc\.documents\.|trpc\.processes\./);
      expect(src, `${f}`).not.toMatch(/saveDFD|generateETP|importDFD|importPriceResearch|addItemsToTR/);
    }
  });
});

describe("B.2.2 · linguagem institucional", () => {
  it("não usa frases impróprias em nenhum arquivo de ingestão (fora de comentários)", () => {
    for (const f of ALL_ING) {
      expect(codeOnly(read(f)), `${f}`).not.toMatch(/IA decidiu|aprovado automaticamente|validado juridicamente/i);
    }
  });
  it("expõe rótulos institucionais (extraído / revisão / confiança / origem)", () => {
    const status = read(`${ING_LIB_DIR}/status.ts`);
    expect(status).toMatch(/Conteúdo extraído/);
    expect(status).toMatch(/Confiança da extração/);
    expect(status).toMatch(/Origem do dado/);
    expect(status).toMatch(/NÃO transforma o conteúdo em documento oficial/);
  });
});

describe("B.2.2 · legado preservado e congelado", () => {
  it("Pesquisa de Preços mantém o caminho legado importPriceResearch", () => {
    expect(PESQUISA).toMatch(/procurementProcess\.importPriceResearch/);
  });
  it("DFD mantém o caminho legado importDFD (ramo com flag desligada)", () => {
    expect(DFD).toMatch(/procurementProcess\.importDFD|importDFD\.mutate/);
  });
  it("não introduz novos consumidores de trpc.processes.* nos workspaces tocados", () => {
    for (const src of [PESQUISA, DFD, ETP]) {
      expect(src).not.toMatch(/trpc\.processes\./);
    }
  });
});
