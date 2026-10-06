import { StatusBadge } from "@/components/ui/StatusBadge";
import { STATUS_LABEL, STATUS_TONE, type RevisionStatus } from "@/lib/institutionalTemplatesView";

/** Estado da revisão (DRAFT · APPROVED · PUBLISHED · DEPRECATED) — sempre o rótulo canônico, nunca "ativo/latest". */
export function RevisionStatusBadge({ status }: { status: RevisionStatus }) {
  return <StatusBadge label={STATUS_LABEL[status]} tone={STATUS_TONE[status]} />;
}
