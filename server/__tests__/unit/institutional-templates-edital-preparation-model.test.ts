/**
 * Preparação ZERO_REENTRY — classificação determinística do catálogo BLL (100% das variáveis), projeções e paridade das condições.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BLL } from "../helpers/institutionalTemplatesE2eWorld";
import {
  PREPARATION_CLASSES, PROJECTION_BY_VARIABLE, PREPARATION_CLASSIFICATION_UNSUPPORTED, PreparationClassificationUnsupportedError, UF_EXTENSO, classifyCatalog, classifyVariable,
  type PreparationClass,
} from "../../domain/institutionalTemplates/editalPreparationModel";
import { canonicalProjectedPaths, isCanonicalProjection, trProjectedPaths } from "../../domain/institutionalTemplates/canonicalProjectionPolicy";
import { CANONICAL_AUTHORITY_OWNED, validateGovernedPayload, validateGovernedSection } from "../../domain/institutionalTemplates/governedSources";
import type { VariableDef2 } from "../../domain/institutionalTemplates/variableCatalog2";
import { AUTHORITY_OWNED_PATHS } from "../../domain/institutionalTemplates/governedSources";
import { conditionVariables, evaluateCondition2 } from "../../domain/institutionalTemplates/conditionalDsl2";
import { evaluateCond } from "../../../client/src/lib/editalPreparation";

const catalog = BLL.catalog;
const rows = classifyCatalog(catalog);
const byName = new Map(rows.map((r) => [r.name, r]));

describe("classificação do catálogo BLL", () => {
  it("100% das variáveis têm UMA classe conhecida e uma regra explícita (nada cai em 'manual' por omissão)", () => {
    expect(rows).toHaveLength(catalog.vars.length);
    expect(new Set(rows.map((r) => r.name)).size).toBe(catalog.vars.length);
    for (const r of rows) {
      expect(PREPARATION_CLASSES, r.name).toContain(r.class);
      expect(r.rule, r.name).toBeTruthy();
    }
    const counts = Object.fromEntries(PREPARATION_CLASSES.map((c) => [c, rows.filter((r) => r.class === c).length])) as Record<PreparationClass, number>;
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(catalog.vars.length);
    // eslint-disable-next-line no-console
    console.log("[INVENTARIO BLL]", JSON.stringify({ TOTAL: catalog.vars.length, ...counts }));
  });

  it("regras: pós-homologação, autoridade canônica, projeção, condicional, perfil do órgão, TR e decisão do certame", () => {
    for (const v of catalog.vars) {
      const c = byName.get(v.name)!;
      if (v.name.startsWith("pos.")) expect(c.class, v.name).toBe("POST_AWARD");
      else if ((AUTHORITY_OWNED_PATHS[v.source] ?? []).includes(v.path)) expect(c.class, v.name).toBe("CANONICAL");
      else if (PROJECTION_BY_VARIABLE[v.name]) expect(["CANONICAL", "TR_PROJECTION"], v.name).toContain(c.class);
      else if (v.requiredWhen) expect(c.class, v.name).toBe("CONDITIONAL");
      else if (c.rule === "ORG_ROLE") expect(c.class, v.name).toBe("ORG_PROFILE");
      else if (c.rule === "TR_PARAM") expect(c.class, v.name).toBe("TR_PROJECTION");
      else if (v.source === "IDENTITY" || v.source === "POLICY") expect(c.class, v.name).toBe("ORG_PROFILE");
      else if (v.source === "TR") expect(c.class, v.name).toBe("TR_PROJECTION");
      else expect(c.class, v.name).toBe("PROCESS_DECISION");
    }
    // escopo do registro humano: perfil do órgão = ORG; o resto do certame = PROCESS; sem escrita para canônico "dono" e pós-homologação
    expect(byName.get("sancoes.tabelaMultas")?.scope).toBe("ORG");
    expect(byName.get("instituicao.pregoeiroNome")?.scope).toBe("ORG");
    expect(byName.get("processo.dataAbertura")?.scope).toBe("PROCESS");
    expect(byName.get("processo.numeroProcesso")?.scope).toBe("NONE");
    expect(byName.get("pos.valorContrato")?.scope).toBe("NONE");
  });

  it("projeções determinísticas existem no catálogo; nenhuma decisão jurídica/normativa é projetada", () => {
    for (const name of Object.keys(PROJECTION_BY_VARIABLE)) expect(byName.has(name), name).toBe(true);
    const projected = new Set(Object.keys(PROJECTION_BY_VARIABLE));
    for (const forbidden of ["decisao.formaJulgamento", "julgamento.modoDisputa", "julgamento.criterioJulgamento", "decisao.consorcio", "participacao.percentualAcrescimoConsorcio", "contratacao.prazoExecucao", "sancoes.multaMoraPercentual"]) {
      expect(projected.has(forbidden), forbidden).toBe(false);
    }
    expect(UF_EXTENSO.PR).toBe("Paraná");
    expect(Object.keys(UF_EXTENSO)).toHaveLength(27);
  });

  it("classifyVariable é pura/determinística", () => {
    for (const v of catalog.vars) expect(classifyVariable(v)).toEqual(classifyVariable(v));
  });
});

describe("paridade: avaliador de condições do cliente × composer (servidor)", () => {
  it("para TODA requiredWhen do BLL e TODAS as combinações de valores das variáveis envolvidas, o resultado é o mesmo", () => {
    let checked = 0;
    for (const v of catalog.vars) {
      if (!v.requiredWhen) continue;
      const names = conditionVariables(v.requiredWhen);
      const domains = names.map((n) => {
        const def = catalog.vars.find((x) => x.name === n)!;
        const base: unknown[] = [undefined, ""];
        if (def.type === "boolean") base.push(true, false);
        else if (def.type === "enum") base.push(...(def.enumValues ?? []));
        else if (def.type === "integer" || def.type === "number" || def.type === "percent" || def.type === "money") base.push(0, 1, 10, 100);
        else base.push("x");
        return base;
      });
      const combos = domains.reduce<unknown[][]>((acc, d) => acc.flatMap((a) => d.map((x) => [...a, x])), [[]]);
      for (const combo of combos) {
        const facts = Object.fromEntries(names.map((n, i) => [n, combo[i]]));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(evaluateCond(v.requiredWhen as any, facts), `${v.name} ${JSON.stringify(facts)}`).toBe(evaluateCondition2(v.requiredWhen, facts).result);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe("classificação EXAUSTIVA (sem catch-all manual) — segurança evolutiva", () => {
  const base: VariableDef2 = { name: "x.nova", type: "string", source: "PROCESS", path: "nova", required: true, renderable: true };
  it("fontes com política explícita classificam; DFD/ETP/PARAMS ou fonte futura SEM política falham fechado (nunca PROCESS_DECISION implícito)", () => {
    for (const source of ["PROCESS", "TR", "ITEMS", "CERTAME_CONFIG", "NORMATIVE", "BUDGET", "LIFECYCLE", "POLICY", "IDENTITY"] as const) {
      expect(() => classifyVariable({ ...base, source })).not.toThrow();
    }
    for (const source of ["DFD", "ETP", "PARAMS", "FUTURA_SEM_POLITICA"] as const) {
      const run = () => classifyVariable({ ...base, source: source as never });
      expect(run).toThrow(PreparationClassificationUnsupportedError);
      expect(run).toThrow(PREPARATION_CLASSIFICATION_UNSUPPORTED);
    }
    // pós-homologação e pin de documento continuam classificados mesmo em fonte sem política de decisão
    expect(classifyVariable({ ...base, source: "RESULT", name: "pos.x" }).class).toBe("POST_AWARD");
    expect(classifyVariable({ ...base, source: "DFD", type: "document_ref", documentKind: "DFD" }).class).toBe("CANONICAL");
  });
  it("um catálogo com variável de fonte sem política NÃO classifica (o modelo inteiro falha fechado)", () => {
    expect(() => classifyCatalog({ ...catalog, vars: [...catalog.vars, { ...base, source: "PARAMS" }] })).toThrow(PreparationClassificationUnsupportedError);
  });
});

describe("política única das projeções canônicas", () => {
  it("CANONICAL: objeto resumido, unidade requisitante, localidade e UF; TR_OBJECT é a única admitida a suprimento humano", () => {
    for (const n of ["processo.objetoResumido", "processo.secretariaRequisitante", "instituicao.municipioSede", "instituicao.municipioUfExtenso"]) expect(isCanonicalProjection(n), n).toBe(true);
    expect(isCanonicalProjection("processo.objetoCompleto")).toBe(false);
    expect(isCanonicalProjection("contratacao.prazoExecucao")).toBe(false);
    expect([...canonicalProjectedPaths(catalog.vars, "PROCESS")].sort()).toEqual(["objetoResumido", "secretariaRequisitante"]);
    expect([...canonicalProjectedPaths(catalog.vars, "IDENTITY")].sort()).toEqual(["municipioSede", "municipioUfExtenso"]);
    expect([...trProjectedPaths(catalog.vars, "TR")]).toEqual(["objetoCompleto"]);
  });
  it("guard de escrita derivado da MESMA política: grava recusa CANONICAL_AUTHORITY_OWNED; a releitura do registro tolera o legado", () => {
    const w = validateGovernedSection(catalog, "PROCESS", "PROCESS", { objetoResumido: "novo" }, "write");
    expect(w.ok).toBe(false);
    expect(JSON.stringify(w)).toContain(CANONICAL_AUTHORITY_OWNED);
    // TR_OBJECT admite suprimento humano; um campo legítimo continua aceito
    expect(validateGovernedSection(catalog, "PROCESS", "TR", { objetoCompleto: "suprido" }, "write").ok).toBe(true);
    expect(validateGovernedSection(catalog, "PROCESS", "PROCESS", { fiscalContrato: "Fiscal" }, "write").ok).toBe(true);
    // leitura/revalidação do ledger legado NÃO quebra (o valor é preservado e ignorado por quem compõe)
    expect(validateGovernedSection(catalog, "PROCESS", "PROCESS", { objetoResumido: "legado" }).ok).toBe(true);
    expect(validateGovernedPayload(catalog, "PROCESS", { sections: { PROCESS: { objetoResumido: "legado", fiscalContrato: "F" } } }).ok).toBe(true);
    expect(validateGovernedSection(catalog, "ORG", "IDENTITY", { municipioSede: "x" }, "write").ok).toBe(false);
  });
});

describe("guardas estruturais — nenhuma autoridade 'latest' paralela na projeção do TR", () => {
  const read = (rel: string) => readFileSync(path.resolve(rel), "utf8");
  it("a projeção lê o documento do PIN (getOfficialDocument por id), nunca getLatestEmittedByOrigin", () => {
    const proj = read("server/services/institutionalTemplates/editalProjections.ts");
    expect(proj).toContain("getOfficialDocument");
    expect(proj).not.toContain("getLatestEmittedByOrigin");
    expect(proj).toContain("OFFICIAL_PIN_MISMATCH");
  });
  it("a composição resolve o pin ANTES das fontes e entrega o documento exato a elas (não em paralelo)", () => {
    const comp = read("server/services/institutionalTemplates/templateCompositionService.ts");
    expect(comp).toContain("t.catalog, officialDocuments, { pinned: officialPins !== undefined })");   // o pin exato (e só ele) ativa a checagem de lineage dos parâmetros do TR
    const adapter = read("server/services/institutionalTemplates/adapters/canonicalSources.ts");
    expect(adapter).toContain("shadowedPaths");
    expect(adapter).toContain("canonicalProjectedPaths");
  });
  it("a tela envia o TR exato escolhido à preparação (sem pin não há projeção do TR)", () => {
    expect(read("client/src/components/procurement/EditalWorkspace.tsx")).toContain("trPin={trPin}");
    expect(read("client/src/components/procurement/EditalPreparationPanel.tsx")).toContain("officialPins: { TR: trPin }");
  });
});
