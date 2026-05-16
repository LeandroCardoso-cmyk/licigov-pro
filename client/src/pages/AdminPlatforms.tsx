import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Edit, Loader2, Settings, Eye } from "lucide-react";
import { useLocation } from "wouter";
import { useState } from "react";
import { ChecklistEditorDialog } from "./AdminPlatforms_ChecklistEditor";
import { TemplateInstructionsDialog } from "@/components/admin-platforms/TemplateInstructionsDialog";
import { TemplatePreviewDialogWrapper } from "@/components/admin-platforms/TemplatePreviewDialogWrapper";
import { ChecklistPreviewDialogWrapper } from "@/components/admin-platforms/ChecklistPreviewDialogWrapper";

export default function AdminPlatforms() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [selectedPlatform, setSelectedPlatform] = useState<number | null>(null);
  const [selectedPlatformName, setSelectedPlatformName] = useState<string>("");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [checklistDialogOpen, setChecklistDialogOpen] = useState(false);
  const [templatePreviewOpen, setTemplatePreviewOpen] = useState(false);
  const [checklistPreviewOpen, setChecklistPreviewOpen] = useState(false);

  if (!user || user.role !== "admin") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Acesso Negado</CardTitle>
            <CardDescription>Você não tem permissão para acessar esta página.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/dashboard")}>Voltar ao Dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { data: platforms, isLoading } = trpc.platforms.list.useQuery();

  const openEdit = (platformId: number, platformName: string) => {
    setSelectedPlatform(platformId); setSelectedPlatformName(platformName); setEditDialogOpen(true);
  };
  const openChecklist = (platformId: number, platformName: string) => {
    setSelectedPlatform(platformId); setSelectedPlatformName(platformName); setChecklistDialogOpen(true);
  };
  const openTemplatePreview = (platformId: number, platformName: string) => {
    setSelectedPlatform(platformId); setSelectedPlatformName(platformName); setTemplatePreviewOpen(true);
  };
  const openChecklistPreview = (platformId: number, platformName: string) => {
    setSelectedPlatform(platformId); setSelectedPlatformName(platformName); setChecklistPreviewOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold">Gerenciar Plataformas</h1>
                <p className="text-sm text-muted-foreground">Edite instruções e checklists das plataformas de pregão</p>
              </div>
            </div>
            <Settings className="h-6 w-6 text-muted-foreground" />
          </div>
        </div>
      </header>

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
                      <CardDescription className="mt-1">{platform.description || "Sem descrição"}</CardDescription>
                    </div>
                    <Badge variant={platform.isActive ? "default" : "secondary"}>
                      {platform.isActive ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {platform.websiteUrl && (
                    <p className="text-sm text-muted-foreground truncate">🌐 {platform.websiteUrl}</p>
                  )}
                  <div className="space-y-2 mt-4">
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => openEdit(platform.id, platform.name)}>
                        <Edit className="h-4 w-4 mr-1" />Instruções
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openTemplatePreview(platform.id, platform.name)} title="Preview">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => openChecklist(platform.id, platform.name)}>
                        <Edit className="h-4 w-4 mr-1" />Checklist
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openChecklistPreview(platform.id, platform.name)} title="Preview">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!isLoading && platforms?.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <p>Nenhuma plataforma cadastrada</p>
            </CardContent>
          </Card>
        )}
      </main>

      <TemplateInstructionsDialog open={editDialogOpen} onOpenChange={setEditDialogOpen} platformId={selectedPlatform} />
      <ChecklistEditorDialog open={checklistDialogOpen} onOpenChange={setChecklistDialogOpen} platformId={selectedPlatform} />
      <TemplatePreviewDialogWrapper open={templatePreviewOpen} onOpenChange={setTemplatePreviewOpen} platformId={selectedPlatform} platformName={selectedPlatformName} />
      <ChecklistPreviewDialogWrapper open={checklistPreviewOpen} onOpenChange={setChecklistPreviewOpen} platformId={selectedPlatform} platformName={selectedPlatformName} />
    </div>
  );
}
