import cron from 'node-cron';
import { supabase } from './supabase.js';
// import { openai } from './openaiClient'; // Uncomment when ready
import { sendEmail } from './email.js';

// Simple recommendation database
const RECOMMENDATION_DB = {
  // Course recommendations based on skills
  courses: {
    javascript: ['Advanced JavaScript Patterns', 'Node.js Masterclass', 'React Performance Optimization'],
    python: ['Python Data Science', 'Django Web Development', 'Machine Learning with Python'],
    react: ['React Advanced Patterns', 'Next.js Complete Guide', 'React Testing Library'],
    node: ['Node.js Architecture', 'Express.js Advanced', 'Node.js Security Best Practices'],
    sql: ['Advanced SQL Queries', 'Database Design Principles', 'PostgreSQL Administration'],
    aws: ['AWS Solutions Architecture', 'AWS DevOps Engineering', 'AWS Security Specialty'],
    default: ['Problem Solving Fundamentals', 'Software Engineering Principles', 'Clean Code Practices']
  },
  
  // Certification recommendations
  certifications: {
    javascript: ['JavaScript Institute Certification', 'React Developer Certification'],
    python: ['Python Institute PCAP', 'Google Data Analytics Certificate'],
    aws: ['AWS Certified Developer', 'AWS Certified Solutions Architect'],
    react: ['Meta Frontend Developer Certificate', 'React Developer Certification'],
    node: ['Node.js Certified Developer', 'JavaScript Institute Certification'],
    sql: ['Oracle Database SQL Certified', 'Microsoft SQL Server Certification'],
    default: ['CompTIA IT Fundamentals', 'Google IT Support Certificate']
  },
  
  // Job recommendations based on experience level and skills
  jobs: {
    junior: ['Junior Frontend Developer', 'Entry Level Software Engineer', 'Junior Full Stack Developer'],
    mid: ['Frontend Developer', 'Backend Developer', 'Full Stack Developer', 'Software Engineer'],
    senior: ['Senior Software Engineer', 'Lead Developer', 'Technical Lead', 'Engineering Manager'],
    default: ['Software Developer', 'Web Developer', 'Application Developer']
  }
};

// Simple algorithm to generate recommendations
function generateSimpleRecommendations(userProfile) {
  const skills = (userProfile.skills || []).map(skill => skill.toLowerCase());
  const experience = userProfile.experience || [];
  const education = userProfile.education || [];
  
  // Determine experience level
  const experienceLevel = determineExperienceLevel(experience);
  
  // Get skill-based recommendations
  const skillBasedCourses = getSkillBasedRecommendations(skills, RECOMMENDATION_DB.courses);
  const skillBasedCerts = getSkillBasedRecommendations(skills, RECOMMENDATION_DB.certifications);
  
  // Get experience-based job recommendations
  const jobRecommendations = RECOMMENDATION_DB.jobs[experienceLevel] || RECOMMENDATION_DB.jobs.default;
  
  // Add some randomization to avoid same recommendations
  const shuffledCourses = shuffleArray([...skillBasedCourses]);
  const shuffledCerts = shuffleArray([...skillBasedCerts]);
  const shuffledJobs = shuffleArray([...jobRecommendations]);
  
  return {
    courses: shuffledCourses.slice(0, 3),
    certifications: shuffledCerts.slice(0, 2),
    jobs: shuffledJobs.slice(0, 2)
  };
}

function determineExperienceLevel(experience) {
  const experienceText = experience.join(' ').toLowerCase();
  
  if (experienceText.includes('senior') || experienceText.includes('lead') || 
      experienceText.includes('manager') || experienceText.includes('architect')) {
    return 'senior';
  } else if (experienceText.includes('developer') || experienceText.includes('engineer') ||
             experienceText.match(/\d+\s*years?/)) {
    return 'mid';
  } else {
    return 'junior';
  }
}

