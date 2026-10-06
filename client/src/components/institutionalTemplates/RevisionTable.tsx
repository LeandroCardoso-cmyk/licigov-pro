import { Button } from "@/components/ui/button";
import { RevisionStatusBadge } from "./RevisionStatusBadge";
import { nextLifecycleAction, revisionLabel, type LifecycleAction, type RevisionStatus } from "@/lib/institutionalTemplatesView";

export interface RevisionRow {
  id: string; revision: number; status: RevisionStatus; semanticHash: string; sourceFormat: string;
  approvalDecisionId: string | null; publishDecisionId: string | null;
}

export interface RevisionTableProps {
  revisions: readonly RevisionRow[];
  selectedId?: string | null;
  role: string | null;
  floors: Record<string, string> | undefined;
  onSelect: (revisionId: string) => void;
  onLifecycle: (action: LifecycleAction, revision: RevisionRow) => void;
  onNewRevision: (revision: RevisionRow) => void;
}

const SOURCE_LABEL: Record<string, string> = { NATIVE: "Editor", MARKDOWN_IMPORT: "Importada (Markdown)", DOCX_IMPORT: "Importada (DOCX)" };

/** Lista de revisões: SEMPRE a revisão exata (nº + hash). Nenhuma linha é rotulada "última"/"atual" como autoridade. */
export function RevisionTable({ revisions, selectedId, role, floors, onSelect, onLifecycle, onNewRevision }: RevisionTableProps) {
  if (revisions.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma revisão ainda. Crie um rascunho ou importe um modelo.</p>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm" aria-label="Revisões do modelo">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr><th className="p-2">Revisão exata</th><th className="p-2">Estado</th><th className="p-2">Origem</th><th className="p-2">Decisões</th><th className="p-2 text-right">Ações</th></tr>
        </thead>
        <tbody>
          {[...revisions].sort((a, b) => b.revision - a.revision).map((r) => {
            const action = nextLifecycleAction(r.status, role, floors);
            return (
              <tr key={r.id} className={`border-t ${selectedId === r.id ? "bg-primary/5" : ""}`}>
                <td className="p-2 font-medium"><button type="button" className="underline-offset-2 hover:underline" onClick={() => onSelect(r.id)}>{revisionLabel(r)}</button></td>
                <td className="p-2"><RevisionStatusBadge status={r.status} /></td>
                <td className="p-2">{SOURCE_LABEL[r.sourceFormat] ?? r.sourceFormat}</td>
                <td className="p-2 text-xs text-muted-foreground">
                  {r.approvalDecisionId ? <div>Aprovação: {r.approvalDecisionId}</div> : <div>Sem aprovação</div>}
                  {r.publishDecisionId ? <div>Publicação: {r.publishDecisionId}</div> : <div>Sem publicação</div>}
                </td>
                <td className="p-2 text-right">
                  <div className="flex justify-end gap-2">
                    {action && (
                      <Button size="sm" variant={action.action === "DEPRECATE" ? "outline" : "default"} disabled={!action.enabled} title={action.disabledReason}
                        onClick={() => onLifecycle(action.action, r)}>{action.label}</Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => onNewRevision(r)} title="Cria uma NOVA revisão em rascunho com o conteúdo desta">Nova revisão a partir desta</Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
