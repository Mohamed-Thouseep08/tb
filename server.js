require('dotenv').config();
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
require('./db');

const app = express();
const port = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
      imgSrc: ["'self'", 'data:', 'https://images.unsplash.com', 'https://api.qrserver.com'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  }
}));
app.use(express.json({ limit: '100kb' }));
app.use(session({
  name: 'saffron.sid',
  secret: process.env.SESSION_SECRET || 'demo-only-change-this-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));
app.get('/i18n/:lang.json', (req, res) => {
  if (!['en', 'ta', 'hi'].includes(req.params.lang)) return res.status(404).end();
  res.sendFile(path.join(__dirname, 'i18n', `${req.params.lang}.json`));
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/admin', adminRoutes);
app.use('/api', apiRoutes);

app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use((error, _req, res, _next) => {
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That record already exists.' });
  if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(409).json({ error: 'This record is in use and cannot be removed.' });
  console.error(error);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(port, () => console.log(`Saffron & Ember is running at http://localhost:${port}`));