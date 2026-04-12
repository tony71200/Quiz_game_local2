// ============================================================
// Sound Engine — Web Audio API sound effects
// No external files needed — all sounds are generated
// ============================================================

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playTone(freq, duration, type = 'sine', volume = 0.3, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    try {
      const startTime = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(volume, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    } catch (e) { /* silently ignore audio errors */ }
  }

  playCorrect() {
    this.init();
    this.playTone(523.25, 0.12, 'sine', 0.25, 0);
    this.playTone(659.25, 0.12, 'sine', 0.25, 0.12);
    this.playTone(783.99, 0.35, 'sine', 0.3, 0.24);
  }

  playWrong() {
    this.init();
    this.playTone(220, 0.35, 'sawtooth', 0.12, 0);
    this.playTone(180, 0.35, 'sawtooth', 0.12, 0.18);
  }

  playTick() {
    this.init();
    this.playTone(900, 0.04, 'square', 0.06);
  }

  playCountdownWarning() {
    this.init();
    this.playTone(440, 0.12, 'sine', 0.12);
  }

  playReveal() {
    this.init();
    // Quick drum roll then rising chord
    for (let i = 0; i < 6; i++) {
      this.playTone(250 + Math.random() * 150, 0.06, 'triangle', 0.06, i * 0.05);
    }
    this.playTone(523.25, 0.2, 'sine', 0.18, 0.4);
    this.playTone(659.25, 0.2, 'sine', 0.18, 0.5);
    this.playTone(783.99, 0.35, 'sine', 0.22, 0.6);
  }

  playVictory() {
    this.init();
    const notes = [523.25, 659.25, 783.99, 1046.50, 783.99, 1046.50];
    notes.forEach((n, i) => {
      this.playTone(n, 0.22, 'sine', 0.18, i * 0.16);
    });
  }

  playEliminated() {
    this.init();
    this.playTone(350, 0.25, 'sine', 0.12, 0);
    this.playTone(280, 0.25, 'sine', 0.12, 0.25);
    this.playTone(220, 0.45, 'sine', 0.12, 0.5);
  }

  playTransition() {
    this.init();
    this.playTone(600, 0.08, 'sine', 0.08, 0);
    this.playTone(800, 0.12, 'sine', 0.1, 0.08);
  }

  // Handle server sound events
  handleSoundEvent(sound) {
    switch (sound) {
      case 'reveal': this.playReveal(); break;
      case 'correct': this.playCorrect(); break;
      case 'wrong': this.playWrong(); break;
      case 'victory': this.playVictory(); break;
      case 'eliminated': this.playEliminated(); break;
      case 'transition': this.playTransition(); break;
      case 'tick': this.playTick(); break;
    }
  }
}

// Global instance
const soundEngine = new SoundEngine();
