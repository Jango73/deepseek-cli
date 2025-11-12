// test_command_parser.mjs
import { CommandExecutor } from './CommandExecutor.mjs';
import fs from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class CommandParserTester {
    constructor() {
        this.testDir = join(__dirname, 'test_temp');
        this.passedTests = 0;
        this.failedTests = 0;
    }

    async setup() {
        try {
            await fs.mkdir(this.testDir, { recursive: true });
        } catch (error) {
            // Directory already exists
        }
    }

    async cleanup() {
        try {
            const files = await fs.readdir(this.testDir);
            for (const file of files) {
                await fs.unlink(join(this.testDir, file));
            }
            await fs.rmdir(this.testDir);
        } catch (error) {
            // Ignore cleanup errors
        }
    }

    logTestResult(testName, passed, message = '') {
        if (passed) {
            this.passedTests++;
            console.log(`✅ ${testName} - PASSED`);
        } else {
            this.failedTests++;
            console.log(`❌ ${testName} - FAILED: ${message}`);
        }
    }

    // Test 1: Simple commands with >>
    async testBasicCommandParsing() {
        console.log('\n🧪 TEST 1: Simple commands with >>');
        
        const executor = new CommandExecutor(this.testDir, []);
        
        const testCases = [
            {
                name: 'Simple command with >>',
                input: '>> ls -la',
                expectedType: 'command',
                expectedCommand: 'ls -la'
            },
            {
                name: 'Command without >>',
                input: 'echo "hello"',
                expectedType: 'command', 
                expectedCommand: 'echo "hello"'
            },
            {
                name: 'Complex command',
                input: '>> find . -name "*.js" -type f',
                expectedType: 'command',
                expectedCommand: 'find . -name "*.js" -type f'
            }
        ];

        for (const testCase of testCases) {
            const result = executor.parseAIResponse(testCase.input);
            const passed = result.type === testCase.expectedType && 
                          result.command === testCase.expectedCommand;
            
            this.logTestResult(
                testCase.name,
                passed,
                `Got type: ${result.type}, command: ${result.command}`
            );
        }
    }

    // Test 2: Complete multiline heredoc - INCREASED SIZE
    async testHeredocMultiline() {
        console.log('\n🧪 TEST 2: Multiline heredoc - INCREASED SIZE');
        
        const executor = new CommandExecutor(this.testDir, []);
        
        const heredocInput = `Let's create a complete configuration file for a modern Node.js application with all necessary dependencies:
>> cat > package.json << EOF
{
    "name": "my-advanced-project",
    "version": "1.0.0",
    "description": "A modern Node.js application with Express, MongoDB and JWT",
    "main": "src/app.js",
    "type": "module",
    "scripts": {
        "start": "node src/app.js",
        "dev": "nodemon src/app.js",
        "test": "jest --coverage",
        "test:watch": "jest --watch",
        "lint": "eslint src/",
        "lint:fix": "eslint src/ --fix",
        "build": "npm run lint && npm run test",
        "docker:build": "docker build -t my-project .",
        "docker:run": "docker run -p 3000:3000 my-project",
        "deploy:staging": "npm run build && docker build -t my-project:staging .",
        "deploy:production": "npm run build && docker build -t my-project:production ."
    },
    "dependencies": {
        "express": "^4.18.2",
        "mongoose": "^7.5.0",
        "cors": "^2.8.5",
        "helmet": "^7.0.0",
        "compression": "^1.7.4",
        "dotenv": "^16.3.1",
        "jsonwebtoken": "^9.0.2",
        "bcryptjs": "^2.4.3",
        "express-rate-limit": "^6.10.0",
        "express-validator": "^7.0.1",
        "winston": "^3.10.0",
        "moment": "^2.29.4",
        "axios": "^1.5.0",
        "uuid": "^9.0.0",
        "redis": "^4.6.7",
        "socket.io": "^4.7.2",
        "multer": "^1.4.5",
        "sharp": "^0.32.5",
        "node-cron": "^3.0.2",
        "nodemailer": "^6.9.4",
        "cloudinary": "^1.40.0"
    },
    "devDependencies": {
        "nodemon": "^3.0.1",
        "jest": "^29.6.2",
        "supertest": "^6.3.3",
        "eslint": "^8.47.0",
        "eslint-config-airbnb-base": "^15.0.0",
        "eslint-plugin-import": "^2.28.1",
        "@types/jest": "^29.5.4",
        "@types/node": "^20.5.0",
        "prettier": "^3.0.2",
        "husky": "^8.0.3",
        "lint-staged": "^14.0.1"
    },
    "engines": {
        "node": ">=18.0.0",
        "npm": ">=9.0.0"
    },
    "keywords": [
        "nodejs",
        "express",
        "mongodb",
        "jwt",
        "api",
        "rest",
        "docker",
        "microservices",
        "redis",
        "socketio"
    ],
    "author": "Your Name <email@example.com>",
    "license": "MIT",
    "repository": {
        "type": "git",
        "url": "https://github.com/your-username/my-advanced-project"
    },
    "bugs": {
        "url": "https://github.com/your-username/my-advanced-project/issues"
    },
    "homepage": "https://github.com/your-username/my-advanced-project#readme",
    "funding": {
        "type": "individual",
        "url": "https://github.com/sponsors/your-username"
    }
}
EOF

Now let's also create an extended Docker configuration file:
>> cat > Dockerfile << EOF
# Official Node.js image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy configuration files
COPY package*.json ./
COPY .env.example .env
COPY tsconfig.json ./
COPY jest.config.js ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/
COPY public/ ./public/
COPY tests/ ./tests/

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Change permissions
RUN chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:3000/health || exit 1

# Start command
CMD ["npm", "start"]

# Labels
LABEL maintainer="your-team@example.com"
LABEL version="1.0.0"
LABEL description="Advanced Node.js application with full stack features"
EOF

And finally a comprehensive ESLint configuration file:
>> cat > .eslintrc.json << EOF
{
    "env": {
        "node": true,
        "es2021": true,
        "jest": true,
        "browser": true
    },
    "extends": [
        "airbnb-base",
        "eslint:recommended",
        "prettier"
    ],
    "parserOptions": {
        "ecmaVersion": "latest",
        "sourceType": "module"
    },
    "rules": {
        "no-console": "off",
        "indent": ["error", 4],
        "quotes": ["error", "single"],
        "semi": ["error", "always"],
        "comma-dangle": ["error", "never"],
        "arrow-parens": ["error", "as-needed"],
        "import/prefer-default-export": "off",
        "class-methods-use-this": "off",
        "no-underscore-dangle": "off",
        "max-len": ["error", { "code": 120 }],
        "no-unused-vars": ["error", { "argsIgnorePattern": "next|req|res" }],
        "consistent-return": "off",
        "object-curly-newline": "off",
        "operator-linebreak": ["error", "after"],
        "implicit-arrow-linebreak": "off",
        "function-paren-newline": "off"
    },
    "overrides": [
        {
            "files": ["**/*.test.js", "**/*.spec.js"],
            "rules": {
                "no-undef": "off",
                "no-unused-expressions": "off"
            }
        }
    ]
}
EOF

Additionally, let's create a comprehensive environment configuration:
>> cat > .env.example << EOF
# Server Configuration
PORT=3000
NODE_ENV=development
HOST=localhost
API_VERSION=v1
API_PREFIX=/api

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/myapp
MONGODB_TEST_URI=mongodb://localhost:27017/myapp-test
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your_redis_password_here

# Security Configuration
JWT_SECRET=your_super_secure_jwt_secret_here_change_in_production
JWT_EXPIRES_IN=7d
BCRYPT_SALT_ROUNDS=12
CORS_ORIGIN=http://localhost:3000,http://localhost:3001

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# File Upload Configuration
MAX_FILE_SIZE=10485760
ALLOWED_FILE_TYPES=image/jpeg,image/png,image/gif,application/pdf

# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_specific_password
FROM_EMAIL=noreply@yourapp.com

# Cloud Storage
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Third Party APIs
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
SENDGRID_API_KEY=your_sendgrid_api_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Monitoring and Logging
LOG_LEVEL=info
SENTRY_DSN=your_sentry_dsn_here
NEW_RELIC_LICENSE_KEY=your_new_relic_license_key

# Cache Configuration
CACHE_TTL=3600
CACHE_MAX_ITEMS=1000

# Feature Flags
FEATURE_NEW_UI=true
FEATURE_PAYMENTS=false
FEATURE_MULTI_TENANCY=true
EOF

This configuration provides a solid foundation for a production-ready Node.js application.`;

        const result = executor.parseAIResponse(heredocInput);
        
        console.log('📝 Parsed input:');
        console.log(heredocInput);
        console.log('\n🔧 Extracted command:');
        console.log(result.command);
        
        const tests = [
            {
                name: 'Correct type',
                condition: result.type === 'command'
            },
            {
                name: 'Contains cat command',
                condition: result.command.includes('cat > package.json')
            },
            {
                name: 'Contains EOF marker',
                condition: result.command.includes('EOF')
            },
            {
                name: 'Contains complete package.json',
                condition: result.command.includes('"name": "my-advanced-project"') &&
                          result.command.includes('"express": "^4.18.2"') &&
                          result.command.includes('"scripts"')
            },
            {
                name: 'Contains Docker configuration',
                condition: result.command.includes('FROM node:18-alpine') &&
                          result.command.includes('HEALTHCHECK')
            },
            {
                name: 'Contains ESLint configuration',
                condition: result.command.includes('"env"') &&
                          result.command.includes('"rules"')
            },
            {
                name: 'Contains environment configuration',
                condition: result.command.includes('PORT=3000') &&
                          result.command.includes('JWT_SECRET') &&
                          result.command.includes('MONGODB_URI')
            },
            {
                name: 'Preserves multiline structure',
                condition: (result.command.match(/\n/g) || []).length >= 50
            }
        ];

        tests.forEach(test => {
            this.logTestResult(test.name, test.condition);
        });
    }

    // Test 3: Real heredoc execution
    async testHeredocExecution() {
        console.log('\n🧪 TEST 3: Real heredoc execution');
        
        const executor = new CommandExecutor(this.testDir, []);
        
        const heredocCommand = `cat > my_script.sh << EOF
#!/bin/bash
# Automatically generated script
echo "Script start"
for i in {1..3}; do
    echo "Iteration \$i"
done
echo "Script end"
EOF`;

        try {
            console.log('🔧 Executing heredoc command...');
            const result = await executor.executeCommand(heredocCommand);
            
            // Verify command succeeded
            const filePath = join(this.testDir, 'my_script.sh');
            const fileContent = await fs.readFile(filePath, 'utf8');
            
            console.log('📄 Created file content:');
            console.log(fileContent);
            
            const tests = [
                {
                    name: 'Command executed successfully',
                    condition: result.success === true
                },
                {
                    name: 'File created with correct content',
                    condition: fileContent.includes('#!/bin/bash') &&
                              fileContent.includes('Iteration') &&
                              fileContent.includes('Script end')
                },
                {
                    name: 'Multiline structure preserved',
                    condition: (fileContent.match(/\n/g) || []).length >= 6
                }
            ];

            tests.forEach(test => {
                this.logTestResult(test.name, test.condition);
            });

        } catch (error) {
            this.logTestResult('Heredoc execution', false, error.message);
        }
    }

    // Test 4: Mixed comments and commands
    async testMixedCommentsAndCommands() {
        console.log('\n🧪 TEST 4: Mixed comments and commands');
        
        const executor = new CommandExecutor(this.testDir, []);
        
        const mixedInput = `First, let's create the project structure
This is a comment before the command
>> mkdir -p src/components
>> cd src/components
Now let's create a React component
>> cat > Button.js << EOF
import React from 'react';

const Button = ({ children, onClick }) => {
    return (
        <button onClick={onClick} className="btn">
            {children}
        </button>
    );
};

export default Button;
EOF
Component created successfully!`;

        const result = executor.parseAIResponse(mixedInput);
        
        console.log('📝 Input with comments:');
        console.log(mixedInput);
        console.log('\n🔧 Extracted commands:');
        console.log(result.command);
        
        const tests = [
            {
                name: 'Command type detected',
                condition: result.type === 'command'
            },
            {
                name: 'Contains mkdir',
                condition: result.command.includes('mkdir -p src/components')
            },
            {
                name: 'Contains cd',
                condition: result.command.includes('cd src/components')
            },
            {
                name: 'Contains React component',
                condition: result.command.includes('import React') &&
                          result.command.includes('const Button') &&
                          result.command.includes('export default')
            }
        ];

        tests.forEach(test => {
            this.logTestResult(test.name, test.condition);
        });
    }

    // Test 5: Forbidden commands
    async testForbiddenCommands() {
        console.log('\n🧪 TEST 5: Forbidden commands');
        
        const forbiddenCommands = ['rm -rf /', 'chmod -R 000 /'];
        const executor = new CommandExecutor(this.testDir, forbiddenCommands);
        
        const testCases = [
            {
                name: 'rm -rf / forbidden command',
                input: '>> rm -rf /',
                shouldBeForbidden: true
            },
            {
                name: 'ls command allowed',
                input: '>> ls -la',
                shouldBeForbidden: false
            },
            {
                name: 'chmod forbidden command',
                input: '>> chmod -R 000 /etc',
                shouldBeForbidden: true
            }
        ];

        for (const testCase of testCases) {
            const result = executor.parseAIResponse(testCase.input);
            const isForbidden = executor.isCommandForbidden(result.command);
            
            this.logTestResult(
                testCase.name,
                isForbidden === testCase.shouldBeForbidden,
                `Expected forbidden: ${testCase.shouldBeForbidden}, Got: ${isForbidden}`
            );
        }
    }

    // Test 6: Multiline commands with backslash
    async testMultilineWithBackslash() {
        console.log('\n🧪 TEST 6: Multiline commands with continuation');
        
        const executor = new CommandExecutor(this.testDir, []);
        
        const multilineInput = `>> npm init -y && \\
>> npm install express cors dotenv && \\
>> npm install --save-dev jest supertest`;

        const result = executor.parseAIResponse(multilineInput);
        
        console.log('📝 Multiline command:');
        console.log(multilineInput);
        console.log('\n🔧 Reconstructed command:');
        console.log(result.command);
        
        const tests = [
            {
                name: 'Command type detected',
                condition: result.type === 'command'
            },
            {
                name: 'Contains npm init',
                condition: result.command.includes('npm init -y')
            },
            {
                name: 'Contains npm install express',
                condition: result.command.includes('npm install express')
            },
            {
                name: 'Contains npm install jest',
                condition: result.command.includes('npm install --save-dev jest')
            },
            {
                name: 'Backslashes handled correctly',
                condition: !result.command.includes('\\\\') // No double backslash
            }
        ];

        tests.forEach(test => {
            this.logTestResult(test.name, test.condition);
        });
    }

    // Test 7: Complex AI response simulation
    async testComplexAIResponse() {
        console.log('\n🧪 TEST 7: Complex AI response simulation');
        
        const executor = new CommandExecutor(this.testDir, []);
        
        const aiResponse = `I will help you create a complete Node.js project.

First, let's initialize the project:
>> npm init -y

Let's create the folder structure:
>> mkdir -p src/routes src/models src/middleware src/utils

Now, let's create the main file with a basic Express server:
>> cat > src/app.js << EOF
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health route
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 404 error handling
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(\`Server running on port \${PORT}\`);
});

module.exports = app;
EOF

Finally, let's create the environment file:
>> cat > .env << EOF
PORT=3000
NODE_ENV=development
DATABASE_URL=mongodb://localhost:27017/myapp
JWT_SECRET=your-super-secure-secret-here
EOF

The project is now ready!`;

        const result = executor.parseAIResponse(aiResponse);
        
        console.log('📝 Simulated AI response analyzed');
        console.log('\n🔧 Extracted commands:');
        console.log(result.command);
        
        const tests = [
            {
                name: 'Command type detected',
                condition: result.type === 'command'
            },
            {
                name: 'Contains npm init',
                condition: result.command.includes('npm init -y')
            },
            {
                name: 'Contains mkdir structure',
                condition: result.command.includes('mkdir -p src/routes')
            },
            {
                name: 'Contains app.js Express',
                condition: result.command.includes('const express = require') &&
                          result.command.includes('app.listen')
            },
            {
                name: 'Contains .env file',
                condition: result.command.includes('PORT=3000') &&
                          result.command.includes('JWT_SECRET')
            },
            {
                name: 'Correct EOF marker handling',
                condition: result.command.includes('EOF')
            }
        ];

        tests.forEach(test => {
            this.logTestResult(test.name, test.condition);
        });
    }

    async runAllTests() {
        console.log('🚀 LAUNCHING AI COMMAND PARSER TESTS');
        console.log('=' .repeat(60));
        
        await this.setup();

        try {
            await this.testBasicCommandParsing();
            await this.testHeredocMultiline();
            await this.testHeredocExecution();
            await this.testMixedCommentsAndCommands();
            await this.testForbiddenCommands();
            await this.testMultilineWithBackslash();
            await this.testComplexAIResponse();

            // Final summary
            console.log('\n' + '=' .repeat(60));
            console.log('📊 FINAL RESULTS:');
            console.log(`✅ Passed tests: ${this.passedTests}`);
            console.log(`❌ Failed tests: ${this.failedTests}`);
            console.log(`📈 Success rate: ${((this.passedTests / (this.passedTests + this.failedTests)) * 100).toFixed(1)}%`);

            if (this.failedTests === 0) {
                console.log('\n🎉 ALL TESTS PASSED!');
            } else {
                console.log('\n⚠️  Some tests failed, please check the parser.');
            }

        } finally {
            await this.cleanup();
        }
    }
}

// Run tests
const tester = new CommandParserTester();
tester.runAllTests().catch(console.error);