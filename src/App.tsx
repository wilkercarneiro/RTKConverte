import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { Login } from "./components/Login";
import { Upload, type ResultadoParse } from "./components/Upload";
import { Conferencia } from "./components/Conferencia";

export default function App() {
  const [logado, setLogado] = useState<boolean | null>(null);
  const [parse, setParse] = useState<ResultadoParse | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setLogado(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => setLogado(!!sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (logado === null) return <div className="centro">Carregando...</div>;
  if (!logado) return <Login onOk={() => setLogado(true)} />;
  if (!parse) return <Upload onParsed={setParse} />;
  return <Conferencia inicial={parse} onVoltar={() => setParse(null)} />;
}
