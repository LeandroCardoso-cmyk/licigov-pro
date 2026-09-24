/**
 * U2B-MIN — guarda da UX canônica da Pesquisa de Preços (flag ligada):
 *  - caminho principal = ARQUIVO (aba padrão), só com formatos reais (sem .doc);
 *  - "Colar texto" como opção única e explícita, sem rótulos de formato no caminho de texto;
 *  - o painel legado de gravação direta NÃO é oferecido com a flag ligada.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
const workspace = read("./PesquisaPrecosWorkspace.tsx");
const launcher = read("../ingestion/DocumentIngestionLauncher.tsx");

/** Trecho JSX do DocumentIngestionLauncher no ramo `enabled` da Pesquisa. */
const enabledBranch = workspace.slice(workspace.indexOf("<DocumentIngestionLauncher"), workspace.indexOf("/>", workspace.indexOf("<DocumentIngestionLauncher")) + 2);

describe("Pesquisa de Preços — UX canônica com a flag ligada", () => {
  it("não oferece o painel legado (gravação direta) quando a ingestão canônica está ligada", () => {
    expect(enabledBranch).not.toMatch(/manualSlot/);
    expect(enabledBranch).not.toMatch(/LegacyPriceResearchPanel/);
    expect(enabledBranch).toMatch(/allowPaste/);
  });
  it("descrição reflete formatos reais: sem .doc e sem 'OCR indisponível'", () => {
    expect(enabledBranch).not.toMatch(/\.doc\b/);
    expect(enabledBranch).not.toMatch(/indispon[íi]vel/);
    expect(enabledBranch).toMatch(/XLSX, XLS ou CSV/);
    expect(enabledBranch).toMatch(/digitalizado/);
  });
  it("launcher: arquivo é a aba padrão; 'Colar texto' sem rótulos de formato", () => {
    expect(launcher).toMatch(/<Tabs defaultValue="file">/);
    expect(launcher).toMatch(/value="paste">Colar texto</);
    const paste = launcher.slice(launcher.indexOf('<TabsContent value="paste"'), launcher.indexOf("</TabsContent>", launcher.indexOf('<TabsContent value="paste"')));
    expect(paste).not.toMatch(/\b(PDF|DOCX|XLSX|XLS|CSV)\b/);
  });
});
