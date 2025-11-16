import { DeepSeekAPI } from "../DeepSeekAPI.mjs";
import { jest } from "@jest/globals";

describe("DeepSeekAPI", () => {
  let deepseekAPI;

  beforeEach(() => {
    deepseekAPI = new DeepSeekAPI();
  });

  describe("Constructor", () => {
    test("should initialize with apiKey", () => {
      expect(deepseekAPI.apiKey).toBeUndefined();
    });

    test("should initialize with provided apiKey", () => {
      const api = new DeepSeekAPI("test-key");
      expect(api.apiKey).toBe("test-key");
    });
  });

  describe("getApiConfig", () => {
    test("should return correct API configuration", () => {
      const config = deepseekAPI.getApiConfig();
      expect(config.url).toBe("https://api.deepseek.com/chat/completions");
      expect(config.model).toBe("deepseek-coder");
      expect(config.maxTokens).toBe(1000);
      expect(config.temperature).toBe(0.1);
      expect(config.timeout).toBe(30000);
    });
  });

  describe("makeApiRequest", () => {
    let mockFetch;
    let mockAbortController;

    beforeEach(() => {
      mockFetch = jest.fn();
      global.fetch = mockFetch;

      mockAbortController = {
        signal: "test-signal",
        abort: jest.fn(),
      };
      global.AbortController = jest.fn(() => mockAbortController);
    });

    test("should make successful API request", async () => {
      deepseekAPI.apiKey = "test-key";
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: "Test response content",
              },
            },
          ],
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await deepseekAPI.makeApiRequest([
        { role: "user", content: "Hello" },
      ]);

      expect(result).toBe("Test response content");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.deepseek.com/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer test-key",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "deepseek-coder",
            messages: [{ role: "user", content: "Hello" }],
            max_tokens: 1000,
            temperature: 0.1,
          }),
          signal: mockAbortController.signal,
        },
      );
    });

    test("should handle API errors", async () => {
      deepseekAPI.apiKey = "test-key";
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(
        deepseekAPI.makeApiRequest([{ role: "user", content: "Hello" }]),
      ).rejects.toThrow("HTTP 401: Unauthorized");
    });

    test("should handle network errors", async () => {
      deepseekAPI.apiKey = "test-key";
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(
        deepseekAPI.makeApiRequest([{ role: "user", content: "Hello" }]),
      ).rejects.toThrow("Network error");
    });

    test("should handle invalid response format", async () => {
      deepseekAPI.apiKey = "test-key";
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          choices: [],
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(
        deepseekAPI.makeApiRequest([{ role: "user", content: "Hello" }]),
      ).rejects.toThrow("Invalid response format from API");
    });
  });
});
