import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

interface PluginSettings {
	inboxFolder: string;
	dailyNotesFolder: string;
}

const DEFAULT_SETTINGS: PluginSettings = {
	inboxFolder: '000_inbox',
	dailyNotesFolder: '001_journal'
}

export default class MarcoModePlugin extends Plugin {
	settings: PluginSettings;

	async onload() {
		console.log('MarcoModePlugin loaded - testing script update');
		await this.loadSettings();
		
		// Wait for Obsidian to be ready, then check for daily note
		setTimeout(() => {
			this.checkAndImportDailyNote();
		}, 2000);

		this.addCommandAndRibbon('go-to-next-inbox-note', 'Go to next inbox note', 'inbox', () => this.goToNextInboxNote());
		this.addCommandAndRibbon('mark-file-as-read', 'Mark file as read', 'check-square', () => this.markFileAsRead());
		this.addCommandAndRibbon('snooze-file', 'Snooze file', 'clock', () => this.snoozeFile());
		this.addCommandAndRibbon('create-new-inbox-note', 'Create new inbox note', 'plus', () => this.createNewInboxNote());
		this.addCommand({ id: 'import-daily-note', name: 'Import today\'s daily note to inbox', callback: () => this.importDailyNote() });

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
		const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		const day = days[date.getDay()];
		const hours = date.getHours().toString().padStart(2, '0');
		const minutes = date.getMinutes().toString().padStart(2, '0');
		const seconds = date.getSeconds().toString().padStart(2, '0');
		return `${day} ${hours} ${minutes} ${seconds}`;
	}

	async checkAndImportDailyNote() {
		console.log('Checking for daily note content...');
		const hasReminders = await this.todaysDailyNoteHasContent();
		console.log('Has reminders:', hasReminders);
		if (hasReminders) {
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
			new Notice(`Imported daily note reminders from ${dateString} to inbox and cleared daily note`);
		} catch (error) {
			console.error('Failed to import daily note:', error);
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
	}

	addTextSetting(name: string, desc: string, key: keyof PluginSettings) {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText(text => text
				.setValue(this.plugin.settings[key])
				.onChange(async (value) => {
					this.plugin.settings[key] = value;
					await this.plugin.saveSettings();
				}));
	}
}