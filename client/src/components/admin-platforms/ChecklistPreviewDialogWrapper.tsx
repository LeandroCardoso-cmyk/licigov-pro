import { trpc } from "@/lib/trpc";
import { ChecklistPreviewDialog } from "@/components/admin/PreviewDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platformId: number | null;
  platformName: string;
}

export function ChecklistPreviewDialogWrapper({ open, onOpenChange, platformId, platformName }: Props) {
  const { data: checklist } = trpc.platforms.getChecklist.useQuery(
    { platformId: platformId || 0 },
    { enabled: !!platformId && open }
  );

  return (
    <ChecklistPreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      platformName={platformName}
      checklist={checklist || []}
    />
  );
}
