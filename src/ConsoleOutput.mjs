import chalk from 'chalk';

export class ConsoleOutput {
    static info(message) {
        console.log(`${message}`);
    }

    static success(message) {
        console.log(`✅ ${message}`);
    }

    static error(message) {
        console.error(`❌ ${message}`);
    }

    static warning(message) {
        console.warn(`⚠️  ${message}`);
    }

    static header(title) {
        console.log('\n' + '='.repeat(50));
        console.log(` ${title}`);
        console.log('='.repeat(50));
    }

    static printBlock(title, lines) {
        if (!lines || lines.length === 0) {
            lines = [""];
        }
        const limitedLines = lines.slice(0, 6);
        const hasMoreLines = lines.length > 6;
        const maxLineLength = Math.max(...limitedLines.map(line => String(line).length), String(title).length);
        const border = "─".repeat(Math.max(0, maxLineLength + 4));
        
        console.log(chalk.blue(`┌${border}┐`));
        console.log(chalk.blue(`│ ${chalk.bold(title)}${" ".repeat(Math.max(0, maxLineLength - String(title).length + 3))}│`));
        console.log(chalk.blue(`├${border}┤`));
        
        for (const line of limitedLines) {
            const lineStr = String(line);
            console.log(chalk.blue(`│ ${lineStr}${" ".repeat(Math.max(0, maxLineLength - lineStr.length + 3))}│`));
        }
        
        if (hasMoreLines) {
            const remainingLines = lines.length - 6;
            const message = `... and ${remainingLines} more line${remainingLines > 1 ? "s" : ""}`;
            console.log(chalk.blue(`│ ${message}${" ".repeat(Math.max(0, maxLineLength - message.length + 3))}│`));
        }
        
        console.log(chalk.blue(`└${border}┘`));
    }

    static json(data, title = '') {
        if (title) {
            this.header(title);
        }
        console.log(JSON.stringify(data, null, 2));
    }
}
