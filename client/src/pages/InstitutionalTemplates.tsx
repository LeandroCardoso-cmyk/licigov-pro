import { useMemo, useState } from "react";
import { LibraryBig, Plus, FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { PageShell } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoader } from "@/components/ui/PageLoader";
import { CatalogCard } from "@/components/institutionalTemplates/CatalogCard";
import { CatalogFilters } from "@/components/institutionalTemplates/CatalogFilters";
import { TemplateActivationCard } from "@/components/institutionalTemplates/TemplateActivationCard";
import { RegisterModelForm } from "@/components/institutionalTemplates/RegisterModelForm";
import { OwnershipTabs } from "@/components/institutionalTemplates/OwnershipTabs";
import { TemplatePolicyCard } from "@/components/institutionalTemplates/TemplatePolicyCard";
import { DeriveTemplateForm } from "@/components/institutionalTemplates/DeriveTemplateForm";
import {
  catalogFilterOptions, DOCUMENT_KIND_LABEL, EMPTY_CATALOG_FILTER, emptyDeriveForm, emptyPolicyForm, filterByOwnership, hasRoleAtLeast, makeIdempotencyKey, ownershipCounts, packageSourceOf,
  scopeFromForm, validateDeriveForm, validatePolicyForm, emptyRegisterForm, validateRegisterForm,
  type CatalogFilterState, type CatalogRowView, type DeriveFormState, type OwnershipFilter, type PolicyFormState, type PolicyView, type RegisterFormState, type RegistrationPresetView,
} from "@/lib/institutionalTemplatesView";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Modelos Institucionais — catálogo MULTI-MODELO. Vários modelos do mesmo tipo (ex.: Edital — Pregão Eletrônico — BLL,
 * Edital — Pregão Presencial, Concorrência…) convivem aqui; filtros por tipo, modalidade, forma, plataforma e status.
 * Nenhuma página separada por modelo. DISTINTO do menu "Templates" pessoal legado. Módulo atrás de flag tenant-scoped.
 */
