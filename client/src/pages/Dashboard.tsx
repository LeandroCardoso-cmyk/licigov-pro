import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Plus, FileText } from "lucide-react";
import { InlineLoader } from "@/components/ui/PageLoader";
import { EmptyState } from "@/components/ui/EmptyState";
import { DashboardMetrics } from "@/components/DashboardMetrics";
import { ProcessCard } from "@/components/dashboard/ProcessCard";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useLocation } from "wouter";

/**
 * Processos Licitatórios — renderizado DENTRO do shell (DashboardLayout).
 * O header de aplicação (logo/usuário/logout/tema) é fornecido pelo shell; esta página usa
 * apenas a faixa de título leve, evitando chrome duplicado.
 */
export default function Dashboard() {
  const [, navigate] = useLocation();
  const { data: processes, isLoading } = trpc.processes.list.useQuery();

  const handleNewProcess = () => {
    navigate("/novo-processo");
  };

  // Calcular métricas
  const totalProcesses = processes?.length || 0;
  const totalValue = processes?.reduce((sum, p) => sum + (p.estimatedValue || 0), 0) || 0;
  const processesByStatus = processes?.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const processesByModality = processes?.reduce((acc, p) => {
    if (p.modality) {
      acc[p.modality] = (acc[p.modality] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>) || {};

  return (
    <div className="min-h-screen bg-background">
      {/* Faixa de título (dentro do shell — sem chrome de app duplicado) */}
      <div className="border-b bg-card">
        <div className="container py-6">
          <Breadcrumbs items={[{ label: "Processo Licitatório" }]} className="mb-2" />
          <h1 className="text-3xl font-bold">Processos Licitatórios</h1>
          <p className="text-muted-foreground mt-1">
            Gestão completa de licitações — geração de ETP, TR, DFD e Editais.
          </p>
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        {/* Action Bar */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Meus Processos</h2>
            <p className="text-muted-foreground mt-1">
              Gerencie e acompanhe seus processos licitatórios
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleNewProcess} size="lg" className="gap-2">
              <Plus className="h-5 w-5" />
              Novo Processo
            </Button>
          </div>
        </div>

        {/* Dashboard Metrics */}
        {!isLoading && processes && processes.length > 0 && (
          <div className="mb-8">
            <DashboardMetrics
              totalProcesses={totalProcesses}
              totalValue={totalValue}
              processesByStatus={processesByStatus}
              processesByModality={processesByModality}
            />
          </div>
        )}

        {/* Processes List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <InlineLoader className="h-8 w-8 text-primary" />
          </div>
        ) : processes && processes.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {processes.map((process) => (
              <ProcessCard
                key={process.id}
                process={process}
                onClick={() => navigate(`/processo/${process.id}`)}
              />
            ))}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent>
              <EmptyState
                icon={FileText}
                title="Nenhum processo criado"
                description="Comece criando seu primeiro processo licitatório. O sistema irá guiá-lo através da geração de todos os documentos necessários."
                action={{ label: "Criar Primeiro Processo", onClick: handleNewProcess }}
              />
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
