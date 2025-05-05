function generateRecommendationEmail({ firstName, primarySkill, email, courses = [], certifications = [], jobs = [] }) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Skillarly Recommendations</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .header { background: #0077b5; color: white; padding: 20px; text-align: center; }
        .header-title { font-size: 22px; margin: 10px 0; }
        .content { padding: 20px; }
        .section-title { font-size: 18px; color: #0077b5; margin: 20px 0 10px; border-bottom: 1px solid #eee; padding-bottom: 5px; }
        .recommendation-card { background: #f9f9f9; border-left: 3px solid #0077b5; padding: 15px; margin-bottom: 15px; border-radius: 4px; }
        .recommendation-title { font-size: 16px; font-weight: 600; color: #0077b5; margin-bottom: 5px; }
        .recommendation-description { font-size: 14px; color: #555; margin-bottom: 10px; }
        .recommendation-meta { font-size: 13px; display: flex; justify-content: space-between; }
        .recommendation-link { background: #0077b5; color: white; padding: 6px 12px; text-decoration: none; border-radius: 4px; font-weight: bold; }
        .footer { background: #f5f5f5; text-align: center; padding: 15px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 class="header-title">Your Personalized Career Recommendations</h1>
        </div>
        <div class="content">
          <p>Hi ${firstName},</p>
          <p>Here are your latest course, certification, and job suggestions based on your skills in ${primarySkill}.</p>
  
          <h2 class="section-title">📚 Courses</h2>
          ${courses.map(course => `
            <div class="recommendation-card">
              <div class="recommendation-title">${course.title}</div>
              <div class="recommendation-description">${course.description}</div>
              <div class="recommendation-meta">
                <span>${course.source}</span>
                <a href="${course.link}" class="recommendation-link">View Course</a>
              </div>
            </div>`).join('')}
  
          ${certifications.length ? `
          <h2 class="section-title">🎖️ Certifications</h2>
          ${certifications.map(cert => `
            <div class="recommendation-card">
              <div class="recommendation-title">${cert.title}</div>
              <div class="recommendation-description">${cert.description}</div>
              <div class="recommendation-meta">
                <span>${cert.source}</span>
                <a href="${cert.link}" class="recommendation-link">View</a>
              </div>
            </div>`).join('')}
          ` : ''}
  
          ${jobs.length ? `
          <h2 class="section-title">💼 Job Opportunities</h2>
          ${jobs.map(job => `
            <div class="recommendation-card">
              <div class="recommendation-title">${job.title} at ${job.company}</div>
              <div class="recommendation-description">${job.description}</div>
              <div class="recommendation-meta">
                <span>Live Job</span>
                <a href="${job.link}" class="recommendation-link">Apply Now</a>
              </div>
            </div>`).join('')}
          ` : ''}
  
          <p>Visit your Skillarly dashboard anytime for updated suggestions or to manage your plan.</p>
        </div>
        <div class="footer">
          <p>&copy; 2025 Skillarly – <a href="https://skillarly.com/unsubscribe?email=${email}">Unsubscribe</a></p>
        </div>
      </div>
    </body>
    </html>`;
  }
  
  module.exports = { generateRecommendationEmail };
  