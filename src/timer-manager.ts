/**
 * Centralized timer management for summoner spell cooldowns.
 *
 * Uses startTime + duration to compute remaining time from timestamps
 * instead of decrementing a counter. This avoids floating-point drift
 * and stays accurate even if interval ticks are slightly off.
 *
 * The setInterval is only used to trigger display updates — the actual
 * remaining time is always derived from Date.now().
 */

interface ActiveTimer {
	startTime: number;
	duration: number;
	cooldown: number;
	intervalId: ReturnType<typeof setInterval>;
	onTick: (remaining: number) => void;
	onComplete: (cooldown: number) => void;
}

export class TimerManager {
	private timers: Map<string, ActiveTimer> = new Map();

	/**
	 * Start a countdown timer for the given key.
	 * If a timer already exists for this key, it is cleared first.
	 */
	startTimer(
		key: string,
		duration: number,
		cooldown: number,
		onTick: (remaining: number) => void,
		onComplete: (cooldown: number) => void
	): void {
		this.clearTimer(key);

		const timer: ActiveTimer = {
			startTime: Date.now(),
			duration,
			cooldown,
			intervalId: null as unknown as ReturnType<typeof setInterval>,
			onTick,
			onComplete,
		};

		timer.intervalId = setInterval(() => {
			const remaining = this.computeRemaining(timer);

			if (remaining <= 0) {
				this.clearTimer(key);
				onComplete(cooldown);
			} else {
				onTick(remaining);
			}
		}, 1000);

		this.timers.set(key, timer);
	}

	/**
	 * Compute remaining seconds from timestamps.
	 */
	private computeRemaining(timer: ActiveTimer): number {
		const elapsed = (Date.now() - timer.startTime) / 1000;
		return Math.ceil(timer.duration - elapsed);
	}

	/**
	 * Clear and remove a timer by key. No-op if no timer exists.
	 */
	clearTimer(key: string): void {
		const timer = this.timers.get(key);
		if (timer) {
			clearInterval(timer.intervalId);
			this.timers.delete(key);
		}
	}

	/**
	 * Check if a timer is currently running for the given key.
	 */
	isRunning(key: string): boolean {
		return this.timers.has(key);
	}

	/**
	 * Get the remaining time for a running timer, computed from timestamps.
	 * Returns undefined if not running.
	 */
	getRemaining(key: string): number | undefined {
		const timer = this.timers.get(key);
		if (!timer) return undefined;
		return Math.max(0, this.computeRemaining(timer));
	}

	/**
	 * Clear all timers. Used for cleanup.
	 */
	clearAll(): void {
		for (const key of this.timers.keys()) {
			this.clearTimer(key);
		}
	}
}

/** Shared singleton instance */
export const timerManager = new TimerManager();
