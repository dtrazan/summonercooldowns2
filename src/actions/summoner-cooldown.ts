import { action, KeyDownEvent, SingletonAction, WillAppearEvent, WillDisappearEvent, streamDeck } from "@elgato/streamdeck";
import type { KeyAction } from "@elgato/streamdeck";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GlobalSettings } from "../global-settings.js";
import { timerManager } from "../timer-manager.js";

/**
 * A keypad action for tracking summoner spell cooldowns.
 */
@action({ UUID: "com.dt.summonercooldowns.summonercooldown" })
export class SummonerCooldown extends SingletonAction<SummonerCooldownSettings> {
	private instances: Map<string, KeyAction<SummonerCooldownSettings>> = new Map();
	private summonerSpells = [
		"SummonerBarrier",
		"SummonerClarity",
		"SummonerCleanse",
		"SummonerExhaust",
		"SummonerFlash",
		"SummonerGhost",
		"SummonerHeal",
		"SummonerIgnite",
		"SummonerSmite",
		"SummonerTeleport",
		"SummonerUnleashedTeleport"
	];
	private summonerData: Record<string, { name: string; cooldown: number; img: string }> = {};

	// Mutex lock to prevent concurrent modifications to the same cell
	private pendingOperations: Map<string, Promise<void>> = new Map();

	constructor() {
		super();
		this.loadSummonerSpells();

		// Listen for global settings changes to update titles when champion is locked
		streamDeck.settings.onDidReceiveGlobalSettings(async (ev) => {
			const globalSettings = ev.settings as GlobalSettings;

			for (const [id, actionRef] of this.instances.entries()) {
				try {
					const settings = await actionRef.getSettings<SummonerCooldownSettings>();
					const currentCol = settings.current_col;
					const currentRow = settings.current_row;

					if (currentCol === undefined || currentRow === undefined) continue;

					const timerKey = `${currentRow}-${currentCol}`;

					// If the timer manager is running, it handles title updates — skip
					if (timerManager.isRunning(timerKey)) continue;

					const spellsArray = currentRow === 0 ? globalSettings.spellsRow0 : globalSettings.spellsRow1;
					const spellCell = spellsArray?.[currentCol];
					const displayTime = this.getReducedCooldown(spellCell?.cooldown ?? 0, spellCell?.cooldown_reduction);

					await actionRef.setTitle(displayTime.toString());
				} catch (error) {
					console.error("[SummonerCooldown] Error updating instance in global settings listener:", error);
				}
			}
		});
	}

	private loadSummonerSpells(): void {
		try {
			const currentDir = dirname(fileURLToPath(import.meta.url));
			const summonerDataPath = join(currentDir, "..", "summoner", "summoner.json");

			const data = readFileSync(summonerDataPath, "utf-8");
			this.summonerData = JSON.parse(data);
			console.log(`[SummonerCooldown] Loaded ${Object.keys(this.summonerData).length} summoner spells`);
		} catch (error) {
			console.error("[SummonerCooldown] Error loading summoner spells:", error);
		}
	}

	/**
	 * Derive the "on cooldown" image path from the normal image filename.
	 * e.g. "SummonerFlash.png" → "SummonerFlashDown.png"
	 */
	private getDownImage(img: string): string {
		return img.replace(".png", "Down.png");
	}

	/**
	 * Apply cooldown reduction to a base cooldown, returning the reduced value (floored).
	 */
	private getReducedCooldown(baseCooldown: number, cooldownReduction?: number): number {
		if (!cooldownReduction) return baseCooldown;
		return Math.floor(baseCooldown * (1 - cooldownReduction / 100));
	}

	/**
	 * Acquire a lock for a specific cell to prevent race conditions.
	 * Returns a promise that resolves when the lock is acquired.
	 */
	private async acquireLock(cellKey: string): Promise<void> {
		// Wait for any pending operation on this cell to complete
		while (this.pendingOperations.has(cellKey)) {
			await this.pendingOperations.get(cellKey);
		}
	}

	/**
	 * Execute an operation with a lock on a specific cell.
	 * Prevents concurrent modifications to the same timer state.
	 */
	private async withLock<T>(cellKey: string, operation: () => Promise<T>): Promise<T> {
		// Wait for lock
		await this.acquireLock(cellKey);

		// Create promise for this operation
		let resolver: () => void;
		const lockPromise = new Promise<void>((resolve) => {
			resolver = resolve;
		});
		this.pendingOperations.set(cellKey, lockPromise);

		try {
			// Execute operation
			return await operation();
		} finally {
			// Release lock
			this.pendingOperations.delete(cellKey);
			resolver!();
		}
	}

