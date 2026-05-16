import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface Module {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  path: string;
  available: boolean;
  adminOnly?: boolean;
  color: string;
  image: string;
  stats?: { label: string; value: string | number };
}

interface Props {
  module: Module;
  alertCount?: number;
  onClick: () => void;
}

export function ModuleCard({ module, alertCount, onClick }: Props) {
  return (
    <Card
      className={`group relative overflow-hidden transition-all duration-300 hover:shadow-2xl cursor-pointer border-2 ${
        module.available ? "hover:scale-[1.02] hover:border-primary/30" : "opacity-75 hover:opacity-90"
      }`}
      onClick={onClick}
    >
      <div className="relative h-48 overflow-hidden bg-gradient-to-br from-muted to-muted/50">
        <img
          src={module.image}
          alt={module.title}
          className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-110"
        />
        <div className={`absolute inset-0 bg-gradient-to-t ${module.color} opacity-20 group-hover:opacity-30 transition-opacity`} />
        <div className={`absolute bottom-3 left-3 p-3 rounded-xl bg-gradient-to-br ${module.color} text-white shadow-lg`}>
          {module.icon}
        </div>
        {module.stats && (
          <div className="absolute top-3 right-3 bg-card/95 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-md border">
            <p className="text-xs text-muted-foreground">{module.stats.label}</p>
            <p className="text-lg font-bold text-foreground">{module.stats.value}</p>
          </div>
        )}
      </div>

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-xl font-bold text-foreground">{module.title}</CardTitle>
          {!module.available && <Badge variant="secondary" className="shrink-0">Em Breve</Badge>}
          {alertCount !== undefined && alertCount > 0 && (
            <Badge variant="destructive" className="shrink-0 animate-pulse">{alertCount} alertas</Badge>
          )}
        </div>
        <CardDescription className="text-sm mt-2 text-muted-foreground">{module.description}</CardDescription>
      </CardHeader>

      <CardContent className="pt-0">
        <Button
          variant={module.available ? "default" : "outline"}
          className={`w-full transition-all ${module.available ? "bg-gradient-to-r from-primary to-accent hover:opacity-90 shadow-md hover:shadow-lg" : ""}`}
          disabled={!module.available}
        >
          {module.available ? (
            <>Acessar Módulo<ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" /></>
          ) : "Em Desenvolvimento"}
        </Button>
      </CardContent>
    </Card>
  );
}
