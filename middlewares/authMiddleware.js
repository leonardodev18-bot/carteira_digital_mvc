function exigirAutenticacao(req, res, next) {
  if (!req.session?.usuario) {
    return res.redirect('/login');
  }
  next();
}

module.exports = { exigirAutenticacao };