	/**
	 * Find the action instance for a given row-col position.
	 */
	private findActionForPosition(row: number, col: number): KeyAction<SummonerCooldownSettings> | undefined {
		for (const actionRef of this.instances.values()) {
			// We stored coordinates in action settings, but the action itself has .coordinates
			if (actionRef.coordinates?.column === col && actionRef.coordinates?.row === row) {
				return actionRef;
			}
		}
		return undefined;
	}

	/**
	 * Start (or restart) a timer for the given cell position.
	 */
	private startTimerForCell(
		timerKey: string,
		row: number,
		col: number,
		duration: number,
		cooldown: number,
		spellKey: string | undefined
	): void {
		timerManager.startTimer(
			timerKey,
			duration,
			cooldown,
			// onTick — update title from in-memory state (no global settings writes)
			(remaining) => {
				try {
					const actionRef = this.findActionForPosition(row, col);
					if (actionRef) {
						actionRef.setTitle(remaining.toString()).catch((err) => {
							streamDeck.logger.warn(`Failed to update timer title for ${timerKey}: ${err}`);
						});
					}
				} catch (error) {
					streamDeck.logger.error(`Timer tick error for ${timerKey}: ${error}`);
				}
			},
			// onComplete — persist reset state and update title with reduced cooldown
			async (baseCooldown) => {
				try {
					const latestSpellData = spellKey ? this.summonerData[spellKey] : undefined;
					const resetBaseCooldown = latestSpellData?.cooldown ?? baseCooldown;

					const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
					const spellsArray = row === 0 ? globalSettings.spellsRow0 : globalSettings.spellsRow1;
					const cell = spellsArray?.[col];
					const reducedCooldown = this.getReducedCooldown(resetBaseCooldown, cell?.cooldown_reduction);

					if (cell) {
						cell.isTimerRunning = false;
						cell.remainingTime = reducedCooldown;
						cell.cooldown = resetBaseCooldown;
					}
					await streamDeck.settings.setGlobalSettings(globalSettings);

					const actionRef = this.findActionForPosition(row, col);
					if (actionRef) {
						await actionRef.setTitle(reducedCooldown.toString());
						if (latestSpellData?.img) {
							await actionRef.setImage(`imgs/summoner/${latestSpellData.img}`);
						}
					}
					streamDeck.logger.info(`Timer finished for ${timerKey}, reset to ${reducedCooldown}s (base: ${resetBaseCooldown}s)`);
				} catch (error) {
					streamDeck.logger.error(`Timer completion error for ${timerKey}: ${error}`);
				}
			}
		);
	}

