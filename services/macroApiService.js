class MacroApiService {
  /**
   * Consulta Meta Selic (432), CDI anualizado (4389), IPCA mensal (433)
   * e IPCA acumulado 12m (13522) na API oficial do Banco Central do Brasil (SGS).
   */
  static async buscarIndicadores() {
    const fallback = {
      selicAnual: 13.75,
      cdiAnual: 13.65,
      ipcaMensal: 0.14,
      ipca12m: 4.63,
      dataReferencia: null,
      origem: 'fallback_local'
    };

    try {
      const [selic, cdi, ipcaMes, ipcaAno] = await Promise.all([
        this.consultarSerieBcb(432),
        this.consultarSerieBcb(4389),
        this.consultarSerieBcb(433),
        this.consultarSerieBcb(13522)
      ]);

      if (!selic && !cdi && !ipcaMes) {
        return fallback;
      }

      const selicAnual = selic?.valor ?? fallback.selicAnual;
      const cdiAnual = cdi?.valor ?? Number((selicAnual - 0.10).toFixed(2));
      const ipcaMensal = ipcaMes?.valor ?? fallback.ipcaMensal;
      const ipca12m = ipcaAno?.valor ?? fallback.ipca12m;

      // Converte taxas anuais (base 12 meses) para taxa mensal equivalente
      const taxaMensalCdiPct = (Math.pow(1 + cdiAnual / 100, 1 / 12) - 1) * 100;
      const ganhoRealAnualPct = (((1 + cdiAnual / 100) / (1 + ipca12m / 100)) - 1) * 100;

      return {
        selicAnual,
        cdiAnual,
        taxaMensalCdiPct: Number(taxaMensalCdiPct.toFixed(4)),
        ipcaMensal,
        ipca12m,
        ganhoRealAnualPct: Number(ganhoRealAnualPct.toFixed(2)),
        dataReferencia: ipcaMes?.data || selic?.data || null,
        origem: 'bcb_online'
      };
    } catch (erro) {
      console.warn('[MacroApiService] Falha ao consultar BCB:', erro.message);
      const taxaMensalCdiPct = (Math.pow(1 + fallback.cdiAnual / 100, 1 / 12) - 1) * 100;
      const ganhoRealAnualPct = (((1 + fallback.cdiAnual / 100) / (1 + fallback.ipca12m / 100)) - 1) * 100;
      return {
        ...fallback,
        taxaMensalCdiPct: Number(taxaMensalCdiPct.toFixed(4)),
        ganhoRealAnualPct: Number(ganhoRealAnualPct.toFixed(2))
      };
    }
  }

  static async consultarSerieBcb(codigoSerie) {
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigoSerie}/dados/ultimos/1?formato=json`;

    try {
      const resposta = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000)
      });

      if (!resposta.ok) return null;

      const json = await resposta.json();
      const registro = Array.isArray(json) ? json[0] : null;
      if (!registro || registro.valor === undefined) return null;

      const valorNum = Number(String(registro.valor).replace(',', '.'));
      if (Number.isNaN(valorNum)) return null;

      return {
        valor: valorNum,
        data: registro.data || null
      };
    } catch {
      return null;
    }
  }
}

module.exports = MacroApiService;