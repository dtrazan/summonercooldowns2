import { action, KeyDownEvent, SingletonAction, WillAppearEvent, streamDeck } from "@elgato/streamdeck";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GlobalSettings } from "../global-settings.js";

/**
 * Action for managing cooldown reduction items.
 * Stores the current column and row position.
 */
@action({ UUID: "com.dt.summonercooldowns.cooldownreduction" })
export class CooldownReduction extends SingletonAction<CooldownReductionSettings> {
	private cdrItems: Array<{ id: string; summoner_haste: number; img: string }> = [];

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
		} catch (error) {
			console.error("[CooldownReduction] Error loading CDR items:", error);
		}
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

		// Initialize with current CDR item if exists, otherwise start at index 0
		const currentIndex = ev.payload.settings.current_index ?? 0;
		const currentItem = this.cdrItems[currentIndex];
		
		if (currentItem) {
			await ev.action.setTitle(`${currentItem.summoner_haste}%`);
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

		const currentIndex = ev.payload.settings.current_index ?? 0;
		const nextIndex = (currentIndex + 1) % this.cdrItems.length;
		const currentItem = this.cdrItems[nextIndex];

		if (currentItem) {
			// Update settings with all current values
			ev.payload.settings.current_index = nextIndex;
			ev.payload.settings.current_id = currentItem.id;
			ev.payload.settings.current_summoner_haste = currentItem.summoner_haste;
			ev.payload.settings.current_img = currentItem.img;
			
			await ev.action.setSettings(ev.payload.settings);
			await ev.action.setTitle(`${currentItem.summoner_haste}%`);
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
