const pool = require('../config/db');

class OrcamentoModel {
  static async obterPorUsuario(usuarioId) {
    const { rows } = await pool.query(
      'SELECT usuario_id, tipo_metodo, pct_fixa, pct_variavel, pct_reserva FROM preferencias_orcamento WHERE usuario_id = $1',
      [usuarioId]
    );
    return rows[0] || {
      usuario_id: usuarioId,
      tipo_metodo: '50-30-20',
      pct_fixa: 50,
      pct_variavel: 30,
      pct_reserva: 20
    };
  }

  static async salvar(usuarioId, tipoMetodo, pctFixa, pctVariavel, pctReserva) {
    await pool.query(
      `INSERT INTO preferencias_orcamento (usuario_id, tipo_metodo, pct_fixa, pct_variavel, pct_reserva)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (usuario_id) DO UPDATE SET
                tipo_metodo = EXCLUDED.tipo_metodo,
                pct_fixa = EXCLUDED.pct_fixa,
                pct_variavel = EXCLUDED.pct_variavel,
                pct_reserva = EXCLUDED.pct_reserva`,
      [usuarioId, tipoMetodo, pctFixa, pctVariavel, pctReserva]
    );
  }
}

module.exports = OrcamentoModel;