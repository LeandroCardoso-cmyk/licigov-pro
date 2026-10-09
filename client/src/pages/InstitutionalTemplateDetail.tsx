import { useMemo, useState } from "react";
import { useParams } from "wouter";
import { LibraryBig } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { PageShell } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoader } from "@/components/ui/PageLoader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AstOutline } from "@/components/institutionalTemplates/AstOutline";
import { DecisionForm } from "@/components/institutionalTemplates/DecisionForm";
import { ImportResultPanel, type ImportResultView } from "@/components/institutionalTemplates/ImportResultPanel";
import { GovernanceSummary, LegalEvidenceForm, type GovernanceView } from "@/components/institutionalTemplates/LegalEvidencePanel";
import { PreviewDossierPanel, type PreviewDossierView } from "@/components/institutionalTemplates/PreviewDossierPanel";
import { ReadinessMatrixPanel } from "@/components/institutionalTemplates/ReadinessMatrixPanel";
import { ScopeFields } from "@/components/institutionalTemplates/ScopeFields";
import { ResolutionNotice } from "@/components/institutionalTemplates/ResolutionNotice";
import { RevisionStatusBadge } from "@/components/institutionalTemplates/RevisionStatusBadge";
import { RevisionTable, type RevisionRow } from "@/components/institutionalTemplates/RevisionTable";
import {
  ACTION_COPY, AST_SNIPPETS, appendSnippet, DOCUMENT_KIND_LABEL, emptyDecisionForm, emptyLegalEvidenceForm, emptyScopeForm, formatIssues, hasRoleAtLeast,
  legalEvidencePayload, makeIdempotencyKey, revisionLabel, sampleValuesFromText, scopeFormProblems, scopeFromForm, scopeLabel, STATUS_EXPLANATION,
  validateDecisionForm, validateLegalEvidenceForm,
  type DecisionFormState, type LegalEvidenceFormState, type LifecycleAction, type ReadinessMatrixView, type RevisionStatus, type ResolutionView, type ScopeFormState,
} from "@/lib/institutionalTemplatesView";

const today = () => new Date().toISOString().slice(0, 10);

interface PendingAction { action: LifecycleAction; revision: RevisionRow; expectedStatus: RevisionStatus; idempotencyKey: string }

/**
 * Modelos Institucionais — detalhe: revisões, estrutura/edição do DRAFT, pré-visualização, vínculos e importação.
 * Toda ação institucional abre uma confirmação humana explícita com a autoridade DECLARADA; o servidor reautoriza.
 */
