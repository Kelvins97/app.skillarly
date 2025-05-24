import express from 'express';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

const generateSecureToken = (user) => {
  return jwt.sign(
    {
      sub: user.sub || user.id,
      id: user.id,
      name: user.name,
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24)
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' }
  );
};

export const initializeAuth = () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  router.get('/linkedin/callback', async (req, res) => {
    try {
      const { code, state, error, error_description } = req.query;

      if (error) {
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=${error}&details=${encodeURIComponent(error_description || '')}`);
      }
      if (!code) {
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=missing_code`);
      }

      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.LINKEDIN_CALLBACK_URL,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET
      });

      const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody
      });

      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_access_token`);
      }

      const accessToken = tokenData.access_token;

      // Fetch profile data
      const meRes = await fetch('https://api.linkedin.com/v2/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'LinkedIn-Version': '202305'
        }
      });

      const me = await meRes.json();
      const vanityName = me.vanityName;
      const fullName = `${me.localizedFirstName || ''} ${me.localizedLastName || ''}`.trim();
      const profileUrl = vanityName ? `https://linkedin.com/in/${vanityName}` : null;

      // Fetch email
      const emailRes = await fetch(
        'https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const emailJson = await emailRes.json();
      const email = emailJson.elements?.[0]?.['handle~']?.emailAddress;

      const user = {
        id: me.id,
        name: fullName,
        email,
        profileUrl
      };

      const token = generateSecureToken(user);

      // Upsert user into Supabase
      await supabase
        .from('users')
        .upsert([{
          email: user.email,
          name: user.name,
          profile_url: user.profileUrl,
          linkedin_id: user.id
        }], { onConflict: 'email' });

      // Trigger scrape-profile
      try {
        const scrapeRes = await fetch(`${process.env.BACKEND_URL}/scrape-profile`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ profileUrl: user.profileUrl })
        });

        const scrapeJson = await scrapeRes.json();
        if (!scrapeJson.success) {
          console.warn('⚠️ Scrape failed:', scrapeJson.message);
        } else {
          console.log('✅ Scrape successful');
        }
      } catch (err) {
        console.error('❌ Failed to trigger scrape-profile:', err);
      }

      return res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${encodeURIComponent(token)}`);
    } catch (err) {
      console.error('LinkedIn callback failed:', err);
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=callback_exception`);
    }
  });

  return router;
};
