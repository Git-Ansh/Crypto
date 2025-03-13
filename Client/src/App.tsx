import React from "react";
import { AppRouter } from "./router";

const App: React.FC = () => {
  return (
    <div className="w-full h-full min-h-screen flex items-center justify-center">
      <AppRouter />
    </div>
  );
};

export default App;
