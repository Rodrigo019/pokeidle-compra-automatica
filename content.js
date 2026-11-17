// PokeIdle - Compra automática
// Repõe sozinho o estoque de pokebolas, poções e revives no Market do NPC.
// Lê o estoque nos chips do painel "Automações" e compra clicando nos mesmos botões do Market que você
// clicaria (abre o Market, escolhe a categoria, põe a quantidade e clica em Comprar). Só gasta Coins do jogo.
// Não faz requisições de rede nem envia nada para fora do navegador. Começa DESLIGADA.
(() => {
  'use strict';
  if (window.__pokeidleCompraAuto) return;
  window.__pokeidleCompraAuto = true;

  // ---------- constantes ----------
  const CATEGORIAS = ['bolas', 'potions', 'revives']; // mesma ordem dos botões .mk-cat do Market
  const ROTULO_CAT = { bolas: 'Pokebola', potions: 'Poção', revives: 'Revive' };
  const GRUPOS_ESTOQUE = [
    ['#auto-ball-opts', 'bolas'],
    ['#auto-potion-opts', 'potions'],
    ['#auto-revive-opts', 'revives'],
  ];
  const INTERVALO_MS = 5000; // com que frequência confere o estoque
  const ESPERA_ENTRE_COMPRAS_MS = 15000; // respiro entre uma compra e a seguinte
  const BLOQUEIO_LIMITE_MS = 60000; // se bateu reserva/limite, só tenta de novo depois disso
  const MAX_POR_COMPRA = 9999; // o jogo não deixa comprar mais que isso de uma vez
  const RESERVA_PADRAO = 1_000_000;
  const LIMITE_HORA_PADRAO = 10_000_000;

  // ---------- util ----------
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (n) => Math.round(n).toLocaleString('pt-BR');
  const parseNum = (s) => {
    const n = Number(String(s ?? '').replace(/[^\d]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const guardar = (k, v) => { try { localStorage.setItem('pxca-' + k, JSON.stringify(v)); } catch { /* sem storage: ignora */ } };
  const ler = (k, padrao) => {
    try {
      const v = localStorage.getItem('pxca-' + k);
      return v == null ? padrao : JSON.parse(v);
    } catch { return padrao; }
  };
  async function esperar(fn, ms = 3000, passo = 100) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > ms) return null;
      await dormir(passo);
    }
  }
  const hora = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // ---------- configuração e histórico (só no navegador) ----------
  const cfg = {
    ligado: false,
    reserva: RESERVA_PADRAO,
    limiteHora: LIMITE_HORA_PADRAO,
    itens: [], // { nome, cat, min, qtd, ativo }
    ...ler('cfg', {}),
  };
  const salvarCfg = () => guardar('cfg', cfg);
  let gasto = ler('gasto', []); // [[timestamp, valor], ...]
  const podarGasto = () => {
    const corte = Date.now() - 24 * 3600 * 1000;
    gasto = gasto.filter((g) => g[0] > corte);
  };
  const gastoUltimaHora = () => {
    const corte = Date.now() - 3600 * 1000;
    return gasto.filter((g) => g[0] > corte).reduce((s, g) => s + g[1], 0);
  };

  // ---------- leitura do jogo ----------
  function lerOuro() {
    const s = (document.querySelector('#tr-gold')?.textContent || '').trim();
    const m = s.match(/^([\d.,]+)\s*(kk|k|m|b)?$/i);
    if (!m) return NaN;
    const suf = (m[2] || '').toLowerCase();
    if (!suf) return Number(m[1].replace(/[^\d]/g, ''));
    const base = Number(m[1].replace(/\./g, '').replace(',', '.'));
    return base * ({ k: 1e3, kk: 1e6, m: 1e6, b: 1e9 }[suf] || 1);
  }

  // O painel Automações mostra um chip por item com o estoque: <button class="auto-chip" title="Nome — ..."><span class="q">1.234</span>
  function lerEstoque() {
    const lista = [];
    for (const [sel, cat] of GRUPOS_ESTOQUE) {
      for (const chip of document.querySelectorAll(`${sel} .auto-chip`)) {
        const nome = (chip.title || '').split(' — ')[0].trim();
        const q = chip.querySelector('.q');
        if (!nome || !q) continue;
        lista.push({ cat, nome, qtd: parseNum(q.textContent) });
      }
    }
    return lista;
  }
  const estoqueDe = (estoque, item) => estoque.find((e) => e.cat === item.cat && e.nome === item.nome)?.qtd;

  const modalAberto = () => [...document.querySelectorAll('.modal')].some((m) => !m.classList.contains('hidden'));
  const digitando = () => {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  };

  // ---------- compra (clica no Market como uma pessoa) ----------
  const cartoes = () => [...document.querySelectorAll('#mk-corpo .mk-card.mk-pal')];
  const cartaoDe = (nome) => cartoes().find((c) => (c.querySelector('.mk-nome')?.textContent || '').trim() === nome);

  async function abrirMarket(item) {
    const menu = document.querySelector('button[data-modal="market"]');
    if (!menu) throw new Error('botão Market não encontrado');
    menu.click();
    if (!await esperar(() => document.querySelector('#mk-modos'), 3000)) throw new Error('o Market não abriu');
    const compra = document.querySelector('#mk-modos [data-aba="compra"]');
    if (compra && !compra.classList.contains('on')) compra.click();
    const cats = await esperar(() => {
      const l = document.querySelectorAll('.mk-lado .mk-cat');
      return l.length ? [...l] : null;
    }, 3000);
    if (!cats) throw new Error('categorias do Market não apareceram');
    const idx = CATEGORIAS.indexOf(item.cat);
    if (!cats[idx]) throw new Error('categoria não encontrada');
    cats[idx].click();
    await dormir(150);
    if (!await esperar(() => cartaoDe(item.nome), 3000)) return null; // o item não é vendido aqui
    return cartaoDe(item.nome);
  }

  async function fecharMarket() {
    document.querySelector('#modal-fechar')?.click();
    await dormir(250);
  }

  async function comprar(item, estoqueAntes) {
    const card = await abrirMarket(item);
    if (!card) return { ok: false, motivo: 'indisponível no Market (não se compra com Coins)', desativar: true };

    const preco = parseNum(card.querySelector('.mk-pal-preco .mk-moeda')?.textContent);
    if (!(preco > 0)) throw new Error('não consegui ler o preço');
    item.preco = preco;

    const ouro = lerOuro();
    if (!Number.isFinite(ouro)) throw new Error('não consegui ler o saldo de Coins');
    const porReserva = Math.floor((ouro - cfg.reserva) / preco);
    const porHora = Math.floor((cfg.limiteHora - gastoUltimaHora()) / preco);
    const q = Math.min(item.qtd, MAX_POR_COMPRA, porReserva, porHora);
    if (q < 1) {
      return { ok: false, bloquear: true, motivo: porReserva < 1 ? 'saldo abaixo da reserva de Coins' : 'limite por hora atingido' };
    }

    const campo = card.querySelector('.mk-qtd input');
    const botao = card.querySelector('.mk-pal-comprar');
    if (!campo || !botao) throw new Error('campo de quantidade não encontrado');
    campo.value = String(q);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    await dormir(150);
    if (botao.disabled) return { ok: false, bloquear: true, motivo: 'o jogo recusou (saldo insuficiente)' };
    botao.click();

    // confirma: o estoque do painel tem que subir
    const subiu = await esperar(() => {
      const atual = estoqueDe(lerEstoque(), item);
      return atual != null && atual > estoqueAntes ? atual : null;
    }, 6000, 200);
    if (!subiu) return { ok: false, motivo: 'a compra não foi confirmada', pausar: true };
    const custo = q * preco;
    gasto.push([Date.now(), custo]);
    podarGasto();
    guardar('gasto', gasto);
    return { ok: true, q, custo, novoEstoque: subiu };
  }

  // ---------- ciclo ----------
  let ocupado = false;
  let ultimaCompra = 0;
  let bloqueadoAte = 0;
  const estado = { msg: 'Desligada', tom: 'neutro', ultimo: '' };

  function definirMsg(msg, tom = 'neutro') {
    estado.msg = msg;
    estado.tom = tom;
  }

  function escolherAlvo(estoque) {
    for (const item of cfg.itens) {
      if (!item.ativo) continue;
      const tem = estoqueDe(estoque, item);
      if (tem == null) continue; // item sumiu do painel
      if (tem < item.min) return { item, tem };
    }
    return null;
  }

  async function ciclo() {
    if (ocupado) return;
    atualizarPainel();
    if (!cfg.ligado) return;
    const agora = Date.now();
    if (agora < bloqueadoAte || agora - ultimaCompra < ESPERA_ENTRE_COMPRAS_MS) return;
    if (!document.querySelector('#tr-gold') || modalAberto() || digitando()) return;

    const estoque = lerEstoque();
    const alvo = escolherAlvo(estoque);
    if (!alvo) {
      definirMsg('Ligada · estoque em dia', 'ok');
      return;
    }

    ocupado = true;
    document.documentElement.classList.add('pxca-trabalhando');
    try {
      const r = await comprar(alvo.item, alvo.tem);
      if (r.ok) {
        ultimaCompra = Date.now();
        estado.ultimo = `${hora()} · ${fmt(r.q)}× ${alvo.item.nome} (${fmt(r.custo)} Coins)`;
        definirMsg('Ligada · última compra feita', 'ok');
      } else {
        if (r.desativar) alvo.item.ativo = false;
        if (r.bloquear) bloqueadoAte = Date.now() + BLOQUEIO_LIMITE_MS;
        if (r.pausar) cfg.ligado = false;
        salvarCfg();
        definirMsg(`${alvo.item.nome}: ${r.motivo}${r.pausar ? ' — automação pausada' : ''}`, r.pausar ? 'erro' : 'aviso');
      }
    } catch (e) {
      cfg.ligado = false;
      salvarCfg();
      definirMsg(`Erro: ${e.message} — automação pausada`, 'erro');
    } finally {
      await fecharMarket();
      document.documentElement.classList.remove('pxca-trabalhando');
      ocupado = false;
      atualizarPainel(true);
    }
  }

  // ---------- interface (visual do jogo, encaixada abaixo das Automações) ----------
  const estilo = document.createElement('style');
  estilo.textContent = 'html.pxca-trabalhando #modal{visibility:hidden !important}';
  document.head.appendChild(estilo);

  const CSS = `
    :host{all:initial;display:block;margin:6px 0}
    *{box-sizing:border-box}
    .caixa{font:12px/1.35 "Segoe UI",system-ui,sans-serif;color:#fff6ef;background:#33202b;border-radius:6px;padding:7px 8px 8px;
      box-shadow:inset 0 0 0 2px #480e1e,0 1px 0 #e7a86d}
    .topo{display:flex;align-items:center;justify-content:space-between;gap:6px}
    h4{margin:0;font:700 11px Tahoma,Verdana,"Segoe UI",sans-serif;text-transform:uppercase;letter-spacing:1px;color:#ffe9a3}
    .chave{display:flex;align-items:center;gap:5px;font-size:11px;color:#c9a9b4;cursor:pointer}
    .chave input{accent-color:#e2a93f;cursor:pointer;margin:0}
    .corpo{margin-top:6px}
    .corpo[hidden]{display:none}
    .cab,.linha{display:grid;grid-template-columns:minmax(0,1fr) 54px 54px 18px;gap:4px;align-items:center}
    .cab{font-size:10px;color:#8d7480;margin-bottom:2px}
    .cab span:nth-child(n+2){text-align:right}
    .linha{padding:2px 0}
    .nome{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .nome small{color:#8d7480;font-size:10px;display:block}
    .linha.off .nome{opacity:.45}
    input[type=text]{all:unset;box-sizing:border-box;width:100%;padding:2px 5px;background:#1e1219;border-radius:5px;color:#fff;text-align:right;font-size:12px;
      box-shadow:inset 0 0 0 1px #480e1e,0 1px 0 #e7a86d66}
    input[type=text]:focus{box-shadow:inset 0 0 0 1px #e2a93f,0 1px 0 #e7a86d}
    button{all:unset;cursor:pointer;font-size:11px;font-weight:700;border-radius:4px;color:#fff6ef;text-align:center}
    .x{color:#c9a9b4;font-size:13px;line-height:1}
    .x:hover{color:#ff8a7a}
    select{all:unset;box-sizing:border-box;width:100%;padding:2px 5px;background:#1e1219;border-radius:5px;color:#fff;font-size:12px;cursor:pointer;
      box-shadow:inset 0 0 0 1px #480e1e,0 1px 0 #e7a86d66}
    select option{background:#1e1219}
    .adicionar{margin-top:4px}
    .sep{border-top:1px solid #ffffff1c;margin:7px 0 5px}
    .limites{display:grid;grid-template-columns:minmax(0,1fr) 78px;gap:3px 6px;align-items:center;font-size:11px;color:#c9a9b4}
    .caixa{min-width:0;max-width:100%;overflow:hidden}
    .status{margin-top:6px;font-size:11px;color:#c9a9b4}
    .status b{display:block;font-weight:600}
    .ok{color:#6fd08a}.aviso{color:#ffe9a3}.erro{color:#ff8a7a}
    .dica{margin-top:4px;font-size:10.5px;color:#8d7480}
    .recolher{color:#c9a9b4;font-size:13px;padding:0 3px}
  `;

  let host = null;
  let raiz = null;
  let q = null;
  let aberto = ler('aberto', true);
  let assinaturaLinhas = '';

  function montar() {
    host = document.createElement('div');
    host.id = 'pokeidle-compra-auto';
    raiz = host.attachShadow({ mode: 'open' });
    raiz.innerHTML = `
      <style>${CSS}</style>
      <div class="caixa">
        <div class="topo">
          <h4>Compra automática</h4>
          <span style="display:flex;align-items:center;gap:6px">
            <label class="chave" title="Liga ou desliga a compra automática"><input type="checkbox" data-r="ligar"><span data-r="rotuloLigar">Off</span></label>
            <button class="recolher" data-r="recolher" title="Mostrar/esconder">▾</button>
          </span>
        </div>
        <div class="corpo" data-r="corpo">
          <div data-r="linhas"></div>
          <div class="adicionar"><select data-r="adicionar"></select></div>
          <div class="sep"></div>
          <div class="limites">
            <span>Reserva de Coins</span><input type="text" data-r="reserva" inputmode="numeric">
            <span>Limite por hora</span><input type="text" data-r="limite" inputmode="numeric">
          </div>
          <div class="status"><b data-r="msg"></b><span data-r="ultimo"></span><span data-r="hora"></span></div>
          <div class="dica">Compra quando o estoque ficar abaixo do mínimo. Só gasta Coins no Market do NPC.</div>
        </div>
      </div>`;
    q = (n) => raiz.querySelector(`[data-r="${n}"]`);
    for (const ev of ['keydown', 'keyup', 'keypress']) raiz.addEventListener(ev, (e) => e.stopPropagation());

    q('ligar').addEventListener('change', () => {
      cfg.ligado = q('ligar').checked;
      if (cfg.ligado) {
        bloqueadoAte = 0;
        definirMsg('Ligada', 'ok');
      } else {
        definirMsg('Desligada', 'neutro');
      }
      salvarCfg();
      atualizarPainel(true);
      ciclo();
    });
    q('recolher').addEventListener('click', () => {
      aberto = !aberto;
      guardar('aberto', aberto);
      atualizarPainel(true);
    });
    q('reserva').addEventListener('change', () => {
      cfg.reserva = parseNum(q('reserva').value);
      q('reserva').value = fmt(cfg.reserva);
      salvarCfg();
    });
    q('limite').addEventListener('change', () => {
      cfg.limiteHora = Math.max(1, parseNum(q('limite').value));
      q('limite').value = fmt(cfg.limiteHora);
      salvarCfg();
    });
    q('adicionar').addEventListener('change', () => {
      const [cat, nome] = q('adicionar').value.split('|');
      q('adicionar').selectedIndex = 0;
      if (!cat || !nome) return;
      if (cfg.itens.some((i) => i.cat === cat && i.nome === nome)) return;
      cfg.itens.push({ nome, cat, min: cat === 'bolas' ? 1000 : 20, qtd: cat === 'bolas' ? 5000 : 100, ativo: true });
      salvarCfg();
      atualizarPainel(true);
    });
    raiz.addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      cfg.itens.splice(Number(b.dataset.del), 1);
      salvarCfg();
      atualizarPainel(true);
    });
    raiz.addEventListener('change', (e) => {
      const el = e.target;
      const i = el.dataset?.i;
      if (i == null) return;
      const item = cfg.itens[Number(i)];
      if (!item) return;
      if (el.dataset.campo === 'ativo') item.ativo = el.checked;
      if (el.dataset.campo === 'min') { item.min = parseNum(el.value); el.value = fmt(item.min); }
      if (el.dataset.campo === 'qtd') { item.qtd = Math.min(MAX_POR_COMPRA, Math.max(1, parseNum(el.value))); el.value = fmt(item.qtd); }
      salvarCfg();
      atualizarPainel(true);
    });
  }

  function encaixar() {
    const alvo = document.querySelector('#p-auto');
    if (!alvo) return false;
    if (!host) montar();
    if (host.previousElementSibling !== alvo || !host.isConnected) alvo.after(host);
    return true;
  }

  function atualizarPainel(forcar = false) {
    if (!encaixar()) return;
    const estoque = lerEstoque();
    q('ligar').checked = !!cfg.ligado;
    q('rotuloLigar').textContent = cfg.ligado ? 'On' : 'Off';
    q('corpo').hidden = !aberto;
    q('recolher').textContent = aberto ? '▾' : '▸';
    if (!aberto) return;

    // linhas dos itens (só redesenha quando a estrutura muda, para não atrapalhar quem está digitando)
    const assinatura = JSON.stringify(cfg.itens.map((i) => [i.nome, i.cat, i.ativo, i.min, i.qtd]))
      + '|' + cfg.itens.map((i) => estoqueDe(estoque, i) ?? '-').join(',')
      + '|' + estoque.map((e) => e.cat + e.nome).join(',');
    if (forcar || assinatura !== assinaturaLinhas) {
      const focoDentro = raiz.activeElement && raiz.activeElement.tagName === 'INPUT';
      if (!focoDentro || forcar) {
        assinaturaLinhas = assinatura;
        const cab = cfg.itens.length
          ? '<div class="cab"><span>Item (estoque)</span><span>Se &lt;</span><span>Comprar</span><span></span></div>'
          : '';
        q('linhas').innerHTML = cab + cfg.itens.map((it, i) => {
          const tem = estoqueDe(estoque, it);
          return `<div class="linha${it.ativo ? '' : ' off'}">
            <label class="nome" title="${esc(it.nome)}"><input type="checkbox" data-i="${i}" data-campo="ativo" ${it.ativo ? 'checked' : ''} style="accent-color:#e2a93f;margin:0 4px 0 0;vertical-align:middle">${esc(it.nome)}<small>${tem == null ? 'fora do painel' : 'tem ' + fmt(tem)}</small></label>
            <input type="text" data-i="${i}" data-campo="min" value="${fmt(it.min)}" inputmode="numeric">
            <input type="text" data-i="${i}" data-campo="qtd" value="${fmt(it.qtd)}" inputmode="numeric">
            <button class="x" data-del="${i}" title="Remover">×</button>
          </div>`;
        }).join('');
        const usados = new Set(cfg.itens.map((i) => i.cat + '|' + i.nome));
        const opcoes = estoque.filter((e) => !usados.has(e.cat + '|' + e.nome));
        q('adicionar').innerHTML = '<option value="">+ adicionar item…</option>'
          + opcoes.map((e) => `<option value="${esc(e.cat + '|' + e.nome)}">${esc(ROTULO_CAT[e.cat])}: ${esc(e.nome)}</option>`).join('');
      }
    }
    const campoFoco = raiz.activeElement?.dataset?.r;
    if (campoFoco !== 'reserva') q('reserva').value = fmt(cfg.reserva);
    if (campoFoco !== 'limite') q('limite').value = fmt(cfg.limiteHora);
    q('msg').textContent = cfg.ligado ? estado.msg : (estado.tom === 'erro' ? estado.msg : 'Desligada');
    q('msg').className = cfg.ligado ? estado.tom : (estado.tom === 'erro' ? 'erro' : '');
    q('ultimo').textContent = estado.ultimo ? `Última: ${estado.ultimo}` : '';
    q('ultimo').style.display = 'block';
    q('hora').textContent = `Gasto na última hora: ${fmt(gastoUltimaHora())} / ${fmt(cfg.limiteHora)}`;
    q('hora').style.display = 'block';
  }

  // ---------- partida ----------
  podarGasto();
  setInterval(ciclo, INTERVALO_MS);
  setInterval(() => { atualizarPainel(); }, 2000); // mantém o painel encaixado e o estoque atualizado
  atualizarPainel(true);
  window.__pokeidleCompraAuto = { cfg, lerEstoque, ciclo, lerOuro };
})();
