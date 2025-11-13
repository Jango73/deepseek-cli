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

  async makeApiRequest(messages, systemPrompt = null, abortController = null) {
    const apiConfig = this.getApiConfig();
    const cleanupWaitIndicator = (() => {
      const startTime = Date.now();
      let indicatorActive = false;
      let intervalHandle = null;
      const renderIndicator = () => {
        const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
        process.stdout.write(`\r⏳ Waiting for AI response… ${elapsedSeconds}s`);
      };
      const timeoutHandle = setTimeout(() => {
        indicatorActive = true;
        renderIndicator();
        intervalHandle = setInterval(renderIndicator, 1000);
      }, 10000);

      return () => {
        clearTimeout(timeoutHandle);
        if (intervalHandle) {
          clearInterval(intervalHandle);
        }
        if (indicatorActive) {
          const clearLine = '\r' + ' '.repeat(60) + '\r';
          process.stdout.write(clearLine);
        }
      };
    })();
    
    const finalMessages = systemPrompt 
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const controller = abortController || new AbortController();
    let timeoutId;
    timeoutId = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }, apiConfig.timeout);
    
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
      
      return data.choices[0]?.message?.content;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.error('❌ API request aborted');
      } else {
        console.error('❌ API call failed:', error.message);
      }
      throw error;
    } finally {
      cleanupWaitIndicator();
    }
  }
}
