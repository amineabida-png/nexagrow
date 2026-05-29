require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fetch = require('node-fetch');
const { v4: uuid } = require('uuid');
const cron = require('node-cron');
const { loadDB, saveDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nexagrow_secret_2026';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// ── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.cookies?.token || req.headers?.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { res.status(401).json({ error: 'Token invalide' }); }
}

function requireSuperAdmin(req, res, next) {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé — Super Admin uniquement' });
  next();
}

function checkPlanExpiry(req, res, next) {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });
  if (!user.active) return res.status(403).json({ error: 'Compte désactivé' });
  if (user.plan !== 'lifetime' && user.planExpiry) {
    if (new Date() > new Date(user.planExpiry)) {
      return res.status(403).json({ error: 'Abonnement expiré. Contactez superadmin@nexagrow.ma' });
    }
  }
  next();
}

// ── GROQ ─────────────────────────────────────────────────────────────────────
async function callGroq(messages, maxTokens = 1200) {
  if (!GROQ_KEY) throw new Error('Clé Groq API manquante.');
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY },
    body: JSON.stringify({ model: GROQ_MODEL, messages, max_tokens: maxTokens, temperature: 0.7 })
  });
  if (!res.ok) throw new Error('Groq error: ' + await res.text());
  const data = await res.json();
  return data.choices[0].message.content;
}

const SYSTEM_PROMPT = `Tu es l'agent IA de NexaGrow, suite marketing pour PME marocaines.
Tu parles français, darija marocaine et anglais selon la langue de l'utilisateur.
Tu es expert en Meta Ads, Google Ads, TikTok Ads, Shopify, WooCommerce, e-commerce Maroc.
Réponds de façon professionnelle, concise et actionnable avec des chiffres précis.`;

// ═══════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  const db = loadDB();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  if (!user.active) return res.status(403).json({ error: 'Compte désactivé. Contactez l\'administrateur.' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  if (user.plan !== 'lifetime' && user.planExpiry && new Date() > new Date(user.planExpiry)) {
    return res.status(403).json({ error: 'Abonnement expiré. Contactez superadmin@nexagrow.ma pour renouveler.' });
  }
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name, company: user.company, plan: user.plan }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 30*86400000, sameSite: 'lax' });
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, company: user.company, plan: user.plan, planLabel: user.planLabel, planExpiry: user.planExpiry } });
});

app.post('/api/auth/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });

app.get('/api/auth/me', auth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, company: user.company, plan: user.plan, planLabel: user.planLabel, planExpiry: user.planExpiry, active: user.active } });
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, company } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Champs obligatoires manquants' });
  const db = loadDB();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: 'Email déjà utilisé' });
  const hash = await bcrypt.hash(password, 10);
  const now = new Date();
  const user = {
    id: uuid(), email, name, password: hash, role: 'user', company: company || '',
    plan: 'monthly', planLabel: '30 jours', planPrice: 500,
    planExpiry: new Date(now.getTime() + 30*86400000).toISOString(),
    active: true, createdAt: now.toISOString()
  };
  db.users.push(user);
  saveDB(db);
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name, company: user.company, plan: user.plan }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 30*86400000, sameSite: 'lax' });
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, company: user.company, plan: user.plan } });
});

// ═══════════════════════════════════════════════════════
// SUPER ADMIN — GESTION UTILISATEURS
// ═══════════════════════════════════════════════════════

// Lister tous les utilisateurs
app.get('/api/admin/users', auth, requireSuperAdmin, (req, res) => {
  const db = loadDB();
  const users = db.users.map(u => ({
    id: u.id, email: u.email, name: u.name, role: u.role,
    company: u.company, plan: u.plan, planLabel: u.planLabel,
    planPrice: u.planPrice, planExpiry: u.planExpiry,
    active: u.active, createdAt: u.createdAt
  }));
  res.json(users);
});

