import chalk from 'chalk';

export const printBlock = (title, lines) => {
  const maxLineLength = Math.max(...lines.map(line => line.length));
  const border = '─'.repeat(Math.max(0, maxLineLength + 4));
  
  console.log(chalk.blue(`┌${border}┐`));
  console.log(chalk.blue(`│ ${chalk.bold(title)}${' '.repeat(Math.max(0, maxLineLength - title.length + 3))}│`));
  console.log(chalk.blue(`├${border}┤`));
  
  for (const line of lines) {
    console.log(chalk.blue(`│ ${line}${' '.repeat(Math.max(0, maxLineLength - line.length + 2))}│`));
  }
  
  console.log(chalk.blue(`└${border}┘`));
};
