import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModeToggle } from "@/components/mode-toggle";
import { Eye, EyeOff } from "lucide-react";
import { signInWithGoogle } from "@/lib/auth";
import { loginUser, verifyGoogleAuth } from "@/lib/api";
import { useNavigate, NavigateFunction } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";

// Custom hook to safely use navigate
const useSafeNavigate = (): NavigateFunction | ((path: string) => void) => {
  try {
    // Try to use the real navigate hook
    return useNavigate();
  } catch (e) {
    // If it fails, return a fallback function
    return (path: string) => {
      console.warn("Navigation attempted outside Router context:", path);
      window.location.href = path; // Fallback to basic navigation
    };
  }
};

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState({
    google: false,
    email: false,
  });
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const navigate = useSafeNavigate();
  const { toast } = useToast();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [id]: value,
    }));
    if (error) setError("");
  };

  // Handle form submission for email/password login
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading((prev) => ({ ...prev, email: true }));
    setError("");

    try {
      const result = await loginUser(formData.email, formData.password);

      if (result.success) {
        toast("Login successful. Redirecting to dashboard...");
        navigate("/dashboard");
      } else {
        setError(result.message || "Login failed");
      }
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading((prev) => ({ ...prev, email: false }));
    }
  };

  // Handle Google Sign-in
  const handleGoogleSignIn = async () => {
    setLoading((prev) => ({ ...prev, google: true }));
    try {
      const result = await signInWithGoogle();
      if (result.success && result.user) {
        // Add null check for result.user
        // Now that we have Firebase auth, send the token to our backend
        const idToken = await result.user.getIdToken();

        // Make sure we're using the correct API URL - no undefined in path
        const apiUrl = "https://api.crypto-pilot.dev/"; // Or your actual backend URL
        const response = await fetch(`${apiUrl}/api/auth/google-verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ idToken }),
        });

        const backendResult = await response.json();

        if (backendResult.success) {
          toast("Login successful. Redirecting to dashboard...");
          navigate("/dashboard");
        } else {
          setError(backendResult.message || "Server verification failed");
        }
      }
    } catch (error: any) {
      console.error("Google sign-in failed:", error);
      setError(error.message || "Google sign-in failed");
    } finally {
      setLoading((prev) => ({ ...prev, google: false }));
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="absolute top-2 right-2">
        <ModeToggle />
      </div>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Welcome back</CardTitle>
          <CardDescription>Login with Google or email</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-6">
              {/* Google Sign In */}
              <div className="flex flex-col gap-4">
                <Button
                  variant="outline"
                  className="w-full bg-white text-gray-900 dark:bg-gray-700 dark:text-gray-100"
                  onClick={handleGoogleSignIn}
                  disabled={loading.google || loading.email}
                  type="button"
                >
                  {loading.google ? (
                    <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      className="mr-2 h-5 w-5"
                    >
                      <path
                        d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                        fill="currentColor"
                      />
                    </svg>
                  )}
                  Login with Google
                </Button>
              </div>

              <div className="after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
                <span className="bg-background text-muted-foreground relative z-10 px-2">
                  Or continue with
                </span>
              </div>

              {/* Email/Password Fields */}
              <div className="grid gap-6">
                {error && (
                  <div className="text-red-500 text-sm p-2 bg-red-50 dark:bg-red-900/20 rounded-md">
                    {error}
                  </div>
                )}
                <div className="grid gap-3">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@example.com"
                    required
                    value={formData.email}
                    onChange={handleInputChange}
                  />
                </div>

                <div className="grid gap-3">
                  <div className="flex items-center">
                    <Label htmlFor="password">Password</Label>
                    <a
                      href="#"
                      className="ml-auto text-sm underline-offset-4 hover:underline"
                    >
                      Forgot your password?
                    </a>
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      required
                      value={formData.password}
                      onChange={handleInputChange}
                    />
                    <div
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-0 top-0 flex h-full cursor-pointer items-center px-3"
                      tabIndex={0}
                      role="button"
                      aria-pressed={showPassword}
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading.email || loading.google}
                >
                  {loading.email ? (
                    <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : null}
                  Login
                </Button>
              </div>

              <div className="text-center text-sm">
                Don&apos;t have an account?{" "}
                <a href="/register" className="underline underline-offset-4">
                  Sign up
                </a>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
      <div className="text-muted-foreground *:[a]:hover:text-primary text-center text-xs text-balance *:[a]:underline *:[a]:underline-offset-4">
        By clicking continue, you agree to our <a href="#">Terms of Service</a>{" "}
        and <a href="#">Privacy Policy</a>.
      </div>
    </div>
  );
}