// Créer un utilisateur
app.post('/api/admin/users', auth, requireSuperAdmin, async (req, res) => {
  const { email, password, name, company, plan } = req.body;
  if (!email || !password || !name || !plan) return res.status(400).json({ error: 'Champs obligatoires manquants' });
  const db = loadDB();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: 'Email déjà utilisé' });
  const hash = await bcrypt.hash(password, 10);
  const now = new Date();
  const planDef = db.plans?.find(p => p.id === plan) || { label: plan, days: 30, price: 500 };
  const expiry = planDef.days ? new Date(now.getTime() + planDef.days*86400000).toISOString() : null;
  const user = {
    id: uuid(), email, name, password: hash, role: 'user', company: company || '',
    plan: planDef.id || plan, planLabel: planDef.label,
    planPrice: planDef.price, planExpiry: expiry,
    active: true, createdAt: now.toISOString()
  };
  db.users.push(user);
  saveDB(db);
  res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, planExpiry: user.planExpiry } });
});

// Modifier un utilisateur (plan, statut, etc.)
app.put('/api/admin/users/:id', auth, requireSuperAdmin, async (req, res) => {
  const db = loadDB();
  const idx = db.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const { plan, active, name, company, password } = req.body;
  const user = db.users[idx];
  if (plan) {
    const planDef = db.plans?.find(p => p.id === plan) || { label: plan, days: 30, price: 500 };
    user.plan = planDef.id || plan;
    user.planLabel = planDef.label;
    user.planPrice = planDef.price;
    user.planExpiry = planDef.days ? new Date(Date.now() + planDef.days*86400000).toISOString() : null;
  }
  if (active !== undefined) user.active = active;
  if (name) user.name = name;
  if (company) user.company = company;
  if (password) user.password = await bcrypt.hash(password, 10);
  db.users[idx] = user;
  saveDB(db);
  res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, planExpiry: user.planExpiry, active: user.active } });
});

