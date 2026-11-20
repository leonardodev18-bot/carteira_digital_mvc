const pool = require('../config/db');

class UsuarioModel {
  static async buscarPorEmail(email) {
    const { rows } = await pool.query(
      'SELECT id, nome, email, senha_hash, tema, ocultar_valores, bloqueado_ate FROM usuarios WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    return rows[0] || null;
  }

  static async criar(nome, email, senhaHash) {
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash)
             VALUES ($1, $2, $3)
             RETURNING id, nome, email, tema, ocultar_valores`,
      [nome, email.toLowerCase().trim(), senhaHash]
    );
    return rows[0];
  }

  static async atualizarPreferenciasVisuais(usuarioId, tema, ocultarValores) {
    await pool.query(
      'UPDATE usuarios SET tema = $1, ocultar_valores = $2 WHERE id = $3',
      [tema, ocultarValores, usuarioId]
    );
  }
}

module.exports = UsuarioModel;