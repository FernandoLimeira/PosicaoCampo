# Login e sessões

O login utiliza as contas existentes em `data/usuarios.db`. O formulário
envia o nome e a senha para `POST /api/auth/login`; o servidor valida o hash
PBKDF2, verifica se a conta está ativa e cria uma sessão com token aleatório.
Somente o hash desse token é armazenado na tabela `sessions`.
As respostas não incluem hashes de senha nem tokens no corpo JSON.

Não há conta demonstrativa, autenticação apenas no frontend ou cadastro
público. Somente administradores gerenciam contas; o cadastro web cria apenas
Coordenadores e Analistas. A API rejeita a criação de Administradores, que
continua disponível no utilitário local `python -m backend.create_admin`.
Cada administrador vê somente a própria conta administrativa e os usuários
não administradores. Outras contas administrativas não são retornadas na
listagem nem podem ser alteradas por ID direto. Os detalhes de perfil, unidade
base, email e ativação estão em [databases.md](databases.md).

## Lembrar de mim

- Desmarcado: cookie de sessão, sem `Max-Age` ou `Expires`, com validade
  máxima de 12 horas verificada no servidor.
- Marcado: cookie persistente com `Max-Age=2592000`, correspondendo a uma
  sessão de até 30 dias no servidor. A validade é fixa, não renovada em cada acesso.

Os prazos são `SESSION_TTL_SECONDS` e `REMEMBER_SESSION_TTL_SECONDS` em
`backend/config.py`. Alterá-los afeta sessões criadas após a atualização.
As sessões existentes mantêm sua expiração, sem alterações no schema.

O aplicativo não armazena senhas, tokens ou dados de login em `localStorage`
ou `sessionStorage`. Os cookies usam `HttpOnly` e `SameSite=Strict`, além de
`Secure` nas requisições HTTPS, inclusive quando o proxy informa HTTPS.
Em HTTP local, `Secure` não é usado para permitir o desenvolvimento.
Na publicação, utilize HTTPS.

Alguns navegadores restauram cookies de sessão ao reabrir janelas. Portanto,
fechar o navegador não garante logout; o limite no servidor sempre se aplica.
Essa distinção entre cookies de sessão e persistentes está documentada na
[referência de Set-Cookie da MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

Use “Lembrar de mim” somente em dispositivos pessoais. “Sair” apaga a sessão
no banco e limpa o cookie. Ao fazer um novo login no mesmo navegador, o token
anterior é substituído; isso não encerra sessões de outros dispositivos.
Desativar uma conta, excluí-la ou redefinir sua senha revoga suas sessões,
inclusive as de 30 dias. A criação de sessão verifica novamente se a conta
está ativa dentro da transação.

## Mostrar senha

O botão de olho alterna o campo entre `password` e `text`, sem modificar o
valor digitado. É um botão separado do envio do formulário, acessível pelo
teclado e com rótulos “Mostrar senha”/“Ocultar senha” e `aria-pressed`.
A senha volta a ser ocultada quando o formulário é enviado.

## Execução e publicação

Na raiz do projeto:

```powershell
& '.\.venv\Scripts\python.exe' run.py --host 127.0.0.1 --port 8000
```

O iniciador local agora é `run.py`. O PythonAnywhere continua usando
`from backend.app import application`, com o caminho da raiz do projeto
configurado no WSGI. Publique os arquivos alterados e recarregue a aplicação
na aba Web. Não substitua as bases existentes ao publicar.

## Validação

```powershell
& '.\.venv\Scripts\python.exe' -m unittest discover -s tests -v
node tests/test_login.js
```

Os testes verificam credenciais, cookies normais e persistentes, expiração,
tokens falsos, logout, rotação, desativação, redefinição de senha, acesso
administrativo e bloqueio de origem diferente, usando bancos temporários.
O teste JavaScript cobre o olho, o envio da opção e mensagens de erro.