// Supprimer un utilisateur
app.delete('/api/admin/users/:id', auth, requireSuperAdmin, (req, res) => {
  const db = loadDB();
  if (req.params.id === 'superadmin') return res.status(403).json({ error: 'Impossible de supprimer le Super Admin' });
  db.users = db.users.filter(u => u.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// Stats globales
app.get('/api/admin/stats', auth, requireSuperAdmin, (req, res) => {
  const db = loadDB();
  const now = new Date();
  const active = db.users.filter(u => u.active && u.role !== 'superadmin');
  const expired = db.users.filter(u => u.planExpiry && new Date(u.planExpiry) < now);
  const revenue = db.users.filter(u => u.planPrice).reduce((a, u) => a + (u.planPrice || 0), 0);
  const byPlan = { monthly: 0, yearly: 0, lifetime: 0 };
  db.users.forEach(u => { if (byPlan[u.plan] !== undefined) byPlan[u.plan]++; });
  res.json({ totalUsers: active.length, expiredUsers: expired.length, totalRevenue: revenue, byPlan, users: db.users.length });
});

// ═══════════════════════════════════════════════════════
// CAMPAIGNS
// ═══════════════════════════════════════════════════════
app.get('/api/campaigns', auth, checkPlanExpiry, (req, res) => {
  const db = loadDB();
  const uid = (req.user.role === 'demo' || req.user.role === 'superadmin') ? '2' : req.user.id;
  res.json(db.campaigns.filter(c => c.userId === uid));
});
app.post('/api/campaigns', auth, checkPlanExpiry, (req, res) => {
  const db = loadDB();
  const camp = { id: uuid(), userId: req.user.id, createdAt: new Date().toISOString(), ...req.body };
  db.campaigns.push(camp); saveDB(db); res.json(camp);
});
app.put('/api/campaigns/:id', auth, checkPlanExpiry, (req, res) => {
  const db = loadDB();
  const idx = db.campaigns.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Introuvable' });
  db.campaigns[idx] = { ...db.campaigns[idx], ...req.body, id: req.params.id };
  saveDB(db); res.json(db.campaigns[idx]);
});
app.delete('/api/campaigns/:id', auth, checkPlanExpiry, (req, res) => {
  const db = loadDB();
  db.campaigns = db.campaigns.filter(c => c.id !== req.params.id);
  saveDB(db); res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════
app.get('/api/products', auth, checkPlanExpiry, (req, res) => {
  const db = loadDB();
  const uid = (req.user.role === 'demo' || req.user.role === 'superadmin') ? '2' : req.user.id;
  res.json(db.products.filter(p => p.userId === uid));
});
app.post('/api/products', auth, checkPlanExpiry, (req, res) => {
  const db = loadDB();
  const prod = { id: uuid(), userId: req.user.id, createdAt: new Date().toISOString(), ...req.body };
  db.products.push(prod); saveDB(db); res.json(prod);
});
app.put('/api/products/:id', auth, checkPlanExpiry, (req, res) => {
  const db = loadDB();
  const idx = db.products.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Introuvable' });
  db.products[idx] = { ...db.products[idx], ...req.body, id: req.params.id };
  saveDB(db); res.json(db.products[idx]);
});
app.delete('/api/products/:id', auth, checkPlanExpiry, (req, res) => {
  const db = loadDB();
  db.products = db.products.filter(p => p.id !== req.params.id);
  saveDB(db); res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════
// ALERTS & INTEGRATIONS & ANALYTICS
// ═══════════════════════════════════════════════════════
app.get('/api/alerts', auth, (req, res) => {
  const db = loadDB();
  const uid = (req.user.role === 'demo' || req.user.role === 'superadmin') ? '2' : req.user.id;
  res.json(db.alerts.filter(a => a.userId === uid));
});
app.put('/api/alerts/:id/read', auth, (req, res) => {
  const db = loadDB();
  const a = db.alerts.find(x => x.id === req.params.id);
  if (a) { a.read = true; saveDB(db); }
  res.json({ ok: true });
});
app.get('/api/integrations', auth, (req, res) => {
  const db = loadDB();
  res.json(db.integrations[req.user.id] || { meta:true, google:true, tiktok:false, shopify:true, woo:false, presta:false });
});
app.put('/api/integrations', auth, (req, res) => {
  const db = loadDB();
  db.integrations[req.user.id] = req.body;
  saveDB(db); res.json(req.body);
});
app.get('/api/analytics/overview', auth, checkPlanExpiry, (req, res) => {
  const db = loadDB();
  const uid = (req.user.role === 'demo' || req.user.role === 'superadmin') ? '2' : req.user.id;
  const camps = db.campaigns.filter(c => c.userId === uid);
  const totalSpend = camps.reduce((a,c)=>a+c.spend,0);
  const totalRev = camps.reduce((a,c)=>a+c.revenue,0);
  res.json({
    roas: totalSpend ? parseFloat((totalRev/totalSpend).toFixed(1)) : 0,
    revenue: 124000, spend: totalSpend, cpa: 38, margin: 31,
    orders: 1184, avgCart: 347, abandonRate: 23,
    revenueHistory: [38,52,47,61,58,73,69,84,79,91,88,124],
    months: ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']
  });
});

// ═══════════════════════════════════════════════════════
// AI ROUTES
// ═══════════════════════════════════════════════════════
app.post('/api/ai/chat', auth, checkPlanExpiry, async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: 'Messages invalides' });
  try {
    const db = loadDB();
    const uid = (req.user.role === 'demo' || req.user.role === 'superadmin') ? '2' : req.user.id;
    const camps = db.campaigns.filter(c => c.userId === uid);
    const prods = db.products.filter(p => p.userId === uid);
    const ctx = `Données: Campagnes: ${camps.map(c=>`${c.name} ROAS:${c.roas}× CPA:${c.cpa}MAD`).join(', ')} | Produits: ${prods.map(p=>`${p.name} stock:${p.stock} marge:${p.margin}%`).join(', ')}`;
    const reply = await callGroq([{ role:'system', content: SYSTEM_PROMPT+'\n'+ctx }, ...messages.slice(-20)], 1200);
    if (!db.chatHistories) db.chatHistories = {};
    if (!db.chatHistories[req.user.id]) db.chatHistories[req.user.id] = [];
    db.chatHistories[req.user.id].push({ role:'user', content: messages[messages.length-1].content, ts: new Date().toISOString() });
    db.chatHistories[req.user.id].push({ role:'assistant', content: reply, ts: new Date().toISOString() });
    if (db.chatHistories[req.user.id].length > 100) db.chatHistories[req.user.id] = db.chatHistories[req.user.id].slice(-100);
    saveDB(db);
    res.json({ reply });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ai/report', auth, checkPlanExpiry, async (req, res) => {
  try {
    const db = loadDB();
    const uid = (req.user.role === 'demo' || req.user.role === 'superadmin') ? '2' : req.user.id;
    const camps = db.campaigns.filter(c => c.userId === uid);
    const prods = db.products.filter(p => p.userId === uid);
    const prompt = `Génère un rapport exécutif hebdomadaire COMPLET:\nCampagnes:\n${camps.map(c=>`- ${c.name}: ROAS ${c.roas}×, dépense ${c.spend} MAD, revenus ${c.revenue} MAD, statut: ${c.status}`).join('\n')}\nProduits:\n${prods.map(p=>`- ${p.name}: ${p.sales} ventes, marge ${p.margin}%, stock ${p.stock}`).join('\n')}\nCA: 124 000 MAD | Marge: 31% | Abandon panier: 23%\n\nStructure: 1.Résumé exécutif 2.Performances marketing 3.E-commerce 4.Alertes prioritaires 5.Top 5 recommandations 6.Objectifs semaine prochaine. En français, chiffré et professionnel.`;
    const report = await callGroq([{role:'user',content:prompt}], 2000);
    res.json({ report });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ai/ab-test', auth, checkPlanExpiry, async (req, res) => {
  const { product, platform, goal, budget } = req.body;
  try {
    const r = await callGroq([{role:'user',content:`Génère 3 variantes A/B test pour: Produit: ${product}, Plateforme: ${platform}, Objectif: ${goal}, Budget: ${budget} MAD. Chaque variante: Headline, Texte, CTA, Audience, Budget alloué, KPIs cibles. Marché marocain.`}], 1500);
    res.json({ result: r });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ai/copy', auth, checkPlanExpiry, async (req, res) => {
  const { product, tone, platform, language } = req.body;
  try {
    const r = await callGroq([{role:'user',content:`Expert copywriter marché marocain. 5 textes publicitaires: Produit: ${product}, Ton: ${tone}, Plateforme: ${platform}, Langue: ${language}. Hook + Corps + CTA + Hashtags.`}], 1500);
    res.json({ result: r });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ai/audience', auth, checkPlanExpiry, async (req, res) => {
  const { product, platform, budget, goal } = req.body;
  try {
    const r = await callGroq([{role:'user',content:`Expert ciblage pub Maroc. 4 audiences pour: ${product}, ${platform}, ${budget} MAD/j, ${goal}. Âge/genre/intérêts/villes marocaines/taille/budget/ROAS attendu. Include lookalike + remarketing.`}], 1500);
    res.json({ result: r });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ai/campaign', auth, checkPlanExpiry, async (req, res) => {
  const { platform, goal, budget, duration, product } = req.body;
  try {
    const r = await callGroq([{role:'user',content:`Expert Media Buyer Maroc. Plan campagne COMPLET: ${platform}, ${goal}, ${budget} MAD, ${duration} jours, Produit: ${product}. Structure/Budget/3 audiences/2 textes/KPIs/Horaires/Enchères/Optimisation semaine par semaine.`}], 2000);
    res.json({ result: r });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ai/optimize/:id', auth, checkPlanExpiry, async (req, res) => {
  const db = loadDB();
  const c = db.campaigns.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Introuvable' });
  try {
    const r = await callGroq([{role:'user',content:`Optimise cette campagne: ${c.name}, ${c.platform}, ROAS:${c.roas}×, CPA:${c.cpa}MAD, dépense:${c.spend}MAD, revenus:${c.revenue}MAD. Diagnostic + 5 optimisations + ROAS cible 2 semaines.`}], 1500);
    res.json({ result: r });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ai/prices', auth, checkPlanExpiry, async (req, res) => {
  try {
    const db = loadDB();
    const uid = (req.user.role === 'demo' || req.user.role === 'superadmin') ? '2' : req.user.id;
    const prods = db.products.filter(p => p.userId === uid);
    const r = await callGroq([{role:'user',content:`Expert pricing e-commerce Maroc. Optimise ces prix:\n${prods.map(p=>`${p.name}: ${p.price}MAD, ${p.sales} ventes, marge ${p.margin}%, stock ${p.stock}, tendance ${p.trend}`).join('\n')}\nPour chaque: prix suggéré + justification + stratégie + timing.`}], 1500);
    res.json({ result: r });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ai/test', auth, async (req, res) => {
  try {
    const r = await callGroq([{role:'user',content:'Réponds uniquement: "Groq OK"'}], 20);
    res.json({ ok: true, response: r, model: GROQ_MODEL });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════
// CRON
// ═══════════════════════════════════════════════════════
cron.schedule('0 * * * *', () => {
  const db = loadDB();
  db.campaigns.forEach(c => {
    if (c.roas < 2.5 && c.status === 'active') {
      if (!db.alerts.find(a => a.msg.includes(c.name) && !a.read)) {
        db.alerts.push({ id: uuid(), userId: c.userId, type:'warning', msg:`${c.name} : ROAS ${c.roas}× sous le seuil (2.5×).`, time: new Date().toISOString(), read: false });
      }
    }
  });
  // Alertes expiration abonnement
  db.users.forEach(u => {
    if (u.plan !== 'lifetime' && u.planExpiry) {
      const daysLeft = Math.ceil((new Date(u.planExpiry) - new Date()) / 86400000);
      if (daysLeft === 7 || daysLeft === 3 || daysLeft === 1) {
        const key = `expiry_${u.id}_${daysLeft}`;
        if (!db.alerts.find(a => a.id === key)) {
          db.alerts.push({ id: key, userId: u.id, type:'warning', msg:`⏰ Votre abonnement expire dans ${daysLeft} jour(s). Contactez superadmin@nexagrow.ma pour renouveler.`, time: new Date().toISOString(), read: false });
        }
      }
    }
  });
  saveDB(db);
});

// ═══════════════════════════════════════════════════════
// PAGES
// ═══════════════════════════════════════════════════════
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, '../public/register.html')));
app.get('/admin', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.redirect('/login');
  try {
    const u = jwt.verify(token, JWT_SECRET);
    if (u.role !== 'superadmin') return res.redirect('/app');
    res.sendFile(path.join(__dirname, '../public/admin.html'));
  } catch(e) { res.redirect('/login'); }
});
app.get('/app', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.redirect('/login');
  try {
    const u = jwt.verify(token, JWT_SECRET);
    if (u.role === 'superadmin') return res.redirect('/admin');
    res.sendFile(path.join(__dirname, '../public/app.html'));
  }
  catch(e) { res.clearCookie('token'); res.redirect('/login'); }
});
app.get('/', (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    try {
      const u = jwt.verify(token, JWT_SECRET);
      if (u.role === 'superadmin') return res.redirect('/admin');
      return res.redirect('/app');
    } catch(e) { res.clearCookie('token'); }
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});
app.get('*', (req, res) => res.redirect('/'));

app.listen(PORT, () => {
  console.log(`\n✅ NexaGrow sur http://localhost:${PORT}`);
  console.log(`👑 SuperAdmin : superadmin@nexagrow.ma / NexaGrow@SuperAdmin2026!`);
  console.log(`🔑 Admin      : admin@nexagrow.ma / admin2026`);
  console.log(`🎯 Demo       : demo@nexagrow.ma / demo\n`);
});
