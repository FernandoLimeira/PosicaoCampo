# Visual da tela de login

O layout foi implementado em `templates/login.html` e `static/css/auth.css`
seguindo a imagem de referência fornecida pelo usuário: painel claro com
folha discreta, campos com ícones, botão verde e fotografia rural à direita.
Os textos e controles são HTML, não uma imagem da interface. A foto é pública
para carregar antes da autenticação; o acesso às páginas do sistema continua
protegido. O menu autenticado utiliza o tema verde sóbrio compartilhado em
`static/css/base.css`; sua organização atual está em [frontend.md](frontend.md).

## Imagem de fundo

- Arquivo do projeto: `static/assets/login-field-sunrise-v1.png`.
- Modo: ferramenta integrada `image_gen`, usando a habilidade `imagegen`.
- Origem: paisagem recriada a partir da parte fotográfica da referência;
  não representa uma foto verificada de uma propriedade ou unidade real.
- Não contém texto, botões ou outros elementos da interface.

Prompt final utilizado:

```text
Use case: photorealistic-natural. Asset type: background-only photo for a real login page. Input image 1 is a visual reference, not a UI to reproduce. Recreate ONLY the photographic rural landscape visible on the right of the supplied reference, expanding it to fill the entire image. A realistic Brazilian green agricultural landscape at sunrise, rolling cultivated hills with coherent rows of sugarcane, slender green cane leaves with morning dew in the foreground, distant trees and mist between hills, pale teal sky with small clouds, warm golden sun toward the upper right above the hills. Match the reference's calm natural color, lighting, depth and composition closely. Landscape 4:3 composition, with the lower left filled with natural darker foliage, usable for a later HTML title. Real agricultural photography, not vector illustration, not painterly. Absolutely no UI, white panels, text, typography, logos, icons, buttons, geometric lines, decorative overlays or watermark anywhere. Produce only the landscape photo; all interface content will be built separately in HTML.
```

## Atualização

Reinicie o servidor local após publicar os novos arquivos, ou recarregue os
workers na aba Web do PythonAnywhere. Isso atualiza a lista de imagens públicas
e a versão dos recursos estáticos. Não substitua os bancos ao publicar.
