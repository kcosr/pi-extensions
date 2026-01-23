/**
 * codemap
 *
 * Borrows heavily from pi-skill-palette (MIT) by @nicobailon.
 * https://github.com/nicobailon/pi-skill-palette
 *
 * A file browser for selecting files/directories to pass to codemap.
 * Usage: /codemap - Opens the file browser overlay
 *
 * When selections are confirmed, the editor is populated with a `!codemap ...`
 * command (or `!!codemap ...` if sharing is disabled). Press Enter to run it.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { matchesKey } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

interface FileEntry {
	name: string;
	isDirectory: boolean;
	relativePath: string; // Path relative to CWD
}

interface CodemapState {
	selectedPaths: string[]; // Relative paths from CWD
	tokenBudget: number | null; // null means no budget
	respectGitignore: boolean;
	shareWithAgent: boolean; // true = !, false = !!
	skipHidden: boolean;
}

interface CodemapConfig {
	tokenBudget?: number | null;
	respectGitignore?: boolean;
	shareWithAgent?: boolean;
	skipHidden?: boolean;
	skipPatterns?: string[];
}

interface CodemapStatsPayload {
	stats: {
		totalFiles: number;
		totalSymbols: number;
		byLanguage: Record<string, number>;
		bySymbolKind: Record<string, number>;
	};
	total_tokens?: number;
	codebase_tokens?: number;
}

interface CodemapStats {
	totalFiles: number;
	totalSymbols: number;
	byLanguage: Record<string, number>;
	bySymbolKind: Record<string, number>;
	totalTokens?: number;
	codebaseTokens?: number;
}

interface CodemapStatsResult {
	stats?: CodemapStats;
	error?: string;
}

type FileBrowserAction =
	| { action: "confirm" }
	| { action: "cancel" }
	| { action: "stats"; result: CodemapStatsResult; scopeLabel: string };

const DEFAULT_CONFIG: CodemapConfig = {
	tokenBudget: 15000,
	respectGitignore: true,
	shareWithAgent: true,
	skipHidden: true,
	skipPatterns: ["node_modules"],
};

/**
 * Load config from ~/.pi/agent/extensions/codemap/config.json
 */
function loadConfig(): CodemapConfig {
	const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "codemap", "config.json");
	try {
		if (fs.existsSync(configPath)) {
			const content = fs.readFileSync(configPath, "utf-8");
			const custom = JSON.parse(content) as Partial<CodemapConfig>;
			return { ...DEFAULT_CONFIG, ...custom };
		}
	} catch {
		// Ignore errors, use default
	}
	return DEFAULT_CONFIG;
}

// Load config once at startup
const config = loadConfig();

// Skip patterns from config
const skipPatterns = config.skipPatterns ?? ["node_modules"];

// Shared state across the extension
const state: CodemapState = {
	selectedPaths: [],
	tokenBudget: config.tokenBudget ?? 15000,
	respectGitignore: config.respectGitignore ?? true,
	shareWithAgent: config.shareWithAgent ?? true,
	skipHidden: config.skipHidden ?? true,
};

/**
 * Convert paths to codemap arguments
 * Directories are converted to globs (dir -> dir/**)
 */
function pathsToCodemapArgs(paths: string[]): string[] {
	return paths.map(p => {
		// Check if path is a directory
		const fullPath = path.join(getCwdRoot(), p);
		try {
			const stats = fs.statSync(fullPath);
			if (stats.isDirectory()) {
				// Convert directory to glob pattern
				return `${p}/**`;
			}
		} catch {
			// If stat fails, assume it's a file
		}
		return p;
	});
}

function quoteCodemapArg(arg: string): string {
	// Use single quotes for globs to prevent shell expansion
	if (/[*?[\]]/.test(arg)) {
		return `'${arg}'`;
	}
	// Use double quotes for paths with spaces
	if (arg.includes(" ")) {
		return `"${arg}"`;
	}
	return arg;
}

function buildCodemapArgs(paths: string[], tokenBudget: number | null = state.tokenBudget): string[] {
	const args: string[] = [];
	if (tokenBudget !== null) {
		args.push("-b", String(tokenBudget));
	}
	return args.concat(pathsToCodemapArgs(paths));
}

function formatCommand(paths: string[], tokenBudget: number | null = state.tokenBudget): string {
	const quotedArgs = buildCodemapArgs(paths, tokenBudget).map(quoteCodemapArg);
	return quotedArgs.length > 0 ? `codemap ${quotedArgs.join(" ")}` : "codemap";
}

function formatStatsCommand(paths: string[], tokenBudget: number | null = state.tokenBudget): string {
	const quotedArgs = buildCodemapArgs(paths, tokenBudget).map(quoteCodemapArg);
	const parts = ["codemap", "--stats-only", "--output", "json", ...quotedArgs];
	return parts.join(" ").trim();
}

function formatExecError(error: unknown): string {
	if (error instanceof Error) {
		const errorWithStderr = error as Error & { stderr?: Buffer | string };
		if (errorWithStderr.stderr) {
			const stderrText = typeof errorWithStderr.stderr === "string"
				? errorWithStderr.stderr
				: errorWithStderr.stderr.toString("utf-8");
			if (stderrText.trim()) {
				return stderrText.trim();
			}
		}
		return error.message;
	}
	return String(error);
}

function fetchCodemapStats(paths: string[], tokenBudget: number | null): CodemapStatsResult {
	const command = formatStatsCommand(paths, tokenBudget);
	try {
		const output = execSync(command, {
			cwd: getCwdRoot(),
			encoding: "utf-8",
			stdio: "pipe",
			maxBuffer: 20 * 1024 * 1024,
		});
		const trimmed = output.trim();
		if (!trimmed) {
			return { error: "codemap returned no output." };
		}
		const parsed = JSON.parse(trimmed) as CodemapStatsPayload;
		if (!parsed.stats) {
			return { error: "codemap output missing stats." };
		}
		return {
			stats: {
				totalFiles: parsed.stats.totalFiles,
				totalSymbols: parsed.stats.totalSymbols,
				byLanguage: parsed.stats.byLanguage ?? {},
				bySymbolKind: parsed.stats.bySymbolKind ?? {},
				totalTokens: parsed.total_tokens,
				codebaseTokens: parsed.codebase_tokens,
			},
		};
	} catch (error) {
		return { error: formatExecError(error) };
	}
}

