import { Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface LegalReferenceTagProps {
  reference: string;
  className?: string;
}

export function LegalReferenceTag({ reference, className }: LegalReferenceTagProps) {
  return (
    <Badge
      variant="outline"
      className={`gap-1 text-xs border-blue-200 text-blue-700 bg-blue-50 ${className ?? ""}`}
    >
      <Scale className="h-3 w-3" />
      {reference}
    </Badge>
  );
}
