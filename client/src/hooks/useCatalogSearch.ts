import { trpc } from "@/lib/trpc";
import { useDebounce } from "./useDebounce";

export interface CatalogSearchResult {
  code: string;
  description: string;
  type: "material" | "service";
}

export function useCatalogSearch(query: string, organizationId: number) {
  const debouncedQuery = useDebounce(query, 400);

  const materialsQuery = trpc.catmat.searchMaterials.useQuery(
    { searchTerm: debouncedQuery, page: 1, pageSize: 10 },
    {
      enabled: debouncedQuery.trim().length >= 2 && organizationId > 0,
    },
  );

  const servicesQuery = trpc.catmat.searchServices.useQuery(
    { searchTerm: debouncedQuery, page: 1, pageSize: 10 },
    {
      enabled: debouncedQuery.trim().length >= 2 && organizationId > 0,
    },
  );

  const isLoading = materialsQuery.isLoading || servicesQuery.isLoading;
  const isError   = materialsQuery.isError || servicesQuery.isError;

  const materialResults: CatalogSearchResult[] = (materialsQuery.data?.items ?? []).map(
    (item: { codigoItem: number; descricaoItem: string }) => ({
      code:        String(item.codigoItem),
      description: item.descricaoItem,
      type:        "material" as const,
    }),
  );

  const serviceResults: CatalogSearchResult[] = (servicesQuery.data?.items ?? []).map(
    (item: { codigoItem: number; descricaoItem: string }) => ({
      code:        String(item.codigoItem),
      description: item.descricaoItem,
      type:        "service" as const,
    }),
  );

  return {
    data:      [...materialResults, ...serviceResults],
    isLoading,
    isError,
  };
}
