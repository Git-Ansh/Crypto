import React from "react";
import { AppRoutes } from "./router";
import AuthDebugPage from "./pages/auth-debug";

// Remove the Router component since one already exists higher in the component tree
const App: React.FC = () => {
  return <AppRoutes authDebugPage={AuthDebugPage} />;
};

export default App;
