/**
 * Prontidão antes da publicação (piloto Edital): reúne os FATOS (revisão exata, catálogo, procedência, evidência jurídica,
 * capacidades do sistema, inventário reenviado) e delega a avaliação ao domínio puro. Só leitura: nenhuma escrita, nenhuma IA,
 * nenhuma transição. O inventário reenviado só vale se o SHA-256 coincidir com o registrado na procedência.
 */
import { evaluateReadiness, type ReadinessMatrix } from "../../domain/institutionalTemplates/governance/readinessMatrix";
import { INTEGRATED_CAPABILITIES } from "../../domain/institutionalTemplates/governance/capabilities";
import { parseSourceInventory, type SourceInventory } from "../../domain/institutionalTemplates/governance/sourceInventory";
import { buildSourceInventory } from "../../domain/institutionalTemplates/governance/packageInventory";
import { getModelPackage } from "./modelPackages";
import { TemplateWorkflowError } from "./errors";
import { TemplateGovernanceService } from "./governanceService";
import type { TemplateReadinessPort, TemplateWorkflowPorts, WorkflowContext } from "./ports";

export interface ReadinessResult {
  readonly matrix: ReadinessMatrix;
  readonly inventory: { readonly supplied: boolean; readonly derivedFromPackage: boolean; readonly shapeIssues: readonly string[] };
  readonly revision: { readonly id: string; readonly revision: number; readonly status: string; readonly semanticHash: string };
}

export class TemplateReadinessService {
  constructor(private readonly ports: TemplateWorkflowPorts) {}

  async evaluate(ctx: WorkflowContext, input: { revisionId: string; inventory?: unknown }): Promise<ReadinessResult> {
    const revision = await this.ports.repository.getRevision(ctx.organizationId, input.revisionId);
    if (!revision || revision.organizationId !== ctx.organizationId) throw new TemplateWorkflowError("NOT_FOUND", "revisão não encontrada nesta organização");
    const governance = new TemplateGovernanceService(this.ports);
    // sem port de governança, procedência/evidência são desconhecidas ⇒ a matriz as mostra BLOCKED (nunca esconde)
    const gov = this.ports.governance ? await governance.get(ctx, revision.id) : null;
    let inventory: SourceInventory | null = null;
    let shapeIssues: string[] = [];
    if (input.inventory !== undefined) {
      const parsed = parseSourceInventory(input.inventory);
      if (parsed.ok) inventory = parsed.value; else shapeIssues = parsed.issues;
    }
    // Modelo registrado a partir de um PACOTE versionado: o inventário é derivado do mapeamento aprovado NO SERVIDOR (nenhum dado do
    // cliente); a matriz o confronta com o SHA-256 gravado na procedência, com o AST real e com as capacidades.
    let derivedFromPackage = false;
    const pkg = input.inventory === undefined && gov?.provenance ? getModelPackage(gov.provenance.templateKey) : null;
    if (pkg && gov?.provenance && pkg.provenance.sourceSha256 === gov.provenance.sourceSha256 && pkg.provenance.sourceLogicalVersion === gov.provenance.sourceLogicalVersion) {
      inventory = buildSourceInventory({ mapping: pkg.mapping, catalog: pkg.catalog, sourceLogicalVersion: pkg.provenance.sourceLogicalVersion, sourceSha256: pkg.provenance.sourceSha256 });
      derivedFromPackage = true;
    }
    const matrix = evaluateReadiness({
      revision, catalog: this.ports.catalog.byVersion(revision.variableCatalogVersion),
      provenance: gov?.provenance ?? null, legalEvidence: gov?.legalEvidence ?? null, inventory,
      capabilities: this.ports.capabilities ?? INTEGRATED_CAPABILITIES,
    });
    return { matrix, inventory: { supplied: input.inventory !== undefined, derivedFromPackage, shapeIssues }, revision: { id: revision.id, revision: revision.revision, status: revision.status, semanticHash: revision.semanticHash } };
  }
}

/** Port estreito de prontidão para a publicação, sobre o estado autoritativo (revisão, ledger, capacidades). */
export function createTemplateReadinessPort(ports: TemplateWorkflowPorts): TemplateReadinessPort {
  const svc = new TemplateReadinessService(ports);
  return { evaluateForPublication: async (ctx, input) => (await svc.evaluate(ctx, input)).matrix };
}
