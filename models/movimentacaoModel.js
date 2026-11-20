const pool = require('../config/db');

class MovimentacaoModel {
  static async criar({ usuarioId, descricao, valor, categoria, mesInicio, recorrente }) {
    await pool.query(
      `INSERT INTO movimentacoes (usuario_id, descricao, valor, categoria, data_registro, mes_inicio, recorrente)
             VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6)`,
      [usuarioId, descricao, valor, categoria, mesInicio, recorrente]
    );
  }

  static async listarPorMes(usuarioId, mesSelecionado) {
    const { rows } = await pool.query(
      `SELECT 
                m.id,
                m.descricao,
                m.valor::FLOAT AS valor,
                m.categoria,
                TO_CHAR(m.data_registro, 'DD/MM/YYYY') AS data_formatada,
                m.mes_inicio,
                m.recorrente
             FROM movimentacoes m
             LEFT JOIN movimentacoes_meses_excluidos ex 
                ON ex.movimentacao_id = m.id 
               AND ex.mes_referencia = $2
             WHERE m.usuario_id = $1
               AND ex.movimentacao_id IS NULL
               AND (
                   (m.recorrente = FALSE AND m.mes_inicio = $2)
                   OR
                   (m.recorrente = TRUE AND m.mes_inicio <= $2 AND (m.mes_fim IS NULL OR m.mes_fim >= $2))
               )
             ORDER BY 
                CASE WHEN m.recorrente THEN 0 ELSE 1 END ASC,
                CASE m.categoria
                    WHEN 'RECEITA'  THEN 1
                    WHEN 'FIXA'     THEN 2
                    WHEN 'VARIAVEL' THEN 3
                    WHEN 'RESERVA'  THEN 4
                    ELSE 5
                END ASC,
                m.id ASC`,
      [usuarioId, mesSelecionado]
    );
    return rows;
  }

  static async excluirIndividual(id, usuarioId, mesAtual, modo) {
    if (modo === 'apenas-mes') {
      await pool.query(
        `INSERT INTO movimentacoes_meses_excluidos (movimentacao_id, mes_referencia)
                 SELECT id, $3 FROM movimentacoes WHERE id = $1 AND usuario_id = $2
                 ON CONFLICT DO NOTHING`,
        [id, usuarioId, mesAtual]
      );
      return;
    }

    if (modo === 'todos-futuros') {
      await pool.query(
        'DELETE FROM movimentacoes WHERE id = $1 AND usuario_id = $2 AND mes_inicio >= $3',
        [id, usuarioId, mesAtual]
      );
      await pool.query(
        `UPDATE movimentacoes
                 SET mes_fim = TO_CHAR((TO_DATE($3 || '-01', 'YYYY-MM-DD') - INTERVAL '1 month'), 'YYYY-MM')
                 WHERE id = $1 AND usuario_id = $2 AND mes_inicio < $3`,
        [id, usuarioId, mesAtual]
      );
      return;
    }

    await pool.query(
      'DELETE FROM movimentacoes WHERE id = $1 AND usuario_id = $2',
      [id, usuarioId]
    );
  }

  static async limparTudo(usuarioId, mesAtual, tudoDefinitivo) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (tudoDefinitivo) {
        await client.query('DELETE FROM movimentacoes WHERE usuario_id = $1', [usuarioId]);
      } else {
        await client.query(
          'DELETE FROM movimentacoes WHERE usuario_id = $1 AND recorrente = FALSE AND mes_inicio = $2',
          [usuarioId, mesAtual]
        );
        await client.query(
          `INSERT INTO movimentacoes_meses_excluidos (movimentacao_id, mes_referencia)
                     SELECT m.id, $2
                     FROM movimentacoes m
                     LEFT JOIN movimentacoes_meses_excluidos ex 
                        ON ex.movimentacao_id = m.id AND ex.mes_referencia = $2
                     WHERE m.usuario_id = $1
                       AND m.recorrente = TRUE
                       AND m.mes_inicio <= $2
                       AND (m.mes_fim IS NULL OR m.mes_fim >= $2)
                       AND ex.movimentacao_id IS NULL`,
          [usuarioId, mesAtual]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = MovimentacaoModel;