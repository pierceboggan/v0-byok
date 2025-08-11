import { CancellationToken, LanguageModelChatMessage, LanguageModelChatMessageRole, LanguageModelTextPart, LanguageModelToolCallPart, Progress, ProviderResult, workspace, ConfigurationChangeEvent } from "vscode";
import { ChatResponseFragment2, LanguageModelChatInformation, LanguageModelChatProvider2, LanguageModelChatRequestHandleOptions } from "vscode";
import OpenAI from 'openai';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import { encode } from 'gpt-tokenizer';

function getChatModelInfo(id: string, name: string, maxInputTokens: number, maxOutputTokens: number, supportsTools = true): LanguageModelChatInformation {
	return {
		id,
		name,
		description: `v0.dev model: ${name}`,
		family: "v0dev",
		maxInputTokens,
		maxOutputTokens,
		version: "1.0.0",
		capabilities: {
			toolCalling: supportsTools,
			vision: true, // v0.dev supports multimodal
		}
	};
}

export class V0DevChatModelProvider implements LanguageModelChatProvider2 {
	private client: OpenAI | null = null;
	private lastApiKey: string | null = null;

	constructor() {
		// Listen for configuration changes to refresh the API key
		workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
			if (e.affectsConfiguration('v0dev.apiKey')) {
				console.log('v0.dev: Configuration changed, will refresh client on next request');
				// Reset the client so it gets recreated with new settings
				this.client = null;
				this.lastApiKey = null;
			}
		});
	}

	private ensureClient(): OpenAI | null {
		const apiKey = this.getApiKey();

		// If we have a client and the API key hasn't changed, reuse it
		if (this.client && this.lastApiKey === apiKey && apiKey) {
			return this.client;
		}

		// If no API key, return null
		if (!apiKey) {
			this.client = null;
			this.lastApiKey = null;
			return null;
		}

		// Create new client with current API key
		this.client = new OpenAI({
			apiKey: apiKey,
			baseURL: 'https://api.v0.dev/v1',
		});
		this.lastApiKey = apiKey;

		return this.client;
	}

	private initializeClient() {
		// Keep this method for backward compatibility, but it's now a no-op
		// since we do lazy initialization in ensureClient()
	}

	private getApiKey(): string | null {
		// First try environment variable (recommended approach)
		const envKey = process.env.V0_API_KEY;
		if (envKey) {
			console.log('v0.dev: Using API key from environment variable');
			return envKey;
		}

		// Then try VS Code workspace configuration
		const config = workspace.getConfiguration('v0dev');
		const configKey = config.get<string>('apiKey');
		if (configKey) {
			console.log('v0.dev: Using API key from VS Code settings');
			return configKey;
		}

		console.log('v0.dev: No API key found in environment variables or VS Code settings');
		return null;
	}

	prepareLanguageModelChat(_options: { silent: boolean; }, _token: CancellationToken): ProviderResult<LanguageModelChatInformation[]> {
		return [
			// v0.dev models with appropriate context lengths and capabilities
			getChatModelInfo("v0-1.5-md", "v0 1.5 MD (Everyday tasks and UI generation)", 128000, 64000, true),
			getChatModelInfo("v0-1.5-lg", "v0 1.5 LG (Advanced thinking/reasoning)", 512000, 64000, true),
			getChatModelInfo("v0-1.0-md", "v0 1.0 MD (Legacy model)", 128000, 64000, true),
		];
	}

	async provideLanguageModelChatResponse(
		model: LanguageModelChatInformation,
		messages: Array<LanguageModelChatMessage>,
		options: LanguageModelChatRequestHandleOptions,
		progress: Progress<ChatResponseFragment2>,
		token: CancellationToken
	): Promise<void> {
		// Ensure client is initialized with current API key
		const client = this.ensureClient();

		if (!client) {
			progress.report({
				index: 0,
				part: new LanguageModelTextPart(
					"❌ v0.dev API client not initialized.\n\n" +
					"Please set your API key:\n" +
					"• Set V0_API_KEY environment variable, or\n" +
					"• Configure 'v0dev.apiKey' in VS Code settings\n\n" +
					"Get your API key at: https://v0.dev/chat/settings/keys"
				)
			});
			return;
		}

		try {
			// Convert VS Code messages to OpenAI format
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const openaiMessages: any[] = [];

			for (const msg of messages) {
				// Handle different content types
				if (Array.isArray(msg.content)) {
					// Process array content (can contain text, tool calls, tool results)
					const textParts = msg.content
						.filter(part => part instanceof LanguageModelTextPart)
						.map(part => (part as LanguageModelTextPart).value)
						.join('');

					// Check for tool calls and tool results in the content array
					const toolCalls = msg.content.filter(part => part instanceof LanguageModelToolCallPart);
					const toolResults = msg.content.filter(part =>
						part.constructor.name.includes('ToolResult') ||
						part.constructor.name.includes('ToolCall') ||
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						(part as any).callId !== undefined ||
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						(part as any).result !== undefined
					);

					console.log(`v0.dev: Message ${messages.indexOf(msg)} analysis - Tool calls: ${toolCalls.length}, Tool results: ${toolResults.length}`);

					if (toolCalls.length > 0) {
						// This is an assistant message with tool calls
						console.log(`v0.dev: Found ${toolCalls.length} tool calls in assistant message`);
						openaiMessages.push({
							role: 'assistant',
							content: textParts || '',
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							tool_calls: toolCalls.map((tc: any) => ({
								id: tc.callId,
								type: 'function',
								function: {
									name: tc.name,
									arguments: JSON.stringify(tc.parameters)
								}
							}))
						});
					} else if (toolResults.length > 0) {
						// This should be tool result messages
						console.log(`v0.dev: Found ${toolResults.length} tool results in message`);
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						toolResults.forEach((tr: any) => {
							// Extract the actual result content from VS Code's tool result format
							let content = '';
							if (tr.content && Array.isArray(tr.content)) {
								// VS Code format: content is an array with objects that have 'value' property
								content = tr.content
									// eslint-disable-next-line @typescript-eslint/no-explicit-any
									.filter((item: any) => item.value !== undefined)
									// eslint-disable-next-line @typescript-eslint/no-explicit-any
									.map((item: any) => item.value)
									.join('\n');
							} else if (tr.result) {
								// Fallback: use result property if available
								content = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
							} else {
								// Last resort: stringify the whole object
								content = JSON.stringify(tr);
							}

							console.log(`v0.dev: Extracted tool result content: "${content}"`);

							openaiMessages.push({
								role: 'tool',
								tool_call_id: tr.callId,
								content: content
							});
						});
					} else {
						// Regular text content
						if (textParts.trim().length > 0) {
							openaiMessages.push({
								role: this.convertRole(msg.role),
								content: textParts
							});
						}
					}
				} else {
					// Simple string content
					const content = (msg.content as string) || '';
					if (content.trim().length > 0) {
						openaiMessages.push({
							role: this.convertRole(msg.role),
							content: content
						});
					}
				}
			}

			console.log(`v0.dev: Converted to ${openaiMessages.length} OpenAI messages`);

			if (openaiMessages.length === 0) {
				progress.report({ index: 0, part: new LanguageModelTextPart("Error: No valid messages to process.") });
				return;
			}

			// Prepare the request parameters
			const baseParams: ChatCompletionCreateParamsStreaming = {
				model: model.id,
				messages: openaiMessages,
				stream: true,
				max_tokens: Math.min(options.modelOptions?.maxTokens || 4000, model.maxOutputTokens),
				temperature: Math.max(0, Math.min(2, options.modelOptions?.temperature || 0.7)),
			};

			// Create request params with tools if supported
			let requestParams = baseParams;
			if (model.capabilities?.toolCalling && options.tools && options.tools.length > 0) {
				// Convert VS Code tools to OpenAI format
				console.log(`v0.dev: Converting ${options.tools.length} VS Code tools to OpenAI format`);
				const openaiTools = options.tools.map(tool => {
					const openaiTool = {
						type: "function" as const,
						function: {
							name: tool.name,
							description: tool.description,
							parameters: tool.inputSchema || {
								type: "object",
								properties: {},
								required: []
							}
						}
					};
					console.log(`v0.dev: Converted tool ${tool.name}`);
					return openaiTool;
				});

				requestParams = {
					...baseParams,
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					tools: openaiTools as any,
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					tool_choice: options.toolMode === 2 ? "required" : "auto" as any
				};
				console.log(`v0.dev: Using tool_choice: ${requestParams.tool_choice}`);
			}

			const stream = await client.chat.completions.create(requestParams);

			let chunkCount = 0;
			// Track tool calls being built across multiple chunks
			const toolCallsInProgress: Record<number, { id?: string; name?: string; arguments: string }> = {};

			for await (const chunk of stream) {
				chunkCount++;
				if (token.isCancellationRequested) {
					break;
				}

				const choice = chunk.choices?.[0];
				const delta = choice?.delta;

				// Handle regular text content
				if (delta?.content) {
					progress.report({
						index: 0, // Use same index for all text content parts
						part: new LanguageModelTextPart(delta.content)
					});
				}

				// Handle stream completion
				if (choice?.finish_reason) {
					console.log(`v0.dev: Stream completed with reason: ${choice.finish_reason}`);

					// If it's tool_calls, process any accumulated tool calls
					if (choice.finish_reason === 'tool_calls') {
						console.log(`v0.dev: Processing completed tool calls. Found ${Object.keys(toolCallsInProgress).length} tool calls in progress.`);
						// Process completed tool calls
						for (const [toolIndex, toolCallData] of Object.entries(toolCallsInProgress)) {
							console.log(`v0.dev: Processing tool call ${toolIndex}:`, toolCallData);
							if (toolCallData.id && toolCallData.name && toolCallData.arguments) {
								try {
									const parsedArgs = JSON.parse(toolCallData.arguments);
									console.log(`v0.dev: Reporting tool call ${toolCallData.name} with args:`, parsedArgs);
									progress.report({
										index: parseInt(toolIndex), // Use the actual tool index
										part: new LanguageModelToolCallPart(
											toolCallData.id,
											toolCallData.name,
											parsedArgs
										)
									});
									console.log(`v0.dev: Completed tool call ${toolCallData.name} with ID ${toolCallData.id}`);
								} catch (error) {
									console.error(`v0.dev: Failed to parse tool call arguments: ${error}`);
									console.error(`v0.dev: Raw arguments were: ${toolCallData.arguments}`);
									// Fallback to text representation
									progress.report({
										index: parseInt(toolIndex), // Use the actual tool index for fallbacks too
										part: new LanguageModelTextPart(`[Tool Call: ${toolCallData.name}(${toolCallData.arguments})]`)
									});
								}
							} else {
								console.log(`v0.dev: Incomplete tool call data for ${toolIndex}:`, toolCallData);
								console.log(`v0.dev: Missing - ID: ${!toolCallData.id}, Name: ${!toolCallData.name}, Args: ${!toolCallData.arguments}`);
							}
						}
					}
					break;
				}				// Handle tool calls in streaming responses
				if (delta?.tool_calls) {
					console.log(`v0.dev: Processing ${delta.tool_calls.length} tool calls in chunk ${chunkCount}`);
					for (const toolCall of delta.tool_calls) {
						const toolIndex = toolCall.index || 0;
						console.log(`v0.dev: Tool call ${toolIndex}: ${JSON.stringify(toolCall)}`);

						// Initialize or update tool call tracking
						if (!toolCallsInProgress[toolIndex]) {
							toolCallsInProgress[toolIndex] = { arguments: '' };
						}

						if (toolCall.id) {
							toolCallsInProgress[toolIndex].id = toolCall.id;
							console.log(`v0.dev: Set tool call ID: ${toolCall.id}`);
						}

						if (toolCall.function?.name) {
							toolCallsInProgress[toolIndex].name = toolCall.function.name;
							console.log(`v0.dev: Set tool call name: ${toolCall.function.name}`);
						}

						if (toolCall.function?.arguments) {
							toolCallsInProgress[toolIndex].arguments += toolCall.function.arguments;
						}
					}
				}
			}

			console.log(`v0.dev: Stream completed. Processed ${chunkCount} chunks.`);
		} catch (error) {
			// Log the full error details for debugging
			console.error('v0.dev: Full error details:', error);
			console.error('v0.dev: Error type:', typeof error);
			console.error('v0.dev: Error constructor:', error?.constructor?.name);

			let errorMessage = 'Unknown error occurred';
			let debugInfo = '';

			if (error instanceof Error) {
				console.error('v0.dev: Error message:', error.message);
				console.error('v0.dev: Error stack:', error.stack);
				errorMessage = error.message;
				debugInfo = `\n\nDebug info:\n- Error type: ${error.constructor.name}\n- Message: ${error.message}`;

				// Check for specific error properties (OpenAI SDK specific)
				if ('status' in error) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					console.error('v0.dev: HTTP status:', (error as any).status);
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					debugInfo += `\n- HTTP Status: ${(error as any).status}`;
				}

				if ('code' in error) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					console.error('v0.dev: Error code:', (error as any).code);
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					debugInfo += `\n- Error Code: ${(error as any).code}`;
				}

				if ('type' in error) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					console.error('v0.dev: Error type:', (error as any).type);
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					debugInfo += `\n- Type: ${(error as any).type}`;
				}

				// Provide more helpful error messages for common issues
				if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
					errorMessage = "❌ Invalid API key. Please check your v0.dev API key and try again.\n\nGet your API key at: https://v0.dev/chat/settings/keys";
				} else if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
					errorMessage = "❌ Access denied. Please check your API key permissions or account status.";
				} else if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
					errorMessage = "❌ Rate limit exceeded. Please wait a moment and try again.";
				} else if (errorMessage.includes('500') || errorMessage.includes('Internal Server Error')) {
					errorMessage = "❌ v0.dev service error. Please try again later.";
				} else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
					errorMessage = "❌ Network error. Please check your internet connection and try again.";
				}
			} else {
				// Non-Error objects
				console.error('v0.dev: Non-Error object:', JSON.stringify(error, null, 2));
				debugInfo = `\n\nDebug info:\n- Non-Error object: ${JSON.stringify(error)}`;
			}

			progress.report({
				index: 0,
				part: new LanguageModelTextPart(`Error calling v0.dev API: ${errorMessage}${debugInfo}`)
			});
		}
	}

	private convertRole(role: LanguageModelChatMessageRole): 'user' | 'assistant' | 'system' {
		// Map VS Code role enum to OpenAI role strings
		switch (role) {
			case LanguageModelChatMessageRole.User:
				return 'user';
			case LanguageModelChatMessageRole.Assistant:
				return 'assistant';
			default:
				return 'user';
		}
	}

	async provideTokenCount(model: LanguageModelChatInformation, text: string | LanguageModelChatMessage, _token: CancellationToken): Promise<number> {
		try {
			let content: string;
			if (typeof text === 'string') {
				content = text;
			} else {
				content = Array.isArray(text.content)
					? text.content.map(part => part instanceof LanguageModelTextPart ? part.value : '').join('')
					: text.content;
			}

			// Use gpt-tokenizer for more accurate token counting
			// Note: This gives an approximation since Fireworks models may use different tokenizers
			const tokens = encode(content);
			return tokens.length;
		} catch {
			// Fallback to simple estimation if tokenizer fails
			let content: string;
			if (typeof text === 'string') {
				content = text;
			} else {
				content = Array.isArray(text.content)
					? text.content.map(part => part instanceof LanguageModelTextPart ? part.value : '').join('')
					: text.content;
			}
			return Math.ceil(content.length / 4);
		}
	}
}