	override async onWillAppear(ev: WillAppearEvent<SummonerCooldownSettings>): Promise<void> {
		// Track this instance — use isKey() type guard to get KeyAction
		if (ev.action.isKey()) {
			this.instances.set(ev.action.id, ev.action);
		}

		const spellIndex = ev.payload.settings.spellIndex ?? 4;
		const spellKey = this.summonerSpells[spellIndex];
		const spell = this.summonerData[spellKey];

		// Store current summoner spell
		if (spellKey !== ev.payload.settings.current_summoner_spell) {
			ev.payload.settings.current_summoner_spell = spellKey;
			await ev.action.setSettings(ev.payload.settings);
		}

		// Get coordinates from the action (KeyAction and DialAction both have .coordinates)
		const currentCol = ev.action.isKey() ? ev.action.coordinates?.column : undefined;
		const currentRow = ev.action.isKey() ? ev.action.coordinates?.row : undefined;

		if (currentCol !== undefined && currentCol !== ev.payload.settings.current_col) {
			ev.payload.settings.current_col = currentCol;
			await ev.action.setSettings(ev.payload.settings);
		}
		if (currentRow !== undefined && currentRow !== ev.payload.settings.current_row) {
			ev.payload.settings.current_row = currentRow;
			await ev.action.setSettings(ev.payload.settings);
		}

		// Update global spells array
		if (currentCol !== undefined && currentRow !== undefined) {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();

			let role = "unknown";
			for (const roleKey of ["top", "jungle", "mid", "adc", "support"] as const) {
				if (globalSettings[roleKey]?.column === currentCol) {
					role = roleKey;
					break;
				}
			}

			if (!globalSettings.spellsRow0) {
				globalSettings.spellsRow0 = [undefined, undefined, undefined, undefined];
			}
			if (!globalSettings.spellsRow1) {
				globalSettings.spellsRow1 = [undefined, undefined, undefined, undefined];
			}

			const spellsArray = currentRow === 0 ? globalSettings.spellsRow0 : globalSettings.spellsRow1;
			const cooldown = spell?.cooldown ?? 0;
			const existingCell = spellsArray[currentCol];
			const spellChanged = existingCell?.spell !== spellKey;

			// If spell changed, clear any running timer
			if (spellChanged) {
				const timerKey = `${currentRow}-${currentCol}`;
				timerManager.clearTimer(timerKey);
			}

			spellsArray[currentCol] = {
				spell: spellKey,
				role: role,
				cooldown: cooldown,
				spellLocked: existingCell?.spellLocked ?? false,
				remainingTime: spellChanged ? undefined : existingCell?.remainingTime,
				isTimerRunning: spellChanged ? false : (existingCell?.isTimerRunning ?? false),
				cooldown_reduction: existingCell?.cooldown_reduction
			};

			await streamDeck.settings.setGlobalSettings(globalSettings);

			if (spell) {
				const timerKey = `${currentRow}-${currentCol}`;
				const inMemoryRemaining = timerManager.getRemaining(timerKey);
				const updatedCell = spellsArray[currentCol];
				const reducedCooldown = this.getReducedCooldown(cooldown, updatedCell?.cooldown_reduction);

				// Display: in-memory remaining > persisted remaining > reduced cooldown
				const displayTime = inMemoryRemaining
					?? ((!spellChanged && existingCell?.isTimerRunning && existingCell?.remainingTime !== undefined)
						? existingCell.remainingTime
						: reducedCooldown);

				await ev.action.setTitle(displayTime.toString());
				const isTimerActive = timerManager.isRunning(timerKey) || (!spellChanged && existingCell?.isTimerRunning);
				await ev.action.setImage(`imgs/summoner/${isTimerActive ? this.getDownImage(spell.img) : spell.img}`);

				// Restart timer if it was running when page was switched (and not already running in memory)
				if (updatedCell?.isTimerRunning && !spellChanged && !timerManager.isRunning(timerKey)) {
					const resumeTime = updatedCell.remainingTime ?? reducedCooldown;
					if (resumeTime > 0) {
						console.log(`[SummonerCooldown] Restarting timer for ${timerKey} at ${resumeTime}s`);
						this.startTimerForCell(timerKey, currentRow, currentCol, resumeTime, cooldown, spellKey);
					}
				}
			}
		} else if (spell) {
			await ev.action.setTitle(spell.cooldown.toString());
			await ev.action.setImage(`imgs/summoner/${spell.img}`);
		}
	}

	override async onWillDisappear(ev: WillDisappearEvent<SummonerCooldownSettings>): Promise<void> {
		this.instances.delete(ev.action.id);
		// Don't clear the timer — let it keep running in the background.
		// The onTick callback will silently no-op since findActionForPosition
		// won't find this instance anymore. When the action reappears,
		// onWillAppear will pick up the in-memory timer's remaining time.
	}

