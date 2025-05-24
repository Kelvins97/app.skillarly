import express from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const router = express.Router();

const generateSecureToken = (user) => {
  return jwt.sign(
    {
      sub: user.id,
      id: user.id,
      name: user.name,
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' }
  );
};

export const initializeAuth = () => {
  try {
    const requiredVars = [
      'LINKEDIN_CLIENT_ID',
      'LINKEDIN_CLIENT_SECRET',
      'LINKEDIN_CALLBACK_URL',
      'JWT_SECRET',
      'FRONTEND_URL',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'BACKEND_URL'
    ];

    const missing = requiredVars.filter((v) => !process.env[v]);
    if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);

    passport.serializeUser((user, done) => done(null, user));
    passport.deserializeUser((user, done) => done(null, user));

    router.get('/linkedin', (req, res) => {
      const state = Math.random().toString(36).substring(2);
      if (req.session) req.session.linkedInState = state;

      const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', process.env.LINKEDIN_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', process.env.LINKEDIN_CALLBACK_URL);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('scope', 'openid profile email');

      res.redirect(authUrl.toString());
    });

    router.get('/linkedin/callback', async (req, res) => {
      try {
        const { code, error } = req.query;
        if (error || !code) return res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_error`);

        const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: process.env.LINKEDIN_CALLBACK_URL,
            client_id: process.env.LINKEDIN_CLIENT_ID,
            client_secret: process.env.LINKEDIN_CLIENT_SECRET
          })
        });

        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_access_token`);

        const accessToken = tokenData.access_token;

        const profileRes = await fetch('https://api.linkedin.com/v2/me', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'LinkedIn-Version': '202305'
          }
        });
        const profile = await profileRes.json();

        const emailRes = await fetch('https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const emailJson = await emailRes.json();
        const email = emailJson.elements?.[0]?.['handle~']?.emailAddress;

        if (!email) return res.redirect(`${process.env.FRONTEND_URL}/login?error=missing_email`);

        const fullName = `${profile.localizedFirstName} ${profile.localizedLastName}`.trim();
        const vanity = profile.vanityName || profile.id;
        const profileUrl = `https://linkedin.com/in/${vanity}`;

        const user = { id: profile.id, name: fullName, email, profileUrl };
        const token = generateSecureToken(user);

        await supabase.from('users').upsert([{
          email,
          name: fullName,
          profile_url: profileUrl,
          linkedin_id: profile.id
        }], { onConflict: 'email' });

        try {
          const scrapeRes = await fetch(`${process.env.BACKEND_URL}/scrape-profile`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ profileUrl })
          });

          const result = await scrapeRes.json();
          if (!result.success) console.warn('⚠️ Scrape failed:', result.message);
          else console.log('✅ Scrape successful');
        } catch (err) {
          console.error('❌ Failed to trigger scrape:', err.message);
        }

        return res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${encodeURIComponent(token)}`);
      } catch (err) {
        console.error('LinkedIn callback failed:', err);
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=callback_exception`);
      }
    });

    return router;
  } catch (err) {
    console.error('Auth init failed:', err.message);
    const errorRouter = express.Router();
    errorRouter.use((req, res) => {
      res.status(500).json({ error: 'Auth init failed', message: err.message });
    });
    return errorRouter;
  }
};
