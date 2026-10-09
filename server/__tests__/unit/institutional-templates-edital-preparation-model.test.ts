/**
 * Preparação ZERO_REENTRY — classificação determinística do catálogo BLL (100% das variáveis), projeções e paridade das condições.
 */
import { describe, it, expect } from "vitest";
import { BLL } from "../helpers/institutionalTemplatesE2eWorld";
import {
  PREPARATION_CLASSES, PROJECTION_BY_VARIABLE, UF_EXTENSO, classifyCatalog, classifyVariable, type PreparationClass,
} from "../../domain/institutionalTemplates/editalPreparationModel";
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
