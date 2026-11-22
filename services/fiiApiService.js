class FiiApiService {
  static async buscarViaBrapi(tickers) {
    const resultado = {};
    if (!tickers || tickers.length === 0) return resultado;

    try {
      const token = process.env.BRAPI_TOKEN ? `&token=${encodeURIComponent(process.env.BRAPI_TOKEN)}` : '';
      const url = `https://brapi.dev/api/quote/${encodeURIComponent(tickers.join(','))}?fundamental=true&dividends=true${token}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'ControleFinanceiroApp/1.0' },
        signal: AbortSignal.timeout(6000)
      });

      if (!response.ok) return resultado;

      const json = await response.json();
      const lista = Array.isArray(json.results) ? json.results : [];

      for (const item of lista) {
        const ticker = String(item.symbol || '').toUpperCase();
        const cotacaoAtual = Number(item.regularMarketPrice) || 0;
        if (!ticker || cotacaoAtual <= 0) continue;

        let ultimoDividendo = 0;
        const cashDividends = item.dividendsData?.cashDividends;
        if (Array.isArray(cashDividends) && cashDividends.length > 0) {
          ultimoDividendo = Number(cashDividends[0].rate) || 0;
        }

        const pvp = item.priceToBook !== undefined && item.priceToBook !== null
          ? Number(item.priceToBook)
          : null;

        resultado[ticker] = {
          cotacaoAtual,
          ultimoDividendo,
          pvp
        };
      }
    } catch {
      // Segue para Yahoo B3
    }

    return resultado;
  }

  static async buscarHistoricoMensalYahooB3(ticker, mesRef) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.SA?range=3mo&interval=1d&events=div`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(6000)
      });

      if (!response.ok) return null;

      const json = await response.json();
      const resChart = json?.chart?.result?.[0];
      const meta = resChart?.meta;
      const timestamps = Array.isArray(resChart?.timestamp) ? resChart.timestamp : [];
      const quote = resChart?.indicators?.quote?.[0] || {};
      const opens = quote.open || [];
      const closes = quote.close || [];

      const cotacaoMercadoYahoo = Number(meta?.regularMarketPrice) || 0;
      if (cotacaoMercadoYahoo <= 0) return null;

      const [anoStr, mesStr] = String(mesRef || '').split('-');
      const anoAlvo = Number(anoStr);
      const mesAlvo = Number(mesStr);

      let cotacaoInicioMes = null;
      let cotacaoFimMes = cotacaoMercadoYahoo;

      if (anoAlvo > 0 && mesAlvo > 0 && timestamps.length > 0) {
        const pontosMes = [];

        for (let i = 0; i < timestamps.length; i++) {
          const fechamento = Number(closes[i]);
          const abertura = Number(opens[i]);
          if (!fechamento || Number.isNaN(fechamento)) continue;

          // Converte timestamp B3 (UTC-3) para evitar virada errada de mês no dia 1
          const dtB3 = new Date((timestamps[i] - 3 * 3600) * 1000);
          const ano = dtB3.getUTCFullYear();
          const mes = dtB3.getUTCMonth() + 1;

          if (ano === anoAlvo && mes === mesAlvo) {
            pontosMes.push({
              abertura: abertura > 0 ? abertura : fechamento,
              fechamento
            });
          }
        }

        if (pontosMes.length > 0) {
          // Usa a abertura do 1º pregão do mês (sem ajuste retroativo de dividendos do mês anterior)
          cotacaoInicioMes = pontosMes[0].abertura;
          const hoje = new Date();
          const mesCorrente = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
          cotacaoFimMes = mesRef === mesCorrente
            ? cotacaoMercadoYahoo
            : pontosMes[pontosMes.length - 1].fechamento;
        }
      }

      if (!cotacaoInicioMes || cotacaoInicioMes <= 0) {
        cotacaoInicioMes = cotacaoFimMes;
      }

      const variacaoMesReais = Number((cotacaoFimMes - cotacaoInicioMes).toFixed(4));
      const variacaoMesPct = cotacaoInicioMes > 0
        ? Number((((cotacaoFimMes - cotacaoInicioMes) / cotacaoInicioMes) * 100).toFixed(2))
        : 0;

      let ultimoDividendo = 0;
      const eventosDiv = resChart?.events?.dividends;
      if (eventosDiv && typeof eventosDiv === 'object') {
        const listaDivs = Object.values(eventosDiv).sort((a, b) => (b.date || 0) - (a.date || 0));
        if (listaDivs.length > 0) {
          ultimoDividendo = Number(listaDivs[0].amount) || 0;
        }
      }

      return {
        cotacaoAtual: cotacaoFimMes,
        cotacaoInicioMes,
        ultimoDividendo,
        pvp: null,
        variacaoCotaReais: variacaoMesReais,
        variacaoCotaPct: variacaoMesPct
      };
    } catch {
      return null;
    }
  }

  static async buscarDadosAtivos(tickers = [], mesRef = null) {
    const listaLimpa = [...new Set(
      tickers
        .map(t => String(t || '').trim().toUpperCase())
        .filter(Boolean)
    )];

    if (listaLimpa.length === 0) {
      return { dados: {}, origem: 'sem_ativos' };
    }

    const [dadosBrapi, historicosYahoo] = await Promise.all([
      this.buscarViaBrapi(listaLimpa),
      Promise.all(listaLimpa.map(async (ticker) => ({
        ticker,
        info: await this.buscarHistoricoMensalYahooB3(ticker, mesRef)
      })))
    ]);

    const dados = {};
    for (const item of historicosYahoo) {
      const brapi = dadosBrapi[item.ticker];
      const yahoo = item.info;

      if (!brapi && !yahoo) continue;

      // Usa a mesma fonte (Yahoo B3) para calcular a variação mensal sem distorção entre APIs
      const cotacaoAtual = yahoo?.cotacaoAtual > 0 ? yahoo.cotacaoAtual : brapi.cotacaoAtual;
      const cotacaoInicioMes = yahoo?.cotacaoInicioMes > 0 ? yahoo.cotacaoInicioMes : cotacaoAtual;
      const variacaoCotaReais = yahoo ? yahoo.variacaoCotaReais : 0;
      const variacaoCotaPct = yahoo ? yahoo.variacaoCotaPct : 0;

      dados[item.ticker] = {
        cotacaoAtual,
        cotacaoInicioMes,
        ultimoDividendo: brapi?.ultimoDividendo > 0 ? brapi.ultimoDividendo : (yahoo?.ultimoDividendo || 0),
        pvp: brapi?.pvp !== undefined && brapi?.pvp !== null ? brapi.pvp : null,
        variacaoCotaReais,
        variacaoCotaPct
      };
    }

    const origem = Object.keys(dados).length > 0 ? 'api_online' : 'banco_local';
    return { dados, origem };
  }
}

module.exports = FiiApiService;