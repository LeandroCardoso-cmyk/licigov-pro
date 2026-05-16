import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

interface Props {
  expired: number;
  within30: number;
  within60: number;
  within90: number;
}

export function ContractAlertStats({ expired, within30, within60, within90 }: Props) {
  return (
    <div className="grid gap-6 md:grid-cols-4 mb-8">
      <Card className="border-destructive">
        <CardHeader className="pb-3">
          <CardDescription>Vencidos</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-destructive">{expired}</div>
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader className="pb-3">
          <CardDescription>Vencem em 30 dias</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-destructive">{within30}</div>
        </CardContent>
      </Card>

      <Card className="border-orange-500">
        <CardHeader className="pb-3">
          <CardDescription>Vencem em 60 dias</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-orange-500">{within60}</div>
        </CardContent>
      </Card>

      <Card className="border-yellow-500">
        <CardHeader className="pb-3">
          <CardDescription>Vencem em 90 dias</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-yellow-500">{within90}</div>
        </CardContent>
      </Card>
    </div>
  );
}
