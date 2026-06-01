export class SoundEffects {
  private static context: AudioContext | null = null;

  private static getContext() {
    if (!this.context) {
      this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.context.state === 'suspended') {
      this.context.resume();
    }
    return this.context;
  }

  private static playSound(type: 'move' | 'capture' | 'checkmate') {
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      
      switch (type) {
        case 'move':
          // Subtle soft wooden click
          osc.type = 'sine';
          osc.frequency.setValueAtTime(300, now);
          osc.frequency.exponentialRampToValueAtTime(150, now + 0.05);
          gain.gain.setValueAtTime(0.3, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
          osc.start(now);
          osc.stop(now + 0.05);
          break;
        case 'capture':
          // Sharper clack
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(400, now);
          osc.frequency.exponentialRampToValueAtTime(200, now + 0.08);
          gain.gain.setValueAtTime(0.4, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
          osc.start(now);
          osc.stop(now + 0.08);
          break;
        case 'checkmate':
          // Deep resonance / subtle gong
          osc.type = 'sine';
          osc.frequency.setValueAtTime(200, now);
          osc.frequency.exponentialRampToValueAtTime(100, now + 0.5);
          gain.gain.setValueAtTime(0.5, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
          
          // Add a second harmonic
          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.connect(gain2);
          gain2.connect(ctx.destination);
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(400, now);
          osc2.frequency.exponentialRampToValueAtTime(200, now + 0.5);
          gain2.gain.setValueAtTime(0.2, now);
          gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
          osc2.start(now);
          osc2.stop(now + 0.5);

          osc.start(now);
          osc.stop(now + 0.5);
          break;
      }
    } catch (e) {
      console.warn('Audio play failed', e);
    }
  }

  static playMove() {
    this.playSound('move');
  }

  static playCapture() {
    this.playSound('capture');
  }

  static playCheckmate() {
    this.playSound('checkmate');
  }
}
