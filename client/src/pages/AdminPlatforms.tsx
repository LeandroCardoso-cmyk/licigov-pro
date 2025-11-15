import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Edit, Plus, Loader2, Settings } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import { ChecklistEditorDialog } from "./AdminPlatforms_ChecklistEditor";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export default function AdminPlatforms() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [selectedPlatform, setSelectedPlatform] = useState<number | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [checklistDialogOpen, setChecklistDialogOpen] = useState(false);

  // Verificar se é admin
  if (!user || user.role !== "admin") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Acesso Negado</CardTitle>
            <CardDescription>
              Você não tem permissão para acessar esta página.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/dashboard")}>
              Voltar ao Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { data: platforms, isLoading } = trpc.platforms.list.useQuery();

  const handleEditInstructions = (platformId: number) => {
    setSelectedPlatform(platformId);
    setEditDialogOpen(true);
  };

  const handleEditChecklist = (platformId: number) => {
    setSelectedPlatform(platformId);
    setChecklistDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/dashboard")}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold">Gerenciar Plataformas</h1>
                <p className="text-sm text-muted-foreground">
                  Edite instruções e checklists das plataformas de pregão
                </p>
              </div>
            </div>
            <Settings className="h-6 w-6 text-muted-foreground" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {platforms?.map((platform) => (
              <Card key={platform.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{platform.name}</CardTitle>
                      <CardDescription className="mt-1">
                        {platform.description || "Sem descrição"}
                      </CardDescription>
                    </div>
                    <Badge variant={platform.isActive ? "default" : "secondary"}>
                      {platform.isActive ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {platform.websiteUrl && (
                    <p className="text-sm text-muted-foreground truncate">
                      🌐 {platform.websiteUrl}
                    </p>
                  )}
                  
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleEditInstructions(platform.id)}
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      Instruções
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleEditChecklist(platform.id)}
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      Checklist
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!isLoading && platforms && platforms.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <p>Nenhuma plataforma cadastrada</p>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Dialog de Edição de Instruções */}
      <TemplateInstructionsDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        platformId={selectedPlatform}
      />

      {/* Dialog de Edição de Checklist */}
      <ChecklistEditorDialog
        open={checklistDialogOpen}
        onOpenChange={setChecklistDialogOpen}
        platformId={selectedPlatform}
      />
    </div>
  );
}

/**
 * Dialog para editar instruções de templates
 */
function TemplateInstructionsDialog({
  open,
  onOpenChange,
  platformId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platformId: number | null;
}) {
  const [instructions, setInstructions] = useState({
    general: "",
    etp: "",
    tr: "",
    dfd: "",
    edital: "",
  });

  // Buscar plataforma para carregar instruções atuais
  const { data: platform } = trpc.platforms.getById.useQuery(
    { platformId: platformId || 0 },
    { enabled: !!platformId && open }
  );

  // Carregar instruções atuais quando plataforma for carregada
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

  // Mutation para salvar instruções
  const updateInstructionsMutation = trpc.platforms.updateInstructions.useMutation({
    onSuccess: () => {
      toast.success("Instruções salvas com sucesso!");
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao salvar instruções");
    },
  });

  const handleSave = () => {
    if (!platformId) return;
    updateInstructionsMutation.mutate({
      platformId,
      instructions,
    });
  };

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
          <div>
            <Label htmlFor="general">Instruções Gerais</Label>
            <Textarea
              id="general"
              placeholder="Instruções aplicadas a todos os documentos..."
              value={instructions.general}
              onChange={(e) => setInstructions({ ...instructions, general: e.target.value })}
              rows={4}
            />
          </div>

          <div>
            <Label htmlFor="etp">Instruções Específicas - ETP</Label>
            <Textarea
              id="etp"
              placeholder="Instruções específicas para Estudo Técnico Preliminar..."
              value={instructions.etp}
              onChange={(e) => setInstructions({ ...instructions, etp: e.target.value })}
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="tr">Instruções Específicas - TR</Label>
            <Textarea
              id="tr"
              placeholder="Instruções específicas para Termo de Referência..."
              value={instructions.tr}
              onChange={(e) => setInstructions({ ...instructions, tr: e.target.value })}
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="dfd">Instruções Específicas - DFD</Label>
            <Textarea
              id="dfd"
              placeholder="Instruções específicas para Documento Formalizador de Demanda..."
              value={instructions.dfd}
              onChange={(e) => setInstructions({ ...instructions, dfd: e.target.value })}
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="edital">Instruções Específicas - Edital</Label>
            <Textarea
              id="edital"
              placeholder="Instruções específicas para Edital..."
              value={instructions.edital}
              onChange={(e) => setInstructions({ ...instructions, edital: e.target.value })}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={handleSave}
              disabled={updateInstructionsMutation.isPending}
            >
              {updateInstructionsMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                "Salvar Alterações"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ChecklistEditorDialog movido para arquivo separado AdminPlatforms_ChecklistEditor.tsx
