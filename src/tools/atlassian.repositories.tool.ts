import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Logger } from '../utils/logger.util.js';
import { formatErrorForMcpTool } from '../utils/error.util.js';
import { truncateForAI } from '../utils/formatter.util.js';
import {
	CloneRepositoryToolArgs,
	type CloneRepositoryToolArgsType,
} from './atlassian.repositories.types.js';

// Import directly from specialized controllers
import { handleCloneRepository } from '../controllers/atlassian.repositories.content.controller.js';

// Create a contextualized logger for this file
const toolLogger = Logger.forContext('tools/atlassian.repositories.tool.ts');

// Log tool initialization
toolLogger.debug('Bitbucket repositories tool initialized');

/**
 * Handler for cloning a repository.
 */
async function handleRepoClone(args: Record<string, unknown>) {
	const methodLogger = Logger.forContext(
		'tools/atlassian.repositories.tool.ts',
		'handleRepoClone',
	);
	try {
		methodLogger.debug('Cloning repository:', args);

		// Pass args directly to controller
		const result = await handleCloneRepository(
			args as CloneRepositoryToolArgsType,
		);

		methodLogger.debug('Successfully cloned repository via controller');

		return {
			content: [
				{
					type: 'text' as const,
					text: truncateForAI(result.content, result.rawResponsePath),
				},
			],
		};
	} catch (error) {
		methodLogger.error('Failed to clone repository', error);
		return formatErrorForMcpTool(error);
	}
}

// Tool description
const BB_CLONE_DESCRIPTION = `Clone a Bitbucket repository to the local filesystem.

Prefers SSH (requires SSH keys configured for bitbucket.org); falls back to HTTPS automatically if SSH fails.
The repository is cloned into \`{targetPath}/{repoSlug}\`.

Use this when you need to inspect file contents locally, run code, or work with the full repository tree.
For reading a single file or a PR diff without cloning, use bb_get with \`/repositories/{workspace}/{repo}/src/{commit}/{path}\` or \`/pullrequests/{id}/diff\` instead — it is faster and cheaper.

**If cloning fails:**
- "Permission denied" → your token lacks \`repository:read\` scope; check ATLASSIAN_API_TOKEN
- "Repository not found" → verify workspace and repoSlug via \`bb_get /repositories/{workspace}\`
- SSH fails, HTTPS tried automatically → if HTTPS also fails, check that ATLASSIAN_USER_EMAIL and ATLASSIAN_API_TOKEN are set correctly`;

/**
 * Register all Bitbucket repository tools with the MCP server.
 * Uses the modern registerTool API (SDK v1.22.0+) instead of deprecated tool() method.
 *
 * Branch creation is now handled by bb_post tool.
 */
function registerTools(server: McpServer) {
	const registerLogger = Logger.forContext(
		'tools/atlassian.repositories.tool.ts',
		'registerTools',
	);
	registerLogger.debug('Registering Repository tools...');

	server.registerTool(
		'bb_clone',
		{
			title: 'Clone Bitbucket Repository',
			description: BB_CLONE_DESCRIPTION,
			inputSchema: CloneRepositoryToolArgs,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		handleRepoClone,
	);

	registerLogger.debug('Successfully registered Repository tools');
}

export default { registerTools };
