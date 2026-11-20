const pool = require('../config/db');

class AuditoriaModel {
  static async registrar({ usuarioId = null, email = null, acao, req, detalhes = null }) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0';
    const userAgent = req.headers['user-agent'] || null;

    await pool.query(
      `INSERT INTO logs_auditoria (usuario_id, email_tentativa, acao, ip_origem, user_agent, detalhes)
             VALUES ($1, $2, $3, $4::inet, $5, $6)`,
      [usuarioId, email, acao, ip, userAgent, detalhes ? JSON.stringify(detalhes) : null]
    );
  }

  static async registrarFalhaLogin(usuarioId) {
    await pool.query(
      `UPDATE usuarios
             SET tentativas_login = tentativas_login + 1,
                 bloqueado_ate = CASE 
                     WHEN tentativas_login + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
                     ELSE bloqueado_ate
                 END
             WHERE id = $1`,
      [usuarioId]
    );
  }

  static async resetarTentativas(usuarioId) {
    await pool.query(
      'UPDATE usuarios SET tentativas_login = 0, bloqueado_ate = NULL WHERE id = $1',
      [usuarioId]
    );
  }
}

module.exports = AuditoriaModel;