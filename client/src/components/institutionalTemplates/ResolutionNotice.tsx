import { StatusBadge } from "@/components/ui/StatusBadge";
import { describeResolutionView, type ResolutionView } from "@/lib/institutionalTemplatesView";

/** Deixa EXPLÍCITO qual revisão exata será aplicada (ou por que a geração está bloqueada). Nunca "última publicada". */
export function ResolutionNotice({ resolution }: { resolution: ResolutionView }) {
  const d = describeResolutionView(resolution);
  return (
    <div role="status" className="rounded-md border p-3 text-sm">
      <div className="mb-1 flex items-center gap-2"><StatusBadge label={resolution.status} tone={d.tone} /><span className="font-medium">{d.title}</span></div>
      <p className="text-muted-foreground">{d.detail}</p>
    </div>
  );
}
