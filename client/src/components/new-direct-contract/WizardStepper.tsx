import { FileText, User, Building, Check } from "lucide-react";

const STEPS = [
  { number: 1, title: "Enquadramento Legal", Icon: FileText },
  { number: 2, title: "Dados da Contratação", Icon: Building },
  { number: 3, title: "Fornecedor", Icon: User },
  { number: 4, title: "Revisão", Icon: Check },
];

export function WizardStepper({ currentStep }: { currentStep: number }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        {STEPS.map((step, index) => {
          const isActive = currentStep === step.number;
          const isCompleted = currentStep > step.number;
          return (
            <div key={step.number} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    isCompleted
                      ? "bg-green-500 text-white"
                      : isActive
                      ? "bg-blue-500 text-white"
                      : "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                  }`}
                >
                  {isCompleted ? <Check className="w-6 h-6" /> : <step.Icon className="w-6 h-6" />}
                </div>
                <span
                  className={`text-sm mt-2 text-center ${
                    isActive ? "font-semibold text-blue-600 dark:text-blue-400" : "text-gray-600 dark:text-gray-400"
                  }`}
                >
                  {step.title}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div className={`flex-1 h-1 mx-4 ${isCompleted ? "bg-green-500" : "bg-gray-200 dark:bg-gray-700"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
