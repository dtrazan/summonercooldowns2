import { action, DialDownEvent, DialRotateEvent, SingletonAction, TouchTapEvent, WillAppearEvent, streamDeck } from "@elgato/streamdeck";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GlobalSettings } from "../global-settings.js";
import { timerManager } from "../timer-manager.js";

/**
 * A dial action that allows selecting a champion by rotating the dial.
 * Updates the champion level action's settings.
 */
@action({ UUID: "com.dt.summonercooldowns.championdial" })
export class ChampionDial extends SingletonAction<ChampionDialSettings> {
	private champions: string[] = [];
	private roles = ["TOP⠀⠀⠀⠀", "JG⠀⠀⠀⠀", "MID⠀⠀⠀", "ADC⠀⠀⠀", "SUPP⠀⠀⠀"];

	constructor() {
		super();
		this.loadChampions();
	}

	private loadChampions(): void {
		try {
			const currentDir = dirname(fileURLToPath(import.meta.url));
			const championDataPath = join(currentDir, "..", "champion", "champion.json");

			const data = readFileSync(championDataPath, "utf-8");
			const championData = JSON.parse(data);

			this.champions = Object.keys(championData.data);
		} catch (error) {
			console.error("[ChampionDial] Error loading champions:", error);
			this.champions = ["Error loading champions"];
		}
	}

	override async onWillAppear(ev: WillAppearEvent<ChampionDialSettings>): Promise<void> {
		const championIndex = ev.payload.settings.championIndex ?? 0;
		const locked = ev.payload.settings.locked ?? false;
		const roleIndex = ev.payload.settings.roleIndex ?? 0;
		const championName = this.champions[championIndex] || this.champions[0] || "None";

		// Store current column via type guard
		const currentColumn = ev.action.isDial() ? ev.action.coordinates.column : undefined;
		if (currentColumn !== undefined && currentColumn !== ev.payload.settings.current_column) {
			ev.payload.settings.current_column = currentColumn;
			await ev.action.setSettings(ev.payload.settings);
		}

		// Only unlock spell cells if the dial is not locked
		if (currentColumn !== undefined && !locked) {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();

			if (globalSettings.spellsRow0?.[currentColumn]) {
				globalSettings.spellsRow0[currentColumn].spellLocked = false;
			}
			if (globalSettings.spellsRow1?.[currentColumn]) {
				globalSettings.spellsRow1[currentColumn].spellLocked = false;
			}

			await streamDeck.settings.setGlobalSettings(globalSettings);
		}

		// DialDownEvent/DialRotateEvent/TouchTapEvent already type action as DialAction,
		// but WillAppearEvent types it as DialAction | KeyAction — use isDial() guard
		if (ev.action.isDial()) {
			const valueText = locked ? this.roles[roleIndex] : `${championIndex + 1}/${this.champions.length}`;
			
			await ev.action.setFeedback({
				title: championName,
				icon: `imgs/champion/${championName}.png`,
				value: valueText
			});
		}
	}

