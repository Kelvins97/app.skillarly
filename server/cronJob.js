import cron from 'node-cron';
import { supabase } from './supabase.js';
// import { openai } from './openaiClient'; // Uncomment when ready

cron.schedule('0 7 * * *', async () => {
  console.log('⏰ Running daily recommendation cron job');

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  const { data: users, error: userError } = await supabase
    .from('users')
    .select('id, email, parsed_resume')
    .lt('last_recommendation_at', cutoff.toISOString())
    .neq('parsed_resume', null);

  if (userError) {
    console.error('🚨 Error fetching users:', userError.message);
    return;
  }

  for (const user of users) {
    const skills = user.parsed_resume?.skills?.join(', ') || '';
    const experience = (user.parsed_resume?.experience || []).join('\n');
    const education = (user.parsed_resume?.education || []).join(', ');

    const prompt = `I have these skills: ${skills}\nExperience: ${experience}\nEducation: ${education}. Recommend 3 courses, 2 certifications, and 2 jobs.`;

    try {
      // Uncomment when OpenAI integration is configured
      // const completion = await openai.chat.completions.create({
      //   model: 'gpt-4',
      //   messages: [{ role: 'user', content: prompt }]
      // });
      // const content = completion.choices[0].message.content;
      // const json = JSON.parse(content.match(/```json\n([\s\S]+?)```/)?.[1] || content);

      // Mocked response for testing without OpenAI
      const json = {
        courses: ['Intro to AI', 'React Advanced'],
        certifications: ['AWS Certified Developer', 'Google Data Engineer'],
        jobs: ['Frontend Developer at Spotify', 'AI Analyst at DeepMind']
      };

      // Optional: store in recommendations table
      await supabase.from('recommendations').insert({
        user_id: user.id,
        courses: json.courses,
        certifications: json.certifications,
        jobs: json.jobs
      });

      // Update user profile
      await supabase.from('users')
        .update({
          parsed_resume: { ...user.parsed_resume, recommendations: json },
          last_recommendation_at: new Date().toISOString()
        })
        .eq('id', user.id);

      // Log recommendation event
      await supabase.from('recommendation_logs').insert({
        user_id: user.id
      });

      console.log(`✅ Recommendations updated for ${user.email}`);
    } catch (e) {
      console.error(`❌ Failed for ${user.email}:`, e.message);
    }
  }
});
