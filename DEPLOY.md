# BustedLab — Deploy in 15 minutes

## Step 1: Push to GitHub

1. Go to github.com → New repository → name it `bustedlab` → Create
2. Open terminal (or Git Bash on Windows) and run:

```bash
cd bustedlab
git init
git add .
git commit -m "Initial build"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/bustedlab.git
git push -u origin main
```

## Step 2: Deploy on Vercel

1. Go to vercel.com → Add New Project
2. Import your `bustedlab` GitHub repo
3. Click Deploy (default settings are fine)
4. Your site is live on a .vercel.app URL instantly

## Step 3: Add your Apify API key

1. Go to console.apify.com → Sign up free
2. Go to Settings → Integrations → copy your API token
3. In Vercel: go to your project → Settings → Environment Variables
4. Add: `APIFY_API_TOKEN` = your token
5. Redeploy

**Without the Apify key, the app runs in demo mode with realistic mock data — still fully functional for testing.**

## Step 4: Connect your domain

1. In Vercel: Settings → Domains → Add `bustedlab.com`
2. In your domain registrar (GoDaddy/Namecheap): add the DNS records Vercel shows you
3. Done — usually propagates in under 10 minutes

## Step 5: Add payments (Stripe)

When you're ready to charge $4.99:
1. Create a Stripe account at stripe.com
2. Create a Payment Link for $4.99 one-time
3. Replace the "Unlock BustedLab" buttons with your Stripe Payment Link

That's it. No backend needed for payments at this stage.
