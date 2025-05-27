// For Node.js backend on Render - handles uploaded files or URLs
import pdfParse from 'pdf-parse';

export async function parseResumeFromBuffer(buffer) {
  try {
    const pdfData = await pdfParse(buffer);
    const rawText = pdfData.text;

    return {
      name: extractName(rawText),
      email: extractEmail(rawText),
      phone: extractPhone(rawText),
      skills: extractSkills(rawText),
      certifications: extractCertifications(rawText),
      experience: extractExperience(rawText),
      education: extractEducation(rawText),
      raw: rawText
    };
  } catch (error) {
    console.error('Error parsing PDF:', error);
    throw new Error(`Failed to parse PDF: ${error.message}`);
  }
}

// For handling file uploads in Express.js
export async function parseResumeFromUpload(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ error: 'Only PDF files are allowed' });
    }

    const result = await parseResumeFromBuffer(req.file.buffer);
    res.json(result);
  } catch (error) {
    console.error('Error in parseResumeFromUpload:', error);
    res.status(500).json({ error: error.message });
  }
}

// For parsing from URL
export async function parseResumeFromURL(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    return await parseResumeFromBuffer(buffer);
  } catch (error) {
    console.error('Error parsing PDF from URL:', error);
    throw new Error(`Failed to parse PDF from URL: ${error.message}`);
  }
}

// Example Express.js setup
export function setupResumeRoutes(app) {
  const multer = require('multer');
  const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
  });

  // Upload endpoint
  app.post('/api/parse-resume', upload.single('resume'), parseResumeFromUpload);

  // URL endpoint
  app.post('/api/parse-resume-url', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: 'URL is required' });
      }
      
      const result = await parseResumeFromURL(url);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

function extractName(text) {
  const patterns = [
    /^[A-Z][a-z]+\s+[A-Z][a-z]+/m,
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]*)*)/m,
    /(?:Name|Full Name):\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]*)*)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1] || match[0];
  }
  
  return null;
}

function extractEmail(text) {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/);
  return match ? match[0] : null;
}

function extractPhone(text) {
  const patterns = [
    /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{4}/,
    /\(\d{3}\)\s*\d{3}-\d{4}/,
    /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  
  return null;
}

function extractSkills(text) {
  const skillKeywords = [
    'JavaScript', 'Python', 'Node.js', 'React', 'SQL', 'Docker', 'AWS', 
    'Java', 'C++', 'TypeScript', 'Vue.js', 'Angular', 'MongoDB', 'PostgreSQL',
    'Git', 'Linux', 'Kubernetes', 'Jenkins', 'HTML', 'CSS', 'PHP', 'Ruby'
  ];
  
  return skillKeywords.filter(skill => 
    new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)
  );
}

function extractCertifications(text) {
  const certPatterns = [
    /AWS Certified[^.\n]*/gi,
    /Google Certified[^.\n]*/gi,
    /Microsoft Certified[^.\n]*/gi,
    /CompTIA[^.\n]*/gi,
    /Cisco Certified[^.\n]*/gi,
    /Oracle Certified[^.\n]*/gi,
    /Certified[^.\n]*Professional/gi,
    /Professional[^.\n]*Certified/gi
  ];
  
  const certifications = new Set();
  certPatterns.forEach(pattern => {
    const matches = text.match(pattern) || [];
    matches.forEach(match => certifications.add(match.trim()));
  });
  
  return Array.from(certifications);
}

function extractExperience(text) {
  const lines = text.split('\n').map(line => line.trim());
  const experienceKeywords = /experience|worked at|role|position|employment|job|company|developer|engineer|analyst|manager/i;
  
  return lines
    .filter(line => line.length > 10 && experienceKeywords.test(line))
    .slice(0, 5);
}

function extractEducation(text) {
  const lines = text.split('\n').map(line => line.trim());
  const educationKeywords = /university|college|bachelor|master|ph\.?d|degree|education|school|institute/i;
  
  return lines
    .filter(line => line.length > 10 && educationKeywords.test(line))
    .slice(0, 5);
}
