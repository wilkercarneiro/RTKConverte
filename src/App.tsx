import { useEffect, useState } from "react";
import { configOk, supabase } from "./lib/supabase";
import { Login } from "./components/Login";
import { Upload, type ResultadoParse } from "./components/Upload";
import { Conferencia } from "./components/Conferencia";

export default function App() {
  const [logado, setLogado] = useState<boolean | null>(null);
  const [parse, setParse] = useState<ResultadoParse | null>(null);

  useEffect(() => {
    if (!configOk) return;
    supabase.auth.getSession().then(({ data }) => setLogado(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => setLogado(!!sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!configOk) {
    return (
      <div className="centro">
        <div>
          <h2>Configuração ausente</h2>
          <p>Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no
            arquivo <code>.env</code> (ver <code>.env.example</code>) e reinicie o <code>npm run dev</code>.</p>
        </div>
      </div>
    );
  }
  if (logado === null) return <div className="centro">Carregando...</div>;
  if (!logado) return <Login onOk={() => setLogado(true)} />;
  if (!parse) return <Upload onParsed={setParse} />;
  return <Conferencia inicial={parse} onVoltar={() => setParse(null)} />;
}
