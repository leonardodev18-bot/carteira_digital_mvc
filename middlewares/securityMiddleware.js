const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { doubleCsrf } = require('csrf-csrf');
const { body, query, validationResult } = require('express-validator');

const configurarHelmet = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
});

const limiterLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).render('login', {
      erro: 'Muitas tentativas de acesso. Aguarde 15 minutos e tente novamente.'
    });
  }
});

const limiterGeral = rateLimit({
  windowMs: 60 * 1000,
  max: 120
});

const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET,
  cookieName: 'psifi.x-csrf-token',
  cookieOptions: {
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    signed: true
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getTokenFromRequest: (req) => req.body?._csrf || req.headers['x-csrf-token']
});

function injetarTokenCsrf(req, res, next) {
  res.locals.csrfToken = generateToken(req, res);
  next();
}

const validarLogin = [
  body('email').isEmail().normalizeEmail().withMessage('E-mail inválido.'),
  body('senha').isLength({ min: 8, max: 128 }).withMessage('A senha deve ter entre 8 e 128 caracteres.')
];

const validarMovimentacao = [
  body('descricao').trim().escape().isLength({ min: 1, max: 150 }).withMessage('Descrição inválida.'),
  body('valor').isFloat({ min: 0.01, max: 999999999.99 }).withMessage('Valor inválido.'),
  body('categoria').isIn(['RECEITA', 'FIXA', 'VARIAVEL', 'RESERVA']).withMessage('Categoria inválida.'),
  body('mesInicio').matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage('Mês inválido.')
];

const validarExclusao = [
  body('id').isInt({ min: 1 }).withMessage('ID inválido.'),
  body('mes').matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage('Mês inválido.'),
  body('modo').isIn(['simples', 'apenas-mes', 'todos-futuros']).withMessage('Modo inválido.')
];

const validarLimpar = [
  body('mes').matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage('Mês inválido.'),
  body('tudoDefinitivo').isIn(['true', 'false']).withMessage('Parâmetro inválido.')
];

const validarPreferencias = [
  body('tema').isIn(['dark', 'light']).withMessage('Tema inválido.'),
  body('ocultarValores').isIn(['true', 'false']).withMessage('Parâmetro inválido.'),
  body('mes').matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage('Mês inválido.')
];

const validarOrcamentoCompleto = [
  body('tipoMetodo').isIn(['50-30-20', '70-20-10', '60-30-10', '60-20-20', 'custom']),
  body('mes').matches(/^\d{4}-(0[1-9]|1[0-2])$/),
  body('pctFixa').optional().isFloat({ min: 0, max: 100 }),
  body('pctVariavel').optional().isFloat({ min: 0, max: 100 }),
  body('pctReserva').optional().isFloat({ min: 0, max: 100 })
];

const validarMesQuery = [
  query('mes').optional().matches(/^\d{4}-(0[1-9]|1[0-2])$/)
];

function checarErrosValidacao(redirectFallback = '/') {
  return (req, res, next) => {
    const erros = validationResult(req);
    if (!erros.isEmpty()) {
      if (req.path === '/login') {
        return res.status(400).render('login', { erro: erros.array()[0].msg });
      }
      req.session.aviso = `Dados inválidos: ${erros.array()[0].msg}`;
      return res.redirect(redirectFallback);
    }
    next();
  };
}

module.exports = {
  configurarHelmet,
  limiterLogin,
  limiterGeral,
  doubleCsrfProtection,
  injetarTokenCsrf,
  validarLogin,
  validarMovimentacao,
  validarExclusao,
  validarLimpar,
  validarPreferencias,
  validarOrcamentoCompleto,
  validarMesQuery,
  checarErrosValidacao
};