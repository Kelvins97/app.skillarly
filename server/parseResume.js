import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
const { getDocument } = pdfjs;
import mammoth from 'mammoth';
import path from 'path';

/**
 * Parse resume from buffer using PDF.js (Mozilla's library)
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Original filename
 * @returns {Object} Parsed resume data
 */
export async function parseResumeBuffer(buffer, filename) {
  try {
    console.log(`Processing ${filename} buffer of size: ${buffer.length} bytes`);
    
    const fileExt = path.extname(filename).toLowerCase();
    let extractedText = '';
    
    if (fileExt === '.pdf') {
      console.log('Parsing PDF with PDF.js...');
      extractedText = await extractTextFromPDF(buffer);
      console.log(`Extracted ${extractedText.length} characters from PDF`);
      
    } else if (fileExt === '.docx') {
      console.log('Parsing DOCX with mammoth...');
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value;
      console.log(`Extracted ${extractedText.length} characters from DOCX`);
      
    } else if (fileExt === '.doc') {
      throw new Error('Legacy .doc files are not supported. Please convert to .docx or PDF format.');
      
    } else {
      throw new Error(`Unsupported file format: ${fileExt}`);
    }
    
    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error('No text could be extracted from the document');
    }
    
    // Parse the extracted text into structured data
    const parsedData = parseResumeText(extractedText);
    
    return {
      success: true,
      filename,
      extractedText: extractedText.substring(0, 1000), // First 1000 chars for preview
      parsedData,
      metadata: {
        fileSize: buffer.length,
        textLength: extractedText.length,
        processingMethod: fileExt === '.pdf' ? 'pdfjs' : 'mammoth'
      }
    };
    
  } catch (error) {
    console.error('Error in parseResumeBuffer:', error);
    throw new Error(`Failed to parse resume: ${error.message}`);
  }
}

/**
 * Extract text from PDF using PDF.js
 * @param {Buffer} buffer - PDF buffer
 * @returns {string} Extracted text
 */
async function extractTextFromPDF(buffer) {
  try {
    // Convert buffer to Uint8Array
    const data = new Uint8Array(buffer);
    
    // Load the PDF document
    const loadingTask = getDocument({
      data: data,
      // Disable worker to avoid issues in server environment
      isEvalSupported: false,
      isOffscreenCanvasSupported: false
    });
    
    const pdf = await loadingTask.promise;
    console.log(`PDF loaded successfully. Pages: ${pdf.numPages}`);
    
    let fullText = '';
    
    // Extract text from each page
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        // Combine text items
        const pageText = textContent.items
          .map(item => item.str)
          .join(' ');
        
        fullText += pageText + '\n';
        console.log(`Extracted text from page ${pageNum}: ${pageText.length} characters`);
        
      } catch (pageError) {
        console.warn(`Error extracting text from page ${pageNum}:`, pageError);
        // Continue with other pages
      }
    }
    
    return fullText.trim();
    
  } catch (error) {
    console.error('PDF.js extraction error:', error);
    throw new Error(`PDF text extraction failed: ${error.message}`);
  }
}

/**
 * Parse extracted text into structured resume data
 * @param {string} text - Raw extracted text
 * @returns {Object} Structured resume data
 */
function parseResumeText(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  const resumeData = {
    contact: extractContactInfo(text),
    experience: extractExperience(text),
    education: extractEducation(text),
    skills: extractSkills(text),
    summary: extractSummary(text),
    sections: identifySections(lines),
    rawText: text
  };
  
  return resumeData;
}

/**
 * Extract contact information from resume text
 */
