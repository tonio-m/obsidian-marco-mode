import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

// Remember to rename these classes and interfaces!
interface MyPluginSettings {
	mySetting: string;
	inboxFolder: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default',
	inboxFolder: '000_inbox'
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		// Command to navigate to next inbox note
		this.addCommand({
			id: 'go-to-next-inbox-note',
			name: 'Go to next inbox note',
			callback: () => {
				this.goToNextInboxNote();
			}
		});
    	this.addRibbonIcon(
    	    'inbox', 
    	    'Go to next inbox note',
    	    (evt: MouseEvent) => {
    	        this.goToNextInboxNote();
    	    }
    	);

		// Command to mark file as read
		this.addCommand({
			id: 'mark-file-as-read',
			name: 'Mark file as read',
			callback: () => {
				this.markFileAsRead();
			}
		});
    	this.addRibbonIcon(
    	    'check-square', 
    	    'Mark file as read',
    	    (evt: MouseEvent) => {
    	        this.markFileAsRead();
    	    }
    	);

		// Command to snooze file
		this.addCommand({
			id: 'snooze-file',
			name: 'Snooze file',
			callback: () => {
				this.snoozeFile();
			}
		});
    	this.addRibbonIcon(
    	    'clock', 
    	    'Snooze file',
    	    (evt: MouseEvent) => {
    	        this.snoozeFile();
    	    }
    	);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async goToNextInboxNote() {
		// Get all files in the inbox folder
		const inboxFiles = this.getInboxFiles();
		if (inboxFiles.length === 0) {
			new Notice('No files found in inbox folder');
			return;
		}

		// Sort files alphabetically by name
		inboxFiles.sort((a, b) => a.name.localeCompare(b.name));

		// Get current active file
		const activeFile = this.app.workspace.getActiveFile();
		let nextFile: TFile;

		if (!activeFile || !this.isFileInInbox(activeFile)) {
			// No file open or current file is not in inbox, open first file
			nextFile = inboxFiles[0];
		} else {
			// Find current file index and get next one
			const currentIndex = inboxFiles.findIndex(file => file.path === activeFile.path);
			const nextIndex = (currentIndex + 1) % inboxFiles.length;
			nextFile = inboxFiles[nextIndex];
		}

		// Open the next file
		await this.app.workspace.getLeaf().openFile(nextFile);
	}

	getInboxFiles(): TFile[] {
		const inboxPath = this.settings.inboxFolder;
		const files = this.app.vault.getFiles();
		return files.filter(file => {
			const folderPath = file.parent?.path || '';
			return folderPath === inboxPath || file.path.startsWith(inboxPath + '/');
		});
	}

	isFileInInbox(file: TFile): boolean {
		const inboxPath = this.settings.inboxFolder;
		const folderPath = file.parent?.path || '';
		return folderPath === inboxPath || file.path.startsWith(inboxPath + '/');
	}

	async markFileAsRead() {
		const activeFile = this.app.workspace.getActiveFile();
		
		if (!activeFile) {
			new Notice('No file is currently open');
			return;
		}

		if (!this.isFileInInbox(activeFile)) {
			new Notice('File is not in the inbox folder');
			return;
		}

		// Check if file is already marked as read
		if (activeFile.name.startsWith('(READ) ')) {
			new Notice('File is already marked as read');
			return;
		}

		// Create new filename with (READ) prefix
		const newName = '(READ) ' + activeFile.name;
		const newPath = activeFile.parent ? activeFile.parent.path + '/' + newName : newName;

		try {
			await this.app.vault.rename(activeFile, newPath);
			new Notice('File marked as read');
		} catch (error) {
			new Notice('Failed to rename file: ' + error.message);
		}
	}

	async snoozeFile() {
		const activeFile = this.app.workspace.getActiveFile();
		
		if (!activeFile) {
			new Notice('No file is currently open');
			return;
		}

		if (!this.isFileInInbox(activeFile)) {
			new Notice('File is not in the inbox folder');
			return;
		}

		// Format current time as "EEE HH mm ss" (e.g., "Tue 09 41 00")
		const now = new Date();
		const timeString = this.formatTimeForSnooze(now);
		
		// Get file extension
		const extension = activeFile.extension;
		const nameWithoutExt = activeFile.basename;
		
		// Create new filename with time prefix
		const newName = `${timeString} (snoozed).${extension}`;
		const newPath = activeFile.parent ? activeFile.parent.path + '/' + newName : newName;

		try {
			await this.app.vault.rename(activeFile, newPath);
			new Notice(`File snoozed with timestamp: ${timeString}`);
		} catch (error) {
			new Notice('Failed to snooze file: ' + error.message);
		}
	}

	// TODO: I think Intl or something has a Datetimeformat like strftime
	formatTimeForSnooze(date: Date): string {
		const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		const dayName = days[date.getDay()];
		
		const hours = date.getHours().toString().padStart(2, '0');
		const minutes = date.getMinutes().toString().padStart(2, '0');
		const seconds = date.getSeconds().toString().padStart(2, '0');
		
		return `${dayName} ${hours} ${minutes} ${seconds}`;
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Inbox Folder')
			.setDesc('The folder to use as inbox')
			.addText(text => text
				.setPlaceholder('Enter inbox folder name')
				.setValue(this.plugin.settings.inboxFolder)
				.onChange(async (value) => {
					this.plugin.settings.inboxFolder = value;
					await this.plugin.saveSettings();
				}));
	}
}
