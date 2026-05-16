import { Check } from "lucide-react";

const LABELS = ["Dados Básicos", "Contratado", "Vigência"];

export function ContractStepper({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-between mb-8">
      {[1, 2, 3].map((s) => (
        <div key={s} className="flex items-center flex-1">
          <div
            className={`flex items-center justify-center w-10 h-10 rounded-full border-2 text-sm font-medium ${
              s < step
                ? "bg-primary border-primary text-primary-foreground"
                : s === step
                ? "border-primary text-primary"
                : "border-muted text-muted-foreground"
            }`}
          >
            {s < step ? <Check className="h-5 w-5" /> : s}
          </div>
          <span className={`ml-2 text-sm hidden sm:block ${s === step ? "font-semibold text-primary" : "text-muted-foreground"}`}>
            {LABELS[s - 1]}
          </span>
          {s < 3 && <div className={`flex-1 h-0.5 mx-2 ${s < step ? "bg-primary" : "bg-muted"}`} />}
        </div>
      ))}
    </div>
  );
}
