import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platformId: number | null;
}

export function TemplateInstructionsDialog({ open, onOpenChange, platformId }: Props) {
  const [instructions, setInstructions] = useState({ general: "", etp: "", tr: "", dfd: "", edital: "" });

  const { data: platform } = trpc.platforms.getById.useQuery(
    { platformId: platformId || 0 },
    { enabled: !!platformId && open }
  );

  useEffect(() => {
    if (platform?.config) {
      const config = platform.config as any;
      if (config.instructions) {
        setInstructions({
          general: config.instructions.general || "",
          etp: config.instructions.etp || "",
          tr: config.instructions.tr || "",
          dfd: config.instructions.dfd || "",
          edital: config.instructions.edital || "",
        });
      }
    }
  }, [platform]);

  const updateInstructionsMutation = trpc.platforms.updateInstructions.useMutation({
    onSuccess: () => { toast.success("Instruções salvas com sucesso!"); onOpenChange(false); },
    onError: (error) => toast.error(error.message || "Erro ao salvar instruções"),
  });

  const handleSave = () => {
    if (!platformId) return;
    updateInstructionsMutation.mutate({ platformId, instructions });
  };

  const fields: { id: keyof typeof instructions; label: string; placeholder: string; rows: number }[] = [
    { id: "general", label: "Instruções Gerais", placeholder: "Instruções aplicadas a todos os documentos...", rows: 4 },
    { id: "etp", label: "Instruções Específicas - ETP", placeholder: "Instruções específicas para Estudo Técnico Preliminar...", rows: 3 },
    { id: "tr", label: "Instruções Específicas - TR", placeholder: "Instruções específicas para Termo de Referência...", rows: 3 },
    { id: "dfd", label: "Instruções Específicas - DFD", placeholder: "Instruções específicas para Documento Formalizador de Demanda...", rows: 3 },
    { id: "edital", label: "Instruções Específicas - Edital", placeholder: "Instruções específicas para Edital...", rows: 3 },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Instruções de Templates</DialogTitle>
          <DialogDescription>
            Personalize as instruções que a IA usa para adaptar documentos para esta plataforma
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {fields.map(({ id, label, placeholder, rows }) => (
            <div key={id}>
              <Label htmlFor={id}>{label}</Label>
              <Textarea
                id={id}
                placeholder={placeholder}
                value={instructions[id]}
                onChange={(e) => setInstructions({ ...instructions, [id]: e.target.value })}
                rows={rows}
              />
            </div>
          ))}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={updateInstructionsMutation.isPending}>
              {updateInstructionsMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</>
              ) : "Salvar Alterações"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
