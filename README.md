# O Mundo da Laurinha

Experiência de histórias e brincadeiras para a Laurinha, feita para usar junto com um responsável. O site é público; o progresso fica no aparelho e a sincronização exige conta adulta autenticada. O projeto é uma PWA instalável, funciona sem internet depois do primeiro carregamento e oferece 20 brincadeiras sem cronômetro, pontuação, punição, publicidade ou rolagem infinita.

## Escopo implementado

1. **Como se sente o personagem?** — conversar sobre sentimentos sem resposta única.
2. **Vamos construir juntos** — criar com formas e combinar turnos.
3. **Eu escolho, eu tento** — fazer escolhas simples e mudar de ideia.
4. **Pequenas rotinas** — ordenar ações de uma rotina cotidiana.
5. **Meu corpo conta histórias** — experimentar gestos e movimentos confortáveis.
6. **Caminhos da Laurinha** — explorar posições e trajetos.
7. **Ateliê de mãos** — desenhar livremente com toque, mouse ou caneta.
8. **Cadê esta cor?** — procurar e nomear cores.
9. **Orquestra de objetos** — tocar sons sintetizados, suaves e iniciados pela criança.
10. **Formas que viram coisas** — combinar formas sem gabarito.
11. **O livro que conversa** — escolher caminhos de uma história.
12. **O que está acontecendo?** — observar e imaginar possibilidades.
13. **Sons que rimam** — ouvir palavras que rimam.
14. **Invente uma história** — imaginar personagens e lugares.
15. **Cestas curiosas** — agrupar por cor, tamanho ou forma.
16. **Mercadinho de brinquedo** — montar cestas de faz de conta sem exigir numerais.
17. **Antes e depois** — conversar sobre sequências curtas.
18. **Pequenos cientistas** — observar fenômenos simples com um adulto.
19. **Lembra e combina** — repetir uma sequência de três sons/imagens sem cobrança.
20. **Siga, pare e invente** — imaginar música, movimento e pausa em espaço seguro.

## Produto e arquitetura

- **Frontend:** Vue 3, TypeScript e Vite.
- **Instalação/offline:** `vite-plugin-pwa` e Workbox; arquivos de interface e imagens são pré-armazenados. Progresso fica salvo no aparelho e pode ser usado offline.
- **Ajuda de instalação:** o botão inicia o prompt nativo quando o navegador oferece essa função; em navegadores sem prompt, mostra instruções para iOS, Android e computador.
- **Área adulta:** conta autenticada no Cloudflare Worker. A primeira conta precisa do segredo `LAURINHA_SETUP_TOKEN`, cadastrado como segredo do Worker. Cadastro aberto fica bloqueado depois da criação inicial. Senhas são armazenadas como HMAC-SHA-256 com salt por conta e um `PASSWORD_PEPPER` secreto; a recuperação invalida sessões anteriores.
- **Dados entre aparelhos:** Cloudflare Worker + Cloudflare D1. O proxy de `/api/*` do Netlify mantém a API na mesma origem do site para usar cookie `HttpOnly`, `SameSite=Lax`.
- **Dados persistidos:** somente ID do jogo, quantidade de conclusões, data da última brincadeira e estado/data da favorita. Desenhos, escolhas, respostas, nome completo, data de nascimento e histórico clínico não são enviados ao banco.
- **Conflitos offline:** conclusões usam o maior total dos aparelhos; favoritas usam o registro mais recente. Ao entrar, o aparelho combina o estado local e o remoto.
- **Privacidade:** nenhum analytics, anúncio, fonte remota ou mídia de terceiros. Áudio é sintetizado localmente e começa somente após toque.
- **Acessibilidade:** controles nativos, rótulos para leitores de tela, foco visível, contraste, estados de seleção e redução de movimento respeitada.

## Rodar localmente

Requer Node.js 22 ou superior.

```bash
npm install
npm run dev
```

Para testar o Worker com D1 local:

```bash
npm run cf:migrate:local
npm run cf:dev
```

O Vite encaminha `/api/*` para `http://127.0.0.1:8787`. Crie `.dev.vars` a partir de `.dev.vars.example` e defina dois valores aleatórios diferentes, longos, para `LAURINHA_SETUP_TOKEN` e `PASSWORD_PEPPER`. O arquivo real fica ignorado pelo Git.

## Validar antes do deploy

```bash
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

Os testes exercitam o catálogo de 20 brincadeiras, a combinação do progresso e as rotas de configuração, sessão, login, recuperação e sincronização do Worker com um adaptador D1 de teste em memória.

## Banco remoto criado

- Conta: conta Cloudflare conectada ao projeto.
- D1: `laurinha-db`.
- Binding: `DB`.
- ID: definido em `wrangler.jsonc`.
- Réplicas de leitura: desativadas; o app é pequeno e prioriza uma escrita simples e previsível.
- Migração inicial: `worker/migrations/0001_initial.sql`.

O banco remoto já recebeu a migração inicial e o Worker `mundo-da-laurinha-api` está publicado. O endpoint de saúde foi conferido; as rotas de conta dependem da configuração do primeiro acesso pela família.

## Configurar o primeiro acesso

1. A migração inicial já foi aplicada. Aplicar `npm run cf:migrate:remote` somente quando uma nova migração versionada for adicionada:

   ```bash
   npm run cf:migrate:remote
   ```

2. `APP_ORIGIN` já aponta para a origem Netlify do projeto, e os segredos `LAURINHA_SETUP_TOKEN` e `PASSWORD_PEPPER` já estão configurados no Worker. Nunca incluir seus valores em arquivo versionado:

   ```bash
   npx wrangler secret put LAURINHA_SETUP_TOKEN
   npx wrangler secret put PASSWORD_PEPPER
   ```

3. O proxy de `netlify.toml` aponta para `mundo-da-laurinha-api.dona-de-ouro-demo.workers.dev`; mantenha esse destino e `APP_ORIGIN` alinhados com a conta Cloudflare e o endereço Netlify do projeto.
4. Na área **Responsáveis**, a família cria a primeira conta com seu e-mail, uma senha-frase forte e o token de configuração fornecido separadamente. O token também é necessário para recuperar o acesso; trocar o pepper exige redefinir a senha. Não coloque credenciais da família no repositório.

## Publicação e manutenção

- O repositório `Salmeida-webdev/mundo-da-laurinha` permanece privado; a produção do site é pública e os previews permanecem privados.
- A branch `main` está conectada ao Netlify. Cada novo commit nessa branch inicia automaticamente um deploy de produção; agrupe e valide as alterações antes de enviar o commit.
- Execute `npm run typecheck`, `npm test` e `npm run build` localmente antes de atualizar `main`. Essas validações não iniciam um deploy Netlify.
- A política de segurança em `netlify.toml` restringe scripts ao próprio site (`script-src 'self'`), seguindo a configuração do Alpendre. Não remova essa diretiva sem revisar a segurança e confirmar que o selo da plataforma não voltou a aparecer.
- O service worker instala os recursos estáticos para uso offline depois da primeira visita. A conta adulta e a sincronização entre dispositivos exigem conexão com a API.
