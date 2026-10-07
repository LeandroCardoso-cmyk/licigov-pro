/**
 * Compila um Modelo-Mestre aprovado (Markdown) para a AST canônica `tpl-ast/2` e roda o gate de paridade estrutural.
 * OFFLINE: sem banco, sem rede, sem IA, sem produção. Só lê arquivos locais e (opcionalmente) escreve a AST/relatório.
 *
 * Uso:
 *   pnpm templates:compile-master --md <master.md> --sha256 <hash aprovado> --mapping <mapping.json> --catalog <catalog2.json> [--out <dir>]
 *
 * O `--sha256` é o hash APROVADO do snapshot (proveniência): se o arquivo divergir, a compilação é recusada.
 * Saída: relatório de paridade em JSON no stdout; com `--out`, também `ast.json`, `report.json` e `provenance.json`.
 * Código de saída: 0 = compilou e o gate passou; 1 = recusado/gate falhou; 2 = uso inválido.
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { compileAndVerifyMaster, type MasterMapping } from "../server/domain/institutionalTemplates/masterCompiler";
import type { VariableCatalog2 } from "../server/domain/institutionalTemplates/variableCatalog2";
import { validateVariableCatalog2 } from "../server/domain/institutionalTemplates/variableCatalog2";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const mdPath = arg("md");
  const sha = arg("sha256");
  const mappingPath = arg("mapping");
  const catalogPath = arg("catalog");
  const out = arg("out");
  if (!mdPath || !sha || !mappingPath || !catalogPath) {
    console.error("uso: pnpm templates:compile-master --md <master.md> --sha256 <hash> --mapping <mapping.json> --catalog <catalog2.json> [--out <dir>]");
    process.exit(2);
  }
  const markdown = readFileSync(path.resolve(mdPath), "utf8");
  const mapping = JSON.parse(readFileSync(path.resolve(mappingPath), "utf8")) as MasterMapping;
  const catalog = JSON.parse(readFileSync(path.resolve(catalogPath), "utf8")) as VariableCatalog2;

  const cv = validateVariableCatalog2(catalog);
  if (!cv.ok) {
    console.error(JSON.stringify({ ok: false, stage: "catalog", issues: cv.issues }, null, 2));
    process.exit(1);
  }
  const r = compileAndVerifyMaster({ markdown, expectedSha256: sha, mapping, catalog });
  if (!r.ok) {
    console.error(JSON.stringify({ ok: false, stage: "compile", issues: r.issues }, null, 2));
    process.exit(1);
  }
  const { ast, astSemanticHash, report, provenance, findings } = r.value;
  console.info(JSON.stringify({ ok: true, astSemanticHash, provenance, report, findings }, null, 2));
  if (out) {
    const dir = path.resolve(out);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "ast.json"), `${JSON.stringify(ast, null, 2)}\n`);
    writeFileSync(path.join(dir, "report.json"), `${JSON.stringify({ astSemanticHash, report, findings }, null, 2)}\n`);
    writeFileSync(path.join(dir, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
  }
}

main();
