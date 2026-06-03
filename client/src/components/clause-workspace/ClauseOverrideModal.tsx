import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface ClauseOverrideModalProps {
  open:          boolean;
  onClose:       () => void;
  clauseTitle:   string;
  currentContent: string;
  onConfirm:     (newContent: string, justification: string) => void;
  isLoading?:    boolean;
}

export function ClauseOverrideModal({
  open,
  onClose,
  clauseTitle,
  currentContent,
  onConfirm,
  isLoading = false,
}: ClauseOverrideModalProps) {
  const [newContent,    setNewContent]    = useState(currentContent);
  const [justification, setJustification] = useState("");

  function handleConfirm() {
    if (newContent.trim().length < 1 || justification.trim().length < 5) return;
    onConfirm(newContent.trim(), justification.trim());
    setJustification("");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Override de Cláusula</DialogTitle>
          <DialogDescription>
            Editando: <strong>{clauseTitle}</strong>.
            A justificativa deve ter no mínimo 5 caracteres.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="clause-content">Novo Conteúdo *</Label>
            <Textarea
              id="clause-content"
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              rows={6}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="clause-justif">
              Justificativa * (mín. 5 caracteres — {justification.length}/5)
            </Label>
            <Textarea
              id="clause-justif"
              placeholder="Motivo da alteração da cláusula..."
              value={justification}
              onChange={e => setJustification(e.target.value)}
              rows={3}
            />
            {justification.length > 0 && justification.length < 5 && (
              <p className="text-xs text-destructive">Justificativa muito curta</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={handleConfirm}
            disabled={newContent.trim().length < 1 || justification.trim().length < 5 || isLoading}
          >
            {isLoading && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Confirmar Override
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
