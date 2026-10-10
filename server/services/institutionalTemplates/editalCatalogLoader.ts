/**
 * Catálogo `tpl-catalog/2` aplicável ao Edital de uma organização, para telas que existem ANTES de o Edital ter parâmetros
 * (Perfil institucional de Licitações, Parâmetros estruturados do TR). Somente leitura; nunca escolhe entre modelos divergentes.
 *
 *  1. Parâmetros do Edital completos e binding EXATO resolvido ⇒ catálogo da revisão vinculada (a mesma da preparação/geração).
 *  2. Sem parâmetros (ou sem binding exato): se TODOS os vínculos vigentes do Edital da organização apontam para o MESMO catálogo
 *     v2, esse é o catálogo; zero vínculos ⇒ indisponível; catálogos divergentes ⇒ indisponível (a pessoa informa os parâmetros).
 */
import { isCatalogV2 } from "../../domain/institutionalTemplates/astVersions";
import type { VariableCatalog2 } from "../../domain/institutionalTemplates";
import type { EditalBoundaryParams } from "../../domain/institutionalTemplates/editalBridgeScope";
import type { OrgId } from "../../domain/institutionalTemplates/types";
import { resolveEditalTemplate, type BridgeDeps } from "./editalBridgeService";

export type EditalCatalogResult =
  | { readonly status: "OK"; readonly catalog: VariableCatalog2; readonly via: "BOUND_REVISION" | "SINGLE_CATALOG"; readonly revisionId?: string }
  | { readonly status: "UNAVAILABLE"; readonly reason: string };

export async function loadEditalCatalog(deps: BridgeDeps, organizationId: OrgId, params: EditalBoundaryParams): Promise<EditalCatalogResult> {
  if (!deps.ports) return { status: "UNAVAILABLE", reason: "módulo de modelos institucionais não integrado nesta instalação" };
  if (!(await deps.ports.enablement.isEnabled(organizationId))) return { status: "UNAVAILABLE", reason: "modelos institucionais não habilitados para esta organização" };

  const resolution = await resolveEditalTemplate(deps, organizationId, params);
  if (resolution.status === "BOUND") {
    const revision = await deps.ports.repository.getRevision(organizationId, resolution.template.revisionId);
    const catalog = revision ? deps.ports.catalog.byVersion(revision.variableCatalogVersion) : null;
    if (!revision || revision.organizationId !== organizationId || !catalog || !isCatalogV2(catalog)) return { status: "UNAVAILABLE", reason: "revisão vinculada ou catálogo tpl-catalog/2 indisponível" };
    return { status: "OK", catalog, via: "BOUND_REVISION", revisionId: revision.id };
  }
  if (resolution.status === "CONFLICT" || resolution.status === "INVALID") return { status: "UNAVAILABLE", reason: "vínculo do modelo do Edital em conflito ou inválido" };

  // Sem binding exato: só aceita quando os vínculos vigentes concordam em UM catálogo v2.
  const bindings = await deps.ports.repository.listBindings(organizationId, { documentKind: "edital", activeOnly: true });
  const versions = new Set<string>();
  for (const b of bindings) {
    if (!b.pinnedRevisionId) continue;
    const revision = await deps.ports.repository.getRevision(organizationId, b.pinnedRevisionId);
    if (revision && revision.organizationId === organizationId) versions.add(revision.variableCatalogVersion);
  }
  if (versions.size === 0) return { status: "UNAVAILABLE", reason: "nenhum modelo institucional de Edital vigente para esta organização" };
  if (versions.size > 1) return { status: "UNAVAILABLE", reason: "há modelos de Edital com catálogos diferentes: informe os parâmetros do Edital para escolher o modelo" };
  const catalog = deps.ports.catalog.byVersion([...versions][0]);
  if (!catalog || !isCatalogV2(catalog)) return { status: "UNAVAILABLE", reason: "catálogo tpl-catalog/2 indisponível" };
  return { status: "OK", catalog, via: "SINGLE_CATALOG" };
}
