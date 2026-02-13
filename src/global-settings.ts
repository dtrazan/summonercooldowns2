/**
 * Settings for a specific role
 */
export type RoleSettings = {
	champion?: string;
	ss1?: string;
	ss2?: string;
	cd1?: number;
	cd2?: number;
	column?: number;
};

/**
 * Data stored in each cell of the spells 2D array
 */
export type SpellCellData = {
	spell?: string;
	role?: string;
	cooldown?: number;
	spellLocked?: boolean;
	remainingTime?: number;
	isTimerRunning?: boolean;
	summoner_haste?: number; // Total summoner haste percentage for this column
	cooldown_reduction?: number; // Calculated from summoner haste: (1-(1/(1+(haste/100)))) × 100
};

/**
 * Data for CDR items (boots, runes, etc.)
 */
export type CDRItemData = {
	id?: string;
	summoner_haste?: number;
	img?: string;
};

/**
 * Global settings shared across all actions.
 * Stores the selected champion and summoner spells for each role.
 */
export type GlobalSettings = {
	top?: RoleSettings;
	jungle?: RoleSettings;
	mid?: RoleSettings;
	adc?: RoleSettings;
	support?: RoleSettings;
	spellsRow0?: [SpellCellData?, SpellCellData?, SpellCellData?, SpellCellData?]; // Fixed-size array for 4 columns
	spellsRow1?: [SpellCellData?, SpellCellData?, SpellCellData?, SpellCellData?]; // Fixed-size array for 4 columns
	cdrItemsRow0?: [CDRItemData?, CDRItemData?, CDRItemData?, CDRItemData?]; // CDR items for row 0
	cdrItemsRow1?: [CDRItemData?, CDRItemData?, CDRItemData?, CDRItemData?]; // CDR items for row 1
	currentCDRItem?: string; // Currently selected CDR item ID (e.g., "boots", "boots_cd1")
	currentCDRHaste?: number; // Current summoner haste percentage
};

/**
 * Default role settings
 */
const defaultRoleSettings: RoleSettings = {
	ss1: "SummonerFlash",
	ss2: "SummonerIgnite",
	cd1: 300,
	cd2: 180
};

/**
 * Default global settings values
 */
export const defaultGlobalSettings: GlobalSettings = {
	top: { ...defaultRoleSettings },
	jungle: { ...defaultRoleSettings },
	mid: { ...defaultRoleSettings },
	adc: { ...defaultRoleSettings },
	support: { ...defaultRoleSettings },
	spellsRow0: [undefined, undefined, undefined, undefined],
	spellsRow1: [undefined, undefined, undefined, undefined],
	cdrItemsRow0: [undefined, undefined, undefined, undefined],
	cdrItemsRow1: [undefined, undefined, undefined, undefined]
};