function extractContactInfo(text) {
  const contact = {};
  
  // Email regex
  const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
  if (emailMatch) {
    contact.email = emailMatch[0];
  }
  
  // Phone regex (various formats)
  const phoneMatches = text.match(/(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g);
  if (phoneMatches) {
    contact.phone = phoneMatches[0];
  }
  
  // LinkedIn
  const linkedinMatch = text.match(/(?:linkedin\.com\/in\/|linkedin\.com\/pub\/)([\w-]+)/i);
  if (linkedinMatch) {
    contact.linkedin = `https://linkedin.com/in/${linkedinMatch[1]}`;
  }
  
  // Name extraction (first few lines often contain name)
  const firstLines = text.split('\n').slice(0, 3);
  for (const line of firstLines) {
    const trimmed = line.trim();
    // Simple heuristic: if line has 2-4 words and no numbers/symbols, likely a name
    if (trimmed.length > 3 && trimmed.length < 50 && 
        /^[A-Za-z\s]+$/.test(trimmed) && 
        trimmed.split(' ').length >= 2 && 
        trimmed.split(' ').length <= 4) {
      contact.name = trimmed;
      break;
    }
  }
  
  return contact;
}

/**
 * Extract work experience from resume text
 */
function extractExperience(text) {
  const experience = [];
  
  // Look for common experience section headers
  const expPatterns = [
    /(?:WORK\s+)?EXPERIENCE([\s\S]*?)(?=EDUCATION|SKILLS|PROJECTS|CERTIFICATIONS|$)/i,
    /EMPLOYMENT\s+HISTORY([\s\S]*?)(?=EDUCATION|SKILLS|PROJECTS|CERTIFICATIONS|$)/i,
    /PROFESSIONAL\s+EXPERIENCE([\s\S]*?)(?=EDUCATION|SKILLS|PROJECTS|CERTIFICATIONS|$)/i
  ];
  
  for (const pattern of expPatterns) {
    const match = text.match(pattern);
    if (match) {
      const expText = match[1].trim();
      if (expText.length > 20) { // Only if substantial content
        experience.push({
          section: 'experience',
          content: expText,
          dateRange: extractDateRanges(expText),
          companies: extractCompanies(expText)
        });
        break;
      }
    }
  }
  
  return experience;
}

/**
 * Extract education from resume text
 */
function extractEducation(text) {
  const education = [];
  
  const eduPatterns = [
    /EDUCATION([\s\S]*?)(?=EXPERIENCE|SKILLS|PROJECTS|CERTIFICATIONS|$)/i,
    /ACADEMIC\s+BACKGROUND([\s\S]*?)(?=EXPERIENCE|SKILLS|PROJECTS|CERTIFICATIONS|$)/i,
    /QUALIFICATIONS([\s\S]*?)(?=EXPERIENCE|SKILLS|PROJECTS|CERTIFICATIONS|$)/i
  ];
  
  for (const pattern of eduPatterns) {
    const match = text.match(pattern);
    if (match) {
      const eduText = match[1].trim();
      if (eduText.length > 10) {
        education.push({
          section: 'education',
          content: eduText,
          degrees: extractDegrees(eduText),
          institutions: extractInstitutions(eduText)
        });
        break;
      }
    }
  }
  
  return education;
}

/**
 * Extract skills from resume text
 */
function extractSkills(text) {
  const skills = [];
  
  const skillsPatterns = [
    /(?:TECHNICAL\s+)?SKILLS([\s\S]*?)(?=EXPERIENCE|EDUCATION|PROJECTS|CERTIFICATIONS|$)/i,
    /TECHNOLOGIES([\s\S]*?)(?=EXPERIENCE|EDUCATION|PROJECTS|CERTIFICATIONS|$)/i,
    /COMPETENCIES([\s\S]*?)(?=EXPERIENCE|EDUCATION|PROJECTS|CERTIFICATIONS|$)/i
  ];
  
  for (const pattern of skillsPatterns) {
    const match = text.match(pattern);
    if (match) {
      const skillsText = match[1].trim();
      // Split by common delimiters and clean up
      const skillList = skillsText
        .split(/[,•·\n\t]/)
        .map(skill => skill.trim())
        .filter(skill => skill.length > 1 && skill.length < 50)
        .slice(0, 20); // Limit to first 20 skills
      
      skills.push(...skillList);
      break;
    }
  }
  
  return skills;
}

/**
 * Extract summary/objective from resume text
 */
function extractSummary(text) {
  const summaryPatterns = [
    /(?:PROFESSIONAL\s+)?SUMMARY([\s\S]*?)(?=EXPERIENCE|EDUCATION|SKILLS|$)/i,
    /OBJECTIVE([\s\S]*?)(?=EXPERIENCE|EDUCATION|SKILLS|$)/i,
    /PROFILE([\s\S]*?)(?=EXPERIENCE|EDUCATION|SKILLS|$)/i,
    /ABOUT\s+ME([\s\S]*?)(?=EXPERIENCE|EDUCATION|SKILLS|$)/i
  ];
  
  for (const pattern of summaryPatterns) {
    const match = text.match(pattern);
    if (match) {
      const summary = match[1].trim();
      if (summary.length > 20 && summary.length < 1000) {
        return summary;
      }
    }
  }
  
  return '';
}

/**
 * Helper functions for data extraction
 */
function extractDateRanges(text) {
  const datePattern = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b|\b\d{4}\b/gi;
  return text.match(datePattern) || [];
}

function extractCompanies(text) {
  // This is a simplified approach - you might want to enhance this
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  const companies = [];
  
  for (const line of lines) {
    // Look for lines that might be company names (heuristic approach)
    if (line.length > 5 && line.length < 100 && 
        !line.match(/^\d/) && // Doesn't start with number
        !line.includes('@') && // Not an email
        line.split(' ').length <= 8) { // Not too many words
      companies.push(line.trim());
    }
  }
  
  return companies.slice(0, 5); // Limit results
}

function extractDegrees(text) {
  const degreePattern = /\b(?:Bachelor|Master|PhD|Associate|Certificate|Diploma)[\w\s]*\b/gi;
  return text.match(degreePattern) || [];
}

function extractInstitutions(text) {
  const institutionKeywords = /\b(?:University|College|Institute|School|Academy)\b/gi;
  const lines = text.split('\n');
  const institutions = [];
  
  for (const line of lines) {
    if (institutionKeywords.test(line)) {
      institutions.push(line.trim());
    }
  }
  
  return institutions.slice(0, 3); // Limit results
}

/**
 * Identify major sections in the resume
 */
function identifySections(lines) {
  const sections = [];
  const sectionHeaders = /^(EXPERIENCE|EDUCATION|SKILLS|PROJECTS|SUMMARY|OBJECTIVE|CONTACT|CERTIFICATIONS|AWARDS)/i;
  
  lines.forEach((line, index) => {
    if (sectionHeaders.test(line.trim())) {
      sections.push({
        header: line.trim(),
        lineNumber: index
      });
    }
  });
  
  return sections;
}
