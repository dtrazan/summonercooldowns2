import { action, DialDownEvent, DialRotateEvent, SingletonAction, TouchTapEvent, WillAppearEvent, WillDisappearEvent, streamDeck } from "@elgato/streamdeck";
import type { DialAction } from "@elgato/streamdeck";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GlobalSettings } from "../global-settings.js";
import { timerManager } from "../timer-manager.js";

/**
 * A dial action that displays the champion assigned to a specific role/column.
 * This is a display-only version that shows the locked champion and role.
 */
@action({ UUID: "com.dt.summonercooldowns.championdisplay" })
export class ChampionDisplay extends SingletonAction<ChampionDisplaySettings> {
	private champions: string[] = [];
	private roles = ["Top         I", "Jungle       II", "Mid       III", "ADC        IV", "Support     V"];
	private instances: Map<string, DialAction<ChampionDisplaySettings>> = new Map();

	constructor() {
		super();
		this.loadChampions();

		// Listen for global settings changes to update display
		streamDeck.settings.onDidReceiveGlobalSettings(async (ev) => {
			const globalSettings = ev.settings as GlobalSettings;

			for (const [id, actionRef] of this.instances.entries()) {
				try {
					const settings = await actionRef.getSettings<ChampionDisplaySettings>();
					const currentColumn = settings.current_column;

					if (currentColumn !== undefined) {
						await this.updateDisplay(actionRef, currentColumn, globalSettings);
					}
				} catch (error) {
					console.error("[ChampionDisplay] Error updating instance in global settings listener:", error);
				}
			}
		});
	}

	private loadChampions(): void {
		try {
			const currentDir = dirname(fileURLToPath(import.meta.url));
			const championDataPath = join(currentDir, "..", "champion", "champion.json");

			const data = readFileSync(championDataPath, "utf-8");
			const championData = JSON.parse(data);

			this.champions = Object.keys(championData.data);
			console.log(`[ChampionDisplay] Loaded ${this.champions.length} champions`);
		} catch (error) {
			console.error("[ChampionDisplay] Error loading champions:", error);
			this.champions = ["Error loading champions"];
		}
	}

	private async updateDisplay(actionRef: DialAction<ChampionDisplaySettings>, currentColumn: number, globalSettings: GlobalSettings): Promise<void> {
		let championName = "";
		let roleIndex = -1;

		for (const [index, role] of (["top", "jungle", "mid", "adc", "support"] as const).entries()) {
			if (globalSettings[role]?.column === currentColumn) {
				championName = globalSettings[role]?.champion ?? "";
				roleIndex = index;
				break;
			}
		}

		if (!championName) {
			championName = "None";
		}

		const displayValue = roleIndex >= 0 ? this.roles[roleIndex] : "Not Assigned";

		const feedback: Record<string, string> = {
			title: championName,
			value: displayValue
		};
		if (championName !== "None") {
			feedback.icon = `imgs/champion/${championName}.png`;
		}
		await actionRef.setFeedback(feedback);
	}

	override async onWillAppear(ev: WillAppearEvent<ChampionDisplaySettings>): Promise<void> {
		// Track this instance with isDial() guard
		if (ev.action.isDial()) {
			this.instances.set(ev.action.id, ev.action);
		}

		// Store current column
		const currentColumn = ev.action.isDial() ? ev.action.coordinates.column : undefined;
		if (currentColumn !== undefined && currentColumn !== ev.payload.settings.current_column) {
			ev.payload.settings.current_column = currentColumn;
			await ev.action.setSettings(ev.payload.settings);
		}

		// Get global settings and update display
		if (currentColumn !== undefined && ev.action.isDial()) {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			await this.updateDisplay(ev.action, currentColumn, globalSettings);
		}
	}

	override async onWillDisappear(ev: WillDisappearEvent<ChampionDisplaySettings>): Promise<void> {
		this.instances.delete(ev.action.id);
	}

	override async onDialDown(ev: DialDownEvent<ChampionDisplaySettings>): Promise<void> {
		const currentColumn = ev.payload.settings.current_column;

		if (currentColumn === undefined) {
			console.error("[ChampionDisplay] Cannot update haste - column not set");
			return;
		}

		// Get global settings
		const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();

		// Sum ability haste from both rows for this column
		const hasteRow0 = globalSettings.cdrItemsRow0?.[currentColumn]?.summoner_haste ?? 0;
		const hasteRow1 = globalSettings.cdrItemsRow1?.[currentColumn]?.summoner_haste ?? 0;
		const totalHaste = hasteRow0 + hasteRow1;

		// Ensure spell arrays exist
		if (!globalSettings.spellsRow0) {
			globalSettings.spellsRow0 = [undefined, undefined, undefined, undefined];
		}
		if (!globalSettings.spellsRow1) {
			globalSettings.spellsRow1 = [undefined, undefined, undefined, undefined];
		}

		// Initialize or update summoner_haste for spell cells in this column
		if (!globalSettings.spellsRow0[currentColumn]) {
			globalSettings.spellsRow0[currentColumn] = {};
		}
		globalSettings.spellsRow0[currentColumn]!.summoner_haste = totalHaste;

		if (!globalSettings.spellsRow1[currentColumn]) {
			globalSettings.spellsRow1[currentColumn] = {};
		}
		globalSettings.spellsRow1[currentColumn]!.summoner_haste = totalHaste;

		// Check if timers are running for each row separately
		const timerKeyRow0 = `0-${currentColumn}`;
		const timerKeyRow1 = `1-${currentColumn}`;
		const isTimerRunningRow0 = timerManager.isRunning(timerKeyRow0);
		const isTimerRunningRow1 = timerManager.isRunning(timerKeyRow1);

		// Calculate cooldown reduction: CDR = 100 - (10000/(100+AH))
		const cooldown_reduction = totalHaste > 0 ? 100 - (10000 / (100 + totalHaste)) : 0;

		// Update cooldown_reduction for Row 0 if no timer is running
		if (!isTimerRunningRow0) {
			globalSettings.spellsRow0[currentColumn]!.cooldown_reduction = cooldown_reduction;
			console.log(`[ChampionDisplay] Updated CDR  for Row 0, Column ${currentColumn}: ${cooldown_reduction.toFixed(2)}%`);
		} else {
			console.log(`[ChampionDisplay] Timer running for Row 0, Column ${currentColumn} - skipping CDR update`);
		}

		// Update cooldown_reduction for Row 1 if no timer is running
		if (!isTimerRunningRow1) {
			globalSettings.spellsRow1[currentColumn]!.cooldown_reduction = cooldown_reduction;
			console.log(`[ChampionDisplay] Updated CDR for Row 1, Column ${currentColumn}: ${cooldown_reduction.toFixed(2)}%`);
		} else {
			console.log(`[ChampionDisplay] Timer running for Row 1, Column ${currentColumn} - skipping CDR update`);
		}

		await streamDeck.settings.setGlobalSettings(globalSettings);

		console.log(`[ChampionDisplay] Updated summoner haste for column ${currentColumn}: ${totalHaste}% (Row0: ${hasteRow0}%, Row1: ${hasteRow1}%)`);
	}

	override async onDialRotate(ev: DialRotateEvent<ChampionDisplaySettings>): Promise<void> {
		// Display only — no action
	}

	override async onTouchTap(ev: TouchTapEvent<ChampionDisplaySettings>): Promise<void> {
		// Display only — no action
	}
}

type ChampionDisplaySettings = {
	current_column?: number;
};
