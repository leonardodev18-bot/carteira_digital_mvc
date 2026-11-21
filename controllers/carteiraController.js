const UsuarioModel = require('../models/usuarioModel');
const OrcamentoModel = require('../models/orcamentoModel');
const MovimentacaoModel = require('../models/movimentacaoModel');
const AuditoriaModel = require('../models/auditoriaModel');

function obterMesAtual() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

class CarteiraController {
  static async index(req, res) {
    const usuarioSessao = req.session.usuario;
    const mes = req.query.mes || obterMesAtual();

    const usuario = await UsuarioModel.buscarPorEmail(usuarioSessao.email);
    const orcamento = await OrcamentoModel.obterPorUsuario(usuario.id);
    const extrato = await MovimentacaoModel.listarPorMes(usuario.id, mes);

    let receita = 0, fixas = 0, variaveis = 0, reserva = 0;
    extrato.forEach(item => {
      if (item.categoria === 'RECEITA') receita += item.valor;
      if (item.categoria === 'FIXA') fixas += item.valor;
      if (item.categoria === 'VARIAVEL') variaveis += item.valor;
      if (item.categoria === 'RESERVA') reserva += item.valor;
    });

    const despesasTotais = fixas + variaveis;
    const resultado = receita - despesasTotais - reserva;

    const pctFixa = Number(orcamento.pct_fixa);
    const pctVar = Number(orcamento.pct_variavel);
    const pctRes = Number(orcamento.pct_reserva);

    const aviso = req.session.aviso || null;
    delete req.session.aviso;

    res.render('dashboard', {
      usuario,
      mes,
      aviso,
      orcamento,
      extrato,
      moeda: (v, sinal = '') => {
        if (usuario.ocultar_valores) return 'R$ ***';
        return sinal + Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      },
      kpis: {
        receita,
        despesasTotais,
        fixas,
        variaveis,
        reserva,
        resultado,
        pctDespesas: receita > 0 ? ((despesasTotais / receita) * 100).toFixed(1) : '0.0',
        pctFixas: receita > 0 ? ((fixas / receita) * 100).toFixed(1) : '0.0',
        pctVariaveis: receita > 0 ? ((variaveis / receita) * 100).toFixed(1) : '0.0',
        pctReserva: receita > 0 ? ((reserva / receita) * 100).toFixed(1) : '0.0',
        pctResultado: receita > 0 ? ((resultado / receita) * 100).toFixed(1) : '0.0',
        tetoFixas: receita * (pctFixa / 100),
        tetoVariaveis: receita * (pctVar / 100),
        metaReserva: receita * (pctRes / 100)
      }
    });
  }

  static async adicionar(req, res) {
    const { descricao, valor, categoria, mesInicio, recorrente } = req.body;
    const usuarioId = req.session.usuario.id;
    const isFixo = recorrente === 'true';

    await MovimentacaoModel.criar({
      usuarioId,
      descricao: descricao.trim(),
      valor: parseFloat(valor),
      categoria,
      mesInicio,
      recorrente: isFixo
    });

    req.session.aviso = isFixo
      ? `"${descricao}" fixado para todos os meses!`
      : `"${descricao}" adicionado com sucesso!`;

    res.redirect(`/?mes=${mesInicio}`);
  }

  static async salvarOrcamento(req, res) {
    const usuarioId = req.session.usuario.id;
    const { tipoMetodo, mes } = req.body;
    let pctFixa, pctVariavel, pctReserva;

    if (tipoMetodo !== 'custom') {
      [pctFixa, pctVariavel, pctReserva] = tipoMetodo.split('-').map(Number);
    } else {
      pctFixa = Math.round(Number(req.body.pctFixa) * 100) / 100;
      pctVariavel = Math.round(Number(req.body.pctVariavel) * 100) / 100;
      pctReserva = Math.round(Number(req.body.pctReserva) * 100) / 100;
    }

    const soma = Math.round((pctFixa + pctVariavel + pctReserva) * 100) / 100;

    if (Number.isNaN(soma) || soma !== 100) {
      req.session.aviso = 'A soma das porcentagens precisa ser exatamente 100%.';
      return res.redirect(`/?mes=${mes}`);
    }

    await OrcamentoModel.salvar(usuarioId, tipoMetodo, pctFixa, pctVariavel, pctReserva);
    req.session.aviso = `Método ${pctFixa}/${pctVariavel}/${pctReserva} aplicado!`;
    res.redirect(`/?mes=${mes}`);
  }

  static async atualizarPreferencias(req, res) {
    const usuarioId = req.session.usuario.id;
    const { tema, ocultarValores, mes } = req.body;
    await UsuarioModel.atualizarPreferenciasVisuais(usuarioId, tema, ocultarValores === 'true');
    const destino = req.body.origem === 'investimentos' ? '/investimentos' : `/?mes=${mes}`;
    res.redirect(destino);
  }

  static async excluir(req, res) {
    const usuarioId = req.session.usuario.id;
    const { id, mes, modo } = req.body;
    await MovimentacaoModel.excluirIndividual(id, usuarioId, mes, modo);
    req.session.aviso = 'Movimentação removida.';
    res.redirect(`/?mes=${mes}`);
  }

  static async limparTudo(req, res) {
    const usuarioId = req.session.usuario.id;
    const { mes, tudoDefinitivo } = req.body;
    const definitivo = tudoDefinitivo === 'true';

    await MovimentacaoModel.limparTudo(usuarioId, mes, definitivo);
    await AuditoriaModel.registrar({
      usuarioId,
      email: req.session.usuario.email,
      acao: 'EXCLUIR_TUDO',
      req,
      detalhes: { mes, definitivo }
    });

    req.session.aviso = definitivo
      ? 'Todas as movimentações foram excluídas!'
      : `Movimentações de ${mes} removidas!`;

    res.redirect(`/?mes=${mes}`);
  }

  static async exportarCsv(req, res) {
    const usuarioId = req.session.usuario.id;
    const mes = req.query.mes || obterMesAtual();
    const lista = await MovimentacaoModel.listarPorMes(usuarioId, mes);

    const sanitizarCelulaCsv = (texto) => {
      const limpo = String(texto).replace(/;/g, ',').replace(/[\r\n]+/g, ' ');
      return /^[=+\-@\t\r]/.test(limpo) ? `'${limpo}` : limpo;
    };

    let csv = '\uFEFFMes;Data;Descricao;Categoria;Fixo;Valor\n';
    lista.forEach(t => {
      const fixo = t.recorrente ? 'Sim' : 'Nao';
      const descSegura = sanitizarCelulaCsv(t.descricao);
      csv += `${mes};${t.data_formatada};${descSegura};${t.categoria};${fixo};${t.valor.toFixed(2).replace('.', ',')}\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="controle_gastos_${mes}.csv"`);
    res.send(csv);
  }
}

module.exports = CarteiraController;