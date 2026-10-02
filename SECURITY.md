# Política de segurança

## Reportando uma vulnerabilidade

Não abra uma issue pública. Use o recurso **Report a vulnerability** da aba *Security* do repositório no GitHub (relato privado) e inclua passos para reproduzir e o impacto estimado.

Respondemos em até 7 dias corridos. Vulnerabilidades confirmadas são corrigidas antes da divulgação.

## Escopo e boas práticas deste projeto

- Segredos ficam apenas em variáveis de ambiente; o repositório contém só `.env.example` sem valores reais.
- Todos os dados do `seed` e das demonstrações são fictícios.
- Dados sensíveis são mascarados antes de qualquer chamada a um provedor de IA, e a IA nunca fecha chamados sozinha.
- O CI roda `gitleaks` e `npm audit`; o Dependabot mantém as dependências atualizadas.
