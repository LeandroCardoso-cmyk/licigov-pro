import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";
import { ReviewQueueItem, type ReviewItemShape, type ItemReviewState } from "./ReviewQueueItem";

interface ReviewQueueProps {
  items: ReviewItemShape[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  checkedIds: Set<string>;
  onCheckboxChange: (id: string, checked: boolean) => void;
}

const TAB_STATES: Record<string, ItemReviewState[] | null> = {
  all:       null,
  awaiting:  ["awaiting_review"],
  approved:  ["approved", "finalized"],
  rejected:  ["rejected"],
  other:     ["pending_match", "candidate_generated", "overridden", "manual_entry"],
};

export function ReviewQueue({
  items,
  isLoading,
  selectedId,
  onSelect,
  checkedIds,
  onCheckboxChange,
}: ReviewQueueProps) {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  function filterItems(tab: string): ReviewItemShape[] {
    const stateFilter = TAB_STATES[tab];
    let filtered = items;
    if (stateFilter) {
      filtered = filtered.filter(i => stateFilter.includes(i.reviewState));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(i => i.description.toLowerCase().includes(q));
    }
    return filtered;
  }

  const visibleItems = filterItems(activeTab);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por descrição..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        <TabsList className="mx-3 mt-2 shrink-0">
          <TabsTrigger value="all"      className="text-xs">Todos</TabsTrigger>
          <TabsTrigger value="awaiting" className="text-xs">Aguardando</TabsTrigger>
          <TabsTrigger value="approved" className="text-xs">Aprovados</TabsTrigger>
          <TabsTrigger value="rejected" className="text-xs">Rejeitados</TabsTrigger>
          <TabsTrigger value="other"    className="text-xs">Outros</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="flex-1 overflow-y-auto mt-0 p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-sm">Nenhum item encontrado</p>
            </div>
          ) : (
            <div className="divide-y">
              {visibleItems.map(item => (
                <ReviewQueueItem
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  checked={checkedIds.has(item.id)}
                  onSelect={onSelect}
                  onCheckboxChange={onCheckboxChange}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
