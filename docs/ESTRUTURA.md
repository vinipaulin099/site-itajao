# Estrutura de pastas do site Itajaó

Arquivos HTML que formam as páginas públicas ficam na raiz do repositório. Os arquivos auxiliares ficam separados por função.

```text
site-itajao/
├── index.html
├── produto.html
├── checkout.html
├── pedido.html
├── assets/
│   ├── images/
│   │   ├── brand/
│   │   ├── home/
│   │   ├── products/
│   │   └── testimonials/
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
- `assets/images/testimonials/`: fotos dos clientes dos depoimentos. O site já procura por `depoimento1.jpg`, `depoimento2.jpg` e `depoimento3.jpg` nesta pasta.
- `assets/js/`: JavaScript do checkout e configuração pública da loja.
- `docs/`: documentação que não é carregada pelo site.
- `supabase/functions/`: backend das integrações.
- `supabase/migrations/`: alterações de estrutura do banco.
- `supabase/sql/`: scripts SQL auxiliares, incluindo o cadastro da newsletter.

Não coloque senhas, tokens nem arquivos `.env` com credenciais reais no repositório.
