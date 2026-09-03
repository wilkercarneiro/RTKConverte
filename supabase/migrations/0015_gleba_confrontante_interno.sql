-- Confrontante das divisas INTERNAS de uma gleba.
--
-- Na planilha SIGEF cada gleba é uma aba de perímetro própria (perimetro_1,
-- perimetro_2…), e cada vértice carrega o descritivo do confrontante do lado
-- que SAI dele. Os lados que acompanham o perímetro herdam o confrontante do
-- imóvel; o lado que fecha a gleba por dentro confronta com a gleba vizinha —
-- mesmo imóvel, mesmo proprietário. Nulo = texto automático
-- ("(MATR./CNS.) IMÓVEL - GLEBA VIZINHA\ PROPRIETÁRIO\ CPF"); preenchido = vale
-- o que o operador escreveu.
alter table glebas
  add column if not exists confrontante_interno text;

comment on column glebas.confrontante_interno is
  'Descritivo do confrontante nas divisas internas da gleba (o lado que fecha por dentro). Nulo = automático: a gleba vizinha do mesmo imóvel/proprietário.';
