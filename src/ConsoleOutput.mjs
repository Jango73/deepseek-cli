export class ConsoleOutput {
    static log(message) {
        console.log(`${message}`);
    }

    static info(message) {
        console.log(`ℹ️  ${message}`);
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

    static json(data, title = '') {
        if (title) {
            this.header(title);
        }
        console.log(JSON.stringify(data, null, 2));
    }
}
