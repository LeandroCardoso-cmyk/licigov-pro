import { trpc } from "@/lib/trpc";
import { TemplatePreviewDialog } from "@/components/admin/PreviewDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platformId: number | null;
  platformName: string;
}

export function TemplatePreviewDialogWrapper({ open, onOpenChange, platformId, platformName }: Props) {
  const { data: platform } = trpc.platforms.getById.useQuery(
    { platformId: platformId || 0 },
    { enabled: !!platformId && open }
  );

  const instructions = (platform?.config as any)?.instructions || {};

  return (
    <TemplatePreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      platformName={platformName}
      instructions={instructions}
    />
  );
}
