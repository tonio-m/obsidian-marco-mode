import { App, Menu, Modal, Notice, Plugin, PluginSettingTab, Setting, SuggestModal, TAbstractFile, TFile, moment } from 'obsidian';

interface PluginSettings {
	inboxFolder: string;
	dailyNotesFolder: string;
	timestampFormat: string;
	lastImportDate: string;
	dummySetting: string;
	enableDailyNoteCheck: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	inboxFolder: '000_inbox',
	dailyNotesFolder: '001_journal',
	timestampFormat: 'ddd HH mm ss',
	lastImportDate: '',
	dummySetting: '',
	enableDailyNoteCheck: true
}

export default class MarcoModePlugin extends Plugin {
	settings: PluginSettings;

	async onload() {
		console.log('MarcoModePlugin loaded - testing script update');
		await this.loadSettings();
		
		// Wait for Obsidian to be ready, then check for daily note
		setTimeout(() => {
			if (this.settings.enableDailyNoteCheck) {
				this.checkAndImportDailyNote();
			}
		}, 2000);

		this.addCommandAndRibbon('go-to-next-inbox-note', 'Go to next inbox note', 'inbox', () => this.goToNextInboxNote());
		this.addCommandAndRibbon('mark-file-as-read', 'Mark file as read', 'check-square', () => this.markFileAsRead());
		this.addCommandAndRibbon('snooze-file', 'Snooze file', 'clock', () => this.snoozeFile());
		this.addCommandAndRibbon('create-new-inbox-note', 'Create new inbox note', 'plus', () => this.createNewInboxNote());
		this.addCommand({ id: 'import-daily-note', name: 'Import today\'s daily note to inbox', callback: () => this.importDailyNote() });
		this.addCommand({ id: 'append-to-daily-note', name: 'Append inbox note to daily note', callback: () => this.appendToDailyNote() });
		this.addCommand({ id: 'merge-inbox-notes', name: 'Merge inbox notes', callback: () => this.mergeInboxNotes() });

		// Register file menu event for right-click context menu
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
				if (file instanceof TFile && this.isInInbox(file)) {
					menu.addItem((item) => {
						item.setTitle('Append to daily note (from filename)')
							.setIcon('calendar')
							.onClick(() => this.appendToDailyNoteFromFilename(file));
					});
				}
			})
		);

		this.addSettingTab(new SettingTab(this.app, this));
	}

	addCommandAndRibbon(id: string, name: string, icon: string, callback: () => void) {
		this.addCommand({ id, name, callback });
		this.addRibbonIcon(icon, name, callback);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async goToNextInboxNote() {
		const files = this.getInboxFiles().sort((a, b) => a.name.localeCompare(b.name));
		if (!files.length) return new Notice('No files found in inbox folder');

		const active = this.app.workspace.getActiveFile();
		const currentIndex = active && this.isInInbox(active) ? files.findIndex(f => f.path === active.path) : -1;
		const nextFile = files[(currentIndex + 1) % files.length];

		await this.app.workspace.getLeaf().openFile(nextFile);
	}

	getInboxFiles(): TFile[] {
		return this.app.vault.getFiles().filter(file => this.isInInbox(file));
	}

	isInInbox(file: TFile): boolean {
		const folder = file.parent?.path || '';
		return folder === this.settings.inboxFolder || file.path.startsWith(this.settings.inboxFolder + '/');
	}

	async markFileAsRead() {
		const file = this.validateInboxFile();
		if (!file) return;

		if (file.name.startsWith('(READ) ')) return new Notice('File is already marked as read');

		const newName = '(READ) ' + file.name;
		const newPath = file.parent ? `${file.parent.path}/${newName}` : newName;

		try {
			await this.app.vault.rename(file, newPath);
			new Notice('File marked as read');
		} catch (error) {
			new Notice('Failed to rename file: ' + error.message);
		}
	}

	async snoozeFile() {
		const file = this.validateInboxFile();
		if (!file) return;

		const timestamp = this.formatTimestamp(new Date());
		const newName = `${timestamp} (snoozed).${file.extension}`;
		const newPath = file.parent ? `${file.parent.path}/${newName}` : newName;

		try {
			await this.app.vault.rename(file, newPath);
			new Notice(`File snoozed with timestamp: ${timestamp}`);
		} catch (error) {
			new Notice('Failed to snooze file: ' + error.message);
		}
	}

	validateInboxFile(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice('No file is currently open');
			return null;
		}
		if (!this.isInInbox(file)) {
			new Notice('File is not in the inbox folder');
			return null;
		}
		return file;
	}

	formatTimestamp(date: Date): string {
		return moment(date).format(this.settings.timestampFormat);
	}

	async checkAndImportDailyNote() {
		console.log('Checking for daily note content...');
		const hasReminders = await this.todaysDailyNoteHasContent();
		console.log('Has reminders:', hasReminders);
		
		// Only show modal if there are reminders AND we haven't imported today yet
		const todayDate = new Date().toISOString().split('T')[0];
		const alreadyImportedToday = this.settings.lastImportDate === todayDate;
		
		if (hasReminders && !alreadyImportedToday) {
			console.log('Opening modal...');
			new ImportConfirmModal(this.app, () => this.importDailyNote()).open();
		}
	}

	async createNewInboxNote() {
		const timestamp = this.formatTimestamp(new Date());
		const inboxPath = `${this.settings.inboxFolder}/${timestamp}.md`;
		
		try {
			await this.app.vault.create(inboxPath, '');
			await this.app.workspace.getLeaf().openFile(this.app.vault.getAbstractFileByPath(inboxPath) as TFile);
			new Notice(`Created new inbox note: ${timestamp}.md`);
		} catch (error) {
			new Notice('Failed to create inbox note: ' + error.message);
		}
	}

	async appendToDailyNote() {
		const activeFile = this.validateInboxFile();
		if (!activeFile) return;

		new DateSuggestModal(this.app, async (selectedDate: string) => {
			await this.moveInboxNoteToDailyNote(activeFile, selectedDate);
		}).open();
	}

	async appendToDailyNoteFromFilename(file: TFile) {
		const filenameWithoutExt = file.basename;
		const parsedDate = moment(filenameWithoutExt, this.settings.timestampFormat, true);

		if (!parsedDate.isValid()) {
			new Notice(`Could not parse date from filename "${filenameWithoutExt}" using format "${this.settings.timestampFormat}"`);
			return;
		}

		const targetDate = parsedDate.format('YYYY-MM-DD');
		await this.moveInboxNoteToDailyNote(file, targetDate);
	}

	async moveInboxNoteToDailyNote(inboxFile: TFile, targetDate: string) {
		const dailyNotePath = `${this.settings.dailyNotesFolder}/${targetDate}.md`;
		const inboxContent = await this.app.vault.read(inboxFile);
		
		try {
			// Check if daily note exists, create if not
			let dailyNote = this.app.vault.getAbstractFileByPath(dailyNotePath);
			if (!dailyNote) {
				await this.app.vault.create(dailyNotePath, '');
				dailyNote = this.app.vault.getAbstractFileByPath(dailyNotePath);
			}

			if (dailyNote && dailyNote instanceof TFile) {
				const existingContent = await this.app.vault.read(dailyNote);
				const separator = existingContent.trim() ? '\n\n' : '';
				await this.app.vault.modify(dailyNote, existingContent + separator + inboxContent);
				
				// Delete the inbox file
				await this.app.vault.delete(inboxFile);
				new Notice(`Moved inbox note to ${targetDate} daily note`);
			}
		} catch (error) {
			new Notice('Failed to move note: ' + error.message);
		}
	}

	async todaysDailyNoteHasContent(): Promise<boolean> {
		const dateString = new Date().toISOString().split('T')[0];
		const path = `${this.settings.dailyNotesFolder}/${dateString}.md`;
		const file = this.app.vault.getAbstractFileByPath(path);
		
		if (!file || !(file instanceof TFile)) return false;
		
		const content = await this.app.vault.read(file);
		return content.trim().length > 0;
	}

	async importDailyNote() {
		const date = new Date();
		const dateString = date.toISOString().split('T')[0];
		const dailyPath = `${this.settings.dailyNotesFolder}/${dateString}.md`;
		
		const dailyNote = this.app.vault.getAbstractFileByPath(dailyPath);
		if (!dailyNote || !(dailyNote instanceof TFile)) return;

		const content = await this.app.vault.read(dailyNote);
		if (!content.trim()) return;

		const timestamp = this.formatTimestamp(date);
		const inboxPath = `${this.settings.inboxFolder}/${timestamp}.md`;
		
		try {
			await this.app.vault.create(inboxPath, content);
			await this.app.vault.modify(dailyNote, '');
			
			// Mark today as imported
			this.settings.lastImportDate = dateString;
			await this.saveSettings();
			
			new Notice(`Imported daily note reminders from ${dateString} to inbox and cleared daily note`);
		} catch (error) {
			console.error('Failed to import daily note:', error);
		}
	}

	async mergeInboxNotes() {
		const inboxFiles = this.getInboxFiles().sort((a, b) => a.name.localeCompare(b.name));
		if (inboxFiles.length === 0) {
			new Notice('No files found in inbox folder');
			return;
		}

		new MergeNotesModal(this.app, inboxFiles, async (selectedFiles: TFile[], mergedFileName: string) => {
			await this.performMerge(selectedFiles, mergedFileName);
		}).open();
	}

	async performMerge(selectedFiles: TFile[], mergedFileName: string) {
		if (selectedFiles.length < 2) {
			new Notice('Please select at least 2 files to merge');
			return;
		}

		const mergedFilePath = `${this.settings.inboxFolder}/${mergedFileName}.md`;
		
		if (this.app.vault.getAbstractFileByPath(mergedFilePath)) {
			new Notice('A file with that name already exists. Please choose a different name.');
			return;
		}

		try {
			let mergedContent = '';
			
			const sortedFiles = selectedFiles.sort((a, b) => a.name.localeCompare(b.name));
			for (const file of sortedFiles) {
				const content = await this.app.vault.read(file);
				const separator = mergedContent ? '\n\n' : '';
				mergedContent += separator + content;
			}

			await this.app.vault.create(mergedFilePath, mergedContent);
			
			for (const file of selectedFiles) {
				await this.app.vault.delete(file);
			}

			new Notice(`Successfully merged ${selectedFiles.length} files into ${mergedFileName}.md`);
			
			const mergedFile = this.app.vault.getAbstractFileByPath(mergedFilePath) as TFile;
			await this.app.workspace.getLeaf().openFile(mergedFile);
		} catch (error) {
			new Notice('Failed to merge files: ' + error.message);
		}
	}
}

