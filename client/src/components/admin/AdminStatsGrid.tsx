import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, FileText, FileCheck, ScrollText } from "lucide-react";

interface Props {
  totalUsers: number;
  adminCount: number;
  totalProcesses: number;
  totalDirectContracts: number;
  activeContracts: number;
  expiredContracts: number;
}

interface StatCardProps {
  title: string;
  value: number;
  sub: string;
  Icon: React.ElementType;
  gradient: string;
}

function StatCard({ title, value, sub, Icon, gradient }: StatCardProps) {
  return (
    <Card className="border-2 hover:shadow-lg transition-shadow">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-gray-600">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <div className={`p-3 rounded-xl ${gradient} text-white`}>
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <p className="text-3xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-600">{sub}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminStatsGrid({ totalUsers, adminCount, totalProcesses, totalDirectContracts, activeContracts, expiredContracts }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <StatCard title="Total de Usuários" value={totalUsers} sub={`${adminCount} admins`} Icon={Users} gradient="bg-gradient-to-br from-blue-500 to-blue-600" />
      <StatCard title="Processos Licitatórios" value={totalProcesses} sub="Total de processos" Icon={FileText} gradient="bg-gradient-to-br from-purple-500 to-purple-600" />
      <StatCard title="Contratações Diretas" value={totalDirectContracts} sub="Dispensas e inexigibilidades" Icon={FileCheck} gradient="bg-gradient-to-br from-orange-500 to-orange-600" />
      <StatCard title="Contratos Vigentes" value={activeContracts} sub={`${expiredContracts} vencidos`} Icon={ScrollText} gradient="bg-gradient-to-br from-green-500 to-green-600" />
    </div>
  );
}
