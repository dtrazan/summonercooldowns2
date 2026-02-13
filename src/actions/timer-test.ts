import { action, KeyDownEvent, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";

/**
 * Test action to verify the timer fix is working correctly.
 * Displays a countdown timer that decrements every second.
 */
@action({ UUID: "com.dt.summonercooldowns.timertest" })
export class TimerTest extends SingletonAction<TimerTestSettings> {
	private intervalMap: Map<string, ReturnType<typeof setInterval>> = new Map();
	private counterMap: Map<string, number> = new Map();
	private readonly INITIAL_TIME = 60; // Start at 60 seconds

	override async onWillAppear(ev: WillAppearEvent<TimerTestSettings>): Promise<void> {
		const { action } = ev;
		const actionId = action.id;
		
		// Initialize countdown (but don't start it)
		this.counterMap.set(actionId, this.INITIAL_TIME);
		
		await action.setTitle(`${this.INITIAL_TIME}s`);
		console.log(`[TimerTest] Initialized countdown for action ${actionId}, press to start`);
	}

	override async onWillDisappear(ev: WillDisappearEvent<TimerTestSettings>): Promise<void> {
		const actionId = ev.action.id;
		
		// Clean up interval
		const intervalId = this.intervalMap.get(actionId);
		if (intervalId !== undefined) {
			clearInterval(intervalId);
			this.intervalMap.delete(actionId);
		}
		
		this.counterMap.delete(actionId);
		console.log(`[TimerTest] Stopped timer for action ${actionId}`);
	}

	override async onKeyDown(ev: KeyDownEvent<TimerTestSettings>): Promise<void> {
		const actionId = ev.action.id;
		
		// Start timer only if not running
		const intervalId = this.intervalMap.get(actionId);
		if (intervalId !== undefined) {
			// Timer is running, ignore the key press
			console.log(`[TimerTest] Timer already running for action ${actionId}, ignoring key press`);
			return;
		}
		
		// Timer is not running, start countdown
		const currentCount = this.counterMap.get(actionId) || 0;
		
		const newIntervalId = setInterval(() => {
			let count = this.counterMap.get(actionId) || 0;
			count = count - 1;
			this.counterMap.set(actionId, count);
			
			if (count <= 0) {
				// Stop timer and reset to initial time when it reaches 0
				const currentIntervalId = this.intervalMap.get(actionId);
				if (currentIntervalId) {
					clearInterval(currentIntervalId);
					this.intervalMap.delete(actionId);
				}
				this.counterMap.set(actionId, this.INITIAL_TIME);
				ev.action.setTitle(`${this.INITIAL_TIME}s`);
				console.log(`[TimerTest] Countdown finished, stopped and reset to ${this.INITIAL_TIME}s at ${new Date().toLocaleTimeString()}`);
			} else {
				ev.action.setTitle(`${count}s`);
				console.log(`[TimerTest] Timer fired at ${new Date().toLocaleTimeString()}, count: ${count}`);
			}
		}, 1000);
		
		this.intervalMap.set(actionId, newIntervalId);
		console.log(`[TimerTest] Started countdown for action ${actionId} from ${currentCount}s`);
	}
}

/**
 * Settings for {@link TimerTest}.
 */
type TimerTestSettings = Record<string, never>;
