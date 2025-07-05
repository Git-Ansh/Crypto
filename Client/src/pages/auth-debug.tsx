import { useEffect, useState } from "react";
import { runAuthDiagnostics } from "../lib/auth-debug";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/ui/loading";

export default function AuthDebugPage() {
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRunDiagnostics() {
    setLoading(true);
    setError(null);
    try {
      const diagnosticResults = await runAuthDiagnostics();
      setResults(diagnosticResults);
    } catch (err: any) {
      setError(err.message || "An error occurred running diagnostics");
    } finally {
      setLoading(false);
    }
  }

  // Check current localStorage token
  const currentToken = localStorage.getItem("auth_token");
  const tokenPreview = currentToken
    ? `${currentToken.substring(0, 20)}...`
    : "No token found";

  return (
    <div className="container mx-auto py-8">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Authentication Debug Page</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-medium">Current Token:</h3>
              <pre className="bg-secondary p-4 rounded-md overflow-x-auto mt-2">
                {tokenPreview}
              </pre>
            </div>

            <Button onClick={handleRunDiagnostics} disabled={loading}>
              {loading ? (
                <div className="flex items-center">
                  <LoadingSpinner size="sm" className="mr-2" />
                  Running Diagnostics...
                </div>
              ) : (
                "Run Auth Diagnostics"
              )}
            </Button>

            {error && (
              <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {results && (
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Diagnostic Results:</h3>
                <div className="grid gap-4">
                  {Object.entries(results).map(
                    ([test, result]: [string, any]) => (
                      <Card key={test}>
                        <CardHeader>
                          <CardTitle
                            className={
                              result.success ? "text-green-500" : "text-red-500"
                            }
                          >
                            {test}: {result.success ? "SUCCESS" : "FAILED"}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <pre className="bg-secondary p-4 rounded-md overflow-x-auto">
                            {JSON.stringify(result, null, 2)}
                          </pre>
                        </CardContent>
                      </Card>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
