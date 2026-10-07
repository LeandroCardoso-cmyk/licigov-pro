import { revisionLabel, scopeLabel, type ScopeLike } from "@/lib/institutionalTemplatesView";

export interface PreviewDossierView {
  status: "COMPOSED" | "COMPOSE_ERROR" | "NOT_RESOLVED";
  resolution: { status: string; revision?: number; revisionId?: string; semanticHash?: string; bindingIds?: readonly string[] } | null;
  template: { identityId: string; slug: string; displayName: string; displayNameSource: string; documentKind: string } | null;
  revision: { id: string; revision: number; status: string; semanticHash: string; hashVersion: string; catalogVersion: string } | null;
  context: { scope: ScopeLike; scopeHeadline: string; appliedScopeVariables: readonly { name: string; value: string }[]; sampleValueCount: number };
  composeError: string | null;
  contentText: string | null;
  conditionDecisions: readonly { nodePath: string; result: boolean; traceHash: string }[];
  sourcePins: readonly { key: string; digest: string }[];
  dynamicTables: readonly { path: string; columns: number; dynamicVariables: readonly string[] }[];
  annexes: readonly { id: string }[];
  crossReferences: { sectionKeys: readonly string[]; annexIds: readonly string[]; docRefs: readonly { kind: string; where: string; annexId?: string }[] };
  aiSlots: readonly { slotKey: string; maxTokens: number; status: string }[];
  manifestPreview: { stage: string; persisted: false; manifestHash: string; composedOutputHash: string } | null;
  sideEffects: { persisted: false; aiCalled: false; officialDocumentCreated: false; issued: false; published: false; processTouched: false };
  notices: readonly string[];
}

const short = (h: string) => `${h.slice(0, 12)}…`;

/**
 * Dossiê da pré-visualização: o que SERIA composto, para o contexto de teste escolhido. Sem efeitos colaterais: nada persistido,
 * emitido ou publicado; nenhuma IA chamada. Binding ausente/ambíguo ⇒ nenhuma prévia (nunca escolhe um modelo por você).
 */
export function PreviewDossierPanel({ dossier: d }: { dossier: PreviewDossierView }) {
  return (
    <section aria-label="Dossiê da pré-visualização" className="space-y-3 text-sm">
      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" data-testid="no-side-effects">
        Pré-visualização de teste: nada foi persistido, emitido ou publicado; nenhuma IA foi chamada; nenhum processo real foi lido.
      </p>
      {d.status === "NOT_RESOLVED" && <p role="alert" className="text-destructive">{d.notices[0]}</p>}
      {d.template && d.revision && (
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Modelo</dt><dd>{d.template.displayName} <span className="font-mono text-xs">({d.template.slug})</span></dd></div>
          <div><dt className="text-xs text-muted-foreground">Revisão exata</dt><dd>{revisionLabel(d.revision)} · {d.revision.status}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Contexto de teste (modalidade · forma · plataforma…)</dt><dd>{d.context.scopeHeadline} — {scopeLabel(d.context.scope)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Parâmetros do edital preenchidos pelo contexto</dt><dd>{d.context.appliedScopeVariables.length ? d.context.appliedScopeVariables.map((v) => `${v.name}=${v.value}`).join(" · ") : "nenhum"}</dd></div>
        </dl>
      )}
      {d.status === "COMPOSE_ERROR" && <p role="alert" className="text-destructive">A composição falhou fechada ({d.composeError}). Ajuste o contexto de teste ou o modelo.</p>}
      {d.status === "COMPOSED" && (
        <>
          <div><h4 className="font-medium">Decisões das condições ativas</h4>
            {d.conditionDecisions.length === 0 ? <p className="text-muted-foreground">Nenhuma condição avaliada.</p> : (
              <ul>{d.conditionDecisions.map((c) => <li key={c.nodePath}><span className="font-mono text-xs">{c.nodePath}</span> → {c.result ? "incluído" : "não incluído"}</li>)}</ul>)}
          </div>
          <div><h4 className="font-medium">Fontes fixadas (pins)</h4>
            {d.sourcePins.length === 0 ? <p className="text-muted-foreground">Nenhuma fonte.</p> : <ul>{d.sourcePins.map((s) => <li key={s.key}><span className="font-medium">{s.key}</span> <span className="font-mono text-xs">{short(s.digest)}</span></li>)}</ul>}
          </div>
          <div><h4 className="font-medium">Tabelas dinâmicas</h4>
            {d.dynamicTables.length === 0 ? <p className="text-muted-foreground">Nenhuma tabela dinâmica.</p> : <ul>{d.dynamicTables.map((t) => <li key={t.path}><span className="font-mono text-xs">{t.path}</span> · {t.columns} coluna(s) · {t.dynamicVariables.join(", ")}</li>)}</ul>}
          </div>
          <div><h4 className="font-medium">Anexos e referências cruzadas</h4>
            <p>Anexos: {d.annexes.length ? d.annexes.map((a) => a.id).join(", ") : "nenhum"} · Seções: {d.crossReferences.sectionKeys.length}</p>
            <p>Referências oficiais: {d.crossReferences.docRefs.length ? d.crossReferences.docRefs.map((r) => `${r.kind}${r.annexId ? `@${r.annexId}` : ""} (pin exato)`).join(", ") : "nenhuma"}</p>
          </div>
          <div><h4 className="font-medium">Slots de IA</h4>
            {d.aiSlots.length === 0 ? <p className="text-muted-foreground">Sem slots de IA.</p> : <ul>{d.aiSlots.map((s) => <li key={s.slotKey}><span className="font-medium">{s.slotKey}</span> (até {s.maxTokens} tokens): apenas marcador — a IA não foi chamada</li>)}</ul>}
          </div>
          {d.manifestPreview && <div><h4 className="font-medium">Prévia do manifest</h4>
            <p>Não persistido · estágio {d.manifestPreview.stage}</p>
            <p className="font-mono text-xs">hash {short(d.manifestPreview.manifestHash)} · saída {short(d.manifestPreview.composedOutputHash)}</p></div>}
          <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3">{d.contentText}</pre>
        </>
      )}
      <ul className="text-xs text-muted-foreground">{d.notices.map((n) => <li key={n}>{n}</li>)}</ul>
    </section>
  );
}
