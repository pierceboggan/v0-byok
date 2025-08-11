import * as vscode from 'vscode';
import { V0DevChatModelProvider } from './provider';

export function activate(_: vscode.ExtensionContext) {
	vscode.lm.registerChatModelProvider('v0dev', new V0DevChatModelProvider());
}

export function deactivate() { }
