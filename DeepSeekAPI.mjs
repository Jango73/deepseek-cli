export class DeepSeekAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  getApiConfig() {
    return {
      url: 'https://api.deepseek.com/chat/completions',
      model: 'deepseek-coder',
      maxTokens: 1000,
      temperature: 0.1,
      timeout: 30000
    };
  }

  async makeApiRequest(messages, systemPrompt = null) {
    const apiConfig = this.getApiConfig();
    
    const finalMessages = systemPrompt 
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), apiConfig.timeout);
    
    try {
      const response = await fetch(apiConfig.url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: apiConfig.model,
          messages: finalMessages,
          max_tokens: apiConfig.maxTokens,
          temperature: apiConfig.temperature
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(`API Error: ${data.error.message}`);
      }
      
      if (!data.choices || !data.choices[0]) {
        throw new Error('Invalid response format from API');
      }
      
      return data.choices[0].message.content;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.error('❌ API request timeout');
      } else {
        console.error('❌ API call failed:', error.message);
      }
      throw error;
    }
  }
}