function formatStatsScope(paths: string[]): string {
	if (paths.length === 0) {
		return "Current directory";
	}
	if (paths.length === 1) {
		return paths[0];
	}
	const preview = paths.slice(0, 2).join(", ");
	const suffix = paths.length > 2 ? ", ..." : "";
	return `${paths.length} paths (${preview}${suffix})`;
}

function formatSelectedSummary(paths: string[]): { widget?: string[] } {
	if (paths.length === 0) {
		return {};
	}

	const cmd = formatCommand(paths);
	const truncatedCmd = cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd;

	return {
		widget: [
			`\x1b[2m$ \x1b[0m\x1b[36m${truncatedCmd}\x1b[0m`,
			`\x1b[2m  └─ esc to populate editor\x1b[0m`,
		],
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// Theming
// ═══════════════════════════════════════════════════════════════════════════

interface PaletteTheme {
	border: string;
	title: string;
	selected: string;
	selectedText: string;
	directory: string;
	checked: string;
	searchIcon: string;
	placeholder: string;
	hint: string;
}

const DEFAULT_THEME: PaletteTheme = {
	border: "2",
	title: "2",
	selected: "36",
	selectedText: "36",
	directory: "34",
	checked: "32",
	searchIcon: "2",
	placeholder: "2;3",
	hint: "2",
};

function loadTheme(): PaletteTheme {
	const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "codemap", "theme.json");
	try {
		if (fs.existsSync(configPath)) {
			const content = fs.readFileSync(configPath, "utf-8");
			const custom = JSON.parse(content) as Partial<PaletteTheme>;
			return { ...DEFAULT_THEME, ...custom };
		}
	} catch {
		// Ignore errors, use default
	}
	return DEFAULT_THEME;
}

function fg(code: string, text: string): string {
	if (!code) return text;
	return `\x1b[${code}m${text}\x1b[0m`;
}

// Load theme once at startup
const paletteTheme = loadTheme();

/**
 * Get the CWD as the root boundary
 */
function getCwdRoot(): string {
	return process.cwd();
}

/**
 * Check if a path is within the CWD
 */
function isWithinCwd(targetPath: string, cwdRoot: string): boolean {
	const resolved = path.resolve(targetPath);
	const normalizedCwd = path.resolve(cwdRoot);
	return resolved === normalizedCwd || resolved.startsWith(normalizedCwd + path.sep);
}

/**
 * List files and directories in a given directory
 */
function listDirectory(dirPath: string, cwdRoot: string, skipHidden = true): FileEntry[] {
	const entries: FileEntry[] = [];

	try {
		const items = fs.readdirSync(dirPath, { withFileTypes: true });

		for (const item of items) {
			// Skip hidden files if configured
			if (skipHidden && item.name.startsWith(".")) continue;
			
			// Skip patterns from config
			if (shouldSkipPattern(item.name)) continue;

			const fullPath = path.join(dirPath, item.name);
			const relativePath = path.relative(cwdRoot, fullPath);

			let isDirectory = item.isDirectory();
			if (item.isSymbolicLink()) {
				try {
					const stats = fs.statSync(fullPath);
					isDirectory = stats.isDirectory();
				} catch {
					continue; // Broken symlink
				}
			}

			entries.push({
				name: item.name,
				isDirectory,
				relativePath,
			});
		}

		// Sort: directories first, then alphabetically
		entries.sort((a, b) => {
			if (a.isDirectory && !b.isDirectory) return -1;
			if (!a.isDirectory && b.isDirectory) return 1;
			return a.name.localeCompare(b.name);
		});
	} catch {
		// Return empty on error
	}

	return entries;
}

/**
 * Recursively list all files and directories from a root directory
 */
function listAllFiles(dirPath: string, cwdRoot: string, results: FileEntry[] = [], skipHidden = true): FileEntry[] {
	try {
		const items = fs.readdirSync(dirPath, { withFileTypes: true });

		for (const item of items) {
			// Skip hidden files if configured
			if (skipHidden && item.name.startsWith(".")) continue;
			
			// Skip patterns from config
			if (shouldSkipPattern(item.name)) continue;

			const fullPath = path.join(dirPath, item.name);
			const relativePath = path.relative(cwdRoot, fullPath);

			let isDirectory = item.isDirectory();
			if (item.isSymbolicLink()) {
				try {
					const stats = fs.statSync(fullPath);
					isDirectory = stats.isDirectory();
				} catch {
					continue; // Broken symlink
				}
			}

			results.push({
				name: item.name,
				isDirectory,
				relativePath,
			});

			// Recurse into directories
			if (isDirectory) {
				listAllFiles(fullPath, cwdRoot, results, skipHidden);
			}
		}
	} catch {
		// Skip inaccessible directories
	}

	return results;
}

/**
 * Check if we're inside a git repository
 */
function isGitRepo(cwdRoot: string): boolean {
	try {
		execSync("git rev-parse --is-inside-work-tree", {
			cwd: cwdRoot,
			encoding: "utf-8",
			stdio: "pipe",
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Get all files using git ls-files (respects .gitignore)
 */
function listGitFiles(cwdRoot: string): FileEntry[] {
	const entries: FileEntry[] = [];

	try {
		// Get tracked files + untracked but not ignored
		const output = execSync("git ls-files --cached --others --exclude-standard", {
			cwd: cwdRoot,
			encoding: "utf-8",
			stdio: "pipe",
			maxBuffer: 10 * 1024 * 1024,
		});

		const files = output.trim().split("\n").filter(f => f);

		for (const relativePath of files) {
			const fullPath = path.join(cwdRoot, relativePath);
			const name = path.basename(relativePath);

			// Check if it's a directory or file
			let isDirectory = false;
			try {
				const stats = fs.statSync(fullPath);
				isDirectory = stats.isDirectory();
			} catch {
				continue; // File doesn't exist
			}

			entries.push({
				name,
				isDirectory,
				relativePath,
			});
		}

		// Also add directories that contain these files
		const dirs = new Set<string>();
		for (const entry of entries) {
			let dir = path.dirname(entry.relativePath);
			while (dir && dir !== ".") {
				dirs.add(dir);
				dir = path.dirname(dir);
			}
		}

		for (const dir of dirs) {
			entries.push({
				name: path.basename(dir),
				isDirectory: true,
				relativePath: dir,
			});
		}
	} catch {
		// Fall back to empty on error
	}

	return entries;
}

/**
 * List files in a directory, optionally filtering by git
 */
function listDirectoryWithGit(dirPath: string, cwdRoot: string, gitFiles: Set<string> | null, skipHidden = true): FileEntry[] {
	const entries: FileEntry[] = [];

	try {
		const items = fs.readdirSync(dirPath, { withFileTypes: true });
		const relDir = path.relative(cwdRoot, dirPath);

		for (const item of items) {
			// Skip hidden files if configured
			if (skipHidden && item.name.startsWith(".")) continue;
			
			// Skip patterns from config
			if (shouldSkipPattern(item.name)) continue;

			const fullPath = path.join(dirPath, item.name);
			const relativePath = relDir ? path.join(relDir, item.name) : item.name;

			let isDirectory = item.isDirectory();
			if (item.isSymbolicLink()) {
				try {
					const stats = fs.statSync(fullPath);
					isDirectory = stats.isDirectory();
				} catch {
					continue; // Broken symlink
				}
			}

			// If gitFiles is provided, filter entries
			if (gitFiles !== null) {
				if (isDirectory) {
					// Check if any git file is under this directory
					let hasGitFiles = false;
					const prefix = relativePath + "/";
					for (const gitFile of gitFiles) {
						if (gitFile.startsWith(prefix) || gitFile === relativePath) {
							hasGitFiles = true;
							break;
						}
					}
					if (!hasGitFiles) continue;
				} else {
					// Check if this file is in git
					if (!gitFiles.has(relativePath)) continue;
				}
			}

			entries.push({
				name: item.name,
				isDirectory,
				relativePath,
			});
		}

		// Sort: directories first, then alphabetically
		entries.sort((a, b) => {
			if (a.isDirectory && !b.isDirectory) return -1;
			if (!a.isDirectory && b.isDirectory) return 1;
			return a.name.localeCompare(b.name);
		});
	} catch {
		// Return empty on error
	}

	return entries;
}

/**
 * Check if a query contains glob characters
 */
function isGlobPattern(query: string): boolean {
	return /[*?[\]]/.test(query);
}

/**
 * Convert a glob pattern to a RegExp
 * Supports: * (any chars except /), ** (any chars including /), ? (single char), [abc] (char class)
 */
function globToRegex(pattern: string): RegExp {
	let regex = "";
	let i = 0;
	
	while (i < pattern.length) {
		const char = pattern[i];
		
		if (char === "*") {
			if (pattern[i + 1] === "*") {
				// ** matches anything including /
				regex += ".*";
				i += 2;
				// Skip following / if present
				if (pattern[i] === "/") i++;
			} else {
				// * matches anything except /
				regex += "[^/]*";
				i++;
			}
		} else if (char === "?") {
			// ? matches single character except /
			regex += "[^/]";
			i++;
		} else if (char === "[") {
			// Character class - find closing ]
			const end = pattern.indexOf("]", i);
			if (end !== -1) {
				regex += pattern.slice(i, end + 1);
				i = end + 1;
			} else {
				regex += "\\[";
				i++;
			}
		} else if (".+^${}()|\\".includes(char)) {
			// Escape regex special chars
			regex += "\\" + char;
			i++;
		} else {
			regex += char;
			i++;
		}
	}
	
	return new RegExp("^" + regex + "$", "i");
}

/**
 * Check if a name should be skipped based on config patterns
 */
function shouldSkipPattern(name: string): boolean {
	return skipPatterns.some(pattern => {
		// Support simple wildcards
		if (pattern.includes("*")) {
			const regex = globToRegex(pattern);
			return regex.test(name);
		}
		// Exact match
		return name === pattern;
	});
}

/**
 * Simple fuzzy match scoring
 */
function fuzzyScore(query: string, text: string): number {
	const lowerQuery = query.toLowerCase();
	const lowerText = text.toLowerCase();

	if (lowerText.includes(lowerQuery)) {
		return 100 + (lowerQuery.length / lowerText.length) * 50;
	}

	let score = 0;
	let queryIndex = 0;
	let consecutiveBonus = 0;

	for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
		if (lowerText[i] === lowerQuery[queryIndex]) {
			score += 10 + consecutiveBonus;
			consecutiveBonus += 5;
			queryIndex++;
		} else {
			consecutiveBonus = 0;
		}
	}

	return queryIndex === lowerQuery.length ? score : 0;
}

/**
 * Filter entries by fuzzy match or glob pattern
 * Auto-detects glob patterns (*, ?, []) and switches modes
 */
function filterEntries(entries: FileEntry[], query: string): FileEntry[] {
	if (!query.trim()) return entries;

	// Check if query is a glob pattern
	if (isGlobPattern(query)) {
		const regex = globToRegex(query);
		return entries.filter((entry) => 
			regex.test(entry.name) || regex.test(entry.relativePath)
		);
	}

	// Fuzzy match mode
	const scored = entries
		.map((entry) => ({
			entry,
			score: Math.max(
				fuzzyScore(query, entry.name),
				fuzzyScore(query, entry.relativePath) * 0.9 // Slight preference for name matches
			),
		}))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score);

	return scored.map((item) => item.entry);
}

/**
 * Option definition for the options panel
 */
interface BrowserOption {
	id: string;
	label: string;
	enabled: boolean;
	visible: () => boolean;
	kind?: "toggle" | "action";
	// For input options
	hasInput?: boolean;
	inputValue?: string;
	inputPlaceholder?: string;
}

/**
 * File Browser Overlay Component
 */
class FileBrowserComponent {
	readonly width = 0;
	cwdRoot: string;
	currentDir: string;
	allEntries: FileEntry[]; // Current directory entries
	allFilesRecursive: FileEntry[]; // All files in project (for search)
	filtered: FileEntry[];
	selected = 0;
	query = "";
	isSearchMode = false; // True when showing search results
	selectedPaths: Set<string>;
	inactivityTimeout: ReturnType<typeof setTimeout> | null = null;
	statsTimeout: ReturnType<typeof setTimeout> | null = null;
	statsLoading = false;
	static readonly INACTIVITY_MS = 60000;
	rootParentView = false;
	
	// Git support
	inGitRepo: boolean;
	gitFiles: Set<string> | null = null;

	// Options panel
	focusOnOptions = false; // Tab toggles between search and options
	selectedOption = 0;
	editingInput = false; // True when typing in an input field
	options: BrowserOption[];

	// Callbacks
	onToggle: (relativePath: string, selected: boolean) => void;
	onOptionChange: (optionId: string, enabled: boolean, value?: string) => void;
	done: (action: FileBrowserAction) => void;

	constructor(
		initialSelectedPaths: string[],
		initialTokenBudget: number | null,
		initialRespectGitignore: boolean,
		initialShareWithAgent: boolean,
		initialSkipHidden: boolean,
		onToggle: (relativePath: string, selected: boolean) => void,
		onOptionChange: (optionId: string, enabled: boolean, value?: string) => void,
		done: (action: FileBrowserAction) => void
	) {
		this.onToggle = onToggle;
		this.onOptionChange = onOptionChange;
		this.done = done;
		this.cwdRoot = getCwdRoot();
		this.currentDir = this.cwdRoot;
		this.selectedPaths = new Set(initialSelectedPaths);
		this.rootParentView = false;
		
		// Check if we're in a git repo
		this.inGitRepo = isGitRepo(this.cwdRoot);
		
		// Initialize options
		this.options = [
			{
				id: "gitignore",
				label: "Respect .gitignore",
				enabled: initialRespectGitignore,
				visible: () => this.inGitRepo,
			},
			{
				id: "skipHidden",
				label: "Skip hidden files",
				enabled: initialSkipHidden,
				visible: () => true,
			},
			{
				id: "tokenBudget",
				label: "Token budget",
				enabled: initialTokenBudget !== null,
				visible: () => true,
				hasInput: true,
				inputValue: initialTokenBudget !== null ? String(initialTokenBudget) : String(config.tokenBudget ?? 15000),
				inputPlaceholder: "tokens",
			},
			{
				id: "shareWithAgent",
				label: "Share with agent",
				enabled: initialShareWithAgent,
				visible: () => true,
			},
			{
				id: "stats",
				label: "Show dry run stats",
				enabled: true,
				visible: () => true,
				kind: "action",
			},
		];
		
		this.rebuildFileLists();
		this.resetInactivityTimeout();
	}

	getOption(id: string): BrowserOption | undefined {
		return this.options.find(o => o.id === id);
	}

	getVisibleOptions(): BrowserOption[] {
		return this.options.filter(o => o.visible());
	}

	rebuildFileLists(): void {
		const gitignoreOption = this.getOption("gitignore");
		const respectGitignore = gitignoreOption?.enabled ?? false;
		const skipHiddenOption = this.getOption("skipHidden");
		const skipHidden = skipHiddenOption?.enabled ?? true;
		
		// Build git file set if in repo and gitignore is enabled
		if (this.inGitRepo && respectGitignore) {
			const gitEntries = listGitFiles(this.cwdRoot);
			this.gitFiles = new Set(gitEntries.map(e => e.relativePath));
			this.allFilesRecursive = gitEntries;
		} else {
			this.gitFiles = null;
			this.allFilesRecursive = listAllFiles(this.cwdRoot, this.cwdRoot, [], skipHidden);
		}
		
		// Rebuild current directory listing
		this.allEntries = this.listCurrentDirectory();
		this.updateFilter();
	}

	listCurrentDirectory(): FileEntry[] {
		if (this.rootParentView) {
			return [{
				name: path.basename(this.cwdRoot),
				isDirectory: true,
				relativePath: ".",
			}];
		}
		
		const skipHiddenOption = this.getOption("skipHidden");
		const skipHidden = skipHiddenOption?.enabled ?? true;
		const entries = listDirectoryWithGit(this.currentDir, this.cwdRoot, this.gitFiles, skipHidden);
		
		// Add ".." entry at top (shows parent view at root)
		entries.unshift({
			name: "..",
			isDirectory: true,
			relativePath: "..",
		});
		
		return entries;
	}

	isUpEntry(entry: FileEntry): boolean {
		return entry.name === ".." && entry.relativePath === "..";
	}

	resetInactivityTimeout(): void {
		if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
		this.inactivityTimeout = setTimeout(() => {
			this.cleanup();
			this.done({ action: "cancel" });
		}, FileBrowserComponent.INACTIVITY_MS);
	}

	navigateTo(dir: string): void {
		if (!isWithinCwd(dir, this.cwdRoot)) return;

		this.rootParentView = false;
		this.currentDir = dir;
		this.allEntries = this.listCurrentDirectory();
		this.query = "";
		this.isSearchMode = false;
		this.filtered = this.allEntries;
		this.selected = 0;
	}

	goUp(): boolean {
		if (this.rootParentView) {
			return false;
		}
		if (this.currentDir === this.cwdRoot) {
			this.rootParentView = true;
			this.allEntries = this.listCurrentDirectory();
			this.query = "";
			this.isSearchMode = false;
			this.filtered = this.allEntries;
			this.selected = 0;
			return true;
		}
		const parentDir = path.dirname(this.currentDir);
		if (isWithinCwd(parentDir, this.cwdRoot)) {
			this.navigateTo(parentDir);
			return true;
		}
		return false;
	}

	handleInput(data: string): void {
		this.resetInactivityTimeout();

		if (this.statsLoading) {
			return;
		}

		// Tab switches focus between search/files and options panel
		if (matchesKey(data, "tab")) {
			const visibleOptions = this.getVisibleOptions();
			if (visibleOptions.length > 0) {
				this.focusOnOptions = !this.focusOnOptions;
				if (this.focusOnOptions) {
					this.selectedOption = 0;
				}
			}
			return;
		}

		// Handle input based on focus
		if (this.focusOnOptions) {
			this.handleOptionsInput(data);
		} else {
			this.handleBrowserInput(data);
		}
	}

	notifyOptionChange(option: BrowserOption): void {
		this.onOptionChange(option.id, option.enabled, option.inputValue);
	}

	handleOptionsInput(data: string): void {
		const visibleOptions = this.getVisibleOptions();
		const currentOption = visibleOptions[this.selectedOption];

		// Handle input editing mode
		if (this.editingInput && currentOption?.hasInput) {
			if (matchesKey(data, "escape") || matchesKey(data, "return")) {
				// Exit edit mode and notify change
				this.editingInput = false;
				this.notifyOptionChange(currentOption);
				return;
			}

			if (matchesKey(data, "backspace")) {
				if (currentOption.inputValue && currentOption.inputValue.length > 0) {
					currentOption.inputValue = currentOption.inputValue.slice(0, -1);
				}
				return;
			}

			// Only allow digits for token budget
			if (data.length === 1 && /[0-9]/.test(data)) {
				currentOption.inputValue = (currentOption.inputValue || "") + data;
				return;
			}
			return;
		}

		// Normal options navigation mode
		if (matchesKey(data, "escape")) {
			// Escape exits options mode
			this.focusOnOptions = false;
			return;
		}

		if (matchesKey(data, "up")) {
			if (visibleOptions.length > 0) {
				this.selectedOption = this.selectedOption === 0 
					? visibleOptions.length - 1 
					: this.selectedOption - 1;
			}
			return;
		}

		if (matchesKey(data, "down")) {
			if (visibleOptions.length > 0) {
				this.selectedOption = this.selectedOption === visibleOptions.length - 1 
					? 0 
					: this.selectedOption + 1;
			}
			return;
		}

		if (data === " ") {
			// Space toggles the checkbox
			if (currentOption && currentOption.kind !== "action") {
				currentOption.enabled = !currentOption.enabled;
				if (currentOption.id === "gitignore" || currentOption.id === "skipHidden") {
					this.rebuildFileLists();
				}
				this.notifyOptionChange(currentOption);
			}
			return;
		}

		if (matchesKey(data, "return")) {
			// Enter: for action options, run; for input options, enter edit mode; otherwise toggle
			if (currentOption?.kind === "action") {
				if (this.statsLoading) {
					return;
				}
				this.statsLoading = true;
				if (this.inactivityTimeout) {
					clearTimeout(this.inactivityTimeout);
					this.inactivityTimeout = null;
				}
				const paths = Array.from(this.selectedPaths);
				const tokenBudget = state.tokenBudget;
				const scopeLabel = formatStatsScope(paths);
				this.statsTimeout = setTimeout(() => {
					const result = fetchCodemapStats(paths, tokenBudget);
					this.cleanup();
					this.done({ action: "stats", result, scopeLabel });
				}, 0);
				return;
			}
			if (currentOption?.hasInput) {
				this.editingInput = true;
			} else if (currentOption) {
				currentOption.enabled = !currentOption.enabled;
				if (currentOption.id === "gitignore" || currentOption.id === "skipHidden") {
					this.rebuildFileLists();
				}
				this.notifyOptionChange(currentOption);
			}
			return;
		}

		// Start typing directly into input field (digits only for token budget)
		if (currentOption?.hasInput && data.length === 1 && /[0-9]/.test(data)) {
			this.editingInput = true;
			currentOption.inputValue = (currentOption.inputValue || "") + data;
			return;
		}
	}

	handleBrowserInput(data: string): void {
		if (matchesKey(data, "escape")) {
			// Esc goes up one directory, or closes if at root
			if (!this.goUp()) {
				this.cleanup();
				this.done({ action: "confirm" });
			}
			return;
		}

		if (matchesKey(data, "return")) {
			const entry = this.filtered[this.selected];
			if (entry) {
				if (entry.name === "..") {
					// Go up entry
					this.goUp();
				} else if (entry.isDirectory && (entry.relativePath !== "." || this.rootParentView)) {
					// Enter the directory (or enter root from parent view)
					const targetPath = path.join(this.cwdRoot, entry.relativePath);
					this.navigateTo(targetPath);
				} else {
					// Toggle selection (files, or root entry when selecting)
					const willSelect = !this.selectedPaths.has(entry.relativePath);
					if (willSelect) {
						this.selectedPaths.add(entry.relativePath);
					} else {
						this.selectedPaths.delete(entry.relativePath);
					}
					this.onToggle(entry.relativePath, willSelect);
				}
			}
			return;
		}

		if (data === " ") {
			const entry = this.filtered[this.selected];
			if (entry && !this.isUpEntry(entry)) {
				const willSelect = !this.selectedPaths.has(entry.relativePath);
				if (willSelect) {
					this.selectedPaths.add(entry.relativePath);
				} else {
					this.selectedPaths.delete(entry.relativePath);
				}
				this.onToggle(entry.relativePath, willSelect);
			}
			return;
		}

		if (matchesKey(data, "up")) {
			if (this.filtered.length > 0) {
				this.selected = this.selected === 0 ? this.filtered.length - 1 : this.selected - 1;
			}
			return;
		}

		if (matchesKey(data, "down")) {
			if (this.filtered.length > 0) {
				this.selected = this.selected === this.filtered.length - 1 ? 0 : this.selected + 1;
			}
			return;
		}

		if (matchesKey(data, "backspace")) {
			if (this.query.length > 0) {
				this.query = this.query.slice(0, -1);
				this.updateFilter();
			} else {
				// Go up a directory if query is empty
				this.goUp();
			}
			return;
		}

		// Printable character
		if (data.length === 1 && data.charCodeAt(0) >= 32) {
			this.query += data;
			this.updateFilter();
		}
	}

	updateFilter(): void {
		if (this.query.trim()) {
			// Search mode: search all files recursively
			this.isSearchMode = true;
			this.filtered = filterEntries(this.allFilesRecursive, this.query);
		} else {
			// Browse mode: show current directory
			this.isSearchMode = false;
			this.filtered = this.allEntries;
		}
		this.selected = 0;
	}

	render(width: number): string[] {
		const w = this.width > 0 ? Math.min(this.width, width) : width;
		const innerW = Math.max(0, w - 2);
		const lines: string[] = [];

		const t = paletteTheme;
		const border = (s: string) => fg(t.border, s);
		const title = (s: string) => fg(t.title, s);
		const selected = (s: string) => fg(t.selected, s);
		const selectedText = (s: string) => fg(t.selectedText, s);
		const directory = (s: string) => fg(t.directory, s);
		const checked = (s: string) => fg(t.checked, s);
		const searchIcon = (s: string) => fg(t.searchIcon, s);
		const placeholder = (s: string) => fg(t.placeholder, s);
		const hint = (s: string) => fg(t.hint, s);
		const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
		const italic = (s: string) => `\x1b[3m${s}\x1b[23m`;

		// Calculate visible length (strip ANSI codes)
		const visLen = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

		const pad = (s: string, len: number) => {
			return s + " ".repeat(Math.max(0, len - visLen(s)));
		};

		const truncate = (s: string, maxLen: number) => {
			if (s.length <= maxLen) return s;
			return s.slice(0, maxLen - 1) + "…";
		};

		const row = (content: string) => border("│") + pad(" " + content, innerW) + border("│");
		const emptyRow = () => border("│") + " ".repeat(innerW) + border("│");

		// Title: show search mode or current directory
		let titleText: string;
		if (this.isSearchMode) {
			titleText = ` Search `;
		} else if (this.rootParentView) {
			titleText = "";
		} else {
			const relDir = path.relative(this.cwdRoot, this.currentDir);
			titleText = relDir ? ` ${truncate(relDir, 40)} ` : "";
		}
		const borderLen = Math.max(0, innerW - visLen(titleText));
		const leftBorder = Math.floor(borderLen / 2);
		const rightBorder = borderLen - leftBorder;
		lines.push(border("╭" + "─".repeat(leftBorder)) + title(titleText) + border("─".repeat(rightBorder) + "╮"));

		lines.push(emptyRow());

		// Search input
		const cursor = this.focusOnOptions ? "" : selected("│");
		const searchIconChar = searchIcon("◎");
		const queryDisplay = this.query || placeholder(italic("search or glob (*.ts, src/**/*)..."));
		const modeIndicator = this.query && isGlobPattern(this.query) ? hint(" [glob]") : "";
		const searchFocusIndicator = !this.focusOnOptions ? "" : "";
		lines.push(row(`${searchFocusIndicator}${searchIconChar}  ${queryDisplay}${cursor}${modeIndicator}`));

		// Options panel
		const visibleOptions = this.getVisibleOptions();
		if (visibleOptions.length > 0) {
			lines.push(emptyRow());
			let optionsHint: string;
			if (this.editingInput) {
				optionsHint = hint(" (type value, enter/esc to finish)");
			} else if (this.focusOnOptions) {
				optionsHint = hint(" (↑↓ nav, space toggle, enter select/edit, tab exit)");
			} else {
				optionsHint = hint(" (tab to focus)");
			}
			const optionsLabel = this.focusOnOptions ? selected("Options") : hint("Options");
			lines.push(row(optionsLabel + optionsHint));
			
			const firstActionIndex = visibleOptions.findIndex(opt => opt.kind === "action");
			for (let i = 0; i < visibleOptions.length; i++) {
				if (i === firstActionIndex && firstActionIndex > 0) {
					lines.push(emptyRow());
				}

				const opt = visibleOptions[i];
				const isSelectedOpt = this.focusOnOptions && i === this.selectedOption;
				const isAction = opt.kind === "action";

				if (isAction) {
					const prefix = isSelectedOpt ? selected("▸") : " ";
					const label = isSelectedOpt ? selectedText(opt.label) : opt.label;
					const loading = this.statsLoading ? hint(italic("Generating...")) : "";
					const loadingGap = loading ? " " : "";
					lines.push(row(`${prefix} ${label}${loadingGap}${loading}`));
					continue;
				}

				const checkbox = opt.enabled ? checked("☑") : hint("☐");
				const prefix = isSelectedOpt ? selected("▸ ") : "  ";
				const label = isSelectedOpt
					? selectedText(opt.label)
					: (opt.enabled ? opt.label : hint(opt.label));
				
				// Render input field if present
				let inputDisplay = "";
				if (opt.hasInput) {
					const isEditing = isSelectedOpt && this.editingInput;
					const inputCursor = isEditing ? selected("│") : "";
					const value = opt.inputValue || "";
					const displayValue = opt.enabled 
						? (isSelectedOpt ? selectedText(value) : value)
						: hint(value);
					inputDisplay = `: ${displayValue}${inputCursor}`;
				}
				
				lines.push(row(`${prefix}${checkbox} ${label}${inputDisplay}`));
			}
		}

		lines.push(emptyRow());

		// Divider
		lines.push(border("├" + "─".repeat(innerW) + "┤"));

		// Show parent directory option if not at root
		const canGoUp = this.currentDir !== this.cwdRoot;

		// File list
		const maxVisible = 10;
		const startIndex = Math.max(0, Math.min(this.selected - Math.floor(maxVisible / 2), this.filtered.length - maxVisible));
		const endIndex = Math.min(startIndex + maxVisible, this.filtered.length);

		if (this.filtered.length === 0) {
			lines.push(emptyRow());
			if (canGoUp) {
				lines.push(row(hint(italic("(empty directory — esc to go up)"))));
			} else {
				lines.push(row(hint(italic("No matching files"))));
			}
			lines.push(emptyRow());
		} else {
			lines.push(emptyRow());
			for (let i = startIndex; i < endIndex; i++) {
				const entry = this.filtered[i];
				const isSelected = i === this.selected;
				const isUpDir = this.isUpEntry(entry);
				const isChecked = !isUpDir && this.selectedPaths.has(entry.relativePath);

				const prefix = isSelected ? selected("▸") : border("·");
				
				let entryLine: string;
				if (isUpDir) {
					// Special rendering for ".." entry
					const upName = isSelected ? bold(selectedText("..")) : hint("..");
					entryLine = `${prefix}   ${upName}`;
				} else {
					const checkMark = isChecked ? checked("☑ ") : hint("☐ ");

					// In search mode, show full relative path; otherwise just name
					let displayName: string;
					if (this.isSearchMode) {
						displayName = entry.relativePath + (entry.isDirectory ? "/" : "");
					} else {
						displayName = entry.name + (entry.isDirectory ? "/" : "");
					}

					let nameStr: string;
					if (entry.isDirectory) {
						nameStr = isSelected ? bold(selectedText(displayName)) : directory(displayName);
					} else {
						nameStr = isSelected ? bold(selectedText(displayName)) : displayName;
					}

					entryLine = `${prefix} ${checkMark}${nameStr}`;
				}
				lines.push(row(entryLine));
			}
			lines.push(emptyRow());

			// Scroll indicator
			if (this.filtered.length > maxVisible) {
				const countStr = `${this.selected + 1}/${this.filtered.length}`;
				lines.push(row(hint(countStr)));
				lines.push(emptyRow());
			}
		}

		// Show selection count
		if (this.selectedPaths.size > 0) {
			lines.push(border("├" + "─".repeat(innerW) + "┤"));
			lines.push(emptyRow());
			const selectedList = Array.from(this.selectedPaths).slice(0, 3);
			const preview = selectedList.join(", ") + (this.selectedPaths.size > 3 ? ", ..." : "");
			lines.push(row(checked(`Selected (${this.selectedPaths.size}): `) + truncate(preview, innerW - 20)));
			lines.push(emptyRow());
		}

		// Divider
		lines.push(border("├" + "─".repeat(innerW) + "┤"));

		lines.push(emptyRow());

		// Footer hints
		const hasOptions = this.getVisibleOptions().length > 0;
		let hints: string;
		if (this.focusOnOptions) {
			hints = `${italic("↑↓")} nav  ${italic("space")} toggle  ${italic("tab")} files  ${italic("esc")} files`;
		} else {
			const escHint = canGoUp ? "up" : "done";
			const tabHint = hasOptions ? `  ${italic("tab")} options` : "";
			hints = `${italic("↑↓")} nav  ${italic("enter")} open  ${italic("space")} select  ${italic("esc")} ${escHint}${tabHint}`;
		}
		lines.push(row(hint(hints)));

		lines.push(border(`╰${"─".repeat(innerW)}╯`));

		return lines;
	}

	cleanup(): void {
		if (this.inactivityTimeout) {
			clearTimeout(this.inactivityTimeout);
			this.inactivityTimeout = null;
		}
		if (this.statsTimeout) {
			clearTimeout(this.statsTimeout);
			this.statsTimeout = null;
		}
		this.statsLoading = false;
	}

	invalidate(): void {}

	dispose(): void {
		this.cleanup();
	}
}

class StatsDialog {
	readonly width = 72;

	constructor(
		private result: CodemapStatsResult,
		private scopeLabel: string,
		private done: (action: "close") => void
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "return") || data === "q" || data === "Q") {
			this.done("close");
		}
	}

	render(width: number): string[] {
		const w = this.width > 0 ? Math.min(this.width, width) : width;
		const innerW = Math.max(0, w - 2);
		const lines: string[] = [];

		const t = paletteTheme;
		const border = (s: string) => fg(t.border, s);
		const title = (s: string) => fg(t.title, s);
		const accent = (s: string) => fg(t.selected, s);
		const hint = (s: string) => fg(t.hint, s);
		const muted = (s: string) => fg(t.placeholder, s);
		const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
		const italic = (s: string) => `\x1b[3m${s}\x1b[23m`;

		const visLen = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

		const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - visLen(s)));
		const row = (content: string) => border("│") + pad(" " + content, innerW) + border("│");
		const emptyRow = () => border("│") + " ".repeat(innerW) + border("│");
		const center = (s: string, len: number) => {
			const padding = Math.max(0, len - visLen(s));
			const left = Math.floor(padding / 2);
			return " ".repeat(left) + s + " ".repeat(padding - left);
		};
		const centerRow = (content: string) => border("│") + center(content, innerW) + border("│");

		const titleText = " Codemap Stats ";
		const borderLen = Math.max(0, innerW - visLen(titleText));
		const leftBorder = Math.floor(borderLen / 2);
		const rightBorder = borderLen - leftBorder;
		lines.push(border("╭" + "─".repeat(leftBorder)) + title(titleText) + border("─".repeat(rightBorder) + "╮"));

		lines.push(emptyRow());

		const closeHint = hint(`${italic("esc")} / ${italic("enter")} close`);
		const scopeText = this.scopeLabel.length > innerW - 8
			? this.scopeLabel.slice(0, Math.max(0, innerW - 9)) + "…"
			: this.scopeLabel;
		const stats = this.result.stats;

		if (this.result.error || !stats) {
			const message = this.result.error ? this.result.error : "No stats available.";
			lines.push(centerRow(`${accent("⚠")} ${bold("Stats unavailable")}`));
			lines.push(emptyRow());
			lines.push(row(muted(message)));
			lines.push(emptyRow());
			lines.push(border("├" + "─".repeat(innerW) + "┤"));
			lines.push(centerRow(closeHint));
			lines.push(border(`╰${"─".repeat(innerW)}╯`));
			return lines;
		}

		const formatNumber = (value: number) => value.toLocaleString();

		lines.push(row(`${hint("Scope:")} ${bold(scopeText)}`));
		lines.push(emptyRow());

		lines.push(border("├" + "─".repeat(innerW) + "┤"));
		lines.push(row(bold("Summary")));
		lines.push(row(`${hint("Total files:")} ${accent(formatNumber(stats.totalFiles))}`));
		lines.push(row(`${hint("Total symbols:")} ${accent(formatNumber(stats.totalSymbols))}`));
		if (stats.totalTokens !== undefined) {
			lines.push(row(`${hint("Total tokens:")} ${accent(formatNumber(stats.totalTokens))}`));
		}
		if (stats.codebaseTokens !== undefined) {
			lines.push(row(`${hint("Codebase tokens:")} ${accent(formatNumber(stats.codebaseTokens))}`));
		}

		const renderList = (label: string, entries: Record<string, number>) => {
			lines.push(emptyRow());
			lines.push(border("├" + "─".repeat(innerW) + "┤"));
			lines.push(row(bold(label)));

			const sorted = Object.entries(entries).sort((a, b) => b[1] - a[1]);
			if (sorted.length === 0) {
				lines.push(row(muted("(none)")));
				return;
			}

			const maxItems = 8;
			const display = sorted.slice(0, maxItems);
			const maxLabelLength = Math.min(
				Math.max(...display.map(([name]) => name.length), 0) + 1,
				Math.max(4, innerW - 12)
			);

			for (const [name, value] of display) {
				const labelText = `${name}:`.padEnd(maxLabelLength);
				lines.push(row(`${hint(labelText)} ${accent(formatNumber(value))}`));
			}

			if (sorted.length > maxItems) {
				lines.push(row(muted(`… ${sorted.length - maxItems} more`)));
			}
		};

		renderList("Languages", stats.byLanguage);
		renderList("Symbols", stats.bySymbolKind);

		lines.push(emptyRow());
		lines.push(border("├" + "─".repeat(innerW) + "┤"));
		lines.push(centerRow(closeHint));

		lines.push(border(`╰${"─".repeat(innerW)}╯`));

		return lines;
	}

	invalidate(): void {}

	dispose(): void {}
}

