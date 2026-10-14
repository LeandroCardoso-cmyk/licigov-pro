/**
 * CAUSA EXATA — por que a preparação do Edital BLL em produção ainda exige as datas: o processo usa a revisão VINCULADA (Revisão 1, imutável), cujo catálogo declara as
 * 7 variáveis de publicação como OBRIGATÓRIAS. A semântica "datas opcionais" (`DEFERRED_PUBLICATION`) vive na Revisão 2 CANDIDATA (DRAFT, não vinculada).
 * Este teste fixa a dependência: ativar a Revisão 2 (aprovar → disponibilizar → trocar o vínculo) é o caminho; nenhuma regra no frontend/serviço a substitui.
 */
import { describe, expect, it } from "vitest";
import { getModelPackage, getModelPackageVersion } from "../../services/institutionalTemplates/modelPackages";
import { PUBLICATION_VARIABLES } from "../../domain/institutionalTemplates/publicationSchedule";
import { supportsGovernedDraftRecomposition } from "../../domain/institutionalTemplates/variableCatalog2";

const MODEL = "EDITAL_PREGAO_ELETRONICO_BLL";

describe("BLL — datas de publicação: Revisão 1 (vinculada) × Revisão 2 (candidata)", () => {
  const rev1 = getModelPackage(MODEL)!;
  const rev2 = getModelPackageVersion(MODEL, "1.0.2-draft");
  const vars = (p: NonNullable<typeof rev1>) => p.catalog.vars.filter((v) => PUBLICATION_VARIABLES.includes(v.name)) as Array<{ name: string; required?: boolean; requiredWhen?: unknown; completionPolicy?: string }>;

  it("Revisão 1: as 7 variáveis de publicação são OBRIGATÓRIAS e sem política de completude ⇒ a preparação as exige e a geração é bloqueada sem elas", () => {
    const v = vars(rev1);
    expect(v.map((x) => x.name).sort()).toEqual([...PUBLICATION_VARIABLES].sort());
    for (const x of v) { expect(x.required || x.requiredWhen, x.name).toBeTruthy(); expect(x.completionPolicy, x.name).toBeUndefined(); }
    expect(supportsGovernedDraftRecomposition(rev1.catalog as never)).toBe(false);          // sem a capability, o legado permanece
  });

  it("Revisão 2 candidata: as MESMAS 7 variáveis são NÃO obrigatórias com DEFERRED_PUBLICATION (renderizam 'A DEFINIR PARA PUBLICAÇÃO'); capability de recomposição declarada", () => {
    expect(rev2?.candidate).toBe(true);
    const v = vars(rev2!);
    expect(v.map((x) => x.name).sort()).toEqual([...PUBLICATION_VARIABLES].sort());
    for (const x of v) { expect(x.required, x.name).toBeFalsy(); expect(x.requiredWhen, x.name).toBeUndefined(); expect(x.completionPolicy, x.name).toBe("DEFERRED_PUBLICATION"); }
    expect(supportsGovernedDraftRecomposition(rev2!.catalog as never)).toBe(true);
  });

  it("o candidato NÃO está no catálogo de pacotes registráveis sem autorização (getModelPackage devolve só a Revisão 1): nada ativa a Revisão 2 por acidente", () => {
    expect(getModelPackage(MODEL)!.provenance.sourceLogicalVersion).toBe(rev1.provenance.sourceLogicalVersion);
    expect(getModelPackage(MODEL)!.candidate).toBeFalsy();
  });
});
