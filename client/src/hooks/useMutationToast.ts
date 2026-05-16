import { toast } from "sonner";

interface MutationToastOptions {
  successMessage: string;
  errorMessage?: string;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export function mutationToastCallbacks(options: MutationToastOptions) {
  return {
    onSuccess: () => {
      toast.success(options.successMessage);
      options.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(options.errorMessage ?? "Ocorreu um erro. Tente novamente.", {
        description: error.message,
      });
      options.onError?.(error);
    },
  };
}