class ImportConfirmModal extends Modal {
	onConfirm: () => void;

	constructor(app: App, onConfirm: () => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Import Daily Note' });
		contentEl.createEl('p', { text: 'Today\'s daily note contains reminders or events. Import to inbox and clear daily note?' });

		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
		
		const importBtn = buttonContainer.createEl('button', { text: 'Import & Clear', cls: 'mod-cta' });
		importBtn.onclick = () => {
			this.close();
			this.onConfirm();
		};

		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.onclick = () => this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class DateSuggestModal extends SuggestModal<string> {
	onDateSelected: (date: string) => void;

	constructor(app: App, onDateSelected: (date: string) => void) {
		super(app);
		this.onDateSelected = onDateSelected;
		this.setPlaceholder('Type a date (today, yesterday, this monday, last friday...)');
	}

	getSuggestions(query: string): string[] {
		const suggestions: string[] = [];
		const lowerQuery = query.toLowerCase();

		// Basic date suggestions
		const basicDates = ['today', 'yesterday', 'tomorrow'];
		basicDates.forEach(date => {
			if (date.includes(lowerQuery)) {
				suggestions.push(date);
			}
		});

		// Day of week suggestions
		const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
		days.forEach(day => {
			if (day.includes(lowerQuery) || lowerQuery.includes(day)) {
				suggestions.push(`this ${day}`);
				suggestions.push(`last ${day}`);
			}
		});

		// If query starts with 'this' or 'last', suggest completions
		if (lowerQuery.startsWith('this ')) {
			const dayPart = lowerQuery.substring(5);
			days.forEach(day => {
				if (day.startsWith(dayPart)) {
					suggestions.push(`this ${day}`);
				}
			});
		}

		if (lowerQuery.startsWith('last ')) {
			const dayPart = lowerQuery.substring(5);
			days.forEach(day => {
				if (day.startsWith(dayPart)) {
					suggestions.push(`last ${day}`);
				}
			});
		}

		// Remove duplicates and limit results
		return [...new Set(suggestions)].slice(0, 10);
	}

	renderSuggestion(value: string, el: HTMLElement) {
		const date = this.parseDateString(value);
		const [year, month, day] = date.split('-').map(Number);

		const displayDate = new Date(year, month - 1, day).toLocaleDateString('en-US', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
		
		console.log('========')
		console.log(value)
		console.log(date)
		console.log(typeof(date))
		console.log('=====')
		el.createEl('div', { text: value });
		el.createEl('small', { text: displayDate, cls: 'suggestion-note' });
	}

	onChooseSuggestion(item: string) {
		const parsedDate = this.parseDateString(item);
		this.onDateSelected(parsedDate);
	}

	parseDateString(input: string): string {
		const today = new Date();
		const text = input.toLowerCase().trim();
		
		// Basic cases
		if (text === 'today') return today.toISOString().split('T')[0];
		if (text === 'yesterday') {
			const yesterday = new Date(today);
			yesterday.setDate(yesterday.getDate() - 1);
			return yesterday.toISOString().split('T')[0];
		}
		if (text === 'tomorrow') {
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);
			return tomorrow.toISOString().split('T')[0];
		}
		
		// Handle "this/last [day]" patterns
		const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
		const thisMatch = text.match(/^this (.+)$/);
		const lastMatch = text.match(/^last (.+)$/);
		
		if (thisMatch) {
			const dayName = thisMatch[1];
			const targetDay = days.indexOf(dayName);
			if (targetDay === -1) return input;
			
			const todayDay = today.getDay();
			const daysAhead = (targetDay - todayDay + 7) % 7;
			const thisDate = new Date(today);
			thisDate.setDate(today.getDate() + daysAhead);
			return thisDate.toISOString().split('T')[0];
		}
		
		if (lastMatch) {
			const dayName = lastMatch[1];
			const targetDay = days.indexOf(dayName);
			if (targetDay === -1) return input;
			
			const todayDay = today.getDay();
			const daysBehind = (todayDay - targetDay + 7) % 7;
			const daysToSubtract = daysBehind === 0 ? 7 : daysBehind;
			const lastDate = new Date(today);
			lastDate.setDate(today.getDate() - daysToSubtract);
			return lastDate.toISOString().split('T')[0];
		}
		
		return input;
	}
}

class MergeNotesModal extends Modal {
	files: TFile[];
	selectedFiles: Set<TFile>;
	onMerge: (selectedFiles: TFile[], mergedFileName: string) => void;
	mergeNameInput: HTMLInputElement;

	constructor(app: App, files: TFile[], onMerge: (selectedFiles: TFile[], mergedFileName: string) => void) {
		super(app);
		this.files = files;
		this.selectedFiles = new Set();
		this.onMerge = onMerge;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Merge Inbox Notes' });
		
		contentEl.createEl('p', { text: 'Select files to merge:' });
		
		const fileContainer = contentEl.createDiv({ cls: 'merge-files-container' });
		fileContainer.style.maxHeight = '300px';
		fileContainer.style.overflowY = 'auto';
		fileContainer.style.border = '1px solid var(--background-modifier-border)';
		fileContainer.style.padding = '10px';
		fileContainer.style.marginBottom = '15px';

		this.files.forEach(file => {
			const fileDiv = fileContainer.createDiv({ cls: 'merge-file-item' });
			fileDiv.style.display = 'flex';
			fileDiv.style.alignItems = 'center';
			fileDiv.style.padding = '5px 0';

			const checkbox = fileDiv.createEl('input', { type: 'checkbox' });
			checkbox.style.marginRight = '10px';
			checkbox.onchange = () => {
				if (checkbox.checked) {
					this.selectedFiles.add(file);
				} else {
					this.selectedFiles.delete(file);
				}
			};

			const label = fileDiv.createEl('label', { text: file.name });
			label.style.cursor = 'pointer';
			label.onclick = () => {
				checkbox.checked = !checkbox.checked;
				if (checkbox.onchange) {
					checkbox.onchange(new Event('change'));
				}
			};
		});


		contentEl.createEl('label', { text: 'Merged file name:' });
		this.mergeNameInput = contentEl.createEl('input', { type: 'text', placeholder: 'Enter filename (without .md extension)' });
		this.mergeNameInput.style.width = '100%';
		this.mergeNameInput.style.marginBottom = '15px';
		this.mergeNameInput.style.padding = '8px';

		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
		
		const mergeBtn = buttonContainer.createEl('button', { text: 'Merge Files', cls: 'mod-cta' });
		mergeBtn.onclick = () => {
			const fileName = this.mergeNameInput.value.trim();
			if (!fileName) {
				new Notice('Please enter a filename for the merged file');
				return;
			}
			
			if (this.selectedFiles.size === 0) {
				new Notice('Please select at least one file to merge');
				return;
			}

			this.close();
			this.onMerge(Array.from(this.selectedFiles), fileName);
		};

		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.onclick = () => this.close();

		this.mergeNameInput.focus();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class SettingTab extends PluginSettingTab {
	plugin: MarcoModePlugin;

	constructor(app: App, plugin: MarcoModePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.containerEl.empty();

		this.addTextSetting('Inbox Folder', 'The folder to use as inbox', 'inboxFolder');
		this.addTextSetting('Daily Notes Folder', 'The folder containing daily notes', 'dailyNotesFolder');
		this.addTextSetting('Timestamp Format', 'Moment.js format string for timestamps (e.g., "ddd HH mm ss" for "Mon 16 33 00")', 'timestampFormat');
		this.addTextSetting('Dummy Setting', 'This setting does nothing', 'dummySetting');

		new Setting(this.containerEl)
			.setName('Enable Daily Note Check')
			.setDesc('Check for daily note content on startup and prompt to import')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableDailyNoteCheck)
				.onChange(async (value) => {
					this.plugin.settings.enableDailyNoteCheck = value;
					await this.plugin.saveSettings();
				}));
	}

	addTextSetting(name: string, desc: string, key: keyof PluginSettings & string) {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText(text => text
				.setValue(this.plugin.settings[key] as string)
				.onChange(async (value) => {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(this.plugin.settings as any)[key] = value;
					await this.plugin.saveSettings();
				}));
	}
}