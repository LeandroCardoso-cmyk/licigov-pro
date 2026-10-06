import { AI_NARRATIVE_LABEL, revisionLabel } from "@/lib/institutionalTemplatesView";

export interface ExplanationView {
  template: { identityId: string; slug: string; documentKind: string };
  revision: { id: string; revision: number; status: string; semanticHash: string; hashVersion: string; catalogVersion: string };
  sourcePins: readonly { key: string; digest: string }[];
  conditionalDecisions: readonly { nodePath: string; result: boolean; traceHash: string }[];
  aiNarratives: readonly { slotKey: string; status: string; humanAccepted: boolean | null }[];
  officialDocRefs: readonly { role: string; order: number; documentId: string; version: number; title: string }[];
  annexes: readonly { id: string }[];
  manifest: { stage: string; persisted: boolean; id: string | null; manifestHash: string; composedOutputHash: string };
  notices: readonly string[];
}

const short = (h: string) => `${h.slice(0, 12)}…`;

/** Por que esta composição é o que é: modelo, revisão EXATA, fontes fixadas, decisões condicionais, IA e manifest. */
export function CompositionExplanationPanel({ explanation: e }: { explanation: ExplanationView }) {
  return (
    <section aria-label="Explicação da composição" className="space-y-3 text-sm">
      {e.notices.length > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {e.notices.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">Modelo</dt><dd>{e.template.slug} · {e.template.documentKind}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Revisão exata</dt><dd>{revisionLabel(e.revision)} · {e.revision.status}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Catálogo de variáveis</dt><dd>{e.revision.catalogVersion}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Hash semântico ({e.revision.hashVersion})</dt><dd className="font-mono text-xs">{short(e.revision.semanticHash)}</dd></div>
      </dl>
      <div>
        <h4 className="font-medium">Fontes fixadas (pin exato)</h4>
        {e.sourcePins.length === 0 ? <p className="text-muted-foreground">Nenhuma fonte fixada.</p> : (
          <ul>{e.sourcePins.map((s) => <li key={s.key}><span className="font-medium">{s.key}</span> <span className="font-mono text-xs">{short(s.digest)}</span></li>)}</ul>
        )}
      </div>
      <div>
        <h4 className="font-medium">Decisões condicionais</h4>
        {e.conditionalDecisions.length === 0 ? <p className="text-muted-foreground">Nenhuma condição avaliada.</p> : (
          <ul>{e.conditionalDecisions.map((c) => <li key={c.nodePath}><span className="font-mono text-xs">{c.nodePath}</span> → {c.result ? "incluído" : "não incluído"}</li>)}</ul>
        )}
      </div>
      <div>
        <h4 className="font-medium">Narrativa de IA</h4>
        {e.aiNarratives.length === 0 ? <p className="text-muted-foreground">Este modelo não tem slots de IA.</p> : (
          <ul>{e.aiNarratives.map((n) => <li key={n.slotKey}><span className="font-medium">{n.slotKey}</span>: {AI_NARRATIVE_LABEL[n.status] ?? n.status}</li>)}</ul>
        )}
      </div>
      {(e.officialDocRefs.length > 0 || e.annexes.length > 0) && (
        <div>
          <h4 className="font-medium">Referências e anexos</h4>
          <ul>
            {e.officialDocRefs.map((r) => <li key={`${r.order}-${r.documentId}`}>{r.order}. {r.title} — {r.role} (v{r.version})</li>)}
            {e.annexes.map((a) => <li key={a.id}>Anexo {a.id}</li>)}
          </ul>
        </div>
      )}
      <div>
        <h4 className="font-medium">Manifest</h4>
        <p>{e.manifest.persisted ? `Persistido (${e.manifest.id})` : "Não persistido (pré-visualização)"} · estágio {e.manifest.stage}</p>
        <p className="font-mono text-xs">hash {short(e.manifest.manifestHash)} · saída {short(e.manifest.composedOutputHash)}</p>
      </div>
    </section>
  );
}
