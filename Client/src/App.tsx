import { ThemeProvider } from "@/components/theme-provider"
import { type ReactNode } from "react"
import { LoginForm } from "@/components/login-form"
import Dashboard  from "@/components/dashboard"

function App({ children }: { children?: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <div className="flex min-h-screen w-screen items-center justify-center">
        {/* <LoginForm /> */}
        <Dashboard />
      </div>
      {children}
    </ThemeProvider>
  )
}

export default App