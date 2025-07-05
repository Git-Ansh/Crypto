import React from "react";

// Reusable loading spinner component with CryptoPilot branding
export const LoadingSpinner: React.FC<{
  size?: "sm" | "md" | "lg";
  className?: string;
}> = ({ size = "md", className = "" }) => {
  const sizeClasses = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-12 w-12",
  };

  return (
    <div className={`${sizeClasses[size]} ${className}`}>
      <div className="cryptopilot-spinner"></div>
    </div>
  );
};

// Full-screen loading component for authentication and page transitions
export const Loading: React.FC<{
  message?: string;
  size?: "sm" | "md" | "lg";
}> = ({ message = "Loading...", size = "lg" }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background">
      <div className="text-center">
        {/* CryptoPilot Logo with Alien Moon font */}
        <h1 className="crypto-dashboard-title text-4xl mb-8 text-foreground">
          Crypto Pilot
        </h1>

        {/* Loading Spinner */}
        <LoadingSpinner size={size} className="mx-auto mb-4" />

        {/* Loading Message */}
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
};

// Inline loading component for table rows and small sections
export const InlineLoading: React.FC<{
  message?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}> = ({ message = "Loading...", size = "sm", className = "" }) => {
  return (
    <div className={`flex items-center justify-center p-4 ${className}`}>
      <LoadingSpinner size={size} className="mr-2" />
      <span className="text-muted-foreground text-sm">{message}</span>
    </div>
  );
};

export default Loading;
