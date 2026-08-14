# Estrutura de pastas do site Itajaó

Arquivos HTML que formam as páginas públicas ficam na raiz do repositório. Os arquivos auxiliares ficam separados por função.

```text
site-itajao/
├── index.html
├── produto.html
├── carrinho.html
├── checkout.html
├── pedido.html
├── comunidade.html
├── admin-comunidade.html
├── avaliar.html
├── cancelar-inscricao.html
├── assets/
│   ├── images/
│   │   ├── brand/
│   │   ├── home/
│   │   └── products/
│   ├── css/
│   │   └── community.css
│   └── js/
├── docs/
└── supabase/
    ├── functions/
    ├── migrations/
    └── sql/
```

## Onde cada arquivo deve ficar

- `assets/images/brand/`: logos e variações da identidade visual.
- `assets/images/home/`: imagens do carrossel e da seção Quem Somos.
- `assets/images/products/`: fotos das embalagens e produtos.
- `comunidade.html`: avaliações verificadas e receitas aprovadas.
- `admin-comunidade.html`: painel protegido para convites e moderação da comunidade; não faz parte da navegação pública.
- `avaliar.html`: formulário protegido por link e código do convite.
- `cancelar-inscricao.html`: confirmação de descadastro da newsletter.
- `assets/css/community.css`: estilos das páginas da comunidade.
- `assets/js/store.js`: catálogo público, carrinho persistente e estado da finalização.
- `assets/js/cart.js`: cupom, CEP, frete, recomendações e resumo do carrinho.
- `assets/js/checkout.js`: dados de cliente/endereço e criação do pagamento.
- `assets/js/`: também contém a configuração pública e os scripts de catálogo da home/produto.
- `docs/`: documentação que não é carregada pelo site.
- `supabase/functions/`: backend das integrações.
- `supabase/migrations/`: alterações de estrutura do banco.
- `supabase/sql/`: scripts SQL auxiliares, incluindo o cadastro da newsletter.

Não coloque senhas, tokens nem arquivos `.env` com credenciais reais no repositório.
