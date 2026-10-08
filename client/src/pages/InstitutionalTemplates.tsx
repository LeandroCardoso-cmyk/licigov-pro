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
import {
  catalogFilterOptions, DOCUMENT_KIND_LABEL, EMPTY_CATALOG_FILTER, emptyRegisterForm, hasRoleAtLeast, makeIdempotencyKey, packageSourceOf, scopeFromForm, validateRegisterForm,
  type CatalogFilterState, type CatalogRowView, type RegisterFormState, type RegistrationPresetView,
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

  const canCreate = hasRoleAtLeast(caps.data?.role, caps.data?.roleFloors?.draft);
  const canRegister = hasRoleAtLeast(caps.data?.role, caps.data?.roleFloors?.register);

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
          <CatalogFilters value={filter} onChange={setFilter} documentKinds={caps.data?.documentKinds ?? []} options={options} />
          {list.isLoading ? <PageLoader /> : rows.length === 0 ? (
            <EmptyState icon={LibraryBig} title="Nenhum modelo institucional" description={Object.keys(apiFilter).length ? "Nenhum modelo corresponde aos filtros." : "Registre um modelo (nasce como rascunho) ou crie um modelo vazio e, em seguida, a primeira revisão."}
              action={canCreate ? { label: "Novo modelo", onClick: () => setOpen(true) } : undefined} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.map((r) => <CatalogCard key={r.identityId} row={r} />)}</div>
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
            documentKinds={caps.data?.documentKinds ?? []} today={today()} hasDocx={docx !== null} onDocxFile={onDocxFile} scopeSuggestions={suggestions} showErrors={showErrors} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegOpen(false)}>Cancelar</Button>
            <Button disabled={register.isPending} onClick={submitRegister}>Registrar como rascunho</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
