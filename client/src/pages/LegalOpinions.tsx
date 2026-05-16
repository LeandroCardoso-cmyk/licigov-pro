import { useAuth } from "@/_core/hooks/useAuth";
import { BackToDashboard } from "@/components/BackToDashboard";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Scale, Plus, FileText, Loader2, BarChart3 } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { LegalOpinionFilters } from "@/components/legal-opinions/LegalOpinionFilters";
import { LegalOpinionCard } from "@/components/legal-opinions/LegalOpinionCard";

export default function LegalOpinions() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceTypeFilter, setSourceTypeFilter] = useState("all");
  const [templateFilter, setTemplateFilter] = useState("all");

  const { data: opinions, isLoading } = trpc.legalOpinions.list.useQuery(
    {
      status: statusFilter !== "all" ? (statusFilter as any) : undefined,
      sourceType: sourceTypeFilter !== "all" ? (sourceTypeFilter as any) : undefined,
      isTemplate: templateFilter === "templates" ? true : templateFilter === "regular" ? false : undefined,
    },
    { enabled: !!user }
  );

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <BackToDashboard />
              <div>
                <Breadcrumbs items={[{ label: "Parecer Jurídico" }]} className="mb-1" />
                <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                  <Scale className="h-6 w-6 text-primary" />
                  Pareceres Jurídicos
                </h1>
                <p className="text-sm text-muted-foreground">
                  Análises jurídicas automatizadas com IA baseadas na Lei 14.133/2021
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate("/parecer-juridico/analytics")}>
                <BarChart3 className="h-4 w-4 mr-2" />Analytics
              </Button>
              <Button onClick={() => navigate("/parecer-juridico/novo")}>
                <Plus className="h-4 w-4 mr-2" />Novo Parecer
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <LegalOpinionFilters
          statusFilter={statusFilter}
          sourceTypeFilter={sourceTypeFilter}
          templateFilter={templateFilter}
          onStatusChange={setStatusFilter}
          onSourceTypeChange={setSourceTypeFilter}
          onTemplateChange={setTemplateFilter}
        />
      </div>

      <div className="container mx-auto px-4 pb-12">
        {!opinions || opinions.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-16 w-16 text-muted-foreground mb-4" />
              <p className="text-lg font-medium text-muted-foreground mb-2">Nenhum parecer encontrado</p>
              <p className="text-sm text-muted-foreground mb-4">Crie seu primeiro parecer jurídico com IA</p>
              <Button onClick={() => navigate("/parecer-juridico/novo")}>
                <Plus className="h-4 w-4 mr-2" />Novo Parecer
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {opinions.map((opinion) => (
              <LegalOpinionCard
                key={opinion.id}
                opinion={opinion}
                onClick={() => navigate(`/parecer-juridico/${opinion.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
