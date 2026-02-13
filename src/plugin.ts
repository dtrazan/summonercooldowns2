import streamDeck from "@elgato/streamdeck";

// Import timer fix to override native timers with Web Worker-based implementation
import "./timers";

import { ChampionDial } from "./actions/champion-dial";
import { ChampionDisplay } from "./actions/champion-display";
import { CooldownReduction } from "./actions/cooldown-reduction";
import { SummonerCooldown } from "./actions/summoner-cooldown";
import { TimerTest } from "./actions/timer-test";
import { defaultGlobalSettings, type GlobalSettings } from "./global-settings";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel("trace");

// Initialize global settings with defaults if empty.
streamDeck.settings.getGlobalSettings<GlobalSettings>().then(async (settings) => {
	// Check if settings need migration or initialization
	const needsMigration = settings.top && typeof settings.top === 'string';
	const needsInitialization = !settings.top && !settings.jungle && !settings.mid && !settings.adc && !settings.support;
	
	if (needsMigration || needsInitialization) {
		if (needsMigration) {
			// Migrate old string format to new object format
			const migratedSettings: GlobalSettings = {
				top: { champion: typeof settings.top === 'string' ? settings.top : undefined, ...defaultGlobalSettings.top },
				jungle: { champion: typeof settings.jungle === 'string' ? settings.jungle : undefined, ...defaultGlobalSettings.jungle },
				mid: { champion: typeof settings.mid === 'string' ? settings.mid : undefined, ...defaultGlobalSettings.mid },
				adc: { champion: typeof settings.adc === 'string' ? settings.adc : undefined, ...defaultGlobalSettings.adc },
				support: { champion: typeof settings.support === 'string' ? settings.support : undefined, ...defaultGlobalSettings.support }
			};
			await streamDeck.settings.setGlobalSettings<GlobalSettings>(migratedSettings);
			console.log("[Plugin] Migrated global settings to new format");
		} else {
			await streamDeck.settings.setGlobalSettings<GlobalSettings>(defaultGlobalSettings);
			console.log("[Plugin] Initialized global settings with default values");
		}
	}
});

// Register actions.
streamDeck.actions.registerAction(new ChampionDial());
streamDeck.actions.registerAction(new ChampionDisplay());
streamDeck.actions.registerAction(new CooldownReduction());
streamDeck.actions.registerAction(new SummonerCooldown());
streamDeck.actions.registerAction(new TimerTest());

// Finally, connect to the Stream Deck.
streamDeck.connect();
