const express = require('express');
const router = express.Router();
const InvestimentoController = require('../controllers/investimentoController');
const AuthController = require('../controllers/authController');
const CarteiraController = require('../controllers/carteiraController');
const { exigirAutenticacao } = require('../middlewares/authMiddleware');

const {
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
  checarErrosValidacao
} = require('../middlewares/securityMiddleware');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Autenticação
router.get('/login', AuthController.exibirLogin);
router.post('/login', limiterLogin, validarLogin, checarErrosValidacao('/login'), asyncHandler(AuthController.processarLogin));
router.post('/sair', exigirAutenticacao, AuthController.sair);

// Investimentos e Carteira B3 / BCB
router.get('/investimentos', exigirAutenticacao, validarMesQuery, checarErrosValidacao('/investimentos'), asyncHandler(InvestimentoController.index));
router.get('/api/investimentos/cotacao/:ticker', exigirAutenticacao, limiterApiCotacao, asyncHandler(InvestimentoController.consultarTicker));
router.post('/investimentos/aportar', exigirAutenticacao, validarAporte, checarErrosValidacao('/investimentos'), asyncHandler(InvestimentoController.aportar));
router.post('/investimentos/atualizar-quantidade', exigirAutenticacao, validarAtualizacaoAtivo, checarErrosValidacao('/investimentos'), asyncHandler(InvestimentoController.atualizarQuantidade));
router.post('/investimentos/atualizar-saldo', exigirAutenticacao, validarAtualizacaoAtivo, checarErrosValidacao('/investimentos'), asyncHandler(InvestimentoController.atualizarSaldo));
router.post('/investimentos/excluir', exigirAutenticacao, validarExclusao, checarErrosValidacao('/investimentos'), asyncHandler(InvestimentoController.excluir));

// Fluxo de Caixa / Gastos
router.get('/', exigirAutenticacao, validarMesQuery, checarErrosValidacao('/'), asyncHandler(CarteiraController.index));
router.post('/movimentacoes/adicionar', exigirAutenticacao, validarMovimentacao, checarErrosValidacao('/'), asyncHandler(CarteiraController.adicionar));
router.post('/movimentacoes/excluir', exigirAutenticacao, validarExclusao, checarErrosValidacao('/'), asyncHandler(CarteiraController.excluir));
router.post('/movimentacoes/limpar', exigirAutenticacao, validarLimpar, checarErrosValidacao('/'), asyncHandler(CarteiraController.limparTudo));
router.post('/orcamento', exigirAutenticacao, validarOrcamentoCompleto, checarErrosValidacao('/'), asyncHandler(CarteiraController.salvarOrcamento));
router.post('/preferencias', exigirAutenticacao, validarPreferencias, checarErrosValidacao('/'), asyncHandler(CarteiraController.atualizarPreferencias));
router.get('/exportar-csv', exigirAutenticacao, validarMesQuery, checarErrosValidacao('/'), asyncHandler(CarteiraController.exportarCsv));

module.exports = router;