import fs from 'fs';
import { ConsoleOutput } from "./ConsoleOutput.mjs";

export class ConversationManager {
  constructor(sessionManager, deepSeekAPI) {
    this.sessionManager = sessionManager;
    this.deepSeekAPI = deepSeekAPI;
    this.maxConversationLength = 90;
    this.criticalConversationLength = 100;
  }

  checkConversationSize() {
    const currentSize = this.sessionManager.conversationHistory.length;

    if (currentSize >= this.criticalConversationLength) {
      return "needs_compact";
    } else if (currentSize >= this.maxConversationLength) {
      return 'warning';
    }

    return 'normal';
  }

  async compactConversationWithAI() {
    const totalMessages = this.sessionManager.conversationHistory.length;

    if (totalMessages <= 10) {
      ConsoleOutput.info('ℹ️ Conversation already has less than 10 messages, no compaction needed');
      return false;
    }

    ConsoleOutput.info(`⚙️ Compacting conversation (${totalMessages} messages)...`);

    const fullConversation = this.sessionManager.conversationHistory.map(msg => 
      `${msg.role.toUpperCase()}:\n${msg.content}`
    ).join('\n\n');

    const compactionPrompt = `
Here is the complete history of a conversation between an AI assistant and a user.
Compact this conversation while keeping only the most relevant information.
Reduce the size to about 20% of the original while preserving:
1. The general context and main objective
2. Important decisions made
3. Problems encountered and their solutions
4. Current project state
5. Key commands executed

Keep the conversation structure (USER/ASSISTANT roles) but merge similar messages.
The compacted version should allow continuing the conversation without losing context.

Conversation to compact:
${fullConversation}
`;

    try {
      const compactedText = await this.deepSeekAPI.makeApiRequest(
        [{ role: 'user', content: compactionPrompt }],
        `You are a conversation synthesis expert.
        Your task is to reduce a long conversation to its essence (20% of original size)
        while keeping all important information to maintain continuity.
        Return ONLY the compacted text, without additional comments.`
      );

      const firstMessages = this.sessionManager.conversationHistory.slice(0, 2);
      const summaryMessage = {
        role: 'system',
        content: `CONVERSATION SUMMARY (${totalMessages} messages compacted):\n${compactedText}`
      };

      const lastMessages = this.sessionManager.conversationHistory.slice(-4);

      this.sessionManager.setConversationHistory([...firstMessages, summaryMessage, ...lastMessages]);

      ConsoleOutput.info(`✅ Compacted conversation: ${totalMessages} → ${this.sessionManager.conversationHistory.length} messages`);
      this.sessionManager.saveSession();
      return true;

    } catch (error) {
      ConsoleOutput.info('❌ AI compaction failed, using fallback method');
      return this.compactConversationFallback();
    }
  }

  compactConversationFallback() {
    const totalMessages = this.sessionManager.conversationHistory.length;

    if (totalMessages <= 10) {
      return false;
    }

    const firstMessages = this.sessionManager.conversationHistory.slice(0, 4);
    const lastMessages = this.sessionManager.conversationHistory.slice(-6);

    this.sessionManager.setConversationHistory([...firstMessages, ...lastMessages]);

    ConsoleOutput.info(`✅ Conversation compacted (fallback): ${totalMessages} → ${this.sessionManager.conversationHistory.length} messages`);
    this.sessionManager.saveSession();
    return true;
  }

  async askDeepSeek(prompt, workingDirectory, systemPrompt, abortController = null) {
    let agentsContent = '';
    if (this.sessionManager.conversationHistory.length === 0) {
      try {
        const agentsPath = `${workingDirectory}/AGENTS.md`;
        if (fs.existsSync(agentsPath)) {
          agentsContent = fs.readFileSync(agentsPath, 'utf8');
          ConsoleOutput.info('📖 Loaded AGENTS.md');
        }
      } catch (error) {
        // Ignore if AGENTS.md doesn't exist
      }
    }

    const finalSystemPrompt = `${systemPrompt}
${agentsContent ? `\nProject-specific context from AGENTS.md:\n${agentsContent}\n` : ''}
Current directory: ${workingDirectory}`;

    const messages = [
      ...this.sessionManager.conversationHistory,
      { role: 'user', content: prompt }
    ];

    const result = await this.deepSeekAPI.makeApiRequest(messages, finalSystemPrompt, abortController);

    this.sessionManager.addConversationMessage('user', prompt);
    this.sessionManager.addConversationMessage('assistant', result);
    this.sessionManager.saveSession();

    return result;
  }
}
