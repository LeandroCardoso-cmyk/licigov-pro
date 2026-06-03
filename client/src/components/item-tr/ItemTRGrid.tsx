import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ConfidenceBadge, scoreToLevel } from "@/components/ui/ConfidenceBadge";
import { ItemTRFilters } from "./ItemTRFilters";
import { Loader2 } from "lucide-react";
import type { ItemReviewState } from "./ItemTRFilters";

interface ItemTRRow {
  id: string;
  itemNumber: number;
  description: string;
  quantity: number;
  unit: string;
  canonicalUnit: string | null;
  confidenceScore: number;
  reviewState: string;
  selectedCandidate: { catmatCode?: string; catmatDesc?: string } | null;
  estimatedTotalPrice: number | null;
}

interface ItemTRGridProps {
  items: ItemTRRow[];
  isLoading?: boolean;
  onRowClick?: (id: string) => void;
}

const stateVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending_match:       "secondary",
  candidate_generated: "secondary",
  awaiting_review:     "default",
  approved:            "default",
  rejected:            "destructive",
  overridden:          "outline",
  manual_entry:        "outline",
  finalized:           "default",
};

const stateLabel: Record<string, string> = {
  pending_match:       "Match Pendente",
  candidate_generated: "Candidatos",
  awaiting_review:     "Aguardando",
  approved:            "Aprovado",
  rejected:            "Rejeitado",
  overridden:          "Sobrescrito",
  manual_entry:        "Manual",
  finalized:           "Finalizado",
};

export function ItemTRGrid({ items, isLoading = false, onRowClick }: ItemTRGridProps) {
  const [search,      setSearch]      = useState("");
  const [filterState, setFilterState] = useState<ItemReviewState>("all");

  const filtered = items.filter(item => {
    const matchState  = filterState === "all" || item.reviewState === filterState;
    const matchSearch = !search.trim() || item.description.toLowerCase().includes(search.toLowerCase());
    return matchState && matchSearch;
  });

  return (
    <div className="space-y-4">
      <ItemTRFilters
        search={search}
        onSearchChange={setSearch}
        reviewState={filterState}
        onReviewStateChange={setFilterState}
      />

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Nº</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="w-20">Qtd.</TableHead>
              <TableHead className="w-20">Unidade</TableHead>
              <TableHead className="w-32">Confiança</TableHead>
              <TableHead className="w-32">Estado</TableHead>
              <TableHead>Candidato CATMAT</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground text-sm">
                  Nenhum item encontrado
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(item => (
                <TableRow
                  key={item.id}
                  className={onRowClick ? "cursor-pointer hover:bg-muted/50" : ""}
                  onClick={() => onRowClick?.(item.id)}
                >
                  <TableCell className="font-mono text-sm">{item.itemNumber}</TableCell>
                  <TableCell>
                    <p className="text-sm line-clamp-2 max-w-sm">{item.description}</p>
                  </TableCell>
                  <TableCell className="text-sm">{item.quantity}</TableCell>
                  <TableCell className="text-sm">{item.canonicalUnit ?? item.unit}</TableCell>
                  <TableCell>
                    <ConfidenceBadge
                      level={scoreToLevel(item.confidenceScore)}
                      score={item.confidenceScore}
                      showScore
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant={stateVariant[item.reviewState] ?? "secondary"} className="text-xs">
                      {stateLabel[item.reviewState] ?? item.reviewState}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {item.selectedCandidate?.catmatCode ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        {filtered.length} de {items.length} item(ns)
      </p>
    </div>
  );
}
