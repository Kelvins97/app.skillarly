import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function parseResume(filePath) {
  try {
    // Convert relative path to absolute if needed
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
    
    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }
    
    // Check if it's actually a file (not a directory)
    const stats = fs.statSync(absolutePath);
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${absolutePath}`);
    }
    
    console.log(`Parsing resume from: ${absolutePath}`);
    
    const dataBuffer = fs.readFileSync(absolutePath);
    const pdfData = await pdfParse(dataBuffer);
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
    console.error('Error parsing resume:', error.message);
    throw error;
  }
}

// Helper function to find resume files in common locations
export function findResumeFiles(searchDir = '.') {
  const resumeFiles = [];
  
  function searchDirectory(dir) {
    try {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const itemPath = path.join(dir, item);
        const stats = fs.statSync(itemPath);
        
        if (stats.isDirectory() && !item.startsWith('.')) {
          searchDirectory(itemPath);
        } else if (stats.isFile() && item.toLowerCase().endsWith('.pdf')) {
          resumeFiles.push(itemPath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
      console.warn(`Could not read directory ${dir}: ${error.message}`);
    }
  }
  
  searchDirectory(searchDir);
  return resumeFiles;
}

function extractName(text) {
  // Try multiple patterns for name extraction
  const patterns = [
    /^[A-Z][a-z]+\s+[A-Z][a-z]+/m,  // First line pattern
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]*)*)/m,  // More flexible first line
    /(?:Name|Full Name):\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]*)*)/i  // Labeled name
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
