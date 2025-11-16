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
        const limitedLines = lines.slice(0, 6);
        const maxLineLength = Math.max(...limitedLines.map(line => line.length));
        const border = "─".repeat(Math.max(0, maxLineLength + 4));
        
        console.log(chalk.blue(`┌${border}┐`));
        console.log(chalk.blue(`│ ${chalk.bold(title)}${" ".repeat(Math.max(0, maxLineLength - title.length + 3))}│`));
        console.log(chalk.blue(`├${border}┤`));
        
        for (const line of limitedLines) {
            console.log(chalk.blue(`│ ${line}${" ".repeat(Math.max(0, maxLineLength - line.length + 3))}│`));
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
