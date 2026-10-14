import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ELECTRONIC_RECORD_NOTE } from "@/lib/institutionalTemplatesView";

export interface ActionNoteProps {
  /** O que a ação faz, em linguagem direta. */
  consequence: string;
  note: string;
  onNote: (next: string) => void;
  /** id único do campo (acessibilidade). */
  id?: string;
}

/**
 * LICIGOV-FAST — confirmação enxuta: diz o que vai acontecer e oferece uma observação OPCIONAL. A confirmação é o clique no botão que nomeia a ação
 * (fora deste componente). Nenhum campo de autoridade/cargo/ato: o usuário autenticado, o papel, a data/hora e o correlation id são registrados pelo servidor.
 */
export function ActionNote({ consequence, note, onNote, id = "action-note" }: ActionNoteProps) {
  return (
    <div className="space-y-2 text-sm">
      <p className="rounded-md border bg-muted/40 p-3 text-muted-foreground">{consequence} <span className="block text-xs">{ELECTRONIC_RECORD_NOTE}</span></p>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Adicionar observação (opcional)</summary>
        <div className="mt-2 space-y-1">
          <Label htmlFor={id}>Observação</Label>
          <Textarea id={id} rows={2} value={note} maxLength={2000} onChange={(e) => onNote(e.target.value)} />
        </div>
      </details>
    </div>
  );
}
