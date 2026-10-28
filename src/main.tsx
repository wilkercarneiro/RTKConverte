import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import "./ui.css";
import { iniciarMonitoramento } from "./lib/monitoramento";
import { VisualizadorPlantaHost } from "./components/planta/VisualizadorPlanta";

iniciarMonitoramento();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    {/* visualizador/editor de planta: qualquer tela abre com abrirPlanta() */}
    <VisualizadorPlantaHost />
  </React.StrictMode>,
);
