# Astro — Chat de testes

Página estática para o grupo testar a API multiagente do Astro no Render.

## O que está pronto

- Login com e-mail e senha pela rota Firebase da API (`POST /auth/login`).
- Token guardado somente durante a aba do navegador (`sessionStorage`).
- Chat com sessão UUID, histórico local e respostas Markdown sanitizadas.
- Exibição da rota de agentes utilizada em cada resposta.
- Encerramento real pela rota `POST /sessions/{session_id}/encerrar`.
- Nova sessão criada automaticamente após finalizar uma conversa.
- Layout responsivo para computador e celular.
- Publicação automática no GitHub Pages por GitHub Actions.

## Configuração

A URL do Render já está em `public/config.js`:

```js
window.ASTRO_CONFIG = Object.freeze({
  apiBaseUrl: "https://astro-ai-api-qq6l.onrender.com",
  markdown: true,
});
```

Altere somente se o endereço da API mudar.

## Executar localmente

Não abra o HTML diretamente pelo explorador de arquivos. Na raiz deste projeto,
inicie um servidor estático:

```bash
python -m http.server 4173 --directory public
```

Depois, acesse `http://localhost:4173`.

## Publicar no GitHub Pages

1. Crie um repositório novo no GitHub.
2. Envie todo o conteúdo deste projeto para a branch `main`.
3. No repositório, abra **Settings → Pages**.
4. Em **Build and deployment → Source**, escolha **GitHub Actions**.
5. Abra a aba **Actions** e acompanhe o workflow **Publicar site no GitHub Pages**.
6. Ao concluir, o endereço público aparecerá no resumo da execução.

## Liberação de CORS no backend

Um navegador só permite que o GitHub Pages chame a API do Render se o backend
autorizar a origem do site. O projeto da IA não foi alterado por este pacote.

No FastAPI, registre `CORSMiddleware` antes dos routers e informe as origens usadas
nos testes. O endereço do GitHub Pages usa apenas o domínio como origem; o nome do
repositório não entra nessa lista.

```python
from fastapi.middleware.cors import CORSMiddleware

application.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4173",
        "https://astro-inter.github.io",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
```

Se o site usar domínio próprio, substitua ou acrescente esse domínio completo. Após
publicar o backend novamente, o login e o chat funcionarão normalmente no navegador.

## Segurança

- Não coloque credenciais Firebase, senhas ou tokens em `config.js`.
- A senha digitada não é persistida.
- O ID Token fica no `sessionStorage` e é apagado ao sair ou expirar.
- O Markdown retornado pela IA é sanitizado com DOMPurify antes de aparecer na tela.
- Mantenha o login da API habilitado apenas enquanto este ambiente de teste for necessário.
