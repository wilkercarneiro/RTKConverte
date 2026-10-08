import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import { iniciarMonitoramento } from "./lib/monitoramento";

iniciarMonitoramento();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
