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
import { SemanticScoreBar } from "@/components/ui/SemanticScoreBar";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

interface CandidateInfo {
  id: string;
  description: string;
  catmatCode?: string;
  score: number;
}

interface CandidateDecisionModalProps {
  open: boolean;
  onClose: () => void;
  candidate: CandidateInfo | null;
  onConfirm: (candidateId: string, justification?: string) => void;
  isLoading?: boolean;
}

export function CandidateDecisionModal({
  open,
  onClose,
  candidate,
  onConfirm,
  isLoading = false,
}: CandidateDecisionModalProps) {
  const [justification, setJustification] = useState("");

  function handleConfirm() {
    if (!candidate) return;
    onConfirm(candidate.id, justification.trim() || undefined);
    setJustification("");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Selecionar Candidato</DialogTitle>
          <DialogDescription>
            Confirme a seleção do candidato semântico. A justificativa é opcional.
          </DialogDescription>
        </DialogHeader>

        {candidate && (
          <div className="space-y-3 py-2">
            <div className="border rounded-lg p-3 space-y-2">
              {candidate.catmatCode && (
                <Badge variant="secondary" className="font-mono text-xs">{candidate.catmatCode}</Badge>
              )}
              <p className="text-sm font-medium">{candidate.description}</p>
              <SemanticScoreBar score={candidate.score} label="Score semântico" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="decision-justif">Justificativa (opcional)</Label>
              <Textarea
                id="decision-justif"
                placeholder="Motivo da seleção (opcional)..."
                value={justification}
                onChange={e => setJustification(e.target.value)}
                rows={2}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={!candidate || isLoading}>
            {isLoading && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Confirmar Seleção
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
