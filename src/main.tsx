import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import "./ui.css";
import { iniciarMonitoramento } from "./lib/monitoramento";
import { ligarGradesBalanceadas } from "./lib/grade";
import { VisualizadorPlantaHost } from "./components/planta/VisualizadorPlanta";
import { BarreiraErro } from "./components/BarreiraErro";

iniciarMonitoramento();
// nenhuma grade de formulário deixa um campo sozinho na última linha
ligarGradesBalanceadas();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* última rede: se até a casca (menu) falhar, sai um aviso, não a página em branco;
        cada tela ainda tem a sua barreira dentro do AppShell */}
    <BarreiraErro onde="o sistema">
      <App />
    </BarreiraErro>
    {/* visualizador/editor de planta: qualquer tela abre com abrirPlanta() */}
    <BarreiraErro onde="a planta" compacta>
      <VisualizadorPlantaHost />
    </BarreiraErro>
  </React.StrictMode>,
);
