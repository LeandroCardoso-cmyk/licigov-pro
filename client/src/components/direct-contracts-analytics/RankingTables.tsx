import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Scale } from "lucide-react";

interface Supplier {
  supplierName: string | null;
  supplierCNPJ?: string | null;
  totalValue: number | string;
  count: number;
}

interface Article {
  articleNumber: string | null;
  articleDescription: string | null;
  count: number;
}

interface Props {
  topSuppliers: Supplier[] | undefined;
  topArticles: Article[] | undefined;
  loadingSuppliers: boolean;
  loadingArticles: boolean;
}

export function RankingTables({ topSuppliers, topArticles, loadingSuppliers, loadingArticles }: Props) {
  const formatBRL = (value: number | string) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            <CardTitle>Top 5 Fornecedores</CardTitle>
          </div>
          <CardDescription>Fornecedores mais contratados</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingSuppliers ? (
            <p className="text-center text-gray-600">Carregando...</p>
          ) : topSuppliers && topSuppliers.length > 0 ? (
            <div className="space-y-4">
              {topSuppliers.map((supplier, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="font-medium">{supplier.supplierName}</p>
                    <p className="text-sm text-gray-600">{supplier.supplierCNPJ || "CNPJ não informado"}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatBRL(supplier.totalValue)}</p>
                    <p className="text-sm text-gray-600">{supplier.count} contratações</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-gray-600">Nenhum fornecedor encontrado</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            <CardTitle>Top 5 Artigos Legais</CardTitle>
          </div>
          <CardDescription>Artigos mais utilizados</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingArticles ? (
            <p className="text-center text-gray-600">Carregando...</p>
          ) : topArticles && topArticles.length > 0 ? (
            <div className="space-y-4">
              {topArticles.map((article, index) => (
                <div key={index} className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-medium">{article.articleNumber}</p>
                    <p className="text-sm text-gray-600 line-clamp-2">{article.articleDescription}</p>
                  </div>
                  <div className="text-right ml-4">
                    <p className="font-semibold">{article.count}</p>
                    <p className="text-sm text-gray-600">usos</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-gray-600">Nenhum artigo encontrado</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
