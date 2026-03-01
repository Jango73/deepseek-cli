import chalk from "chalk";
import { logger } from "./Logger.mjs";

export class ConsoleOutput {
  static info(message, ...args) {
    console.log(`${message}`);
    logger.info(message + (args.length > 0 ? ' ' + args.join(' ') : ''));
  }

  static success(message, ...args) {
    console.log(`✅ ${message}`);
    logger.success(message + (args.length > 0 ? ' ' + args.join(' ') : ''));
  }

  static error(message, ...args) {
    console.error(`❌ ${message}`);
    logger.error(message + (args.length > 0 ? ' ' + args.join(' ') : ''));
  }

  static warning(message, ...args) {
    console.warn(`⚠️  ${message}`);
    logger.warn(message + (args.length > 0 ? ' ' + args.join(' ') : ''));
  }

  static header(title) {
    console.log("\n" + "=".repeat(50));
    console.log(` ${title}`);
    console.log("=".repeat(50));
  }

  static printBlock(title, lines) {
    if (!lines || lines.length === 0) {
      lines = [""];
    }
    const limitedLines = lines.slice(0, 6);

    // Get terminal width with fallback
    const terminalWidth = process.stdout.columns || 80;
    const blockWidth = terminalWidth - 6; // Account for borders and padding

    // Truncate title and lines to fit terminal width
    const truncatedTitle =
      String(title).length > blockWidth
        ? String(title).substring(0, blockWidth - 3) + "..."
        : String(title);

    const truncatedLines = limitedLines.map((line) => {
      const lineStr = String(line);
      return lineStr.length > blockWidth
        ? lineStr.substring(0, blockWidth - 3) + "..."
        : lineStr;
    });
    const hasMoreLines = lines.length > 6;
    
    // Use full terminal width for the block
    const border = "─".repeat(Math.max(0, blockWidth + 2));

    console.log(chalk.gray(`┌${border}┐`));
    console.log(
      chalk.gray(
        `│ ${chalk.bold(truncatedTitle)}${" ".repeat(Math.max(0, blockWidth - truncatedTitle.length))} │`,
      ),
    );
    console.log(chalk.gray(`├${border}┤`));

    for (const line of truncatedLines) {
      const lineStr = String(line);
      console.log(
        chalk.gray(
          `│ ${lineStr}${" ".repeat(Math.max(0, blockWidth - lineStr.length))} │`,
        ),
      );
      logger.info(`    ${lineStr}`);
    }

    if (hasMoreLines) {
      const remainingLines = lines.length - 6;
      const message = `... and ${remainingLines} more line${remainingLines > 1 ? "s" : ""}`;
      console.log(
        chalk.gray(
          `│ ${message}${" ".repeat(Math.max(0, blockWidth - message.length))} │`,
        ),
      );
    }

    console.log(chalk.gray(`└${border}┘`));
  }

  static json(data, title = "") {
    if (title) {
      this.header(title);
    }
    console.log(JSON.stringify(data, null, 2));
  }
}
