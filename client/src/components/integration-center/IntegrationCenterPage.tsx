import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Webhook, Key, Download, Activity, Plus } from "lucide-react";
import { WebhookStatusCard } from "./WebhookStatusCard";
import { ApiUsageWidget } from "./ApiUsageWidget";
import { IntegrationLogsList } from "./IntegrationLogsList";

interface IntegrationCenterPageProps {
  organizationId: number;
}

// Placeholder types for demo data
interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

interface ExportHistoryEntry {
  id: string;
  schema: string;
  format: string;
  checksum: string;
  generatedAt: string;
}

export function IntegrationCenterPage({
  organizationId,
}: IntegrationCenterPageProps) {
  const [activeTab, setActiveTab] = useState("webhooks");

  // Demo data — in production these would come from tRPC queries
  const webhooks: WebhookEndpoint[] = [];
  const apiStats = {
    totalRequests: 0,
    avgLatency: 0,
    errorRate: 0,
    topEndpoints: [],
  };
  const exportHistory: ExportHistoryEntry[] = [];
  const logs: never[] = [];

  void organizationId;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Central de Integrações</h2>
          <p className="text-sm text-muted-foreground">
            Webhooks, tokens de API, exportações e logs de integração
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          Org #{organizationId}
        </Badge>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="webhooks" className="text-xs">
            <Webhook className="w-3.5 h-3.5 mr-1" />
            Webhooks
          </TabsTrigger>
          <TabsTrigger value="tokens" className="text-xs">
            <Key className="w-3.5 h-3.5 mr-1" />
            API Tokens
          </TabsTrigger>
          <TabsTrigger value="exports" className="text-xs">
            <Download className="w-3.5 h-3.5 mr-1" />
            Exportações
          </TabsTrigger>
          <TabsTrigger value="logs" className="text-xs">
            <Activity className="w-3.5 h-3.5 mr-1" />
            Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="webhooks" className="space-y-3 mt-4">
          <div className="flex justify-end">
            <Button size="sm" variant="outline">
              <Plus className="w-4 h-4 mr-1" />
              Novo endpoint
            </Button>
          </div>
          {webhooks.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Webhook className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm text-muted-foreground">
                  Nenhum webhook configurado.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Configure endpoints para receber notificações de eventos.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {webhooks.map((ep) => (
                <WebhookStatusCard key={ep.id} endpoint={ep} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tokens" className="mt-4">
          <Card>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Tokens de API Pública</CardTitle>
                <Button size="sm" variant="outline">
                  <Plus className="w-4 h-4 mr-1" />
                  Gerar token
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-sm text-muted-foreground text-center py-6">
                Nenhum token ativo. Gere um token para integrar sistemas externos.
              </p>
            </CardContent>
          </Card>
          <div className="mt-3">
            <ApiUsageWidget stats={apiStats} />
          </div>
        </TabsContent>

        <TabsContent value="exports" className="mt-4">
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">Histórico de Exportações</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {exportHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Nenhuma exportação estruturada gerada ainda.
                </p>
              ) : (
                <div className="space-y-2">
                  {exportHistory.map((exp) => (
                    <div
                      key={exp.id}
                      className="flex items-center gap-3 text-sm py-2 border-b last:border-b-0"
                    >
                      <Badge variant="outline" className="text-xs">
                        {exp.schema}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {exp.format.toUpperCase()}
                      </Badge>
                      <span className="text-muted-foreground font-mono text-xs flex-1 truncate">
                        {exp.checksum.slice(0, 16)}…
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(exp.generatedAt).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">Logs de Integração</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <IntegrationLogsList logs={logs} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
