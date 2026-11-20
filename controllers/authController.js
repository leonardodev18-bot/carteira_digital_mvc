const bcrypt = require('bcryptjs');
const UsuarioModel = require('../models/usuarioModel');
const AuditoriaModel = require('../models/auditoriaModel');

class AuthController {
  static exibirLogin(req, res) {
    if (req.session.usuario) return res.redirect('/');
    res.render('login', { erro: null });
  }

  static async processarLogin(req, res) {
    const { email, senha, lembrar } = req.body;
    let usuario = await UsuarioModel.buscarPorEmail(email);

    if (usuario?.bloqueado_ate && new Date(usuario.bloqueado_ate) > new Date()) {
      await AuditoriaModel.registrar({ usuarioId: usuario.id, email, acao: 'LOGIN_BLOQUEADO', req });
      return res.status(423).render('login', {
        erro: 'Conta temporariamente bloqueada por excesso de tentativas. Aguarde 15 minutos.'
      });
    }

    if (!usuario) {
      const nome = email.split('@')[0];
      const hash = await bcrypt.hash(senha, 12);
      usuario = await UsuarioModel.criar(nome, email, hash);
    } else {
      const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
      if (!senhaValida) {
        await AuditoriaModel.registrarFalhaLogin(usuario.id);
        await AuditoriaModel.registrar({ usuarioId: usuario.id, email, acao: 'LOGIN_FALHA', req });
        return res.status(401).render('login', { erro: 'E-mail ou senha inválidos.' });
      }
    }

    await AuditoriaModel.resetarTentativas(usuario.id);
    await AuditoriaModel.registrar({ usuarioId: usuario.id, email, acao: 'LOGIN_SUCESSO', req });

    req.session.regenerate((err) => {
      if (err) throw err;

      req.session.usuario = {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email
      };

      if (lembrar) {
        req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
      }

      req.session.save(() => res.redirect('/'));
    });
  }

  static sair(req, res) {
    req.session.destroy(() => {
      res.clearCookie('sid_carteira');
      res.redirect('/login');
    });
  }
}

module.exports = AuthController;