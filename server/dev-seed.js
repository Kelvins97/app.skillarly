// dev-seed.js (or in your main server file if you prefer)

import express from 'express';
import { adminSupabase } from './supabase.js';

const router = express.Router();

// Route to seed a test user
router.post('/dev-seed', async (req, res) => {
  try {
    const email = 'klvnkngth@gmail.com';
    const name = 'Kelvin Karanja';
    const plan = 'basic';

    console.log('🌱 Seeding test user:', email);

    const { data, error } = await adminSupabase
      .from('users')
      .upsert(
        [{
          email,
          name,
          plan,
          subscribed: true,
          monthly_scrapes: 0,
          email_notifications: true
        }],
        { onConflict: 'email', returning: 'representation' }
      )
      .select('*');

    if (error) {
      console.error('❌ Failed to seed user:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    console.log('✅ User seeded:', data[0]);
    res.json({ success: true, message: 'Test user seeded', user: data[0] });
  } catch (err) {
    console.error('💥 Unexpected error in /dev-seed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
