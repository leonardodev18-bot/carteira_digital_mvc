require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const webRoutes = require('./routes/webRoutes');
const {
  configurarHelmet,
  limiterGeral,
  doubleCsrfProtection,
  injetarTokenCsrf,
  sanitizarEntradas
} = require('./middlewares/securityMiddleware');

const variaveisObrigatorias = ['DATABASE_URL', 'SESSION_SECRET', 'CSRF_SECRET'];
for (const variavel of variaveisObrigatorias) {
  if (!process.env[variavel]) {
    console.error(`[ERRO CRÍTICO] A variável de ambiente ${variavel} não foi definida no .env.`);
    process.exit(1);
  }
}

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(configurarHelmet);
app.use(limiterGeral);
app.use(cookieParser(process.env.CSRF_SECRET));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(sanitizarEntradas);

app.use(session({
  name: 'sid_carteira',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 2 * 60 * 60 * 1000
  }
}));

app.use(doubleCsrfProtection);
app.use(injetarTokenCsrf);

app.use('/', webRoutes);

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).send('Sessão expirada ou requisição inválida (CSRF). Atualize a página e tente novamente.');
  }
  console.error('[ERRO INTERNO]:', err);
  res.status(500).send('Ocorreu um erro interno inesperado. Tente novamente.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor MVC seguro rodando em http://localhost:${PORT}`));