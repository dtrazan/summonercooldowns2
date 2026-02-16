import { action, KeyDownEvent, SingletonAction, WillAppearEvent, streamDeck } from "@elgato/streamdeck";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GlobalSettings } from "../global-settings.js";
import { timerManager } from "../timer-manager.js";

/**
 * Action for managing cooldown reduction items.
 * Stores the current column and row position.
 */
@action({ UUID: "com.dt.summonercooldowns.cooldownreduction" })
export class CooldownReduction extends SingletonAction<CooldownReductionSettings> {
	private cdrItems: Array<{ id: string; summoner_haste: number; img: string }> = [];
	private cdrItemsRow0: Array<{ id: string; summoner_haste: number; img: string }> = [];
	private cdrItemsRow1: Array<{ id: string; summoner_haste: number; img: string }> = [];

	constructor() {
		super();
		this.loadCDRItems();
	}

	private loadCDRItems(): void {
		try {
			const currentDir = dirname(fileURLToPath(import.meta.url));
			const cdrDataPath = join(currentDir, "..", "summoner", "summoner_cdr.json");

			const data = readFileSync(cdrDataPath, "utf-8");
			this.cdrItems = JSON.parse(data);

			// Row 0: Only boots and cosmic_insight_rune
			this.cdrItemsRow0 = this.cdrItems.filter(item => 
				item.id === "boots" || item.id === "cosmic_insight_rune"
			);

		// Row 1: Only boots, boots_cd1, and boots_cd2
		this.cdrItemsRow1 = this.cdrItems.filter(item =>
			item.id === "boots" || item.id === "boots_cd1" || item.id === "boots_cd2"
		);
		} catch (error) {
			console.error("[CooldownReduction] Error loading CDR items:", error);
		}
	}

	private async updateCooldowns(currentColumn: number): Promise<void> {
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
			console.log(`[CooldownReduction] Updated CDR  for Row 0, Column ${currentColumn}: ${cooldown_reduction.toFixed(2)}%`);
		} else {
			console.log(`[CooldownReduction] Timer running for Row 0, Column ${currentColumn} - skipping CDR update`);
		}

		// Update cooldown_reduction for Row 1 if no timer is running
		if (!isTimerRunningRow1) {
			globalSettings.spellsRow1[currentColumn]!.cooldown_reduction = cooldown_reduction;
			console.log(`[CooldownReduction] Updated CDR for Row 1, Column ${currentColumn}: ${cooldown_reduction.toFixed(2)}%`);
		} else {
			console.log(`[CooldownReduction] Timer running for Row 1, Column ${currentColumn} - skipping CDR update`);
		}

		await streamDeck.settings.setGlobalSettings(globalSettings);

		console.log(`[CooldownReduction] Updated summoner haste for column ${currentColumn}: ${totalHaste}% (Row0: ${hasteRow0}%, Row1: ${hasteRow1}%)`);
	}
	
	override async onWillAppear(ev: WillAppearEvent<CooldownReductionSettings>): Promise<void> {
		// Get coordinates via type guard
		const currentCol = ev.action.isKey() ? ev.action.coordinates?.column : undefined;
		const currentRow = ev.action.isKey() ? ev.action.coordinates?.row : undefined;

		// Store current column if it's different
		if (currentCol !== undefined && currentCol !== ev.payload.settings.current_column) {
			ev.payload.settings.current_column = currentCol;
			await ev.action.setSettings(ev.payload.settings);
		}

		// Store current row if it's different
		if (currentRow !== undefined && currentRow !== ev.payload.settings.current_row) {
			ev.payload.settings.current_row = currentRow;
			await ev.action.setSettings(ev.payload.settings);
		}

		// Get the appropriate item array based on the row
		const itemArray = currentRow === 0 ? this.cdrItemsRow0 : this.cdrItemsRow1;

		// Initialize with current CDR item if exists, otherwise start at index 0
		const currentIndex = ev.payload.settings.current_index ?? 0;
		const currentItem = itemArray[currentIndex];
		
		if (currentItem) {
			await ev.action.setTitle("");
			await ev.action.setImage(`imgs/items/${currentItem.img}`);
		}
	}

	override async onKeyDown(ev: KeyDownEvent<CooldownReductionSettings>): Promise<void> {
		const currentCol = ev.payload.settings.current_column;
		const currentRow = ev.payload.settings.current_row;

		if (currentCol === undefined || currentRow === undefined) {
			console.error("[CooldownReduction] Cannot cycle - position not set");
			return;
		}

		// Get the appropriate item array based on the row
		const itemArray = currentRow === 0 ? this.cdrItemsRow0 : this.cdrItemsRow1;

		const currentIndex = ev.payload.settings.current_index ?? 0;
		const nextIndex = (currentIndex + 1) % itemArray.length;
		const currentItem = itemArray[nextIndex];

		if (currentItem) {
			// Update settings with all current values
			ev.payload.settings.current_index = nextIndex;
			ev.payload.settings.current_id = currentItem.id;
			ev.payload.settings.current_summoner_haste = currentItem.summoner_haste;
			ev.payload.settings.current_img = currentItem.img;
			
			await ev.action.setSettings(ev.payload.settings);
			await ev.action.setTitle("");
			await ev.action.setImage(`imgs/items/${currentItem.img}`);

			// Store in global settings
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			
			// Ensure arrays exist
			if (!globalSettings.cdrItemsRow0) {
				globalSettings.cdrItemsRow0 = [undefined, undefined, undefined, undefined];
			}
			if (!globalSettings.cdrItemsRow1) {
				globalSettings.cdrItemsRow1 = [undefined, undefined, undefined, undefined];
			}

			// Store CDR item in the appropriate row array at the current column
			const cdrArray = currentRow === 0 ? globalSettings.cdrItemsRow0 : globalSettings.cdrItemsRow1;
			cdrArray[currentCol] = {
				id: currentItem.id,
				summoner_haste: currentItem.summoner_haste,
				img: currentItem.img
			};

			await streamDeck.settings.setGlobalSettings(globalSettings);

			// Update cooldowns immediately after changing CDR item
			await this.updateCooldowns(currentCol);
		}
	}
}

type CooldownReductionSettings = {
	current_column?: number;
	current_row?: number;
	current_index?: number;
	current_id?: string;
	current_summoner_haste?: number;
	current_img?: string;
};
