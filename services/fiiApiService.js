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

        const fechamentoAnterior = Number(item.regularMarketPreviousClose) || cotacaoAtual;
        const variacaoCotaReais = item.regularMarketChange !== undefined && item.regularMarketChange !== null
          ? Number(item.regularMarketChange)
          : Number((cotacaoAtual - fechamentoAnterior).toFixed(4));

        const variacaoCotaPct = item.regularMarketChangePercent !== undefined && item.regularMarketChangePercent !== null
          ? Number(item.regularMarketChangePercent)
          : (fechamentoAnterior > 0 ? Number((((cotacaoAtual - fechamentoAnterior) / fechamentoAnterior) * 100).toFixed(2)) : 0);

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
          pvp,
          variacaoCotaReais,
          variacaoCotaPct
        };
      }
    } catch {
      // Fallback automático para Yahoo Finance B3 (.SA)
    }

    return resultado;
  }

  static async buscarViaYahooB3(ticker) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.SA?range=1mo&interval=1d&events=div`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(6000)
      });

      if (!response.ok) return null;

      const json = await response.json();
      const resChart = json?.chart?.result?.[0];
      const meta = resChart?.meta;
      const cotacaoAtual = Number(meta?.regularMarketPrice) || 0;

      if (cotacaoAtual <= 0) return null;

      const fechamentoAnterior = Number(meta?.chartPreviousClose || meta?.previousClose) || cotacaoAtual;
      const variacaoCotaReais = Number((cotacaoAtual - fechamentoAnterior).toFixed(4));
      const variacaoCotaPct = fechamentoAnterior > 0
        ? Number((((cotacaoAtual - fechamentoAnterior) / fechamentoAnterior) * 100).toFixed(2))
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
        cotacaoAtual,
        ultimoDividendo,
        pvp: null,
        variacaoCotaReais,
        variacaoCotaPct
      };
    } catch {
      return null;
    }
  }

  static async buscarDadosAtivos(tickers = []) {
    const listaLimpa = [...new Set(
      tickers
        .map(t => String(t || '').trim().toUpperCase())
        .filter(Boolean)
    )];

    if (listaLimpa.length === 0) {
      return { dados: {}, origem: 'sem_ativos' };
    }

    const dados = await this.buscarViaBrapi(listaLimpa);

    const faltantes = listaLimpa.filter(t => !dados[t]);
    if (faltantes.length > 0) {
      await Promise.all(faltantes.map(async (ticker) => {
        const infoYahoo = await this.buscarViaYahooB3(ticker);
        if (infoYahoo) {
          dados[ticker] = infoYahoo;
        }
      }));
    }

    const origem = Object.keys(dados).length > 0 ? 'api_online' : 'banco_local';
    return { dados, origem };
  }
}

module.exports = FiiApiService;