	override async onKeyDown(ev: KeyDownEvent<SummonerCooldownSettings>): Promise<void> {
		const currentCol = ev.payload.settings.current_col;
		const currentRow = ev.payload.settings.current_row;

		// Check if this spell cell is locked
		if (currentCol !== undefined && currentRow !== undefined) {
			const timerKey = `${currentRow}-${currentCol}`;

			// Use lock to prevent race conditions when starting/stopping timers
			await this.withLock(timerKey, async () => {
				// Re-read global settings inside lock to ensure fresh data
				const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
				const spellsArray = currentRow === 0 ? globalSettings.spellsRow0 : globalSettings.spellsRow1;
				const spellCell = spellsArray?.[currentCol];

				if (spellCell?.spellLocked) {
					try {
						// Update cooldown from latest spell data
						const currentSpellData = this.summonerData[spellCell.spell ?? ""];
						if (currentSpellData) {
							spellCell.cooldown = currentSpellData.cooldown;
						}

						const reducedCooldown = this.getReducedCooldown(spellCell.cooldown ?? 0, spellCell.cooldown_reduction);

						if (timerManager.isRunning(timerKey)) {
							// Timer is running — reset it
							timerManager.clearTimer(timerKey);
							spellCell.isTimerRunning = false;
							spellCell.remainingTime = reducedCooldown;

							// Persist state changes BEFORE UI updates
							await streamDeck.settings.setGlobalSettings(globalSettings);

							// Update UI
							await ev.action.setTitle(reducedCooldown.toString());
							const resetImg = this.summonerData[spellCell.spell ?? ""]?.img;
							if (resetImg) {
								await ev.action.setImage(`imgs/summoner/${resetImg}`);
							}

							streamDeck.logger.info(`Reset timer for ${timerKey} to ${reducedCooldown}s`);
						} else {
							// Timer is not running — start it with reduced cooldown
							// Always use the current reduced cooldown to ensure cooldown_reduction changes are applied
							const startTime = reducedCooldown;

							if (startTime <= 0) {
								spellCell.remainingTime = reducedCooldown;
								spellCell.isTimerRunning = false;
								await streamDeck.settings.setGlobalSettings(globalSettings);
								await ev.action.setTitle(reducedCooldown.toString());
								return;
							}

							// Always reset remainingTime to current reduced cooldown when starting fresh
							// This ensures any changes to cooldown_reduction are properly reflected
							spellCell.remainingTime = reducedCooldown;

							// Mark as running and persist BEFORE starting timer
							spellCell.isTimerRunning = true;
							await streamDeck.settings.setGlobalSettings(globalSettings);

							// Update UI to show timer started
							const startImg = this.summonerData[spellCell.spell ?? ""]?.img;
							if (startImg) {
								await ev.action.setImage(`imgs/summoner/${this.getDownImage(startImg)}`);
							}

							// Now safe to start the timer - state is persisted
							// Use the current reduced cooldown for fresh timer starts
							this.startTimerForCell(
								timerKey, currentRow, currentCol,
								reducedCooldown, spellCell.cooldown ?? 0, spellCell.spell
							);
							streamDeck.logger.info(`Started timer for ${timerKey} from ${reducedCooldown}s (reduced from ${spellCell.cooldown}s with ${spellCell.cooldown_reduction?.toFixed(2)}% CDR)`);
						}
					} catch (error) {
						streamDeck.logger.error(`Error handling timer for ${timerKey}: ${error}`);
						// Attempt to restore consistent state on error
						const freshSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
						const freshSpellsArray = currentRow === 0 ? freshSettings.spellsRow0 : freshSettings.spellsRow1;
						const freshCell = freshSpellsArray?.[currentCol];
						if (freshCell) {
							freshCell.isTimerRunning = false;
							timerManager.clearTimer(timerKey);
							await streamDeck.settings.setGlobalSettings(freshSettings);
						}
					}
					return;
				}
			});

			// If we handled a locked spell, exit early
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			const spellsArray = currentRow === 0 ? globalSettings.spellsRow0 : globalSettings.spellsRow1;
			if (spellsArray?.[currentCol]?.spellLocked) {
				return;
			}
		}

		// Not locked — cycle through summoner spells (no lock needed)
		const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();

		// Not locked — cycle through summoner spells
		const currentSpellIndex = ev.payload.settings.spellIndex ?? 5;
		const nextSpellIndex = (currentSpellIndex + 1) % this.summonerSpells.length;

		const spellKey = this.summonerSpells[nextSpellIndex];
		const spell = this.summonerData[spellKey];

		ev.payload.settings.spellIndex = nextSpellIndex;
		ev.payload.settings.current_summoner_spell = spellKey;
		await ev.action.setSettings(ev.payload.settings);

		// Update global spells array
		if (currentCol !== undefined && currentRow !== undefined) {
			let role = "unknown";
			for (const roleKey of ["top", "jungle", "mid", "adc", "support"] as const) {
				if (globalSettings[roleKey]?.column === currentCol) {
					role = roleKey;
					break;
				}
			}

			if (!globalSettings.spellsRow0) {
				globalSettings.spellsRow0 = [undefined, undefined, undefined, undefined];
			}
			if (!globalSettings.spellsRow1) {
				globalSettings.spellsRow1 = [undefined, undefined, undefined, undefined];
			}

			const spellsArray = currentRow === 0 ? globalSettings.spellsRow0 : globalSettings.spellsRow1;
			const cooldown = spell?.cooldown ?? 0;
			const existingCell = spellsArray[currentCol];

			// Clear any running timer when changing spell
			const timerKey = `${currentRow}-${currentCol}`;
			timerManager.clearTimer(timerKey);

			spellsArray[currentCol] = {
				spell: spellKey,
				role: role,
				cooldown: cooldown,
				spellLocked: existingCell?.spellLocked ?? false,
				remainingTime: undefined,
				isTimerRunning: false,
				cooldown_reduction: existingCell?.cooldown_reduction
			};

			await streamDeck.settings.setGlobalSettings(globalSettings);
		}

		if (spell) {
			await ev.action.setTitle(spell.cooldown.toString());
			await ev.action.setImage(`imgs/summoner/${spell.img}`);
		}
	}
}

type SummonerCooldownSettings = {
	spellIndex?: number;
	current_col?: number;
	current_row?: number;
	current_summoner_spell?: string;
};
