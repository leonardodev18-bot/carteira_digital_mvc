const UsuarioModel = require('../models/usuarioModel');
const InvestimentoModel = require('../models/investimentoModel');
const MovimentacaoModel = require('../models/movimentacaoModel');
const OrcamentoModel = require('../models/orcamentoModel');
const AuditoriaModel = require('../models/auditoriaModel');
const FiiApiService = require('../services/fiiApiService');
const MacroApiService = require('../services/macroApiService');

function obterMesAtual() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

class InvestimentoController {
  static async index(req, res) {
    const usuario = await UsuarioModel.buscarPorEmail(req.session.usuario.email);
    const mesAtual = req.query.mes || obterMesAtual();

    const aviso = req.session.aviso || null;
    delete req.session.aviso;

    // 1. Busca ativos, extrato do mês, orçamento e indicadores Selic/IPCA do Banco Central
    const [ativosBanco, extratoMes, orcamento, macro] = await Promise.all([
      InvestimentoModel.listarPorUsuario(usuario.id),
      MovimentacaoModel.listarPorMes(usuario.id, mesAtual),
      OrcamentoModel.obterPorUsuario(usuario.id),
      MacroApiService.buscarIndicadores()
    ]);

    // 2. Consolida fluxo de caixa mensal
    let receitaMes = 0;
    let fixasMes = 0;
    let variaveisMes = 0;
    let reservaMes = 0;

    extratoMes.forEach(item => {
      if (item.categoria === 'RECEITA') receitaMes += item.valor;
      if (item.categoria === 'FIXA') fixasMes += item.valor;
      if (item.categoria === 'VARIAVEL') variaveisMes += item.valor;
      if (item.categoria === 'RESERVA') reservaMes += item.valor;
    });

    const despesasTotaisMes = fixasMes + variaveisMes;
    const saldoCaixaMes = receitaMes - despesasTotaisMes - reservaMes;
    const capacidadeAporteMensal = receitaMes - despesasTotaisMes;

    // 3. Sincroniza cotações, variações e dividendos da B3
    const tickersBolsa = ativosBanco
      .filter(a => a.classe === 'FII' || a.classe === 'ACAO')
      .map(a => a.ticker);

    const { dados: dadosApi, origem: statusApi } = await FiiApiService.buscarDadosAtivos(tickersBolsa);

    for (const ticker of Object.keys(dadosApi)) {
      await InvestimentoModel.atualizarDadosMercado(usuario.id, ticker, dadosApi[ticker]);
    }

    const fatorCdiMensal = macro.taxaMensalCdiPct / 100;
    const fatorIpcaMensal = macro.ipcaMensal / 100;
    const ALIQUOTA_IR_RENDA_FIXA = 0.225; // 22,5% IR (tabela regressiva até 180 dias)

    let totalAplicado = 0;
    let patrimonioInvestidoBruto = 0;
    let perdasNaoRefletidasNoSaldo = 0;
    let ganhosFiiMes = 0;
    let ganhosReservaMes = 0;
    let perdasFii = 0;
    let perdasReserva = 0;

    const ativosCalculados = ativosBanco.map(a => {
      const isReservaOuRf = a.classe === 'RESERVA' || a.classe === 'RENDA_FIXA';
      const infoApi = dadosApi[a.ticker];

      const cotacaoAtual = infoApi?.cotacaoAtual > 0 ? infoApi.cotacaoAtual : a.cotacao_atual;
      const valorAplicado = a.quantidade * a.preco_medio;
      const saldoAtual = a.quantidade * cotacaoAtual;

      if (isReservaOuRf) {
        const rendimentoBrutoMes = a.ultimo_dividendo > 0
          ? a.ultimo_dividendo
          : Number((saldoAtual * fatorCdiMensal).toFixed(2));

        const impostoIrMes = Number((rendimentoBrutoMes * ALIQUOTA_IR_RENDA_FIXA).toFixed(2));
        const rendimentoLiquidoMes = Number((rendimentoBrutoMes - impostoIrMes).toFixed(2));

        const perdaInflacaoMes = Number((saldoAtual * fatorIpcaMensal).toFixed(2));
        const ganhoRealMes = rendimentoLiquidoMes - perdaInflacaoMes;
        const variacaoNominal = saldoAtual - valorAplicado;
        const perdaAtivo = Number((Math.max(0, -variacaoNominal) + Math.max(0, perdaInflacaoMes)).toFixed(2));

        perdasReserva = Number((perdasReserva + perdaAtivo).toFixed(2));
        perdasNaoRefletidasNoSaldo = Number((perdasNaoRefletidasNoSaldo + Math.max(0, perdaInflacaoMes)).toFixed(2));
        ganhosReservaMes = Number((ganhosReservaMes + rendimentoLiquidoMes).toFixed(2));
        totalAplicado += valorAplicado;
        patrimonioInvestidoBruto += saldoAtual;

        return {
          ...a,
          isReservaOuRf: true,
          cotacao_atual: cotacaoAtual,
          ultimo_dividendo: rendimentoBrutoMes,
          impostoIrMes,
          perdaInflacaoMes,
          ganhoRealMes,
          pvp: null,
          dyMensalPct: Number((macro.taxaMensalCdiPct * (1 - ALIQUOTA_IR_RENDA_FIXA)).toFixed(2)),
          valorAplicado,
          saldoAtual,
          proventoMensal: rendimentoLiquidoMes,
          desvalorizacaoReais: perdaAtivo,
          variacaoExibicaoReais: -perdaAtivo,
          variacaoExibicaoPct: 0,
          lucroReais: ganhoRealMes,
          lucroPct: saldoAtual > 0 ? (ganhoRealMes / saldoAtual) * 100 : 0,
          atualizadoViaApi: macro.origem === 'bcb_online'
        };
      }

      // FIIs e Ações (Dividendos isentos de IR + cálculo de desvalorização)
      const ultimoDividendo = infoApi?.ultimoDividendo > 0 ? infoApi.ultimoDividendo : a.ultimo_dividendo;
      const pvp = infoApi?.pvp !== undefined && infoApi?.pvp !== null ? infoApi.pvp : a.pvp;
      const proventoMensal = Number((a.quantidade * ultimoDividendo).toFixed(2));
      const diferencaPatrimonial = Number((saldoAtual - valorAplicado).toFixed(2));
      const dyMensalPct = cotacaoAtual > 0 ? (ultimoDividendo / cotacaoAtual) * 100 : 0;

      const variacaoCotaReaisApi = infoApi?.variacaoCotaReais ?? 0;
      const variacaoCotaPctApi = infoApi?.variacaoCotaPct ?? 0;
      const variacaoMercadoTotal = Number((a.quantidade * variacaoCotaReaisApi).toFixed(2));

      let desvalorizacaoReais = 0;
      let perdaNaoRefletidaFii = 0;

      if (diferencaPatrimonial < 0) {
        desvalorizacaoReais = Math.abs(diferencaPatrimonial);
      } else if (variacaoMercadoTotal < 0) {
        desvalorizacaoReais = Math.abs(variacaoMercadoTotal);
        perdaNaoRefletidaFii = desvalorizacaoReais;
      }

      const variacaoExibicaoReais = diferencaPatrimonial !== 0 ? diferencaPatrimonial : variacaoMercadoTotal;
      const variacaoExibicaoPct = diferencaPatrimonial !== 0 && valorAplicado > 0
        ? Number(((diferencaPatrimonial / valorAplicado) * 100).toFixed(2))
        : variacaoCotaPctApi;

      perdasFii = Number((perdasFii + desvalorizacaoReais).toFixed(2));
      perdasNaoRefletidasNoSaldo = Number((perdasNaoRefletidasNoSaldo + perdaNaoRefletidaFii).toFixed(2));
      totalAplicado += valorAplicado;
      patrimonioInvestidoBruto += saldoAtual;
      ganhosFiiMes = Number((ganhosFiiMes + proventoMensal).toFixed(2));

      return {
        ...a,
        isReservaOuRf: false,
        cotacao_atual: cotacaoAtual,
        ultimo_dividendo: ultimoDividendo,
        impostoIrMes: 0,
        perdaInflacaoMes: 0,
        ganhoRealMes: diferencaPatrimonial,
        pvp,
        dyMensalPct,
        valorAplicado,
        saldoAtual,
        proventoMensal,
        desvalorizacaoReais,
        variacaoExibicaoReais,
        variacaoExibicaoPct,
        lucroReais: diferencaPatrimonial,
        lucroPct: variacaoExibicaoPct,
        atualizadoViaApi: Boolean(infoApi)
      };
    });

    ativosCalculados.forEach(a => {
      a.alocacaoAtualPct = patrimonioInvestidoBruto > 0 ? (a.saldoAtual / patrimonioInvestidoBruto) * 100 : 0;
    });

    // Abate as perdas no patrimônio investido, no patrimônio atual e na projeção anual
    const patrimonioInvestido = Math.max(0, Number((patrimonioInvestidoBruto - perdasNaoRefletidasNoSaldo).toFixed(2)));
    const patrimonioAtual = Number((patrimonioInvestido + saldoCaixaMes).toFixed(2));
    const perdasTotais = Number((perdasFii + perdasReserva).toFixed(2));
    const rendaMensalEstimada = Number((ganhosFiiMes + ganhosReservaMes).toFixed(2));
    const yocCarteiraPct = totalAplicado > 0 ? (rendaMensalEstimada / totalAplicado) * 100 : 0;

    const rendaAnualProjetada = Number((rendaMensalEstimada * 12).toFixed(2));
    const economiaAnualProjetada = Number((capacidadeAporteMensal * 12).toFixed(2));
    const patrimonioProjetado12m = Number((patrimonioInvestido + economiaAnualProjetada + rendaAnualProjetada).toFixed(2));

    const mxrf = ativosCalculados.find(a => a.ticker === 'MXRF11');
    const precoCotaRef = mxrf?.cotacao_atual > 0 ? mxrf.cotacao_atual : 10.00;

    res.render('investimentos', {
      usuario,
      aviso,
      macro,
      statusApi: tickersBolsa.length === 0 ? 'sem_ativos_b3' : statusApi,
      ativos: ativosCalculados,
      precoCotaRef,
      fluxoCaixa: {
        mes: mesAtual,
        receitaMes,
        despesasTotaisMes,
        reservaMes,
        saldoCaixaMes,
        capacidadeAporteMensal,
        pctReservaMeta: Number(orcamento.pct_reserva)
      },
      moeda: (v, sinal = '', maxCasas = 2) => {
        if (usuario.ocultar_valores) return 'R$ ***';
        return sinal + Number(v).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
          minimumFractionDigits: 2,
          maximumFractionDigits: maxCasas
        });
      },
      kpis: {
        patrimonioInvestido,
        patrimonioAtual,
        totalAplicado,
        perdasFii,
        perdasReserva,
        perdasTotais,
        ganhosFiiMes,
        ganhosReservaMes,
        rendaMensalEstimada,
        rendaAnualProjetada,
        economiaAnualProjetada,
        patrimonioProjetado12m,
        yocCarteiraPct: yocCarteiraPct.toFixed(2)
      }
    });
  }

  static async consultarTicker(req, res) {
    const ticker = String(req.params.ticker || '').trim().toUpperCase();
    const { dados, origem } = await FiiApiService.buscarDadosAtivos([ticker]);
    const info = dados[ticker];

    if (!info || info.cotacaoAtual <= 0) {
      return res.status(404).json({ sucesso: false, origem });
    }

    return res.json({
      sucesso: true,
      ticker,
      cotacaoAtual: info.cotacaoAtual,
      ultimoDividendo: info.ultimoDividendo,
      pvp: info.pvp,
      variacaoCotaReais: info.variacaoCotaReais,
      variacaoCotaPct: info.variacaoCotaPct
    });
  }

  static async aportar(req, res) {
    const usuarioId = req.session.usuario.id;
    const { ticker, classe, quantidade, precoPago, ultimoDividendo, descontarReserva, mes } = req.body;
    const mesRef = mes || obterMesAtual();

    const classesPermitidas = ['FII', 'ACAO', 'RENDA_FIXA', 'RESERVA', 'CRIPTO'];
    const classeValida = classesPermitidas.includes(classe) ? classe : 'FII';
    const isReservaOuRf = classeValida === 'RESERVA' || classeValida === 'RENDA_FIXA';

    const qtdNum = isReservaOuRf ? (parseFloat(quantidade) || 1) : parseFloat(quantidade);
    let precoNum = parseFloat(precoPago);
    let cotacaoMercado = precoNum;
    let divNum = parseFloat(ultimoDividendo) || 0;
    let pvpVal = null;

    if (!ticker || !ticker.trim() || Number.isNaN(qtdNum) || qtdNum <= 0) {
      req.session.aviso = 'Informe um nome/ticker válido e valor maior que zero.';
      return res.redirect(`/investimentos?mes=${encodeURIComponent(mesRef)}`);
    }

    if (classeValida === 'FII' || classeValida === 'ACAO') {
      const tickerLimpo = ticker.trim().toUpperCase();
      const { dados } = await FiiApiService.buscarDadosAtivos([tickerLimpo]);
      const infoApi = dados[tickerLimpo];

      if (infoApi) {
        cotacaoMercado = infoApi.cotacaoAtual;
        if (Number.isNaN(precoNum) || precoNum <= 0) {
          precoNum = infoApi.cotacaoAtual;
        }
        if (divNum <= 0 && infoApi.ultimoDividendo > 0) {
          divNum = infoApi.ultimoDividendo;
        }
        pvpVal = infoApi.pvp ?? null;
      }
    }

    if (Number.isNaN(precoNum) || precoNum <= 0) {
      req.session.aviso = 'Informe um valor válido maior que zero.';
      return res.redirect(`/investimentos?mes=${encodeURIComponent(mesRef)}`);
    }

    await InvestimentoModel.registrarAporte({
      usuarioId,
      ticker,
      classe: classeValida,
      quantidade: qtdNum,
      precoPago: precoNum,
      cotacaoAtual: cotacaoMercado > 0 ? cotacaoMercado : precoNum,
      ultimoDividendo: isReservaOuRf ? 0 : divNum,
      pvp: pvpVal
    });

    if (descontarReserva === 'true') {
      const valorTotalAporte = Number((qtdNum * precoNum).toFixed(2));
      const nomeDesc = isReservaOuRf
        ? `Reserva: ${ticker.trim()}`
        : `Aporte: ${ticker.trim().toUpperCase()} (${qtdNum}x)`;

      await MovimentacaoModel.criar({
        usuarioId,
        descricao: nomeDesc,
        valor: valorTotalAporte,
        categoria: 'RESERVA',
        mesInicio: mesRef,
        recorrente: false
      });
    }

    req.session.aviso = `${ticker.trim()} registrado na carteira com sucesso!`;
    res.redirect(`/investimentos?mes=${encodeURIComponent(mesRef)}`);
  }

  static async atualizarQuantidade(req, res) {
    const usuarioId = req.session.usuario.id;
    const { id, quantidade } = req.body;
    const novaQtd = parseFloat(quantidade);

    if (!id || Number.isNaN(novaQtd) || novaQtd <= 0) {
      req.session.aviso = 'Informe uma quantidade válida maior que zero.';
      return res.redirect('/investimentos');
    }

    await InvestimentoModel.atualizarQuantidade(id, usuarioId, novaQtd);
    req.session.aviso = 'Quantidade de cotas atualizada com sucesso!';
    res.redirect('/investimentos');
  }

  static async atualizarSaldo(req, res) {
    const usuarioId = req.session.usuario.id;
    const { id, saldoAtual } = req.body;
    const novoSaldo = parseFloat(saldoAtual);

    if (!id || Number.isNaN(novoSaldo) || novoSaldo <= 0) {
      req.session.aviso = 'Informe um saldo válido maior que zero.';
      return res.redirect('/investimentos');
    }

    await InvestimentoModel.atualizarSaldo(id, usuarioId, novoSaldo);
    req.session.aviso = 'Saldo da reserva atualizado! Rendimento líquido e perda IPCA recalculados.';
    res.redirect('/investimentos');
  }

  static async excluir(req, res) {
    const usuarioId = req.session.usuario.id;
    const { id, mes } = req.body;

    const ativoRemovido = await InvestimentoModel.excluir(id, usuarioId);

    if (ativoRemovido) {
      await AuditoriaModel.registrar({
        usuarioId,
        email: req.session.usuario.email,
        acao: 'EXCLUIR_ATIVO_INVESTIMENTO',
        req,
        detalhes: { ativoId: id, ticker: ativoRemovido.ticker }
      });
      req.session.aviso = `${ativoRemovido.ticker} removido da carteira e da tela de gastos!`;
    } else {
      req.session.aviso = 'Ativo não encontrado.';
    }

    const destino = mes ? `/investimentos?mes=${encodeURIComponent(mes)}` : '/investimentos';
    res.redirect(destino);
  }
}

module.exports = InvestimentoController;