import pdfParse from 'pdf-parse';

// Main function that works with uploaded file buffers
export async function parseResumeFromBuffer(buffer) {
  try {
    if (!buffer || buffer.length === 0) {
      throw new Error('Invalid or empty buffer provided');
    }

    console.log(`Processing PDF buffer of size: ${buffer.length} bytes`);
    
    const pdfData = await pdfParse(buffer);
    const rawText = pdfData.text;

    if (!rawText || rawText.trim().length === 0) {
      throw new Error('No text content found in PDF');
    }

    console.log(`Extracted text length: ${rawText.length} characters`);

    const result = {
      name: extractName(rawText),
      email: extractEmail(rawText),
      phone: extractPhone(rawText),
      skills: extractSkills(rawText),
      certifications: extractCertifications(rawText),
      experience: extractExperience(rawText),
      education: extractEducation(rawText),
      raw: rawText.substring(0, 500) + (rawText.length > 500 ? '...' : '') // Truncate for response
    };

    console.log('Parsing completed successfully');
    return result;

  } catch (error) {
    console.error('Error in parseResumeFromBuffer:', error);
    throw new Error(`PDF parsing failed: ${error.message}`);
  }
}

// Alias for backward compatibility
export const parseResumeBuffer = parseResumeFromBuffer;

function extractName(text) {
  const patterns = [
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]*){1,3})/m, // First line with 2-4 capitalized words
    /(?:Name|Full Name|FULL NAME):\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]*)*)/i,
    /^([A-Z]{2,}\s+[A-Z]{2,})/m, // All caps names
    /([A-Z][a-z]+\s+[A-Z][a-z]+)(?:\s|$)/m // Basic first last pattern
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Validate it's actually a name (not just random capitalized words)
      if (name.length > 3 && name.length < 50 && !/\d/.test(name)) {
        return name;
      }
    }
  }
  
  return null;
}

function extractEmail(text) {
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const matches = text.match(emailRegex);
  
  if (matches && matches.length > 0) {
    // Return the first valid email found
    return matches[0].toLowerCase();
  }
  
  return null;
}

function extractPhone(text) {
  const patterns = [
    /(\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g,
    /(\(\d{3}\)\s*\d{3}[-.\s]?\d{4})/g,
    /(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/g,
    /(\+\d{1,3}\s\d{1,4}\s\d{3,4}\s\d{4})/g
  ];
  
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      return matches[0].trim();
    }
  }
  
  return null;
}

function extractSkills(text) {
  const skillKeywords = [
    // Programming Languages
    'JavaScript', 'Python', 'Java', 'C++', 'C#', 'PHP', 'Ruby', 'Go', 'Rust', 'Swift',
    'TypeScript', 'Kotlin', 'Scala', 'R', 'MATLAB', 'Perl', 'Shell', 'Bash',
    
    // Frameworks & Libraries
    'React', 'Angular', 'Vue.js', 'Node.js', 'Express', 'Django', 'Flask', 'Spring',
    'Laravel', 'Rails', 'ASP.NET', 'jQuery', 'Bootstrap', 'Tailwind', 
    
    // Databases
    'SQL', 'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'SQLite', 'Oracle', 'DynamoDB',
    
    // Cloud & DevOps
    'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Jenkins', 'CI/CD', 'Terraform',
    'Ansible', 'Chef', 'Puppet',
    
    // Tools & Technologies
    'Git', 'Linux', 'Windows', 'macOS', 'Jira', 'Confluence', 'Slack', 'Teams',
    'Figma', 'Adobe', 'Photoshop', 'Illustrator'
  ];
  
  const foundSkills = [];
  const textLower = text.toLowerCase();
  
  skillKeywords.forEach(skill => {
    const skillLower = skill.toLowerCase();
    const regex = new RegExp(`\\b${skillLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(textLower)) {
      foundSkills.push(skill);
    }
  });
  
  return [...new Set(foundSkills)]; // Remove duplicates
}

function extractCertifications(text) {
  const certPatterns = [
    /AWS Certified[^.\n]*/gi,
    /Google (?:Cloud )?Certified[^.\n]*/gi,
    /Microsoft Certified[^.\n]*/gi,
    /CompTIA[^.\n]*/gi,
    /Cisco Certified[^.\n]*/gi,
    /Oracle Certified[^.\n]*/gi,
    /Salesforce Certified[^.\n]*/gi,
    /PMI[^.\n]*/gi,
    /PMP[^.\n]*/gi,
    /Scrum Master[^.\n]*/gi,
    /Professional Certificate[^.\n]*/gi,
    /Certified[^.\n]*(?:Professional|Specialist|Expert|Associate)/gi
  ];
  
  const certifications = new Set();
  
  certPatterns.forEach(pattern => {
    const matches = text.match(pattern) || [];
    matches.forEach(match => {
      const cert = match.trim();
      if (cert.length > 5 && cert.length < 100) {
        certifications.add(cert);
      }
    });
  });
  
  return Array.from(certifications);
}

function extractExperience(text) {
  const lines = text.split('\n').map(line => line.trim());
  const experienceKeywords = /(?:experience|worked?\s+(?:at|for)|role|position|employment|job|company|developer|engineer|analyst|manager|director|lead|senior|junior|intern)/i;
  
  const experienceLines = lines.filter(line => {
    return line.length > 15 && 
           line.length < 200 && 
           experienceKeywords.test(line) &&
           !line.toLowerCase().includes('years of experience'); // Skip summary lines
  });
  
  return experienceLines.slice(0, 8); // Return up to 8 experience entries
}

function extractEducation(text) {
  const lines = text.split('\n').map(line => line.trim());
  const educationKeywords = /(?:university|college|bachelor|master|ph\.?d|degree|education|school|institute|b\.?s\.?|m\.?s\.?|b\.?a\.?|m\.?a\.?|diploma|certificate)/i;
  
  const educationLines = lines.filter(line => {
    return line.length > 10 && 
           line.length < 150 && 
           educationKeywords.test(line);
  });
  
  return educationLines.slice(0, 5); // Return up to 5 education entries
}
