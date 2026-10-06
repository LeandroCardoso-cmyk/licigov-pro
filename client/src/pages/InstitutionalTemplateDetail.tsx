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
import { CompositionExplanationPanel } from "@/components/institutionalTemplates/CompositionExplanationPanel";
import { DecisionForm } from "@/components/institutionalTemplates/DecisionForm";
import { ImportResultPanel, type ImportResultView } from "@/components/institutionalTemplates/ImportResultPanel";
import { ResolutionNotice } from "@/components/institutionalTemplates/ResolutionNotice";
import { RevisionStatusBadge } from "@/components/institutionalTemplates/RevisionStatusBadge";
import { RevisionTable, type RevisionRow } from "@/components/institutionalTemplates/RevisionTable";
import {
  ACTION_COPY, AST_SNIPPETS, appendSnippet, DOCUMENT_KIND_LABEL, emptyDecisionForm, formatIssues, hasRoleAtLeast, makeIdempotencyKey,
  revisionLabel, sampleValuesFromText, scopeLabel, STATUS_EXPLANATION, validateDecisionForm,
  type DecisionFormState, type LifecycleAction, type RevisionStatus, type ResolutionView,
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
    const run = pending.action === "APPROVE" ? approve : pending.action === "PUBLISH" ? publish : deprecate;
    try {
      await run.mutateAsync(input);
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

  // ── prévia ──
  const [sampleText, setSampleText] = useState("processo.objeto=Objeto de exemplo");
  const sample = sampleValuesFromText(sampleText);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const preview = trpc.institutionalTemplates.preview.useQuery({ revisionId: selectedId ?? "", sampleValues: sample.values }, { enabled: enabled && !!selectedId && previewKey === `${selectedId}|${sampleText}` && sample.errors.length === 0 });

  // ── vínculos ──
  const bindings = trpc.institutionalTemplates.bindings.list.useQuery({ documentKind: detail.data?.identity.documentKind, activeOnly: false }, { enabled: enabled && !!detail.data });
  const setBinding = trpc.institutionalTemplates.bindings.set.useMutation({ onSuccess: () => { toast.success("Vínculo criado para a revisão exata."); invalidate(); bindings.refetch(); }, onError });
  const deactivate = trpc.institutionalTemplates.bindings.deactivate.useMutation({ onSuccess: () => { toast.success("Vínculo desativado."); bindings.refetch(); invalidate(); }, onError });
  const [bindRev, setBindRev] = useState("");
  const [bindScope, setBindScope] = useState({ modality: "", regime: "", criterion: "" });
  const [bindConfirm, setBindConfirm] = useState(false);
  const scopeInput = { ...(bindScope.modality.trim() ? { modality: bindScope.modality.trim() } : {}), ...(bindScope.regime.trim() ? { regime: bindScope.regime.trim() } : {}), ...(bindScope.criterion.trim() ? { criterion: bindScope.criterion.trim() } : {}) };
  const resolve = trpc.institutionalTemplates.bindings.resolve.useQuery({ documentKind: detail.data?.identity.documentKind ?? "tr", scope: scopeInput }, { enabled: enabled && !!detail.data });

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
      breadcrumbs={[{ label: "Modelos Institucionais", href: "/modelos-institucionais" }, { label: identity.slug }]}
      title={identity.slug}
      description={`${DOCUMENT_KIND_LABEL[identity.documentKind] ?? identity.documentKind} — a revisão aplicada é sempre a EXATA fixada por um vínculo; não existe "última revisão" como autoridade.`}
    >
      <Tabs defaultValue="revisoes">
        <TabsList className="flex-wrap">
          <TabsTrigger value="revisoes">Revisões</TabsTrigger>
          <TabsTrigger value="estrutura">Estrutura e edição</TabsTrigger>
          <TabsTrigger value="previa">Prévia e explicação</TabsTrigger>
          <TabsTrigger value="vinculos">Vínculos</TabsTrigger>
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
              <div className="space-y-1">
                <Label htmlFor="sample-values">Valores de exemplo (um por linha: nome=valor)</Label>
                <Textarea id="sample-values" rows={4} className="font-mono text-xs" value={sampleText} onChange={(e) => setSampleText(e.target.value)} />
                {sample.errors.map((er) => <p key={er} role="alert" className="text-xs text-destructive">{er}</p>)}
              </div>
              <Button size="sm" onClick={() => setPreviewKey(`${rev.id}|${sampleText}`)} disabled={sample.errors.length > 0}>Pré-visualizar {revisionLabel(rev)}</Button>
              {preview.data?.status === "COMPOSED" && (
                <div className="space-y-3">
                  <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">{preview.data.content.text}</pre>
                  <CompositionExplanationPanel explanation={preview.data.explanation} />
                </div>
              )}
              {preview.data?.status === "COMPOSE_ERROR" && <p role="alert" className="text-sm text-destructive">A composição falhou ({preview.data.error}). Nada foi gerado nem salvo; ajuste os valores ou o modelo.</p>}
              {preview.error && <p role="alert" className="text-sm text-destructive">{preview.error.message}</p>}
            </>
          )}
        </TabsContent>

        <TabsContent value="vinculos" className="space-y-4 pt-4">
          <p className="text-sm text-muted-foreground">Um vínculo fixa uma revisão PUBLICADA exata a um tipo de documento e escopo. Revisões publicadas depois não substituem o vínculo; ambiguidade bloqueia a geração.</p>
          {resolve.data && <ResolutionNotice resolution={resolve.data as unknown as ResolutionView} />}
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
              <div className="grid gap-2 sm:grid-cols-3">
                {(["modality", "regime", "criterion"] as const).map((k) => (
                  <div key={k} className="space-y-1"><Label htmlFor={`bind-${k}`}>{k === "modality" ? "Modalidade" : k === "regime" ? "Regime" : "Critério"} (opcional)</Label>
                    <Input id={`bind-${k}`} value={bindScope[k]} onChange={(e) => setBindScope({ ...bindScope, [k]: e.target.value })} /></div>
                ))}
              </div>
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={bindConfirm} onChange={(e) => setBindConfirm(e.target.checked)} /><span>Confirmo que a revisão selecionada passa a ser a aplicada para este tipo e escopo.</span></label>
              <Button size="sm" disabled={!bindRev || !bindConfirm || setBinding.isPending}
                onClick={() => setBinding.mutate({ documentKind: identity.documentKind, scope: scopeInput, identityId: identity.id, pinnedRevisionId: bindRev, effectiveFrom: new Date().toISOString(), confirm: true })}>Criar vínculo</Button>
            </CardContent></Card>
          ) : <p className="text-sm text-muted-foreground">Gerenciar vínculos exige papel de gestor ou superior.</p>}
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
          {pending && <DecisionForm action={pending.action} revisionLabel={revisionLabel(pending.revision)} value={form} onChange={setForm} showErrors={showErrors} />}
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>Cancelar</Button>
            <Button disabled={approve.isPending || publish.isPending || deprecate.isPending} onClick={confirmAction}>{pending ? ACTION_COPY[pending.action].title : "Confirmar"}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