/**
 * Check if codemap is available in PATH
 */
function isCodemapAvailable(): boolean {
	try {
		execSync("which codemap", { encoding: "utf-8", stdio: "pipe" });
		return true;
	} catch {
		// Try 'where' on Windows
		try {
			execSync("where codemap", { encoding: "utf-8", stdio: "pipe" });
			return true;
		} catch {
			return false;
		}
	}
}
export default function codemapExtension(pi: ExtensionAPI): void {
	// Register the /codemap command
	pi.registerCommand("codemap", {
		description: "Browse and select files to pass to codemap",
		handler: async (_args: string, ctx: ExtensionContext) => {
			// Check if codemap is available
			if (!isCodemapAvailable()) {
				ctx.ui.notify("codemap not found in PATH. Install it from: https://github.com/kcosr/codemap", "error");
				return;
			}

			let showFileBrowser = true;

			while (showFileBrowser) {
				// Show the file browser overlay
				const result = await ctx.ui.custom<FileBrowserAction>(
					(_tui, _theme, _keybindings, done) => new FileBrowserComponent(
						state.selectedPaths,
						state.tokenBudget,
						state.respectGitignore,
						state.shareWithAgent,
						state.skipHidden,
						(relativePath, selected) => {
							if (selected) {
								if (!state.selectedPaths.includes(relativePath)) {
									state.selectedPaths.push(relativePath);
								}
							} else {
								state.selectedPaths = state.selectedPaths.filter(p => p !== relativePath);
							}
							const summary = formatSelectedSummary(state.selectedPaths);
							ctx.ui.setWidget("codemap", summary.widget);
						},
						(optionId, enabled, value) => {
							// Handle option changes
							if (optionId === "tokenBudget") {
								if (enabled && value) {
									state.tokenBudget = parseInt(value, 10) || null;
								} else {
									state.tokenBudget = null;
								}
								// Update widget to reflect new command
								if (state.selectedPaths.length > 0) {
									const summary = formatSelectedSummary(state.selectedPaths);
									ctx.ui.setWidget("codemap", summary.widget);
								}
							} else if (optionId === "gitignore") {
								state.respectGitignore = enabled;
							} else if (optionId === "shareWithAgent") {
								state.shareWithAgent = enabled;
							} else if (optionId === "skipHidden") {
								state.skipHidden = enabled;
							}
						},
						(action) => done(action)
					),
					{ overlay: true }
				);

				if (result.action === "stats") {
					await ctx.ui.custom<"close">(
						(_tui, _theme, _keybindings, done) => new StatsDialog(result.result, result.scopeLabel, done),
						{ overlay: true }
					);
					showFileBrowser = true;
					continue;
				}

				// "confirm" or "cancel"
				if (state.selectedPaths.length > 0) {
					// Populate editor with command
					const cmd = formatCommand(state.selectedPaths);
					const prefix = state.shareWithAgent ? "!" : "!!";
					ctx.ui.setEditorText(`${prefix}${cmd}`);
					ctx.ui.notify("Command ready - press Enter to execute", "info");
					state.selectedPaths = [];
				}
				ctx.ui.setStatus("codemap", undefined);
				ctx.ui.setWidget("codemap", undefined);
				showFileBrowser = false;
			}
		},
	});
}
