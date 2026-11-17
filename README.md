# PokeIdle - Compra automática

Extensão do Chrome que **repõe sozinha o estoque de pokebolas, poções e revives** no Market do NPC do [PokeIdle](https://pokeidle.io), para o farm não parar por falta de item.

> Projeto não oficial, sem ligação com os criadores do PokeIdle. Os Termos de Uso do jogo permitem automações; as regras de conduta valem para quem joga na mão e para quem usa extensão.

## O que ela faz

- Mostra um painel **"Compra automática"** logo abaixo das **Automações**.
- Para cada item que você adicionar, você define: **"se tiver menos de X, comprar Y"**.
- Quando o estoque cai abaixo do mínimo, ela abre o Market, escolhe a categoria, põe a quantidade e clica em **Comprar** — exatamente o que você faria. A janela do Market fica escondida enquanto ela trabalha e é fechada no fim.
- Só gasta **Coins** do jogo, no **Market do NPC**. Não mexe em Gemas, Diamantes nem no Mercado da Comunidade.

## Travas de segurança

Ela **começa desligada**. Depois de ligar, estas regras valem sempre:

| Trava | O que faz |
|---|---|
| **Reserva de Coins** | nunca gasta se o saldo ficar abaixo desse valor (padrão 1.000.000) |
| **Limite por hora** | teto de Coins gastos nos últimos 60 minutos (padrão 10.000.000) |
| **Confirmação** | depois de cada compra confere se o estoque subiu; se não subiu, **pausa sozinha** |
| **Respiro** | espera 15 s entre uma compra e outra |
| **Só quando livre** | não age com outra janela aberta nem enquanto você digita |
| **Item indisponível** | se o item não é vendido por Coins (ex.: Beast Ball), ela o desativa |

Cada compra é de no máximo **9.999** unidades (o limite do próprio jogo).

## Instalar (modo desenvolvedor)

1. Baixe ou clone este repositório.
2. Abra `chrome://extensions` e ligue o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta.
4. Abra o jogo. O painel aparece abaixo das Automações.

## Como usar

1. Em **+ adicionar item…**, escolha o que quer manter em estoque (as opções vêm do painel Automações).
2. Ajuste **Se <** (estoque mínimo) e **Comprar** (quantidade de cada compra).
3. Confira a **Reserva de Coins** e o **Limite por hora**.
4. Ligue o **On/Off** do topo do painel.

Exemplo: Ultra Ball com "Se < 1.000" e "Comprar 5.000" repõe 5.000 bolas toda vez que o estoque cair abaixo de 1.000.

## Segurança

Nada está escondido: o código é este repositório (um arquivo, `content.js`).

- Roda **somente** em `pokeidle.io`.
- **Não faz requisições de rede.** Não há `fetch`, `XMLHttpRequest`, `WebSocket` nem scripts remotos.
- **Não pede nenhuma permissão** da API do Chrome (o `manifest.json` não tem `permissions`).
- Não lê senhas, chat, inventário de outros jogadores nem dados da conta. Lê só o saldo de Coins, o estoque do painel Automações e o preço do Market.
- Guarda no `localStorage` do navegador apenas as suas configurações e o histórico de gasto das últimas 24 horas.
- A única ação que ela faz no jogo é clicar nos botões do Market do NPC para **comprar itens com Coins**.

## Como funciona (para quem quer conferir)

1. A cada 5 s lê o estoque nos chips do painel Automações (`#auto-ball-opts`, `#auto-potion-opts`, `#auto-revive-opts`).
2. Se algum item ativo está abaixo do mínimo e as travas permitem, abre o Market (`button[data-modal="market"]`), vai à aba Comprar e à categoria certa, acha o cartão pelo nome, lê o preço, calcula a quantidade respeitando reserva e limite, preenche o campo e clica em Comprar.
3. Espera o estoque subir para confirmar e fecha o modal (`#modal-fechar`).

## Limitações

- Se o jogo mudar o desenho do Market ou do painel Automações, a extensão pode parar de achar os botões. Nesse caso ela **pausa e avisa**, em vez de insistir.
- Só vê os itens que aparecem nos chips do painel Automações (as bolas e até 10 poções e revives).
- Foi testada em uma página que imita o jogo e ainda não em uma conta de verdade. Comece com valores pequenos.
