import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Search, X, Package, Wrench, Loader2 } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";

export interface CatmatItem {
  codigoItem: number;
  descricaoItem: string;
  unidadeFornecimento?: string;
  unidadeMedida?: string;
  codigoGrupo?: number;
  descricaoGrupo?: string;
  codigoClasse?: number;
  descricaoClasse?: string;
}

interface CatmatSearchProps {
  type: "material" | "service";
  onSelect: (item: CatmatItem) => void;
  selectedItems?: CatmatItem[];
  onRemove?: (item: CatmatItem) => void;
}

export function CatmatSearch({ type, onSelect, selectedItems = [], onRemove }: CatmatSearchProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [showResults, setShowResults] = useState(false);
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  const { data, isLoading, error } = type === "material"
    ? trpc.catmat.searchMaterials.useQuery(
        { searchTerm: debouncedSearchTerm, page: 1, pageSize: 10 },
        { enabled: debouncedSearchTerm.length >= 3 }
      )
    : trpc.catmat.searchServices.useQuery(
        { searchTerm: debouncedSearchTerm, page: 1, pageSize: 10 },
        { enabled: debouncedSearchTerm.length >= 3 }
      );

  useEffect(() => {
    if (debouncedSearchTerm.length >= 3) {
      setShowResults(true);
    } else {
      setShowResults(false);
    }
  }, [debouncedSearchTerm]);

  const handleSelect = (item: any) => {
    const catmatItem: CatmatItem = {
      codigoItem: item.codigoItem,
      descricaoItem: item.descricaoItem,
      unidadeFornecimento: item.unidadeFornecimento,
      unidadeMedida: item.unidadeMedida,
      codigoGrupo: item.codigoGrupo,
      descricaoGrupo: item.descricaoGrupo,
      codigoClasse: item.codigoClasse,
      descricaoClasse: item.descricaoClasse,
    };
    onSelect(catmatItem);
    setSearchTerm("");
    setShowResults(false);
  };

  const isItemSelected = (item: any) => {
    return selectedItems.some((selected) => selected.codigoItem === item.codigoItem);
  };

  return (
    <div className="space-y-4">
      {/* Campo de Busca */}
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder={
              type === "material"
                ? "Buscar material no CATMAT (ex: notebook, impressora...)"
                : "Buscar serviço no CATSER (ex: manutenção, limpeza...)"
            }
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-10"
          />
          {searchTerm && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
              onClick={() => {
                setSearchTerm("");
                setShowResults(false);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Resultados da Busca */}
        {showResults && (
          <Card className="absolute z-10 w-full mt-2 max-h-96 overflow-y-auto shadow-lg">
            {isLoading && (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="ml-2 text-sm text-muted-foreground">Buscando...</span>
              </div>
            )}

            {error && (
              <div className="p-4 text-sm text-destructive">
                Erro ao buscar itens. Tente novamente.
              </div>
            )}

            {!isLoading && !error && data?.data && data.data.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground text-center">
                Nenhum item encontrado. Tente outro termo de busca.
              </div>
            )}

            {!isLoading && !error && data?.data && data.data.length > 0 && (
              <div className="divide-y">
                {data.data.map((item: any) => {
                  const selected = isItemSelected(item);
                  return (
                    <button
                      key={item.codigoItem}
                      onClick={() => !selected && handleSelect(item)}
                      disabled={selected}
                      className={`w-full text-left p-4 hover:bg-accent transition-colors ${
                        selected ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-1">
                          {type === "material" ? (
                            <Package className="h-5 w-5 text-primary" />
                          ) : (
                            <Wrench className="h-5 w-5 text-primary" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="font-mono text-xs">
                              {item.codigoItem}
                            </Badge>
                            {selected && (
                              <Badge variant="secondary" className="text-xs">
                                Selecionado
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm font-medium leading-tight mb-1">
                            {item.descricaoItem}
                          </p>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            {item.descricaoGrupo && (
                              <span className="truncate">{item.descricaoGrupo}</span>
                            )}
                            {item.descricaoClasse && (
                              <span className="truncate">• {item.descricaoClasse}</span>
                            )}
                            {(item.unidadeFornecimento || item.unidadeMedida) && (
                              <span>
                                • Unidade: {item.unidadeFornecimento || item.unidadeMedida}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {!isLoading && !error && data?.totalItens && data.totalItens > 10 && (
              <div className="p-3 text-xs text-center text-muted-foreground border-t">
                Mostrando 10 de {data.totalItens} resultados. Refine sua busca para ver mais.
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Itens Selecionados */}
      {selectedItems.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Itens Selecionados ({selectedItems.length})
          </p>
          <div className="space-y-2">
            {selectedItems.map((item) => (
              <Card key={item.codigoItem} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="mt-1">
                    {type === "material" ? (
                      <Package className="h-4 w-4 text-primary" />
                    ) : (
                      <Wrench className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="font-mono text-xs">
                        {item.codigoItem}
                      </Badge>
                    </div>
                    <p className="text-sm leading-tight mb-1">{item.descricaoItem}</p>
                    <p className="text-xs text-muted-foreground">
                      Unidade: {item.unidadeFornecimento || item.unidadeMedida || "N/A"}
                    </p>
                  </div>
                  {onRemove && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemove(item)}
                      className="h-8 w-8 p-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Hint */}
      {searchTerm.length > 0 && searchTerm.length < 3 && (
        <p className="text-xs text-muted-foreground">
          Digite pelo menos 3 caracteres para buscar
        </p>
      )}
    </div>
  );
}
