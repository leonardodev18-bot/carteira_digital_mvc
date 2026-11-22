const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, query, validationResult } = require('express-validator');
const { doubleCsrf } = require('csrf-csrf');

// 1. Cabeçalhos de segurança HTTP + Content Security Policy (CSP)
const configurarHelmet = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdn.jsdelivr.net"
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdn.jsdelivr.net",
        "https://fonts.googleapis.com"
      ],
      fontSrc: [
        "'self'",
        "https://cdn.jsdelivr.net",
        "https://fonts.gstatic.com"
      ],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
});

// 2. Proteção CSRF (Double Submit Cookie)
const {
  invalidCsrfTokenError,
  generateToken,
  doubleCsrfProtection
} = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET,
  cookieName: process.env.NODE_ENV === 'production' ? '__Host-psifi.x-csrf-token' : 'psifi.x-csrf-token',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: process.env.NODE_ENV === 'production'
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getTokenFromRequest: (req) => req.body?._csrf || req.headers['x-csrf-token']
});

function injetarTokenCsrf(req, res, next) {
  res.locals.csrfToken = generateToken(req, res);
  next();
}

// 3. Rate Limit geral (anti-DDoS e scraping abusivo)
const limiterGeral = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Muitas requisições deste IP. Tente novamente em alguns minutos.'
});

// 4. Rate Limit estrito para Login (anti-força bruta)
const limiterLogin = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    if (req.session) {
      req.session.aviso = 'Muitas tentativas de login. Aguarde 15 minutos antes de tentar novamente.';
    }
    return res.status(429).redirect('/login');
  }
});

// 5. Rate Limit para consultas externas da B3 (/api/investimentos/cotacao/:ticker)
const limiterApiCotacao = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { sucesso: false, erro: 'Limite de consultas atingido. Aguarde 1 minuto.' }
});

// 6. Validadores das rotas
const validarLogin = [
  body('email').trim().isEmail().withMessage('Informe um e-mail válido.').normalizeEmail(),
  body('senha').notEmpty().withMessage('Informe a senha.')
];

const validarMovimentacao = [
  body('descricao').trim().isLength({ min: 1, max: 150 }).withMessage('Descrição inválida.'),
  body('valor').isFloat({ gt: 0 }).withMessage('O valor deve ser maior que zero.'),
  body('categoria').isIn(['RECEITA', 'FIXA', 'VARIAVEL', 'RESERVA']).withMessage('Categoria inválida.'),
  body('mesInicio').optional().matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage('Mês de início inválido.')
];

const validarOrcamentoCompleto = [
  body('pctFixa').optional().isFloat({ min: 0, max: 100 }).withMessage('Percentual de despesas fixas inválido.'),
  body('pctVariavel').optional().isFloat({ min: 0, max: 100 }).withMessage('Percentual de despesas variáveis inválido.'),
  body('pctReserva').optional().isFloat({ min: 0, max: 100 }).withMessage('Percentual de reserva inválido.')
];

const validarExclusao = [
  body('id').notEmpty().withMessage('ID do lançamento inválido.')
];

const validarLimpar = [
  body('mes').optional().matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage('Mês inválido.')
];

const validarPreferencias = [
  body('tema').optional().isIn(['dark', 'light']).withMessage('Tema inválido.'),
  body('ocultarValores').optional().isIn(['true', 'false']).withMessage('Preferência de visibilidade inválida.'),
  body('mes').optional().matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage('Mês inválido.')
];

const validarMesQuery = [
  query('mes').optional().matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage('Formato de mês inválido.')
];

const validarAporte = [
  body('ticker').trim().isLength({ min: 1, max: 60 }).withMessage('Ticker ou nome inválido.'),
  body('classe').isIn(['FII', 'ACAO', 'RENDA_FIXA', 'RESERVA', 'CRIPTO']).withMessage('Classe inválida.'),
  body('quantidade').optional({ checkFalsy: true }).isFloat({ gt: 0, max: 100000000 }).withMessage('Quantidade inválida.'),
  body('precoPago').optional({ checkFalsy: true }).isFloat({ gt: 0, max: 100000000 }).withMessage('Valor inválido.'),
  body('ultimoDividendo').optional({ checkFalsy: true }).isFloat({ min: 0, max: 1000000 }).withMessage('Dividendo inválido.'),
  body('mes').optional().matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage('Mês inválido.')
];

const validarAtualizacaoAtivo = [
  body('id').isInt({ gt: 0 }).withMessage('ID de ativo inválido.'),
  body('quantidade').optional().isFloat({ gt: 0, max: 100000000 }).withMessage('Quantidade inválida.'),
  body('saldoAtual').optional().isFloat({ gt: 0, max: 1000000000 }).withMessage('Saldo inválido.')
];

function checarErrosValidacao(rotaRedirecionamento = '/') {
  return (req, res, next) => {
    const erros = validationResult(req);
    if (!erros.isEmpty()) {
      if (req.session) {
        req.session.aviso = erros.array()[0].msg;
      }
      return res.status(400).redirect(rotaRedirecionamento);
    }
    next();
  };
}

// 7. Sanitização contra bytes nulos e espaços excessivos
function sanitizarEntradas(req, res, next) {
  const limpar = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const chave of Object.keys(obj)) {
      if (typeof obj[chave] === 'string') {
        obj[chave] = obj[chave].replace(/\0/g, '').trim();
      } else if (typeof obj[chave] === 'object') {
        limpar(obj[chave]);
      }
    }
  };

  limpar(req.body);
  limpar(req.query);
  limpar(req.params);
  next();
}

module.exports = {
  configurarHelmet,
  doubleCsrfProtection,
  injetarTokenCsrf,
  invalidCsrfTokenError,
  limiterGeral,
  limiterLogin,
  limiterApiCotacao,
  validarLogin,
  validarMovimentacao,
  validarOrcamentoCompleto,
  validarExclusao,
  validarLimpar,
  validarPreferencias,
  validarMesQuery,
  validarAporte,
  validarAtualizacaoAtivo,
  checarErrosValidacao,
  sanitizarEntradas
};