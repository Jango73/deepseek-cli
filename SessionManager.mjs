import fs from 'fs';

export class SessionManager {
  constructor(workingDirectory) {
    this.workingDirectory = workingDirectory;
    this.sessionFile = `${workingDirectory}/.deepseek_session.json`;
    this.conversationHistory = [];
    this.fullHistory = [];
  }

  loadSession() {
    try {
      if (fs.existsSync(this.sessionFile)) {
        const data = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
        this.conversationHistory = data.conversationHistory || [];
        this.fullHistory = data.fullHistory || [];
        
        console.log('📁 Previous session loaded');
        this.showSessionStatus();
        return true;
      } else {
        console.log('🆕 New session - no previous session found');
        return false;
      }
    } catch (error) {
      this.conversationHistory = [];
      this.fullHistory = [];
      console.log('🆕 New session - error loading previous session');
      return false;
    }
  }

  saveSession() {
    try {
      const data = { 
        conversationHistory: this.conversationHistory,
        fullHistory: this.fullHistory
      };
      fs.writeFileSync(this.sessionFile, JSON.stringify(data, null, 2));
    } catch (error) {
      // Ignore save errors
    }
  }

  showSessionStatus() {
    const historyCount = this.conversationHistory.length;
    const stepsCount = this.fullHistory.length;
    
    if (historyCount === 0) {
      console.log('🆕 New session - no conversation history');
    } else {
      console.log('📁 Current session:');
      console.log(`   Conversation: ${historyCount} messages`);
      console.log(`   Command history: ${stepsCount} steps`);
      
      const lastUserMsg = this.conversationHistory
        .filter(msg => msg.role === 'user')
        .pop();
      if (lastUserMsg) {
        console.log(`   Last task: "${this.truncateOutput(lastUserMsg.content, 1)}"`);
      }
    }
  }

  truncateOutput(text, maxLines = 4) {
    const lines = text.split('\n');
    if (lines.length <= maxLines) return text;
    return lines.slice(0, maxLines).join('\n') + `\n... [${lines.length - maxLines} more lines]`;
  }

  clearSession() {
    this.conversationHistory = [];
    this.fullHistory = [];
    this.saveSession();
    console.log('🧹 History cleared');
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
}