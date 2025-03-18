import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate, useLocation } from "react-router-dom";
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
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { signInWithGoogle } from "@/lib/auth";
import { verifyGoogleAuth } from "@/lib/api";

// Define a function to safely use location
const useSafeLocation = () => {
  try {
    return useLocation();
  } catch (e) {
    return { state: { from: { pathname: "/dashboard" } } };
  }
};

export function SignupForm() {
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState({
    email: false,
    google: false,
  });
  const [error, setError] = useState("");

  const navigate = useNavigate();
  const location = useSafeLocation();
  const { toast } = useToast();
  const { setUser } = useAuth();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [id]: value,
    }));
    if (error) setError("");
  };

  // Handle Google Sign-in
  const handleGoogleSignIn = async () => {
    setLoading((prev) => ({ ...prev, google: true }));
    try {
      const result = await signInWithGoogle();
      if (result.success && result.user) {
        // Get the Firebase ID token
        const idToken = await result.user.getIdToken();

        // Send token to our backend for verification
        const backendResult = await verifyGoogleAuth(idToken);

        if (backendResult.success) {
          toast("Registration successful");

          // Format user data consistently
          const userData = backendResult.data || {};
          const googleUser = {
            id: userData.id || userData._id || result.user.uid,
            name: userData.name || result.user.displayName || "Google User",
            email: userData.email || result.user.email,
            avatar: userData.avatar || result.user.photoURL,
          };

          // Update auth context
          setUser(googleUser);

          // Navigate to dashboard
          const from = location.state?.from?.pathname || "/dashboard";
          navigate(from, { replace: true });
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate form
    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (formData.password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading((prev) => ({ ...prev, email: true }));

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: formData.username,
          email: formData.email,
          password: formData.password,
        }),
        credentials: "include",
      });

      const result = await response.json();

      if (response.ok) {
        toast("Registration successful");
        navigate("/login");
      } else {
        setError(result.message || "Registration failed");
      }
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading((prev) => ({ ...prev, email: false }));
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
              <CardTitle className="text-xl">Create an account</CardTitle>
              <CardDescription>Sign up with Google or email</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit}>
                <div className="grid gap-6">
                  {error && (
                    <div className="text-red-500 text-sm p-2 bg-red-50 dark:bg-red-900/20 rounded-md">
                      {error}
                    </div>
                  )}

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
                      Sign up with Google
                    </Button>
                  </div>

                  <div className="after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
                    <span className="bg-background text-muted-foreground relative z-10 px-2">
                      Or continue with
                    </span>
                  </div>

                  <div className="grid gap-3">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      type="text"
                      placeholder="johndoe"
                      required
                      value={formData.username}
                      onChange={handleInputChange}
                    />
                  </div>

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
                    <Label htmlFor="password">Password</Label>
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

                  <div className="grid gap-3">
                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                    <div className="relative">
                      <Input
                        id="confirmPassword"
                        type={showPassword ? "text" : "password"}
                        required
                        value={formData.confirmPassword}
                        onChange={handleInputChange}
                      />
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
                    Sign Up
                  </Button>

                  <div className="text-center text-sm">
                    Already have an account?{" "}
                    <a
                      href="/login"
                      className="underline underline-offset-4"
                      onClick={(e) => {
                        e.preventDefault();
                        navigate("/login");
                      }}
                    >
                      Log in
                    </a>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
          <div className="text-muted-foreground mt-4 text-center text-xs text-balance *:[a]:underline *:[a]:underline-offset-4 *:[a]:hover:text-primary">
            By clicking continue, you agree to our{" "}
            <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.
          </div>
        </div>
      </div>
    </div>
  );
}
