# Astro — Sua IA de trabalho

Chat estático do Astro, publicado no GitHub Pages, com login e integração à API em **https://ia.astro-app.sbs/**.

## Interface

- Login com e-mail e senha pela rota `POST /auth/login`.
- Conversas anteriores carregadas da API, com título, prévia, data e paginação por cursor.
- Nova conversa sem encerrar ou apagar as anteriores.
- Respostas Markdown sanitizadas, gráficos acessíveis, tabelas com paginação local, indicadores, fichas de usuário, contexto dos dados e PDFs temporários.
- Cópia de respostas, exportação da conversa em Markdown e cópia do UUID da sessão.
- Layout adaptado ao celular, acesso ao histórico e botão de sair em qualquer largura.

## Configuração

`public/config.js` define o endereço utilizado por todas as requisições:

```js
window.ASTRO_CONFIG = Object.freeze({
  apiBaseUrl: "https://ia.astro-app.sbs/",
  markdown: true,
  requestTimeoutMs: 120000,
  imageAllowedHosts: [],
});
```

Barras finais são normalizadas pelo cliente. Não coloque senhas, chaves ou tokens nesse arquivo.

Fotos aceitam apenas HTTPS em subdomínios R2 (`*.r2.cloudflarestorage.com` ou `*.r2.dev`) e hosts exatos adicionais declarados em `imageAllowedHosts`. Quando o host não é permitido, a foto não existe ou falha, aparece uma alternativa textual. URLs assinadas de fotos/PDFs não são persistidas no navegador nem incluídas na exportação estruturada.

## Contrato da API

Implementação alinhada à documentação do [astro-ai-api](https://github.com/Astro-Inter/astro-ai-api), consultada em 02/11/2026:

- [Sessões e histórico](https://github.com/Astro-Inter/astro-ai-api/blob/main/docs/integracao/sessoes-chatbot.md).
- [Blocos de resposta](https://github.com/Astro-Inter/astro-ai-api/blob/main/docs/integracao-graficos-chat.md).
- [Dados analíticos](https://github.com/Astro-Inter/astro-ai-api/blob/main/docs/contrato-dados-analiticos.md).
- [Arquivos PDF](https://github.com/Astro-Inter/astro-ai-api/blob/main/docs/arquivos-chat.md).

A primeira mensagem envia apenas `{ message }` para `POST /chat/messages?markdown=true`. O UUID retornado é usado nas continuações. A resposta utiliza `blocos` na ordem recebida, sem depender do antigo campo `resposta`; há compatibilidade com mensagens antigas via `content` no histórico.

`GET /sessions?limit=20` lista as conversas. O cursor opaco de `next_cursor` é usado para carregar mais, com deduplicação pelo UUID. `GET /sessions/{session_id}/messages` carrega mensagens e status. O histórico também é atualizado ao voltar para a aba.

Sessões legadas `encerrada` são retomadas por `POST /sessions/{session_id}/iniciar`, sem corpo, somente quando o usuário envia uma nova mensagem. Sessões `encerrando` permanecem disponíveis para leitura e exigem recuperação pelo suporte. A rota `/encerrar` foi removida da API e não é chamada pelo chat.

Tabelas v1/v2 e matrizes são divididas em páginas visuais de 10 linhas sem novas chamadas à IA. Contagem recebida/total e avisos de corte são preservados. Gráficos mostram título, unidade, fonte e os valores em texto; indicadores distinguem zero de percentual sem base. Tipos ou versões desconhecidos exibem um aviso sem descartar os demais blocos.

PDFs só abrem por ação do usuário, com estado disponível, URL HTTPS e prazo válido. O token da API não é enviado ao armazenamento. O cliente não gera, renova nem testa automaticamente essas URLs.

Falhas de rede e timeouts nunca repetem um envio automaticamente. Com UUID conhecido, o cliente consulta o histórico antes de liberar uma nova tentativa. Na primeira mensagem sem UUID, atualiza a lista para o usuário conferir se a conversa foi criada. O rascunho é preservado quando não há confirmação do recebimento.

## Executar localmente

Na raiz do projeto:

```bash
python -m http.server 4173 --directory public
```

Abra `http://localhost:4173`. O site não precisa de build nem de Node.js em produção.

## Testes

Com Node.js 22 ou superior:

```bash
npm ci --ignore-scripts
npm test
```

Os testes usam DOM e API simulados para validar criação/retomada de sessões, concorrência, autenticação expirada, recuperação após timeout, paginação, blocos, PDFs e sanitização. Não usam credenciais reais nem chamam a IA. A autenticação e o envio com uma conta real devem ser conferidos no ambiente publicado.

## Publicação

O workflow `.github/workflows/deploy-pages.yml` roda os testes e publica `public/` a cada push na `main`. Em **Settings → Pages**, a fonte deve ser **GitHub Actions**.

Site: [lucaslimaoliveira.github.io/astro-chat](https://lucaslimaoliveira.github.io/astro-chat/).

## Autenticação e CORS

O token fica apenas no `sessionStorage`, com prazo de validade, e é removido ao sair ou receber `401`. A senha não é persistida. Mensagens, fotos, PDFs e lista de conversas ficam apenas em memória; o histórico vem do backend autenticado. Sair limpa os dados da conta e cancela requisições pendentes.

A API precisa autorizar a origem `https://lucaslimaoliveira.github.io` e, para desenvolvimento, `http://localhost:4173`. O nome do repositório não faz parte da origem. O CORS do armazenamento de PDFs é independente do CORS da API.
