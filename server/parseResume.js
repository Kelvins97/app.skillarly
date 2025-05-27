import fs from 'fs';
import path from 'path';

// Debug function to see what files exist
export function debugFileSystem() {
  console.log('Current working directory:', process.cwd());
  
  try {
    console.log('Files in current directory:');
    const files = fs.readdirSync('.');
    files.forEach(file => {
      const stats = fs.statSync(file);
      console.log(`  ${file} (${stats.isDirectory() ? 'directory' : 'file'})`);
    });
  } catch (error) {
    console.error('Error reading current directory:', error.message);
  }
  
  // Check if test directory exists
  try {
    if (fs.existsSync('./test')) {
      console.log('\nFiles in ./test directory:');
      const testFiles = fs.readdirSync('./test');
      testFiles.forEach(file => {
        const filePath = path.join('./test', file);
        const stats = fs.statSync(filePath);
        console.log(`  ${file} (${stats.isDirectory() ? 'directory' : 'file'})`);
        
        if (stats.isDirectory()) {
          try {
            const subFiles = fs.readdirSync(filePath);
            subFiles.forEach(subFile => {
              console.log(`    ${subFile}`);
            });
          } catch (err) {
            console.error(`    Error reading ${file}: ${err.message}`);
          }
        }
      });
    } else {
      console.log('\n./test directory does not exist');
    }
  } catch (error) {
    console.error('Error checking test directory:', error.message);
  }
  
  // Check specific file
  const targetFile = './test/data/05-versions-space.pdf';
  console.log(`\nChecking for ${targetFile}:`, fs.existsSync(targetFile));
}

// Modified parseResume with better error handling
export async function parseResumeWithDebug(filePath) {
  console.log(`Attempting to parse: ${filePath}`);
  console.log(`Absolute path: ${path.resolve(filePath)}`);
  console.log(`File exists: ${fs.existsSync(filePath)}`);
  
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    
    // Try to find similar files
    const dir = path.dirname(filePath);
    const filename = path.basename(filePath);
    
    console.log(`Looking for similar files in ${dir}:`);
    try {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));
        console.log('PDF files found:', pdfFiles);
        
        if (pdfFiles.length > 0) {
          const alternativeFile = path.join(dir, pdfFiles[0]);
          console.log(`Trying alternative file: ${alternativeFile}`);
          return parseResumeWithDebug(alternativeFile);
        }
      }
    } catch (error) {
      console.error('Error searching for alternatives:', error.message);
    }
    
    throw new Error(`File not found: ${filePath}`);
  }
  
  // Your existing parseResume logic here
  // ... (rest of the parsing code)
}