export default function InstitutionalTemplates() {
  const utils = trpc.useUtils();
  const caps = trpc.institutionalTemplates.getCapabilities.useQuery();
  const enabled = caps.data?.enabled === true;
  const [filter, setFilter] = useState<CatalogFilterState>(EMPTY_CATALOG_FILTER);
  const apiFilter = useMemo(() => ({
    ...(filter.documentKind ? { documentKind: filter.documentKind as never } : {}), ...(filter.modality ? { modality: filter.modality } : {}),
    ...(filter.form ? { form: filter.form } : {}), ...(filter.platform ? { platform: filter.platform } : {}), ...(filter.status ? { status: filter.status as never } : {}),
  }), [filter]);
  const list = trpc.institutionalTemplates.catalog.list.useQuery(apiFilter, { enabled });
  // opções dos filtros vêm do catálogo SEM filtro (o que existe), para não esvaziar as opções ao filtrar
  const all = trpc.institutionalTemplates.catalog.list.useQuery({}, { enabled });
  const rows = (list.data ?? []) as unknown as CatalogRowView[];
  const suggestions = useMemo(() => Object.fromEntries((caps.data?.scopeDimensions ?? []).map((d) => [d.dimension, d.suggestions])), [caps.data]);
  const options = catalogFilterOptions((all.data ?? []) as unknown as CatalogRowView[], suggestions);

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>("tr");
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const create = trpc.institutionalTemplates.identities.create.useMutation({
    onSuccess: () => { toast.success("Modelo criado. Crie ou importe a primeira revisão (rascunho)."); utils.institutionalTemplates.catalog.list.invalidate(); setOpen(false); setSlug(""); setDisplayName(""); },
    onError: (e) => toast.error(e.message),
  });

  // ── registro/importação (nasce DRAFT) ──
  const [regOpen, setRegOpen] = useState(false);
  const [reg, setReg] = useState<RegisterFormState>(emptyRegisterForm(today()));
  const [regKey, setRegKey] = useState(makeIdempotencyKey());
  const [docx, setDocx] = useState<{ name: string; base64: string } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const register = trpc.institutionalTemplates.registration.register.useMutation({
    onSuccess: (r) => {
      toast.success(r.provenance.status === "RECORDED" ? "Modelo registrado como rascunho, com procedência." : `Rascunho criado, mas a procedência falhou: ${r.provenance.message}`);
      utils.institutionalTemplates.catalog.list.invalidate(); setRegOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const submitRegister = () => {
    if (!validateRegisterForm(reg, docx !== null).valid) { setShowErrors(true); return; }
    let inventory: unknown;
    if (reg.sourceKind !== "MODEL_PACKAGE" && reg.inventoryText.trim()) inventory = JSON.parse(reg.inventoryText);
    const source = reg.sourceKind === "MODEL_PACKAGE" ? packageSourceOf(reg) : reg.sourceKind === "AST" ? { kind: "AST" as const, ast: JSON.parse(reg.sourceText) as unknown }
      : reg.sourceKind === "MARKDOWN" ? { kind: "MARKDOWN" as const, markdown: reg.sourceText } : { kind: "DOCX" as const, docxBase64: docx!.base64, filename: docx!.name };
    register.mutate({
      target: reg.targetKind === "NEW_IDENTITY" ? { kind: "NEW_IDENTITY", documentKind: reg.documentKind as never, slug: reg.slug } : { kind: "EXISTING_IDENTITY", identityId: reg.existingIdentityId.trim() },
      templateKey: reg.templateKey, displayName: reg.displayName.trim(), declaredScope: scopeFromForm(reg.scope), source,
      sourceLogicalVersion: reg.sourceLogicalVersion.trim(), sourceSha256: reg.sourceSha256.trim(), ...(inventory !== undefined ? { inventory } : {}),
      confirm: true, idempotencyKey: regKey,
      decision: { decidedByName: reg.decidedByName.trim(), decidedByRole: reg.decidedByRole.trim(), decidedAt: reg.decidedAt, basisReference: reg.basisReference.trim(), reason: reg.reason.trim() },
    });
  };
  const onDocxFile = async (file: File | undefined) => {
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = ""; buf.forEach((b) => { bin += String.fromCharCode(b); });
    setDocx({ name: file.name, base64: btoa(bin) });
  };

  // ── propriedade/origem dos modelos (plataforma · minha prefeitura · derivados) ──
  const [ownership, setOwnership] = useState<OwnershipFilter>("ALL");
  const shownRows = filterByOwnership(rows, ownership);
  const counts = ownershipCounts((all.data ?? []) as unknown as CatalogRowView[]);

  // ── política do órgão (leitura: qualquer papel; alteração: piso `policy`) ──
  const policyQuery = trpc.institutionalTemplates.governance.policy.get.useQuery(undefined, { enabled });
  const policy = policyQuery.data as unknown as PolicyView | undefined;
  const [polForm, setPolForm] = useState<PolicyFormState | null>(null);
  const [polKey, setPolKey] = useState(makeIdempotencyKey());
  const [polErrors, setPolErrors] = useState(false);
  const recordPolicy = trpc.institutionalTemplates.governance.policy.record.useMutation({
    onSuccess: () => { toast.success("Política registrada (nova versão; a anterior permanece no histórico)."); setPolForm(null); setPolErrors(false); setPolKey(makeIdempotencyKey()); void policyQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const submitPolicy = () => {
    if (!polForm || !policy || !validatePolicyForm(polForm, policy).valid) { setPolErrors(true); return; }
    recordPolicy.mutate({
      expectedVersion: policy.version, confirm: true, idempotencyKey: polKey,
      policy: { legalEvidence: polForm.legalEvidence, approveMinRole: polForm.approveMinRole, publishMinRole: polForm.publishMinRole },
      decision: { decidedByName: polForm.decision.decidedByName.trim(), decidedByRole: polForm.decision.decidedByRole.trim(), decidedAt: polForm.decision.decidedAt, basisReference: polForm.decision.basisReference.trim(), reason: polForm.decision.reason.trim() },
    });
  };

  // ── derivação (a partir de modelo da plataforma OU de revisão decidida do órgão) ──
  const [derive, setDerive] = useState<{ sourceLabel: string; source: { kind: "PLATFORM_PACKAGE"; modelKey: string } | { kind: "TENANT_REVISION"; revisionId: string } } | null>(null);
  const [derForm, setDerForm] = useState<DeriveFormState>(emptyDeriveForm(today()));
  const [derKey, setDerKey] = useState(makeIdempotencyKey());
  const [derErrors, setDerErrors] = useState(false);
  const openDerive = (d: NonNullable<typeof derive>, suggestedName: string) => { setDerive(d); setDerForm(emptyDeriveForm(today(), suggestedName)); setDerKey(makeIdempotencyKey()); setDerErrors(false); };
  const deriveMut = trpc.institutionalTemplates.derivation.derive.useMutation({
    onSuccess: (r) => {
      toast.success(r.replayed ? "Esta derivação já existia; nada foi duplicado." : "Modelo derivado criado como rascunho, com lineage registrado.");
      void utils.institutionalTemplates.catalog.list.invalidate(); setDerive(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const submitDerive = () => {
    if (!derive || !validateDeriveForm(derForm).valid) { setDerErrors(true); return; }
    deriveMut.mutate({
      source: derive.source, slug: derForm.slug.trim(), displayName: derForm.displayName.trim(), ...(derForm.declaredAuthor.trim() ? { declaredAuthor: derForm.declaredAuthor.trim() } : {}),
      confirm: true, idempotencyKey: derKey,
      decision: { decidedByName: derForm.decision.decidedByName.trim(), decidedByRole: derForm.decision.decidedByRole.trim(), decidedAt: derForm.decision.decidedAt, basisReference: derForm.decision.basisReference.trim(), reason: derForm.decision.reason.trim() },
    });
  };
  const platformPresets = ((caps.data?.registrationPresets ?? []) as unknown as RegistrationPresetView[]).filter((p) => p.sourceKind === "MODEL_PACKAGE");

  const canCreate = hasRoleAtLeast(caps.data?.role, caps.data?.roleFloors?.draft);
  const canRegister = hasRoleAtLeast(caps.data?.role, caps.data?.roleFloors?.register);
  const canPolicy = hasRoleAtLeast(caps.data?.role, (caps.data?.roleFloors as Record<string, string> | undefined)?.policy);

  return (
    <PageShell
      icon={LibraryBig}
      breadcrumbs={[{ label: "Modelos Institucionais" }]}
      title="Modelos Institucionais"
      description="Catálogo de modelos documentais da organização, com revisões aprovadas e publicadas por decisão humana. Diferente dos templates pessoais."
      actions={enabled ? (
        <div className="flex gap-2">
          {canRegister && <Button variant="outline" onClick={() => { setReg(emptyRegisterForm(today())); setRegKey(makeIdempotencyKey()); setDocx(null); setShowErrors(false); setRegOpen(true); }}><FilePlus2 className="mr-2 h-4 w-4" />Registrar modelo</Button>}
          {canCreate && <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Novo modelo</Button>}
        </div>
      ) : undefined}
    >
      {caps.data?.portsConfigured && caps.data.organizationId != null && (
        <TemplateActivationCard organizationId={caps.data.organizationId} enabled={enabled} onChanged={() => { void utils.institutionalTemplates.getCapabilities.invalidate(); }} />
      )}
      {caps.isLoading ? <PageLoader /> : !enabled ? (
        <Card>
          <CardHeader><CardTitle>Módulo não habilitado</CardTitle><CardDescription>
            {caps.data?.portsConfigured === false
              ? "O módulo de Modelos Institucionais ainda não está integrado nesta instalação."
              : "Os Modelos Institucionais não estão habilitados para a sua organização. Fale com o administrador."}
          </CardDescription></CardHeader>
        </Card>
      ) : (
        <div className="space-y-4">
          {policy && (
            <TemplatePolicyCard policy={policy} canEdit={canPolicy} form={polForm} showErrors={polErrors} pending={recordPolicy.isPending}
              onOpen={() => { setPolForm(emptyPolicyForm(policy.policy, today())); setPolKey(makeIdempotencyKey()); setPolErrors(false); }}
              onChange={setPolForm} onCancel={() => { setPolForm(null); setPolErrors(false); }} onSubmit={submitPolicy} />
          )}
          {canRegister && platformPresets.length > 0 && (
            <Card aria-label="Modelos da plataforma">
              <CardHeader>
                <CardTitle className="text-base">Modelos da plataforma</CardTitle>
                <CardDescription>Você não é obrigado a usá-los: pode registrar o seu próprio modelo ou derivar (adaptar) um da plataforma. A derivada é do seu órgão, com versões independentes.</CardDescription>
              </CardHeader>
              <div className="flex flex-wrap gap-2 p-6 pt-0">
                {platformPresets.map((p) => (
                  <Button key={p.presetId} size="sm" variant="outline" onClick={() => openDerive({ sourceLabel: `Modelo da plataforma: ${p.displayName}`, source: { kind: "PLATFORM_PACKAGE", modelKey: p.templateKey } }, p.displayName)}>Derivar: {p.displayName}</Button>
                ))}
              </div>
            </Card>
          )}
          <OwnershipTabs value={ownership} counts={counts} onChange={setOwnership} />
          <CatalogFilters value={filter} onChange={setFilter} documentKinds={caps.data?.documentKinds ?? []} options={options} />
          {list.isLoading ? <PageLoader /> : shownRows.length === 0 ? (
            <EmptyState icon={LibraryBig} title="Nenhum modelo institucional" description={Object.keys(apiFilter).length ? "Nenhum modelo corresponde aos filtros." : "Registre um modelo (nasce como rascunho) ou crie um modelo vazio e, em seguida, a primeira revisão."}
              action={canCreate ? { label: "Novo modelo", onClick: () => setOpen(true) } : undefined} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{shownRows.map((r) => <CatalogCard key={r.identityId} row={r} onDerive={canRegister ? (row, revisionId) => openDerive({ sourceLabel: `Modelo: ${row.displayName} (revisão ${row.revisions.find((x) => x.id === revisionId)?.revision ?? "?"})`, source: { kind: "TENANT_REVISION", revisionId } }, row.displayName) : undefined} />)}</div>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo modelo institucional</DialogTitle><DialogDescription>Escolha o tipo de documento e um identificador (slug) único dentro da organização.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="tpl-kind">Tipo de documento</Label>
              <select id="tpl-kind" className="w-full rounded-md border bg-background p-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}>
                {(caps.data?.documentKinds ?? []).map((k) => <option key={k} value={k}>{DOCUMENT_KIND_LABEL[k] ?? k}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tpl-slug">Identificador (slug)</Label>
              <Input id="tpl-slug" value={slug} placeholder="ex.: tr-servicos-continuos" onChange={(e) => setSlug(e.target.value)} />
              <Label htmlFor="tpl-display">Nome de exibição (opcional)</Label>
              <Input id="tpl-display" value={displayName} placeholder="ex.: Edital — Pregão Eletrônico — BLL" onChange={(e) => setDisplayName(e.target.value)} />
              <p className="text-xs text-muted-foreground">Minúsculas, números e hífens.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={create.isPending || !slug.trim()} onClick={() => create.mutate({ documentKind: kind as never, slug: slug.trim(), ...(displayName.trim() ? { displayName: displayName.trim() } : {}) })}>Criar modelo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={regOpen} onOpenChange={setRegOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>Registrar modelo</DialogTitle><DialogDescription>Importa o conteúdo-fonte como RASCUNHO e registra a procedência.</DialogDescription></DialogHeader>
          <RegisterModelForm value={reg} onChange={setReg} presets={(caps.data?.registrationPresets ?? []) as unknown as RegistrationPresetView[]}
            documentKinds={caps.data?.documentKinds ?? []} today={today()} hasDocx={docx !== null} onDocxFile={onDocxFile} scopeSuggestions={suggestions} showErrors={showErrors}
            uploadsAvailable={caps.data?.originalPreservation?.available !== false} uploadsUnavailableReason={caps.data?.originalPreservation?.reason ?? null} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegOpen(false)}>Cancelar</Button>
            <Button disabled={register.isPending} onClick={submitRegister}>Registrar como rascunho</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={derive !== null} onOpenChange={(o) => { if (!o) setDerive(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Derivar modelo</DialogTitle><DialogDescription>Cria uma cópia adaptável no seu órgão, como rascunho.</DialogDescription></DialogHeader>
          {derive && <DeriveTemplateForm sourceLabel={derive.sourceLabel} value={derForm} onChange={setDerForm} showErrors={derErrors} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDerive(null)}>Cancelar</Button>
            <Button disabled={deriveMut.isPending} onClick={submitDerive}>Criar derivada como rascunho</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
