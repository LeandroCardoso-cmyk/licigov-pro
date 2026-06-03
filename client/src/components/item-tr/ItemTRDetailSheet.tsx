import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ConfidenceBadge, scoreToLevel } from "@/components/ui/ConfidenceBadge";
import { SemanticScoreBar } from "@/components/ui/SemanticScoreBar";
import { Separator } from "@/components/ui/separator";

interface ItemTRDetailSheetProps {
  open: boolean;
  onClose: () => void;
  item: {
    id: string;
    itemNumber: number;
    description: string;
    normalizedDescription: string;
    quantity: number;
    unit: string;
    canonicalUnit: string | null;
    estimatedUnitPrice: number | null;
    estimatedTotalPrice: number | null;
    catmatCode: string | null;
    catmatDescription: string | null;
    catserCode: string | null;
    confidenceScore: number;
    reviewState: string;
    warnings: string[];
  } | null;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <p className="text-sm">{value ?? <span className="text-muted-foreground italic">—</span>}</p>
    </div>
  );
}

export function ItemTRDetailSheet({ open, onClose, item }: ItemTRDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle>Item #{item.itemNumber}</SheetTitle>
              <SheetDescription className="line-clamp-3">{item.description}</SheetDescription>
            </SheetHeader>

            <div className="px-4 space-y-5">
              <div className="flex items-center gap-2 flex-wrap">
                <ConfidenceBadge
                  level={scoreToLevel(item.confidenceScore)}
                  score={item.confidenceScore}
                  showScore
                />
                <Badge variant="outline" className="text-xs">{item.reviewState}</Badge>
              </div>

              <SemanticScoreBar score={item.confidenceScore} label="Confiança semântica" />

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <Field label="Quantidade"       value={item.quantity} />
                <Field label="Unidade"          value={item.unit} />
                <Field label="Unidade Canônica" value={item.canonicalUnit} />
                <Field
                  label="Preço Unitário"
                  value={item.estimatedUnitPrice != null ? `R$ ${item.estimatedUnitPrice.toFixed(2)}` : null}
                />
                <Field
                  label="Valor Total Est."
                  value={item.estimatedTotalPrice != null ? `R$ ${item.estimatedTotalPrice.toFixed(2)}` : null}
                />
              </div>

              <Separator />

              <div className="space-y-3">
                <Field label="Código CATMAT" value={item.catmatCode} />
                <Field label="Desc. CATMAT"  value={item.catmatDescription} />
                <Field label="Código CATSER" value={item.catserCode} />
              </div>

              {item.normalizedDescription !== item.description && (
                <>
                  <Separator />
                  <Field label="Descrição Normalizada" value={item.normalizedDescription} />
                </>
              )}

              {item.warnings.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Avisos</span>
                    {item.warnings.map((w, i) => (
                      <p key={i} className="text-sm text-yellow-700 bg-yellow-50 rounded px-2 py-1">{w}</p>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
