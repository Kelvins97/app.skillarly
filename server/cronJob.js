import cron from 'node-cron';
//import { openai } from './openaiClient'; // setup with your key
import { supabase } from './supabase';

cron.schedule('0 * * * *', async () => {
  console.log('⏰ Running recommendation cron job');

  const { data: users } = await supabase
    .from('users')
    .select('id, email, parsed_resume')
    .neq('parsed_resume', null);

  for (const user of users) {
    const skills = user.parsed_resume?.skills?.join(', ') || '';

    const prompt = `I have these skills: ${skills}. Recommend 3 courses, 2 certifications, and 2 jobs.`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }]
      });

      const content = completion.choices[0].message.content;
      const json = JSON.parse(content.match(/```json\n([\s\S]+?)```/)?.[1] || content);

      await supabase.from('recommendations').insert({
        user_id: user.id,
        courses: json.courses || [],
        certifications: json.certifications || [],
        jobs: json.jobs || []
      });

      await supabase.from('users').update({
        last_recommendation_at: new Date()
      }).eq('id', user.id);

      console.log(`✅ Recommendations stored for ${user.email}`);
    } catch (e) {
      console.error(`❌ Failed for ${user.email}:`, e.message);
    }
  }
});
