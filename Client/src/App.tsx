import React from "react";
import { AppRouter } from "./router";
import { useLocation } from "react-router-dom";

const App: React.FC = () => {
  const location = useLocation();
  // Return AppRouter without any wrapper divs
  return <AppRouter />;
};

export default App;
