import { Toaster as SonnerToaster } from "sonner";
import { useTheme } from "next-themes";

export function Toaster() {
  const { theme } = useTheme();

  return (
    <SonnerToaster
      position="bottom-right"
      theme={theme as "light" | "dark" | "system"}
      className="toaster-group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toast]:bg-background group-[.toast]:text-foreground group-[.toast]:border-border group-[.toast]:shadow-lg",
          title: "text-sm font-semibold",
          description: "text-sm opacity-90",
          actionButton:
            "bg-primary text-primary-foreground hover:bg-primary/90",
          cancelButton: "bg-muted text-muted-foreground hover:bg-muted/90",
          closeButton: "text-foreground/50 hover:text-foreground",
        },
      }}
    />
  );
}