function getSkillBasedRecommendations(userSkills, recommendationMap) {
  const recommendations = new Set();
  
  // Add recommendations based on user skills
  userSkills.forEach(skill => {
    const skillKey = Object.keys(recommendationMap).find(key => 
      skill.includes(key) || key.includes(skill)
    );
    
    if (skillKey && recommendationMap[skillKey]) {
      recommendationMap[skillKey].forEach(rec => recommendations.add(rec));
    }
  });
  
  // If no skill matches found, add default recommendations
  if (recommendations.size === 0) {
    recommendationMap.default.forEach(rec => recommendations.add(rec));
  }
  
  return Array.from(recommendations);
}

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Schedule cron job to run daily at 7 AM
cron.schedule('0 7 * * *', async () => {
  console.log('⏰ Running daily recommendation cron job at', new Date().toISOString());

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    // Fetch users who haven't received recommendations in the last 7 days
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, email, name, parsed_resume, email_notifications, last_recommendation_at')
      .or(`last_recommendation_at.is.null,last_recommendation_at.lt.${cutoff.toISOString()}`)
      .not('parsed_resume', 'is', null);

    if (userError) {
      console.error('🚨 Error fetching users:', userError.message);
      return;
    }

    console.log(`📊 Found ${users.length} users eligible for recommendations`);

    let successCount = 0;
    let errorCount = 0;

    for (const user of users) {
      try {
        console.log(`🔄 Processing recommendations for user: ${user.email}`);
        
        // Generate recommendations using simple algorithm
        const recommendations = generateSimpleRecommendations(user.parsed_resume);
        
        console.log(`💡 Generated recommendations for ${user.email}:`, {
          courses: recommendations.courses.length,
          certifications: recommendations.certifications.length,
          jobs: recommendations.jobs.length
        });

        // Insert into recommendations table
        const { error: recError } = await supabase
          .from('recommendations')
          .insert({
            user_id: user.id,
            courses: recommendations.courses,
            certifications: recommendations.certifications,
            jobs: recommendations.jobs,
            created_at: new Date().toISOString()
          });

        if (recError) {
          console.error(`❌ Error inserting recommendation for ${user.email}:`, recError.message);
          errorCount++;
          continue;
        }

        // Update user profile with recommendations and timestamp
        const { error: updateError } = await supabase
          .from('users')
          .update({
            parsed_resume: { 
              ...user.parsed_resume, 
              recommendations: recommendations 
            },
            last_recommendation_at: new Date().toISOString()
          })
          .eq('id', user.id);

        if (updateError) {
          console.warn(`⚠️ Error updating user profile for ${user.email}:`, updateError.message);
        }

        // Log recommendation event
        const { error: logError } = await supabase
          .from('recommendation_logs')
          .insert({
            user_id: user.id,
            created_at: new Date().toISOString(),
            status: 'success'
          });

        if (logError) {
          console.warn(`⚠️ Error logging recommendation for ${user.email}:`, logError.message);
        }

        // Send email recommendations if user has notifications enabled
        if (user.email_notifications && user.email) {
          try {
            const primarySkill = user.parsed_resume?.skills?.[0] || 'Software Development';
            
            await sendEmail(user.email, user.name || 'User', {
              primarySkill,
              email: user.email,
              courses: recommendations.courses,
              certifications: recommendations.certifications,
              jobs: recommendations.jobs
            });
            
            console.log(`📧 Email sent successfully to ${user.email}`);
            
            // Log successful email
            await supabase.from('recommendation_logs').insert({
              user_id: user.id,
              created_at: new Date().toISOString(),
              status: 'email_sent'
            });
            
          } catch (emailError) {
            console.warn(`⚠️ Failed to send email to ${user.email}:`, emailError.message);
            
            // Log email failure
            await supabase.from('recommendation_logs').insert({
              user_id: user.id,
              created_at: new Date().toISOString(),
              status: 'email_failed',
              error_message: emailError.message
            });
          }
        }
        
        console.log(`✅ Recommendations processed successfully for ${user.email}`);
        successCount++;
        
        // Add small delay to avoid overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (userError) {
        console.error(`❌ Failed processing user ${user.email}:`, userError.message);
        errorCount++;
        
        // Log processing failure
        try {
          await supabase.from('recommendation_logs').insert({
            user_id: user.id,
            created_at: new Date().toISOString(),
            status: 'failed',
            error_message: userError.message
          });
        } catch (logError) {
          console.error(`❌ Failed to log error for user ${user.id}:`, logError.message);
        }
      }
    }

    console.log(`🎯 Cron job completed: ${successCount} successful, ${errorCount} failed`);
    
  } catch (error) {
    console.error('🚨 Critical error in cron job:', error.message);
  }
});

console.log('🚀 Recommendation cron job scheduled to run daily at 7:00 AM');

// Export for testing purposes
export { generateSimpleRecommendations, determineExperienceLevel };
