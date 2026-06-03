import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";

export type ItemReviewState =
  | "pending_match"
  | "candidate_generated"
  | "awaiting_review"
  | "approved"
  | "rejected"
  | "overridden"
  | "manual_entry"
  | "finalized"
  | "all";

interface ItemTRFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  reviewState: ItemReviewState;
  onReviewStateChange: (value: ItemReviewState) => void;
}

export function ItemTRFilters({
  search,
  onSearchChange,
  reviewState,
  onReviewStateChange,
}: ItemTRFiltersProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="relative flex-1 min-w-48">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por descrição..."
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>
      <Select value={reviewState} onValueChange={v => onReviewStateChange(v as ItemReviewState)}>
        <SelectTrigger className="w-52">
          <SelectValue placeholder="Filtrar por estado" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os estados</SelectItem>
          <SelectItem value="pending_match">Aguardando Match</SelectItem>
          <SelectItem value="candidate_generated">Candidatos Gerados</SelectItem>
          <SelectItem value="awaiting_review">Aguardando Revisão</SelectItem>
          <SelectItem value="approved">Aprovado</SelectItem>
          <SelectItem value="rejected">Rejeitado</SelectItem>
          <SelectItem value="overridden">Sobrescrito</SelectItem>
          <SelectItem value="manual_entry">Entrada Manual</SelectItem>
          <SelectItem value="finalized">Finalizado</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
