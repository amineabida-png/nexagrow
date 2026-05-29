# NexaGrow — AI Marketing Suite

Suite SaaS IA pour PME marocaines. Media Buyer + E-commerce Manager automatisés par Llama 3 via Groq.

## Déploiement Railway

1. Push ce repo sur GitHub
2. Sur Railway → New Project → Deploy from GitHub
3. Ajouter les variables d'environnement :
   - `GROQ_API_KEY` = votre clé Groq
   - `JWT_SECRET` = une chaîne aléatoire sécurisée (ex: `nexagrow_prod_secret_2026_xyz`)
   - `NODE_ENV` = `production`
4. Railway détecte automatiquement Node.js et lance `npm start`

## Comptes par défaut
- Admin : `admin@nexagrow.ma` / `admin2026`
- Demo  : `demo@nexagrow.ma` / `demo`

## Stack
- Backend : Node.js + Express
- Auth : JWT + cookies httpOnly
- IA : Groq API (Llama 3.3-70b-versatile)
- Storage : JSON file (upgradeable vers PostgreSQL)
- Frontend : HTML/CSS/JS vanilla
