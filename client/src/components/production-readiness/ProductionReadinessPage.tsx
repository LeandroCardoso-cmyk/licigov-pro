import { SystemHealthCard } from "./SystemHealthCard";
import { IngestionStatusWidget } from "./IngestionStatusWidget";
import { CacheMetricsWidget } from "./CacheMetricsWidget";
import { KPIWidget } from "@/components/operational-dashboard/KPIWidget";
import { Activity, Database, Layers, Shield } from "lucide-react";

interface ProductionReadinessPageProps {
  organizationId: number;
}

export function ProductionReadinessPage({ organizationId }: ProductionReadinessPageProps) {
  // In a full implementation these would use tRPC queries
  const healthChecks = [
    { name: "Database", status: "healthy" as const, details: "OK" },
    { name: "Cache", status: "healthy" as const, details: "OK" },
    { name: "Export Engine", status: "healthy" as const, details: "OK" },
    { name: "Ingestion", status: "healthy" as const, details: "OK" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Production Readiness</h1>
        <p className="text-muted-foreground text-sm mt-1">
          System health dashboard for organization {organizationId}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <SystemHealthCard healthy={true} checks={healthChecks} />

        <IngestionStatusWidget
          totalEntries={0}
          processedEntries={0}
          failedEntries={0}
          status="pending"
        />

        <CacheMetricsWidget
          hits={0}
          misses={0}
          evictions={0}
          size={0}
          hitRatio={0}
        />

        <KPIWidget
          label="Matching Latency"
          value="0"
          unit="ms"
          icon={Activity}
        />

        <KPIWidget
          label="Tenant Integrity"
          value="Healthy"
          icon={Shield}
        />

        <KPIWidget
          label="Queue Health"
          value="0"
          unit="pending"
          icon={Database}
        />
      </div>
    </div>
  );
}
