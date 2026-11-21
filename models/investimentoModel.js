const db = require('../config/db');

class InvestimentoModel {
  static async listarPorUsuario(usuarioId) {
    const sql = `
            SELECT id, ticker, classe,
                   quantidade::float AS quantidade,
                   preco_medio::float AS preco_medio,
                   cotacao_atual::float AS cotacao_atual,
                   ultimo_dividendo::float AS ultimo_dividendo,
                   pvp::float AS pvp,
                   meta_alocacao_pct::float AS meta_alocacao_pct
            FROM ativos_investimento
            WHERE usuario_id = $1
            ORDER BY (quantidade * cotacao_atual) DESC, ticker ASC
        `;
    const { rows } = await db.query(sql, [usuarioId]);
    return rows;
  }

  static async registrarAporte({ usuarioId, ticker, classe, quantidade, precoPago, cotacaoAtual, ultimoDividendo, pvp }) {
    const isRendaFixaOuReserva = classe === 'RESERVA' || classe === 'RENDA_FIXA';
    const tickerNorm = isRendaFixaOuReserva
      ? ticker.trim()
      : ticker.trim().toUpperCase();

    const existente = await db.query(
      'SELECT id, quantidade::float, preco_medio::float, cotacao_atual::float, ultimo_dividendo::float FROM ativos_investimento WHERE usuario_id = $1 AND ticker = $2',
      [usuarioId, tickerNorm]
    );

    if (existente.rows.length > 0) {
      const atual = existente.rows[0];

      // Para Caixinha / Renda Fixa, mantém Qtd = 1 e soma o novo aporte ao capital aplicado e ao saldo atual
      if (isRendaFixaOuReserva) {
        const valorAporte = quantidade * precoPago;
        const novoAplicado = atual.preco_medio + valorAporte;
        const novoSaldo = atual.cotacao_atual + valorAporte;
        const novoRendimento = ultimoDividendo > 0 ? ultimoDividendo : atual.ultimo_dividendo;

        await db.query(
          `UPDATE ativos_investimento
                     SET classe = $1,
                         quantidade = 1,
                         preco_medio = $2::numeric,
                         cotacao_atual = $3::numeric,
                         ultimo_dividendo = $4::numeric,
                         atualizado_em = CURRENT_TIMESTAMP
                     WHERE id = $5 AND usuario_id = $6`,
          [classe, novoAplicado, novoSaldo, novoRendimento, atual.id, usuarioId]
        );
        return;
      }

      const novaQtd = atual.quantidade + quantidade;
      const novoPm = novaQtd > 0
        ? ((atual.quantidade * atual.preco_medio) + (quantidade * precoPago)) / novaQtd
        : precoPago;

      await db.query(
        `UPDATE ativos_investimento
                 SET classe = $1,
                     quantidade = $2::numeric,
                     preco_medio = $3::numeric,
                     cotacao_atual = $4::numeric,
                     ultimo_dividendo = $5::numeric,
                     pvp = $6::numeric,
                     atualizado_em = CURRENT_TIMESTAMP
                 WHERE id = $7 AND usuario_id = $8`,
        [
          classe,
          novaQtd,
          novoPm,
          cotacaoAtual || precoPago,
          ultimoDividendo || 0,
          pvp ?? null,
          atual.id,
          usuarioId
        ]
      );
      return;
    }

    const qtdInicial = isRendaFixaOuReserva ? 1 : quantidade;
    const valorInicial = isRendaFixaOuReserva ? (quantidade * precoPago) : precoPago;

    await db.query(
      `INSERT INTO ativos_investimento
                (usuario_id, ticker, classe, quantidade, preco_medio, cotacao_atual, ultimo_dividendo, pvp)
             VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::numeric)`,
      [
        usuarioId,
        tickerNorm,
        classe,
        qtdInicial,
        valorInicial,
        cotacaoAtual ? (isRendaFixaOuReserva ? quantidade * cotacaoAtual : cotacaoAtual) : valorInicial,
        ultimoDividendo || 0,
        pvp ?? null
      ]
    );
  }

  static async atualizarDadosMercado(usuarioId, ticker, { cotacaoAtual, ultimoDividendo, pvp }) {
    const sql = `
            UPDATE ativos_investimento
            SET cotacao_atual = CASE WHEN $1::numeric > 0 THEN $1::numeric ELSE cotacao_atual END,
                ultimo_dividendo = CASE WHEN $2::numeric > 0 THEN $2::numeric ELSE ultimo_dividendo END,
                pvp = COALESCE($3::numeric, pvp),
                atualizado_em = CURRENT_TIMESTAMP
            WHERE usuario_id = $4 AND ticker = $5
        `;
    await db.query(sql, [cotacaoAtual || 0, ultimoDividendo || 0, pvp ?? null, usuarioId, ticker]);
  }

  static async atualizarQuantidade(id, usuarioId, novaQuantidade) {
    const sql = `
            UPDATE ativos_investimento
            SET quantidade = $1::numeric,
                atualizado_em = CURRENT_TIMESTAMP
            WHERE id = $2 AND usuario_id = $3
        `;
    await db.query(sql, [novaQuantidade, id, usuarioId]);
  }

  static async atualizarSaldo(id, usuarioId, novoSaldo) {
    const sql = `
            UPDATE ativos_investimento
            SET cotacao_atual = $1::numeric,
                atualizado_em = CURRENT_TIMESTAMP
            WHERE id = $2 AND usuario_id = $3
        `;
    await db.query(sql, [novoSaldo, id, usuarioId]);
  }

  static async excluir(id, usuarioId) {
    const ativoRes = await db.query(
      'SELECT ticker, classe FROM ativos_investimento WHERE id = $1 AND usuario_id = $2',
      [id, usuarioId]
    );

    if (ativoRes.rows.length === 0) {
      return null;
    }

    const ativo = ativoRes.rows[0];
    const tickerLimpo = ativo.ticker.trim();
    const descReservaExata = `Reserva: ${tickerLimpo}`;
    const prefixoAporte = `Aporte: ${tickerLimpo} (`;

    await db.query(
      'DELETE FROM ativos_investimento WHERE id = $1 AND usuario_id = $2',
      [id, usuarioId]
    );

    // Remove também os lançamentos vinculados na categoria RESERVA (tela de Gastos)
    await db.query(
      `DELETE FROM movimentacoes
             WHERE usuario_id = $1
               AND categoria = 'RESERVA'
               AND (
                   LOWER(descricao) = LOWER($2)
                   OR LEFT(UPPER(descricao), LENGTH($3)) = UPPER($3)
               )`,
      [usuarioId, descReservaExata, prefixoAporte]
    );

    return ativo;
  }
}

module.exports = InvestimentoModel;