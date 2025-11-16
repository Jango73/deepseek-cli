import chalk from 'chalk';
import { ConsoleOutput } from "./ConsoleOutput.mjs";

export const printBlock = (title, lines) => {
  const maxLineLength = Math.max(...lines.map(line => line.length));
  const border = '─'.repeat(Math.max(0, maxLineLength + 4));
  
  ConsoleOutput.info(chalk.blue(`┌${border}┐`));
  ConsoleOutput.info(chalk.blue(`│ ${chalk.bold(title)}${' '.repeat(Math.max(0, maxLineLength - title.length + 3))}│`));
  ConsoleOutput.info(chalk.blue(`├${border}┤`));
  
  for (const line of lines) {
    ConsoleOutput.info(chalk.blue(`│ ${line}${' '.repeat(Math.max(0, maxLineLength - line.length + 3))}│`));
  }
  
  ConsoleOutput.info(chalk.blue(`└${border}┘`));
};
