# DeepSeek CLI

This is a personal project and I am in no way related to DeepSeek, just a simple user.

## Project Setup

Before using the DeepSeek CLI, you need to set up the project dependencies:

```bash
npm install
```

This will install the required dependencies (including dotenv for environment variable management).

## API Key Setup

There are two ways to provide your DeepSeek API key to the CLI:

### Method 1: Environment Variable (Recommended)
Create a `.env` file in the project root with your API key:
```bash
DEEPSEEK_API_KEY=your_deepseek_api_key_here
```

### Method 2: Command Line Argument
Pass the API key directly when running the CLI:
```bash
# First argument = workspace directory
# Remaining arguments are forwarded to the CLI (API key, flags, etc.)
./deepseek.sh /path/to/your/project your_api_key_here
```

If you omit the first argument, the script uses the directory from which you launched it as the agent workspace. This lets you invoke the CLI from anywhere while pointing it to a different project tree (e.g., `./deepseek.sh samples/gallery`).

### Getting Your API Key
1. Visit [DeepSeek Platform](https://platform.deepseek.com/)
2. Sign up or log in to your account
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key and use one of the methods above

### Security Note
- Never commit your `.env` file to version control
- Add `.env` to your `.gitignore` file
- Keep your API key secure and don't share it publicly

The CLI will automatically load the API key from the environment variable if available, otherwise it will use the command line argument.
