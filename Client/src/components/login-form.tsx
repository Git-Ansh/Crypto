import { useState, useEffect } from "react";
import { cn } from "@/lib/utils"; // Remove config from this import
import { config } from "@/lib/config"; // Add this separate import
import { Button } from "@/components/ui/button";
import {
  useNavigate as useReactRouterNavigate,
  useLocation,
} from "react-router-dom";
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
import { useToast } from "@/components/ui/use-toast";
import { useAuth, syncAuthState } from "@/contexts/AuthContext";

// Safe navigation hook that falls back to window.location if Router context is missing
const useNavigate = () => {
  try {
    // Try to use the real navigate hook
    return useReactRouterNavigate();
  } catch (e) {
    // If Router context is missing, provide a fallback that matches React Router's signature
    console.warn("Router context not found. Using fallback navigation.");
    return (path: string, options?: { replace?: boolean; state?: any }) => {
      // In a real app, you might want to handle the state somehow
      window.location.href = path;
    };
  }
};

// Safe location hook
const useSafeLocation = () => {
  try {
    return useLocation();
  } catch (e) {
    console.warn("Router context not found. Using empty location object.");
    return { state: {} };
  }
};

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  // Add effect to redirect authenticated users
  useEffect(() => {
    if (user && !loading) {
      console.log("User already authenticated, redirecting to dashboard");
      navigate("/dashboard", { replace: true });
    }
  }, [user, loading, navigate]);

  // Show loading state while checking auth
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  // If not loading and user is not authenticated, show login form
  if (!user) {
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
    const [showSignupPrompt, setShowSignupPrompt] = useState(false);

    // Use safe versions of hooks
    const location = useSafeLocation();
    const { toast } = useToast();

    // Get auth context - wrap in try/catch in case it's rendered outside AuthProvider
    const auth = (() => {
      try {
        return useAuth();
      } catch (e) {
        console.warn("Auth context not found. Using mock implementation.");
        return {
          setUser: (user: any) => console.log("Would set user:", user),
          user: null,
        };
      }
    })();
    const { setUser } = auth;

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
      setError("");
      setShowSignupPrompt(false);
      setLoading((prev) => ({ ...prev, email: true }));

      try {
        console.log("Submitting login form:", formData.email);
        const result = await loginUser(formData.email, formData.password);
        console.log("Login result:", result);

        if (result.success) {
          console.log("Login successful, processing user data...");
          console.log("Full result:", result);
          console.log("result.data:", result.data);
          console.log("result.data.data:", result.data?.data);
          console.log("result.data.data.user:", result.data?.data?.user);

          // Set user in context - handle double-nested response
          let userData = null;
          if (result.data?.data?.user) {
            userData = result.data.data.user;
            console.log("Using result.data.data.user:", userData);
          } else if (result.data?.user) {
            userData = result.data.user;
            console.log("Using result.data.user:", userData);
          } else if (result.data?.data) {
            userData = result.data.data;
            console.log("Using result.data.data:", userData);
          } else {
            console.error("No user data found in response!");
          }

          if (userData) {
            console.log("Setting user in context:", userData);
            setUser(userData);
          }

          // Navigate to dashboard
          const from = location.state?.from?.pathname || "/dashboard";
          navigate(from, { replace: true });
        } else {
          // Extract error message
          const errorMsg =
            typeof result.error === "string" ? result.error : "Login failed";

          console.log("Login error message:", errorMsg);

          // Check for "user does not exist" message
          if (
            errorMsg.includes("User does not exist") ||
            errorMsg.includes("sign up")
          ) {
            setShowSignupPrompt(true);
          }

          setError(errorMsg);
        }
      } catch (err: any) {
        console.error("Login exception:", err);
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
        console.log("Google sign-in result:", result);

        if (result.success && result.user) {
          // Get the Firebase ID token
          const idToken = await result.user.getIdToken();
          console.log("Firebase ID token obtained");

          // Send token to our backend for verification
          const backendResult = await verifyGoogleAuth(idToken);
          console.log("Backend verification result:", backendResult);

          if (backendResult.success) {
            toast("Login successful");

            // Format user data consistently
            const userData = backendResult.data || {};
            console.log("User data from backend:", userData);

            const googleUser = {
              id: userData.id || userData._id || result.user.uid,
              name: userData.name || result.user.displayName || "Google User",
              email: userData.email || result.user.email,
              avatar: userData.avatar || result.user.photoURL,
            };
            console.log("Formatted user data:", googleUser);

            // If no token was found in the response, use the Firebase ID token
            if (!localStorage.getItem("auth_token")) {
              console.log(
                "No token in localStorage, using Firebase ID token as fallback"
              );
              localStorage.setItem("auth_token", idToken);
            }

            // Update auth context
            setUser(googleUser);

            // Navigate to dashboard
            const from = location.state?.from?.pathname || "/dashboard";
            navigate(from, { replace: true });
          } else {
            // Handle error
            setError(
              backendResult.error instanceof Error
                ? backendResult.error.message
                : typeof backendResult.error === "string"
                ? backendResult.error
                : "Server verification failed"
            );
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
      <div className="relative min-h-screen w-full">
        {/* Mode toggle with responsive positioning */}
        <div className="mode-toggle-container">
          <ModeToggle />
        </div>

        <div className="flex min-h-screen items-center justify-center p-4">
          <div className="w-[400px] max-w-[95%]">
            <h1 className="crypto-dashboard-title text-4xl sm:text-6xl md:text-7xl text-center mb-8">
              CRYPTO PILOT
            </h1>

            <Card className="w-full">
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
                      <a
                        href="/register"
                        className="underline underline-offset-4"
                        onClick={(e) => {
                          e.preventDefault();
                          navigate("/register");
                        }}
                      >
                        Sign up
                      </a>
                    </div>
                  </div>
                </form>
              </CardContent>
            </Card>
            <div className="text-muted-foreground mt-4 text-center text-xs text-balance *:[a]:underline *:[a]:underline-offset-4 *:[a]:hover:text-primary">
              By clicking continue, you agree to our{" "}
              <a href="#">Terms of Service</a> and{" "}
              <a href="#">Privacy Policy</a>.
            </div>
          </div>
        </div>
      </div>
    );
  }
}
