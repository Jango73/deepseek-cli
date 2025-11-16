import fs from "fs";
import path from "path";
import { ConsoleOutput } from "./ConsoleOutput.mjs";

export class SessionManager {
  constructor(workingDirectory, options = {}) {
    this.workingDirectory = workingDirectory;
    this.sessionNamespace = options.sessionNamespace || null;
    const namespaceSuffix = this.sessionNamespace ? `_${this.sessionNamespace}` : '';
    this.sessionsDirectory = path.join(workingDirectory, '.deepseek_sessions');
    this.sessionFile = path.join(this.sessionsDirectory, `.deepseek_session${namespaceSuffix}.json`);
    const archivesRoot = path.join(this.sessionsDirectory, 'archives');
    this.archivesDirectory = this.sessionNamespace
      ? path.join(archivesRoot, this.sessionNamespace)
      : archivesRoot;
    this.conversationHistory = [];
    this.fullHistory = [];
    this.currentSessionId = null;
    this.currentSessionDescription = '';
    this.initialPrompt = '';
    
    this.ensureDirectory(this.sessionsDirectory);
    this.ensureArchivesDirectory();
  }

  ensureDirectory(targetPath) {
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }
  }

  ensureArchivesDirectory() {
    this.ensureDirectory(this.archivesDirectory);
  }

  generateSessionId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    return `${timestamp}-${random}`;
  }

  loadSession() {
    try {
      if (fs.existsSync(this.sessionFile)) {
        const data = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
        this.conversationHistory = data.conversationHistory || [];
        this.fullHistory = data.fullHistory || [];
        this.currentSessionId = data.currentSessionId || this.generateSessionId();
        this.currentSessionDescription = data.currentSessionDescription || '';
        this.initialPrompt = data.initialPrompt || '';
        
        ConsoleOutput.log('📁 Previous session loaded');
        this.showSessionStatus();
        return true;
      } else {
        this.currentSessionId = this.generateSessionId();
        ConsoleOutput.log('🆕 New session - no previous session found');
        return false;
      }
    } catch (error) {
      this.conversationHistory = [];
      this.fullHistory = [];
      this.currentSessionId = this.generateSessionId();
      ConsoleOutput.log('🆕 New session - error loading previous session');
      return false;
    }
  }

  saveSession() {
    try {
      const data = { 
        conversationHistory: this.conversationHistory,
        fullHistory: this.fullHistory,
        currentSessionId: this.currentSessionId,
        currentSessionDescription: this.currentSessionDescription,
        initialPrompt: this.initialPrompt
      };
      fs.writeFileSync(this.sessionFile, JSON.stringify(data, null, 2));
    } catch (error) {
      // Ignore save errors
    }
  }

  async archiveCurrentSession() {
    if (this.conversationHistory.length === 0) {
      ConsoleOutput.log('ℹ️ No conversation to archive');
      return null;
    }

    const sessionId = this.currentSessionId;
    
    // Use initial prompt as description, truncate if too long
    let description = this.initialPrompt || 'No description';
    if (description.length > 100) {
      description = description.substring(0, 97) + '...';
    }
    
    const timestamp = new Date().toISOString();

    const archiveData = {
      sessionId,
      description: description,
      timestamp,
      conversationHistory: [...this.conversationHistory],
      fullHistory: [...this.fullHistory],
      messageCount: this.conversationHistory.length,
      commandCount: this.fullHistory.length,
      initialPrompt: this.initialPrompt
    };

    const archiveFile = `${this.archivesDirectory}/${sessionId}.json`;
    
    try {
      fs.writeFileSync(archiveFile, JSON.stringify(archiveData, null, 2));
      ConsoleOutput.log(`💾 Session archived: ${sessionId}`);
      ConsoleOutput.log(`   Description: ${description}`);
      return sessionId;
    } catch (error) {
      ConsoleOutput.error('❌ Failed to archive session:', error.message);
      return null;
    }
  }

  async archiveAndClear() {
    if (this.conversationHistory.length > 0) {
      await this.archiveCurrentSession();
    }
    this.clearCurrentSession();
  }

  clearCurrentSession() {
    this.conversationHistory = [];
    this.fullHistory = [];
    this.currentSessionId = this.generateSessionId();
    this.currentSessionDescription = '';
    this.initialPrompt = '';
    this.saveSession();
    ConsoleOutput.log('🧹 Current session cleared');
  }

  clearAllSessions() {
    // Clear current session first
    this.clearCurrentSession();
    
    // Clear all archives
    try {
      if (!fs.existsSync(this.archivesDirectory)) {
        ConsoleOutput.log('ℹ️ No archives to clear');
        return;
      }

      const files = fs.readdirSync(this.archivesDirectory);
      let deletedCount = 0;
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(`${this.archivesDirectory}/${file}`);
          deletedCount++;
        }
      }
      
      ConsoleOutput.log(`🗑️  Deleted ${deletedCount} archived sessions`);
    } catch (error) {
      ConsoleOutput.error('❌ Error clearing archives:', error.message);
    }
  }

  listArchives() {
    try {
      const files = fs.readdirSync(this.archivesDirectory);
      const archives = [];
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const data = JSON.parse(fs.readFileSync(`${this.archivesDirectory}/${file}`, 'utf8'));
            archives.push({
              sessionId: data.sessionId,
              description: data.description,
              timestamp: data.timestamp,
              messageCount: data.messageCount,
              commandCount: data.commandCount
            });
          } catch (error) {
            ConsoleOutput.log(`⚠️  Corrupted archive: ${file}`);
          }
        }
      }
      
      // Sort by timestamp (newest first)
      archives.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      return archives;
    } catch (error) {
      ConsoleOutput.error('❌ Error listing archives:', error.message);
      return [];
    }
  }

  loadArchive(sessionId) {
    try {
      const archiveFile = `${this.archivesDirectory}/${sessionId}.json`;
      if (!fs.existsSync(archiveFile)) {
        ConsoleOutput.log('❌ Archive not found');
        return null;
      }

      const data = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
      return data;
    } catch (error) {
      ConsoleOutput.error('❌ Error loading archive:', error.message);
      return null;
    }
  }

  async switchToArchive(sessionId) {
    // Archive current session if it has content
    if (this.conversationHistory.length > 0) {
      await this.archiveCurrentSession();
    }

    // Load the requested archive
    const archiveData = this.loadArchive(sessionId);
    if (!archiveData) {
      return false;
    }

    // Switch to archived session
    this.conversationHistory = archiveData.conversationHistory || [];
    this.fullHistory = archiveData.fullHistory || [];
    this.currentSessionId = archiveData.sessionId;
    this.currentSessionDescription = archiveData.description;
    this.initialPrompt = archiveData.initialPrompt || '';
    this.saveSession();

    ConsoleOutput.log(`🔄 Switched to archived session: ${archiveData.description}`);
    this.showSessionStatus();
    return true;
  }

  showSessionStatus() {
    const historyCount = this.conversationHistory.length;
    const stepsCount = this.fullHistory.length;
    
    if (historyCount === 0) {
      ConsoleOutput.log('🆕 New session - no conversation history');
    } else {
      ConsoleOutput.log('📁 Current session:');
      ConsoleOutput.log(`   ID: ${this.currentSessionId}`);
      if (this.initialPrompt) {
        ConsoleOutput.log(`   Task: ${this.initialPrompt}`);
      }
      ConsoleOutput.log(`   Conversation: ${historyCount} messages`);
      ConsoleOutput.log(`   Command history: ${stepsCount} steps`);
      
      const lastUserMsg = this.conversationHistory
        .filter(msg => msg.role === 'user')
        .pop();
      if (lastUserMsg) {
        ConsoleOutput.log(`   Last action: "${this.truncateOutput(lastUserMsg.content, 1)}"`);
      }
    }
  }

  truncateOutput(text, maxLines = 4) {
    const lines = text.split('\n');
    if (lines.length <= maxLines) return text;
    return lines.slice(0, maxLines).join('\n') + `\n... [${lines.length - maxLines} more lines]`;
  }

  addConversationMessage(role, content) {
    this.conversationHistory.push({ role, content });
  }

  addHistoryEntry(entry) {
    this.fullHistory.push({
      ...entry,
      timestamp: new Date().toISOString()
    });
  }

  getConversationHistory() {
    return this.conversationHistory;
  }

  setConversationHistory(history) {
    this.conversationHistory = history;
  }

  setInitialPrompt(prompt) {
    this.initialPrompt = prompt;
    this.saveSession();
  }

  getInitialPrompt() {
    return this.initialPrompt;
  }

  cleanupArtifacts() {
    if (this.sessionNamespace) {
      try {
        if (fs.existsSync(this.sessionFile)) {
          fs.unlinkSync(this.sessionFile);
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  }
}
