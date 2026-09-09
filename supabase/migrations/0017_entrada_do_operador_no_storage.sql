-- Entrada do operador no bucket `gerados`: a tela guarda em
-- `{servico}/entrada/` a imagem de satélite (do imóvel e a de cada gleba) e o
-- PDF do SIGEF, para que a geração seguinte não precise pedir tudo de novo.
--
-- O bucket nasceu (0001) só com policy de SELECT para `authenticated`: todo
-- upload da tela morria em RLS. O erro virava um aviso discreto na tela e o
-- resto do fluxo seguia com o arquivo que estava na memória da sessão — por
-- isso ninguém percebeu. Quem pagou foi a planta A3 das glebas: ela NÃO recebe
-- imagem pelo corpo da chamada, o servidor a busca em
-- `entrada/satelite-gleba-{k}`, não achava nada e caía na imagem do imóvel
-- inteiro. A pasta `entrada/` estava vazia no projeto todo.
--
-- Os documentos gerados continuam fora do alcance do cliente: quem escreve
-- neles é a service_role das edge functions. O cliente só mexe em `entrada/`.
create policy entrada_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'gerados' and (storage.foldername(name))[2] = 'entrada');
create policy entrada_update on storage.objects for update to authenticated
  using (bucket_id = 'gerados' and (storage.foldername(name))[2] = 'entrada')
  with check (bucket_id = 'gerados' and (storage.foldername(name))[2] = 'entrada');
create policy entrada_delete on storage.objects for delete to authenticated
  using (bucket_id = 'gerados' and (storage.foldername(name))[2] = 'entrada');
