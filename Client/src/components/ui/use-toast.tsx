import { toast } from "sonner";

// Re-export the toast function directly from sonner
export { toast };

// Create a hook to maintain API compatibility with existing code
export function useToast() {
  return {
    toast,
    dismiss: toast.dismiss,
  };
}
