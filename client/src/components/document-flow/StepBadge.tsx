import { Badge } from "@/components/ui/badge";
import { Bot, UploadCloud, Loader2, Clock, Lock } from "lucide-react";
import type { StepStatus } from "./types";

export function StepBadge({ status }: { status: StepStatus }) {
  if (status === "done-ai")
    return (
      <Badge variant="secondary" className="gap-1 text-xs bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
        <Bot className="h-3 w-3" /> Gerado por IA
      </Badge>
    );
  if (status === "done-upload")
    return (
      <Badge variant="secondary" className="gap-1 text-xs bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">
        <UploadCloud className="h-3 w-3" /> Upload
      </Badge>
    );
  if (status === "generating")
    return (
      <Badge variant="secondary" className="gap-1 text-xs bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
        <Loader2 className="h-3 w-3 animate-spin" /> Gerando…
      </Badge>
    );
  if (status === "uploading")
    return (
      <Badge variant="secondary" className="gap-1 text-xs bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
        <Loader2 className="h-3 w-3 animate-spin" /> Enviando…
      </Badge>
    );
  if (status === "pending")
    return (
      <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" /> Pendente
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
      <Lock className="h-3 w-3" /> Bloqueado
    </Badge>
  );
}
