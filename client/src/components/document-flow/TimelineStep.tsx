import { CheckCircle2, Lock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocType, StepStatus, ProcessDocument } from "./types";
import { DOC_LABELS } from "./types";

interface Props {
  docType: DocType;
  index: number;
  status: StepStatus;
  doc: ProcessDocument | undefined;
  activeTab: DocType;
  onTabChange: (docType: DocType) => void;
}

export function TimelineStep({ docType, index, status, doc, activeTab, onTabChange }: Props) {
  const isDone = status === "done-ai" || status === "done-upload";
  const isActive = status === "pending" || status === "generating" || status === "uploading";
  const isLocked = status === "locked";

  return (
    <button
      onClick={() => !isLocked && onTabChange(docType)}
      disabled={isLocked}
      className={cn(
        "flex flex-col items-center gap-2 min-w-0 flex-1 group",
        isLocked ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      )}
    >
      <div
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all",
          isDone && "bg-green-500 border-green-500 text-white",
          isActive && activeTab === docType && "bg-primary border-primary text-primary-foreground",
          isActive && activeTab !== docType && "border-primary text-primary bg-background",
          isLocked && "border-border text-muted-foreground bg-muted"
        )}
      >
        {isDone ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : isLocked ? (
          <Lock className="h-4 w-4" />
        ) : status === "generating" || status === "uploading" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <span className="text-sm font-bold">{index + 1}</span>
        )}
      </div>

      <div className="text-center">
        <p className={cn("text-xs font-semibold", isLocked ? "text-muted-foreground" : "text-foreground")}>
          {DOC_LABELS[docType].short}
        </p>
        {isDone && doc && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            v{doc.version}
            {doc.sourceType === "upload" ? " · Upload" : " · IA"}
          </p>
        )}
      </div>
    </button>
  );
}
