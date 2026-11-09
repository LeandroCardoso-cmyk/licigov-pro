/**
 * E2 — fixture de testes em banco DESCARTÁVEL: resolve os trechos pendentes do Edital (slots de IA sem narrativa) pelo serviço REAL
 * (`TemplateSlotResolutionService`: edição governada + decisão no ledger), com usuário SINTÉTICO e texto neutro. Serve aos smokes que
 * exercitam outras regras e precisam chegar à emissão. NÃO é evidência de revisão humana (ver CLAUDE.md, "Agentes de IA, confirmações
 * humanas e evidências") e nunca roda fora dos testes.
 */
import { getGeneratedDocumentByKind } from "../../db/procurement";
import { draftContentHash } from "../../domain/generatedDocument";
import { latestSlotResolutions, pendingSlotKeys } from "../../domain/institutionalTemplates/slotResolution";
import { getTemplateCompositionPorts } from "../../services/institutionalTemplates/portsRegistry";
import { TemplateSlotResolutionService } from "../../services/institutionalTemplates/slotResolutionService";

export async function resolvePendingSlotsForTest(org: number, processId: string, actorUserId: number, keyPrefix: string): Promise<number> {
  const ports = getTemplateCompositionPorts();
  const svc = new TemplateSlotResolutionService(ports);
  let resolved = 0;
  for (let guard = 0; guard < 20; guard++) {
    const draft = await getGeneratedDocumentByKind(processId, org, "edital");
    if (!draft) return resolved;
    const [slotKey] = pendingSlotKeys(draft.content);
    if (!slotKey) return resolved;
    const m1 = await ports.manifests.findGenerationManifestForDraft(org, draft.id);
    if (!m1) return resolved;
    // Revisão vigente da resolução deste trecho no M1 (X → Y → X volta a um M1 já resolvido antes: o CAS parte da última revisão).
    const current = latestSlotResolutions(org, m1.id, await ports.review.listSlotResolutions(org, m1.id)).get(slotKey);
    await svc.resolveSlot({ organizationId: org, actor: { kind: "human", userId: actorUserId }, correlationId: `corr-slot-${org}` }, {
      processId, manifestId: m1.id, slotKey, resolution: "HUMAN_TEXT", text: `Redação sintética de teste do trecho ${slotKey}.`,
      expectedContentHash: draftContentHash(draft.content), expectedRevision: current?.revision ?? 0, confirm: true, idempotencyKey: `${keyPrefix}-${slotKey}`.slice(0, 64),
      decision: {
        decidedByName: "Servidor sintético", decidedByRole: "operator", decidedAt: "2026-11-09",
        basisReference: "Registro eletrônico (teste sintético)", reason: "Redação de trecho pendente em teste automatizado.",
      },
    });
    resolved++;
  }
  throw new Error("resolvePendingSlotsForTest: trechos pendentes não convergiram");
}
