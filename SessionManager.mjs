import fs from 'fs';

export class SessionManager {
  constructor(workingDirectory) {
    this.workingDirectory = workingDirectory;
    this.sessionFile = `${workingDirectory}/.deepseek_session.json`;
    this.archivesDirectory = `${workingDirectory}/.deepseek_archives`;
    this.conversationHistory = [];
    this.fullHistory = [];
    this.currentSessionId = null;
    this.currentSessionDescription = '';
    this.initialPrompt = '';
    
    this.ensureArchivesDirectory();
  }

  ensureArchivesDirectory() {
    if (!fs.existsSync(this.archivesDirectory)) {
      fs.mkdirSync(this.archivesDirectory, { recursive: true });
    }
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
        
        console.log('📁 Previous session loaded');
        this.showSessionStatus();
        return true;
      } else {
        this.currentSessionId = this.generateSessionId();
        console.log('🆕 New session - no previous session found');
        return false;
      }
    } catch (error) {
      this.conversationHistory = [];
      this.fullHistory = [];
      this.currentSessionId = this.generateSessionId();
      console.log('🆕 New session - error loading previous session');
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
      console.log('ℹ️ No conversation to archive');
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
      console.log(`💾 Session archived: ${sessionId}`);
      console.log(`   Description: ${description}`);
      return sessionId;
    } catch (error) {
      console.error('❌ Failed to archive session:', error.message);
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
    console.log('🧹 Current session cleared');
  }

  clearAllSessions() {
    // Clear current session first
    this.clearCurrentSession();
    
    // Clear all archives
    try {
      const files = fs.readdirSync(this.archivesDirectory);
      let deletedCount = 0;
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(`${this.archivesDirectory}/${file}`);
          deletedCount++;
        }
      }
      
      console.log(`🗑️  Deleted ${deletedCount} archived sessions`);
    } catch (error) {
      console.error('❌ Error clearing archives:', error.message);
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
            console.log(`⚠️  Corrupted archive: ${file}`);
          }
        }
      }
      
      // Sort by timestamp (newest first)
      archives.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      return archives;
    } catch (error) {
      console.error('❌ Error listing archives:', error.message);
      return [];
    }
  }

  loadArchive(sessionId) {
    try {
      const archiveFile = `${this.archivesDirectory}/${sessionId}.json`;
      if (!fs.existsSync(archiveFile)) {
        console.log('❌ Archive not found');
        return null;
      }

      const data = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
      return data;
    } catch (error) {
      console.error('❌ Error loading archive:', error.message);
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

    console.log(`🔄 Switched to archived session: ${archiveData.description}`);
    this.showSessionStatus();
    return true;
  }

  showSessionStatus() {
    const historyCount = this.conversationHistory.length;
    const stepsCount = this.fullHistory.length;
    
    if (historyCount === 0) {
      console.log('🆕 New session - no conversation history');
    } else {
      console.log('📁 Current session:');
      console.log(`   ID: ${this.currentSessionId}`);
      if (this.initialPrompt) {
        console.log(`   Task: ${this.initialPrompt}`);
      }
      console.log(`   Conversation: ${historyCount} messages`);
      console.log(`   Command history: ${stepsCount} steps`);
      
      const lastUserMsg = this.conversationHistory
        .filter(msg => msg.role === 'user')
        .pop();
      if (lastUserMsg) {
        console.log(`   Last action: "${this.truncateOutput(lastUserMsg.content, 1)}"`);
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
}