export default function InstitutionalTemplateDetail() {
  const { identityId = "" } = useParams<{ identityId: string }>();
  const utils = trpc.useUtils();
  const caps = trpc.institutionalTemplates.getCapabilities.useQuery();
  const enabled = caps.data?.enabled === true;
  const detail = trpc.institutionalTemplates.identities.get.useQuery({ identityId }, { enabled });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const revQuery = trpc.institutionalTemplates.revisions.get.useQuery({ revisionId: selectedId ?? "" }, { enabled: enabled && !!selectedId });

  const role = caps.data?.role ?? null;
  const floors = caps.data?.roleFloors as Record<string, string> | undefined;
  const canDraft = hasRoleAtLeast(role, floors?.draft);
  const canBind = hasRoleAtLeast(role, floors?.bind);
  const canEvidence = hasRoleAtLeast(role, floors?.evidence);
  const scopeSuggestions = useMemo(() => Object.fromEntries((caps.data?.scopeDimensions ?? []).map((d) => [d.dimension, d.suggestions])), [caps.data]);
  const persistedDims = caps.data?.persistedScopeDimensions;

  const invalidate = () => { utils.institutionalTemplates.identities.get.invalidate(); utils.institutionalTemplates.identities.list.invalidate(); utils.institutionalTemplates.revisions.get.invalidate(); };
  const onError = (e: { message: string }) => toast.error(e.message);

  // ── ciclo de vida ──
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [form, setForm] = useState<DecisionFormState>(emptyDecisionForm(today()));
  const [showErrors, setShowErrors] = useState(false);
  const approve = trpc.institutionalTemplates.revisions.approve.useMutation({ onError });
  const publish = trpc.institutionalTemplates.revisions.publish.useMutation({ onError });
  const deprecate = trpc.institutionalTemplates.revisions.deprecate.useMutation({ onError });

  const startAction = (action: LifecycleAction, revision: RevisionRow) => {
    setForm(emptyDecisionForm(today())); setShowErrors(false);
    setPending({ action, revision, expectedStatus: revision.status, idempotencyKey: makeIdempotencyKey() });
  };
  const confirmAction = async () => {
    if (!pending) return;
    const v = validateDecisionForm(form);
    if (!v.valid) { setShowErrors(true); return; }
    const input = {
      revisionId: pending.revision.id, expectedStatus: pending.expectedStatus, confirm: true, idempotencyKey: pending.idempotencyKey,
      decision: { decidedByName: form.decidedByName.trim(), decidedByRole: form.decidedByRole.trim(), decidedAt: form.decidedAt, basisReference: form.basisReference.trim(), reason: form.reason.trim() },
    };
    try {
      // Publicar: o servidor RECALCULA a prontidão; o cliente envia só o inventário (dado) — nunca uma matriz nem "aceite de bloqueio".
      if (pending.action === "PUBLISH") await publish.mutateAsync({ ...input, ...(inventoryJson !== undefined && !inventoryBad ? { inventory: inventoryJson } : {}) });
      else await (pending.action === "APPROVE" ? approve : deprecate).mutateAsync(input);
      toast.success(`${ACTION_COPY[pending.action].title}: decisão registrada.`);
      setPending(null); invalidate();
    } catch { /* mensagem já exibida pelo onError */ }
  };

  // ── novo rascunho / edição ──
  const createDraft = trpc.institutionalTemplates.revisions.createDraft.useMutation({
    onSuccess: (r) => { toast.success(`Revisão ${r.revision} criada em rascunho.`); setSelectedId(r.id); invalidate(); }, onError,
  });
  const updateDraft = trpc.institutionalTemplates.revisions.updateDraft.useMutation({ onSuccess: () => { toast.success("Rascunho salvo."); invalidate(); }, onError });
  const [astText, setAstText] = useState("");
  const [astLoadedFor, setAstLoadedFor] = useState<string | null>(null);
  const rev = revQuery.data?.revision;
  if (rev && astLoadedFor !== `${rev.id}:${rev.semanticHash}`) { setAstLoadedFor(`${rev.id}:${rev.semanticHash}`); setAstText(JSON.stringify(rev.ast, null, 2)); }
  const parsedAst = useMemo(() => { try { return { ok: true as const, value: JSON.parse(astText) as unknown }; } catch { return { ok: false as const }; } }, [astText]);
  const validation = trpc.institutionalTemplates.revisions.validateAst.useQuery({ ast: parsedAst.ok ? parsedAst.value : {} }, { enabled: enabled && parsedAst.ok && !!rev && rev.status === "DRAFT" });

  // ── prévia (dossiê com contexto de teste; sem persistência, emissão, publicação ou IA) ──
  const [sampleText, setSampleText] = useState("processo.objeto=Objeto de exemplo");
  const sample = sampleValuesFromText(sampleText);
  const [ctxScope, setCtxScope] = useState<ScopeFormState>(emptyScopeForm());
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const ctxScopeInput = scopeFromForm(ctxScope);
  const dossier = trpc.institutionalTemplates.previewDossier.run.useQuery(
    { target: { kind: "REVISION", revisionId: selectedId ?? "" }, context: { scope: ctxScopeInput, sampleValues: sample.values } },
    { enabled: enabled && !!selectedId && previewKey === `${selectedId}|${sampleText}|${JSON.stringify(ctxScopeInput)}` && sample.errors.length === 0 },
  );
  const hints = trpc.institutionalTemplates.previewDossier.hints.useQuery({ revisionId: selectedId ?? "" }, { enabled: enabled && !!selectedId });

  // ── governança: evidência jurídica ──
  const governance = trpc.institutionalTemplates.governance.get.useQuery({ revisionId: selectedId ?? "" }, { enabled: enabled && !!selectedId });
  const [evForm, setEvForm] = useState<LegalEvidenceFormState>(emptyLegalEvidenceForm(today()));
  const [evKey, setEvKey] = useState(makeIdempotencyKey());
  const [evErrors, setEvErrors] = useState(false);
  const recordEvidence = trpc.institutionalTemplates.governance.recordLegalEvidence.useMutation({
    onSuccess: () => { toast.success("Evidência registrada (não altera o status da revisão)."); setEvForm(emptyLegalEvidenceForm(today())); setEvKey(makeIdempotencyKey()); setEvErrors(false); governance.refetch(); readiness.refetch(); },
    onError,
  });
  const submitEvidence = () => {
    if (!selectedId) return;
    if (!validateLegalEvidenceForm(evForm).valid) { setEvErrors(true); return; }
    recordEvidence.mutate({
      revisionId: selectedId, expectedVersion: (governance.data as unknown as GovernanceView | undefined)?.legalEvidence?.version ?? 0, confirm: true, idempotencyKey: evKey,
      decision: { decidedByName: evForm.decidedByName.trim(), decidedByRole: evForm.decidedByRole.trim(), decidedAt: evForm.decidedAt, basisReference: evForm.basisReference.trim(), reason: evForm.reason.trim() },
      evidence: legalEvidencePayload(evForm),
    });
  };

  // ── prontidão antes de publicar ──
  const [inventoryText, setInventoryText] = useState("");
  const [readyKey, setReadyKey] = useState<string | null>(null);
  let inventoryJson: unknown;
  let inventoryBad = false;
  if (inventoryText.trim()) { try { inventoryJson = JSON.parse(inventoryText); } catch { inventoryBad = true; } }
  const readiness = trpc.institutionalTemplates.readiness.evaluate.useQuery(
    { revisionId: selectedId ?? "", ...(inventoryJson !== undefined ? { inventory: inventoryJson } : {}) },
    { enabled: enabled && !!selectedId && readyKey === `${selectedId}|${inventoryText}` && !inventoryBad },
  );

  // ── vínculos ──
  const bindings = trpc.institutionalTemplates.bindings.list.useQuery({ documentKind: detail.data?.identity.documentKind, activeOnly: false }, { enabled: enabled && !!detail.data });
  const setBinding = trpc.institutionalTemplates.bindings.set.useMutation({ onSuccess: () => { toast.success("Vínculo criado para a revisão exata."); invalidate(); bindings.refetch(); void utils.institutionalTemplates.bindings.resolve.invalidate(); }, onError });
  const deactivate = trpc.institutionalTemplates.bindings.deactivate.useMutation({ onSuccess: () => { toast.success("Vínculo desativado."); bindings.refetch(); invalidate(); void utils.institutionalTemplates.bindings.resolve.invalidate(); }, onError });
  const [bindRev, setBindRev] = useState("");
  const [bindScope, setBindScope] = useState<ScopeFormState>(emptyScopeForm());
  const [bindConfirm, setBindConfirm] = useState(false);
  const [bindShowErrors, setBindShowErrors] = useState(false);
  const scopeInput = scopeFromForm(bindScope);
  // A resolução é do escopo INFORMADO no formulário: escopo incompleto não é "conclusão global" (não consulta nem anuncia NOT_BOUND).
  const scopeComplete = Object.keys(scopeFormProblems(detail.data?.identity.documentKind ?? "tr", bindScope)).length === 0;
  const resolve = trpc.institutionalTemplates.bindings.resolve.useQuery({ documentKind: detail.data?.identity.documentKind ?? "tr", scope: scopeInput }, { enabled: enabled && !!detail.data && scopeComplete });
  const catalogRows = trpc.institutionalTemplates.catalog.list.useQuery({ documentKind: detail.data?.identity.documentKind }, { enabled: enabled && !!detail.data });
  const catalogRow = (catalogRows.data ?? []).find((r) => r.identityId === identityId);

  // ── importação ──
  const [importFormat, setImportFormat] = useState<"markdown" | "docx">("markdown");
  const [importText, setImportText] = useState("");
  const [docx, setDocx] = useState<{ name: string; base64: string } | null>(null);
  const [importResult, setImportResult] = useState<ImportResultView | null>(null);
  const importValidate = trpc.institutionalTemplates.import.validate.useMutation({ onSuccess: (r) => setImportResult(r as unknown as ImportResultView), onError });
  const importCreate = trpc.institutionalTemplates.import.createDraft.useMutation({
    onSuccess: (r) => { toast.success(`Revisão ${r.revision.revision} criada em rascunho a partir da importação.`); setSelectedId(r.revision.id); setImportResult(null); invalidate(); }, onError,
  });
  const importPayload = importFormat === "markdown" ? { format: "markdown" as const, markdown: importText } : { format: "docx" as const, docxBase64: docx?.base64 ?? "", filename: docx?.name };
  const onDocxFile = async (file: File | undefined) => {
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = ""; buf.forEach((b) => { bin += String.fromCharCode(b); });
    setDocx({ name: file.name, base64: btoa(bin) }); setImportResult(null);
  };

  if (caps.isLoading || detail.isLoading) return <PageShell icon={LibraryBig} title="Modelo institucional"><PageLoader /></PageShell>;
  if (!enabled) return <PageShell icon={LibraryBig} title="Modelo institucional"><p className="text-sm text-muted-foreground">Os Modelos Institucionais não estão habilitados para a sua organização.</p></PageShell>;
  if (detail.error || !detail.data) return <PageShell icon={LibraryBig} title="Modelo institucional"><p role="alert" className="text-sm text-destructive">Modelo não encontrado nesta organização.</p></PageShell>;

  const { identity, revisions } = detail.data;
  const published = revisions.filter((r) => r.status === "PUBLISHED");
  const selected = revisions.find((r) => r.id === selectedId) ?? null;

  return (
    <PageShell
      icon={LibraryBig} showBack
      breadcrumbs={[{ label: "Modelos Institucionais", href: "/modelos-institucionais" }, { label: catalogRow?.displayName ?? identity.slug }]}
      title={catalogRow?.displayName ?? identity.slug}
      description={`${DOCUMENT_KIND_LABEL[identity.documentKind] ?? identity.documentKind} · ${identity.slug} — a revisão aplicada é sempre a EXATA fixada por um vínculo; não existe "última revisão" como autoridade.`}
    >
      <Tabs defaultValue="revisoes">
        <TabsList className="flex-wrap">
          <TabsTrigger value="revisoes">Revisões</TabsTrigger>
          <TabsTrigger value="estrutura">Estrutura e edição</TabsTrigger>
          <TabsTrigger value="previa">Prévia e explicação</TabsTrigger>
          <TabsTrigger value="vinculos">Vínculos e aplicabilidade</TabsTrigger>
          <TabsTrigger value="governanca">Governança</TabsTrigger>
          <TabsTrigger value="prontidao">Prontidão</TabsTrigger>
          <TabsTrigger value="importar">Importar</TabsTrigger>
        </TabsList>

        <TabsContent value="revisoes" className="space-y-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Ciclo: Rascunho → Aprovada → Publicada → Depreciada. Aprovar não publica; publicar é uma decisão distinta.</p>
            {canDraft && <Button size="sm" disabled={createDraft.isPending}
              onClick={() => createDraft.mutate({ identityId: identity.id, ast: { schema: "tpl-ast/1", root: [{ t: "heading", level: 1, text: [{ t: "text", v: identity.slug }] }, { t: "paragraph", inline: [{ t: "text", v: "Conteúdo do modelo." }] }] } })}>Novo rascunho em branco</Button>}
          </div>
          <RevisionTable revisions={revisions} selectedId={selectedId} role={role} floors={floors}
            onSelect={setSelectedId} onLifecycle={startAction}
            onNewRevision={(r) => canDraft ? createDraft.mutate({ identityId: identity.id, fromRevisionId: r.id }) : toast.error("Você não tem permissão para criar revisões.")} />
          {selected && <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base">{revisionLabel(selected)} <RevisionStatusBadge status={selected.status} /></CardTitle><CardDescription>{STATUS_EXPLANATION[selected.status]}</CardDescription></CardHeader></Card>}
        </TabsContent>

        <TabsContent value="estrutura" className="space-y-4 pt-4">
          {!rev ? <p className="text-sm text-muted-foreground">Selecione uma revisão na aba Revisões.</p> : (
            <>
              <p className="flex items-center gap-2 text-sm"><span className="font-medium">{revisionLabel(rev)}</span><RevisionStatusBadge status={rev.status} /></p>
              <AstOutline ast={rev.ast} />
              {rev.status !== "DRAFT" ? (
                <p className="text-sm text-muted-foreground">Esta revisão é imutável. Para alterar o conteúdo, crie uma nova revisão (rascunho) na aba Revisões.</p>
              ) : canDraft ? (
                <div className="space-y-2">
                  <Label htmlFor="ast-json">Estrutura (AST canônico — whitelist de nós)</Label>
                  <div className="flex flex-wrap gap-2">{Object.entries(AST_SNIPPETS).map(([k, s]) => <Button key={k} size="sm" variant="outline" onClick={() => setAstText(appendSnippet(astText, k))}>+ {s.label}</Button>)}</div>
                  <Textarea id="ast-json" rows={14} className="font-mono text-xs" value={astText} onChange={(e) => setAstText(e.target.value)} />
                  {!parsedAst.ok && <p role="alert" className="text-xs text-destructive">JSON inválido.</p>}
                  {validation.data && !validation.data.valid && <ul role="alert" className="list-disc pl-5 text-xs text-destructive">{formatIssues(validation.data.issues).map((m) => <li key={m}>{m}</li>)}</ul>}
                  {validation.data?.valid && <p className="text-xs text-green-700 dark:text-green-300">Estrutura válida (catálogo {validation.data.catalogVersion}).</p>}
                  <Button size="sm" disabled={!parsedAst.ok || !validation.data?.valid || updateDraft.isPending}
                    onClick={() => parsedAst.ok && updateDraft.mutate({ revisionId: rev.id, ast: parsedAst.value, expectedSemanticHash: rev.semanticHash })}>Salvar rascunho</Button>
                </div>
              ) : <p className="text-sm text-muted-foreground">Você não tem permissão para editar rascunhos.</p>}
            </>
          )}
        </TabsContent>

        <TabsContent value="previa" className="space-y-4 pt-4">
          {!rev ? <p className="text-sm text-muted-foreground">Selecione uma revisão na aba Revisões.</p> : (
            <>
              <ScopeFields idPrefix="ctx-scope" documentKind={identity.documentKind} value={ctxScope} onChange={setCtxScope} suggestions={scopeSuggestions} />
              <p className="text-xs text-muted-foreground">O contexto de teste preenche os parâmetros do edital (modalidade, forma, plataforma, critério, regime) usados pelas condições. Não é um vínculo e não escolhe modelo.</p>
              {hints.data && hints.data.variables.length > 0 && (
                <details className="rounded-md border p-2 text-xs">
                  <summary className="cursor-pointer">Variáveis usadas por este modelo ({hints.data.variables.length})</summary>
                  <ul className="mt-2 space-y-1">{hints.data.variables.map((v) => <li key={v.name}><span className="font-mono">{v.name}</span> · {v.type} · {v.source} · {v.usedIn === "CONDITION" ? "só controla condição" : v.usedIn === "TEXT" ? "aparece no texto" : "texto e condição"}{v.filledByScope ? " · preenchida pelo contexto" : ` · sugestão: ${String(v.suggested)}`}</li>)}</ul>
                </details>
              )}
              <div className="space-y-1">
                <Label htmlFor="sample-values">Valores de exemplo (um por linha: nome=valor)</Label>
                <Textarea id="sample-values" rows={4} className="font-mono text-xs" value={sampleText} onChange={(e) => setSampleText(e.target.value)} />
                {sample.errors.map((er) => <p key={er} role="alert" className="text-xs text-destructive">{er}</p>)}
              </div>
              <Button size="sm" onClick={() => setPreviewKey(`${rev.id}|${sampleText}|${JSON.stringify(ctxScopeInput)}`)} disabled={sample.errors.length > 0}>Pré-visualizar {revisionLabel(rev)}</Button>
              {dossier.data && <PreviewDossierPanel dossier={dossier.data as unknown as PreviewDossierView} />}
              {dossier.error && <p role="alert" className="text-sm text-destructive">{dossier.error.message}</p>}
            </>
          )}
        </TabsContent>

        <TabsContent value="vinculos" className="space-y-4 pt-4">
          <p className="text-sm text-muted-foreground">Um vínculo fixa uma revisão PUBLICADA exata a um tipo de documento e escopo. Revisões publicadas depois não substituem o vínculo; ambiguidade bloqueia a geração.</p>
          <p className="text-xs font-medium text-muted-foreground">Resolução para o escopo informado abaixo</p>
          {!scopeComplete ? <p role="status" className="text-xs text-muted-foreground">Informe o escopo completo (modalidade e forma) no formulário "Novo vínculo" para ver qual revisão seria aplicada. Isto não indica que o modelo esteja sem vínculo: veja a lista abaixo.</p>
            : resolve.data && <ResolutionNotice resolution={resolve.data as unknown as ResolutionView} />}
          <div className="rounded-md border">
            {(bindings.data ?? []).filter((b) => b.identityId === identity.id).length === 0 ? <p className="p-3 text-sm text-muted-foreground">Nenhum vínculo para este modelo.</p> : (
              <ul className="divide-y text-sm">
                {(bindings.data ?? []).filter((b) => b.identityId === identity.id).map((b) => {
                  const r = revisions.find((x) => x.id === b.pinnedRevisionId);
                  return (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                      <span>{r ? revisionLabel(r) : `Revisão ${b.pinnedRevisionId ?? "—"}`} · {scopeLabel(b.scope)} · desde {b.effectiveFrom} · {b.active ? "ativo" : "inativo"}</span>
                      {b.active && canBind && <Button size="sm" variant="outline" disabled={deactivate.isPending} onClick={() => { if (window.confirm("Desativar este vínculo? A geração para este escopo deixará de usar a revisão.")) deactivate.mutate({ bindingId: b.id, confirm: true }); }}>Desativar</Button>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {canBind ? (
            <Card><CardHeader><CardTitle className="text-base">Novo vínculo (revisão exata)</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
              <div className="space-y-1"><Label htmlFor="bind-rev">Revisão publicada a fixar</Label>
                <select id="bind-rev" className="w-full rounded-md border bg-background p-2" value={bindRev} onChange={(e) => setBindRev(e.target.value)}>
                  <option value="">Selecione…</option>{published.map((r) => <option key={r.id} value={r.id}>{revisionLabel(r)}</option>)}
                </select></div>
              <ScopeFields idPrefix="bind-scope" documentKind={identity.documentKind} value={bindScope} onChange={setBindScope} suggestions={scopeSuggestions}
                persistedDimensions={persistedDims} showErrors={bindShowErrors} />
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={bindConfirm} onChange={(e) => setBindConfirm(e.target.checked)} /><span>Confirmo que a revisão selecionada passa a ser a aplicada para este tipo e escopo.</span></label>
              <Button size="sm" disabled={!bindRev || !bindConfirm || setBinding.isPending}
                onClick={() => {
                  if (Object.keys(scopeFormProblems(identity.documentKind, bindScope)).length) { setBindShowErrors(true); return; }
                  setBinding.mutate({ documentKind: identity.documentKind, scope: scopeInput, identityId: identity.id, pinnedRevisionId: bindRev, effectiveFrom: new Date().toISOString(), confirm: true });
                }}>Criar vínculo</Button>
            </CardContent></Card>
          ) : <p className="text-sm text-muted-foreground">Gerenciar vínculos exige papel de gestor ou superior.</p>}
        </TabsContent>

        <TabsContent value="governanca" className="space-y-4 pt-4">
          {!rev ? <p className="text-sm text-muted-foreground">Selecione uma revisão na aba Revisões.</p> : (
            <>
              <p className="flex items-center gap-2 text-sm"><span className="font-medium">{revisionLabel(rev)}</span><RevisionStatusBadge status={rev.status} /></p>
              {governance.data && <GovernanceSummary governance={governance.data as unknown as GovernanceView} />}
              {governance.error && <p role="alert" className="text-sm text-destructive">{governance.error.message}</p>}
              {canEvidence ? (
                <Card><CardHeader><CardTitle className="text-base">Registrar evidência de aprovação jurídica externa</CardTitle></CardHeader><CardContent className="space-y-3">
                  <LegalEvidenceForm value={evForm} onChange={setEvForm} showErrors={evErrors} />
                  <Button size="sm" disabled={recordEvidence.isPending} onClick={submitEvidence}>Registrar evidência</Button>
                </CardContent></Card>
              ) : <p className="text-sm text-muted-foreground">Registrar evidência jurídica exige papel de gestor ou superior.</p>}
            </>
          )}
        </TabsContent>

        <TabsContent value="prontidao" className="space-y-4 pt-4">
          {!rev ? <p className="text-sm text-muted-foreground">Selecione uma revisão na aba Revisões.</p> : (
            <>
              <p className="text-sm text-muted-foreground">A matriz mostra o que impede a publicação: qualquer BLOCKED a recusa no servidor (PUBLICATION_BLOCKED). Ela não aprova nem publica sozinha. O inventário da fonte precisa ser reenviado (só o hash fica registrado) e deve coincidir com a procedência.</p>
              <div className="space-y-1">
                <Label htmlFor="inv-json">Inventário da fonte (JSON, opcional — dispensado para pacotes aprovados do servidor)</Label>
                <Textarea id="inv-json" rows={5} className="font-mono text-xs" value={inventoryText} onChange={(e) => setInventoryText(e.target.value)} />
                {inventoryBad && <p role="alert" className="text-xs text-destructive">JSON inválido.</p>}
              </div>
              <Button size="sm" disabled={inventoryBad} onClick={() => setReadyKey(`${rev.id}|${inventoryText}`)}>Avaliar prontidão de {revisionLabel(rev)}</Button>
              {readiness.data && (
                <>
                  {readiness.data.inventory.derivedFromPackage && <p className="text-xs text-muted-foreground">Inventário derivado do pacote aprovado versionado no servidor (derivedFromPackage = true); nada foi copiado pelo navegador.</p>}
                  {readiness.data.inventory.shapeIssues.length > 0 && <ul role="alert" className="list-disc pl-5 text-xs text-destructive">{readiness.data.inventory.shapeIssues.map((m) => <li key={m}>{m}</li>)}</ul>}
                  <ReadinessMatrixPanel matrix={readiness.data.matrix as unknown as ReadinessMatrixView} />
                </>
              )}
              {readiness.error && <p role="alert" className="text-sm text-destructive">{readiness.error.message}</p>}
            </>
          )}
        </TabsContent>

        <TabsContent value="importar" className="space-y-4 pt-4">
          {!canDraft ? <p className="text-sm text-muted-foreground">Importar modelos exige permissão para criar rascunhos.</p> : (
            <>
              <p className="text-sm text-muted-foreground">Markdown ou DOCX viram um candidato validado e, se aprovado na validação, uma revisão em RASCUNHO. Nada importado é executado e importar nunca publica. Use <code>{"{{variavel}}"}</code> para variáveis do catálogo.</p>
              <div className="flex gap-4 text-sm">
                {(["markdown", "docx"] as const).map((f) => <label key={f} className="flex items-center gap-1"><input type="radio" name="imp-format" checked={importFormat === f} onChange={() => { setImportFormat(f); setImportResult(null); }} />{f === "markdown" ? "Markdown" : "DOCX"}</label>)}
              </div>
              {importFormat === "markdown"
                ? <Textarea rows={10} className="font-mono text-xs" value={importText} placeholder="# Título do modelo&#10;&#10;Objeto: {{processo.objeto}}" onChange={(e) => { setImportText(e.target.value); setImportResult(null); }} />
                : <Input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => onDocxFile(e.target.files?.[0])} />}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={importValidate.isPending || (importFormat === "markdown" ? !importText.trim() : !docx)} onClick={() => importValidate.mutate(importPayload)}>Validar importação</Button>
                <Button size="sm" disabled={importCreate.isPending || !importResult?.ok} onClick={() => importCreate.mutate({ ...importPayload, identityId: identity.id })}>Criar rascunho a partir da importação</Button>
              </div>
              {importResult && <ImportResultPanel result={importResult} />}
            </>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{pending ? ACTION_COPY[pending.action].title : ""}</AlertDialogTitle>
            <AlertDialogDescription>Esta é uma decisão institucional registrada com a autoridade que você declarar. Revise antes de confirmar.</AlertDialogDescription></AlertDialogHeader>
          {pending && pending.action === "PUBLISH" && (() => {
            const m = readiness.data?.matrix.revisionId === pending.revision.id ? (readiness.data.matrix as unknown as ReadinessMatrixView) : null;
            const blocked = m ? m.checks.filter((c) => c.status === "BLOCKED") : [];
            return (
              <div className="space-y-2 rounded-md border p-3 text-sm" aria-label="Prontidão para publicar">
                <p>O servidor recalcula a prontidão ao publicar: qualquer verificação BLOCKED impede a publicação e nenhuma decisão humana a substitui.</p>
                {!m ? <p>A matriz ainda não foi avaliada nesta sessão; avalie na aba Prontidão (com o inventário da fonte) para ver os bloqueios antes de decidir.</p>
                  : blocked.length === 0 ? <p>Última avaliação sem bloqueios (hash {m.matrixHash.slice(0, 12)}…).</p> : (
                    <>
                      <p role="alert" className="font-medium text-destructive">{blocked.length} verificação(ões) BLOCKED — a publicação será recusada:</p>
                      <ul className="list-disc pl-5">{blocked.map((c) => <li key={c.id}>{c.label}</li>)}</ul>
                    </>
                  )}
              </div>
            );
          })()}
          {pending && <DecisionForm action={pending.action} revisionLabel={revisionLabel(pending.revision)} value={form} onChange={setForm} showErrors={showErrors} />}
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>Cancelar</Button>
            <Button disabled={approve.isPending || publish.isPending || deprecate.isPending
              || (pending?.action === "PUBLISH" && readiness.data?.matrix.revisionId === pending.revision.id && readiness.data.matrix.overall === "BLOCKED")} onClick={confirmAction}>{pending ? ACTION_COPY[pending.action].title : "Confirmar"}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
