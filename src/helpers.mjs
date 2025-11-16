import chalk from 'chalk';
import { ConsoleOutput } from "./ConsoleOutput.mjs";

export const printBlock = (title, lines) => {
  const maxLineLength = Math.max(...lines.map(line => line.length));
  const border = '─'.repeat(Math.max(0, maxLineLength + 4));
  
  ConsoleOutput.log(chalk.blue(`┌${border}┐`));
  ConsoleOutput.log(chalk.blue(`│ ${chalk.bold(title)}${' '.repeat(Math.max(0, maxLineLength - title.length + 3))}│`));
  ConsoleOutput.log(chalk.blue(`├${border}┤`));
  
  for (const line of lines) {
    ConsoleOutput.log(chalk.blue(`│ ${line}${' '.repeat(Math.max(0, maxLineLength - line.length + 3))}│`));
  }
  
  ConsoleOutput.log(chalk.blue(`└${border}┘`));
};
