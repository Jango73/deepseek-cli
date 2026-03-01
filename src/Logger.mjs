import fs from 'fs';
import path from 'path';

export class Logger {
  constructor() {
    // Utiliser process.cwd() au lieu de __dirname pour ES modules
    this.logDir = path.join(process.cwd(), 'log');
    this.logFile = path.join(this.logDir, 'deepseek.log');
    
    // Créer le répertoire de logs s'il n'existe pas
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    
    // Initialiser le fichier de log
    this.initializeLogFile();
  }
  
  initializeLogFile() {
    const timestamp = new Date().toISOString();
    const header = `=== DeepSeek CLI Log - Started at ${timestamp} ===\n\n`;
    
    if (!fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, header);
    } else {
      this.logToFile(`\n\n=== Session started at ${timestamp} ===\n`);
    }
  }
  
  logToFile(message) {
    try {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] ${message}\n`;
      fs.appendFileSync(this.logFile, logMessage);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }
  
  log(message) {
    this.logToFile(message);
  }
  
  info(message) {
    this.logToFile(`[INFO] ${message}`);
  }
  
  error(message) {
    this.logToFile(`[ERROR] ${message}`);
  }
  
  warn(message) {
    this.logToFile(`[WARN] ${message}`);
  }
  
  debug(message) {
    this.logToFile(`[DEBUG] ${message}`);
  }
  
  // Pour logger les blocs de texte sans décoration
  logPlain(text) {
    // Nettoyer le texte des codes ANSI et décorations
    const cleanText = text.replace(/\x1b\[[0-9;]*m/g, '');
    this.logToFile(cleanText);
  }
}

// Singleton
export const logger = new Logger();
