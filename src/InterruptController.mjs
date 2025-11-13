import readline from 'readline';

export class InterruptController {
  constructor() {
    this.listeners = new Set();
    this.isActive = false;
    this.paused = false;
    this.interrupted = false;
    this.isTTY = process.stdin.isTTY;
    this.handleKeypress = this.handleKeypress.bind(this);
    this.handleData = this.handleData.bind(this);
  }

  start() {
    if (this.isActive) return;
    process.stdin.setEncoding('utf8');

    if (this.isTTY) {
      readline.emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('keypress', this.handleKeypress);
    } else {
      process.stdin.on('data', this.handleData);
    }

    this.isActive = true;
  }

  stop() {
    if (!this.isActive) return;
    if (this.isTTY) {
      process.stdin.removeListener('keypress', this.handleKeypress);
      process.stdin.setRawMode(false);
    } else {
      process.stdin.removeListener('data', this.handleData);
    }
    this.isActive = false;
  }

  handleKeypress(str = '', key = {}) {
    if (this.paused) return;
    const isEscape = key?.name === 'escape' || str === '\u001b';
    if (isEscape) {
      this.triggerInterrupt();
    }
  }

  handleData(chunk = '') {
    if (this.paused) return;
    if (chunk === '\u001b') {
      this.triggerInterrupt();
    }
  }

  triggerInterrupt() {
    if (this.interrupted) return;
    this.interrupted = true;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        // Ignore listener errors
      }
    }
  }

  clearInterrupt() {
    this.interrupted = false;
  }

  onInterrupt(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  pause() {
    this.paused = true;
    if (this.isTTY && this.isActive) {
      process.stdin.setRawMode(false);
    }
  }

  resume() {
    this.paused = false;
    if (this.isTTY && this.isActive) {
      process.stdin.setRawMode(true);
    }
  }

  isInterrupted() {
    return this.interrupted;
  }
}