	override async onDialDown(ev: DialDownEvent<ChampionDialSettings>): Promise<void> {
		const { settings } = ev.payload;
		const currentlyLocked = settings.locked ?? false;
		const willBeLocked = !currentlyLocked;
		const championIndex = settings.championIndex ?? 0;
		const roleIndex = settings.roleIndex ?? 0;
		const championName = this.champions[championIndex] || this.champions[0] || "None";

		const roleKey = ["top", "jungle", "mid", "adc", "support"][roleIndex] as "top" | "jungle" | "mid" | "adc" | "support";
		const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();

		// Reset any running timers in this column (both in-memory and global settings)
		const currentColumn = ev.payload.coordinates?.column;
		if (currentColumn !== undefined) {
			let timersReset = false;

			if (globalSettings.spellsRow0?.[currentColumn]?.isTimerRunning) {
				const cell = globalSettings.spellsRow0[currentColumn]!;
				cell.isTimerRunning = false;
				cell.remainingTime = cell.cooldown;
				timerManager.clearTimer(`0-${currentColumn}`);
				timersReset = true;
			}

			if (globalSettings.spellsRow1?.[currentColumn]?.isTimerRunning) {
				const cell = globalSettings.spellsRow1[currentColumn]!;
				cell.isTimerRunning = false;
				cell.remainingTime = cell.cooldown;
				timerManager.clearTimer(`1-${currentColumn}`);
				timersReset = true;
			}

			if (timersReset) {
				await streamDeck.settings.setGlobalSettings(globalSettings);
			}
		}

		if (currentlyLocked) {
			// UNLOCKING: Only unlock the spells, keep champion assignment
			const storedColumn = globalSettings[roleKey]?.column;

			if (storedColumn !== undefined) {
				if (globalSettings.spellsRow0?.[storedColumn]) {
					globalSettings.spellsRow0[storedColumn]!.spellLocked = false;
				}
				if (globalSettings.spellsRow1?.[storedColumn]) {
					globalSettings.spellsRow1[storedColumn]!.spellLocked = false;
				}
			}
		} else {
			// LOCKING: Set champion to role and lock spells using current coordinates
			const previousColumn = globalSettings[roleKey]?.column;

			if (previousColumn !== undefined && previousColumn !== currentColumn) {
				if (globalSettings.spellsRow0?.[previousColumn]) {
					globalSettings.spellsRow0[previousColumn]!.spellLocked = false;
					globalSettings.spellsRow0[previousColumn]!.role = undefined;
				}
				if (globalSettings.spellsRow1?.[previousColumn]) {
					globalSettings.spellsRow1[previousColumn]!.spellLocked = false;
					globalSettings.spellsRow1[previousColumn]!.role = undefined;
				}
			}

			// Clear any OTHER roles that might be using the new column (stale data cleanup)
			if (currentColumn !== undefined) {
				for (const otherRoleKey of ["top", "jungle", "mid", "adc", "support"] as const) {
					if (otherRoleKey !== roleKey && globalSettings[otherRoleKey]?.column === currentColumn) {
						globalSettings[otherRoleKey]!.column = undefined;
					}
				}
			}

			if (!globalSettings[roleKey]) {
				globalSettings[roleKey] = {};
			}
			globalSettings[roleKey]!.champion = championName;
			globalSettings[roleKey]!.column = currentColumn;

			// Lock spell cells in this column and set the role
			if (currentColumn !== undefined) {
				if (globalSettings.spellsRow0?.[currentColumn]) {
					globalSettings.spellsRow0[currentColumn]!.spellLocked = true;
					globalSettings.spellsRow0[currentColumn]!.role = roleKey;
				}
				if (globalSettings.spellsRow1?.[currentColumn]) {
					globalSettings.spellsRow1[currentColumn]!.spellLocked = true;
					globalSettings.spellsRow1[currentColumn]!.role = roleKey;
				}
			}
		}

		await streamDeck.settings.setGlobalSettings(globalSettings);

		settings.locked = willBeLocked;
		await ev.action.setSettings(settings);

		// ev.action is already DialAction from DialDownEvent — no cast needed
		const valueText = willBeLocked ? this.roles[roleIndex] : `${championIndex + 1}/${this.champions.length}`;
		
		await ev.action.setFeedback({
			title: championName,
			icon: `imgs/champion/${championName}.png`,
			value: valueText
		});
	}

	override async onDialRotate(ev: DialRotateEvent<ChampionDialSettings>): Promise<void> {
		const { settings } = ev.payload;

		if (settings.locked) {
			return;
		}

		const currentIndex = settings.championIndex ?? 0;
		let newIndex = currentIndex + ev.payload.ticks;
		newIndex = ((newIndex % this.champions.length) + this.champions.length) % this.champions.length;

		settings.championIndex = newIndex;
		const championName = this.champions[newIndex] || "None";

		await ev.action.setSettings(settings);
		// ev.action is already DialAction from DialRotateEvent — no cast needed
		await ev.action.setFeedback({
			title: championName,
			icon: `imgs/champion/${championName}.png`,
			value: `${newIndex + 1}/${this.champions.length}`
		});
	}

	override async onTouchTap(ev: TouchTapEvent<ChampionDialSettings>): Promise<void> {
		const { settings } = ev.payload;

		if (settings.locked) {
			return;
		}

		const currentRoleIndex = settings.roleIndex ?? 0;
		const newRoleIndex = (currentRoleIndex + 1) % this.roles.length;
		const championIndex = settings.championIndex ?? 0;
		const championName = this.champions[championIndex] || this.champions[0] || "None";

		settings.roleIndex = newRoleIndex;
		await ev.action.setSettings(settings);

		// ev.action is already DialAction from TouchTapEvent — no cast needed
		await ev.action.setFeedback({
			title: championName,
			icon: `imgs/champion/${championName}.png`,
			value: this.roles[newRoleIndex]
		});
	}
}

type ChampionDialSettings = {
	championIndex?: number;
	locked?: boolean;
	roleIndex?: number;
	current_column?: number;
};
