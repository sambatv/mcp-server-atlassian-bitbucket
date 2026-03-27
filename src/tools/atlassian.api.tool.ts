import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Logger } from '../utils/logger.util.js';
import { formatErrorForMcpTool } from '../utils/error.util.js';
import { truncateForAI } from '../utils/formatter.util.js';
import {
	GetApiToolArgs,
	type GetApiToolArgsType,
	RequestWithBodyArgs,
	type RequestWithBodyArgsType,
	DeleteApiToolArgs,
} from './atlassian.api.types.js';
import {
	handleGet,
	handlePost,
	handlePut,
	handlePatch,
	handleDelete,
} from '../controllers/atlassian.api.controller.js';

// Create a contextualized logger for this file
const toolLogger = Logger.forContext('tools/atlassian.api.tool.ts');

// Log tool initialization
toolLogger.debug('Bitbucket API tool initialized');

/**
 * Creates an MCP tool handler for GET/DELETE requests (no body)
 *
 * @param methodName - Name of the HTTP method for logging
 * @param handler - Controller handler function
 * @returns MCP tool handler function
 */
function createReadHandler(
	methodName: string,
	handler: (
		options: GetApiToolArgsType,
	) => Promise<{ content: string; rawResponsePath?: string | null }>,
) {
	return async (args: Record<string, unknown>) => {
		const methodLogger = Logger.forContext(
			'tools/atlassian.api.tool.ts',
			methodName.toLowerCase(),
		);
		methodLogger.debug(`Making ${methodName} request with args:`, args);

		try {
			const result = await handler(args as GetApiToolArgsType);

			methodLogger.debug(
				'Successfully retrieved response from controller',
			);

			return {
				content: [
					{
						type: 'text' as const,
						text: truncateForAI(
							result.content,
							result.rawResponsePath,
						),
					},
				],
			};
		} catch (error) {
			methodLogger.error(`Failed to make ${methodName} request`, error);
			return formatErrorForMcpTool(error);
		}
	};
}

/**
 * Creates an MCP tool handler for POST/PUT/PATCH requests (with body)
 *
 * @param methodName - Name of the HTTP method for logging
 * @param handler - Controller handler function
 * @returns MCP tool handler function
 */
function createWriteHandler(
	methodName: string,
	handler: (
		options: RequestWithBodyArgsType,
	) => Promise<{ content: string; rawResponsePath?: string | null }>,
) {
	return async (args: Record<string, unknown>) => {
		const methodLogger = Logger.forContext(
			'tools/atlassian.api.tool.ts',
			methodName.toLowerCase(),
		);
		methodLogger.debug(`Making ${methodName} request with args:`, {
			path: args.path,
			bodyKeys: args.body ? Object.keys(args.body as object) : [],
		});

		try {
			const result = await handler(args as RequestWithBodyArgsType);

			methodLogger.debug(
				'Successfully received response from controller',
			);

			return {
				content: [
					{
						type: 'text' as const,
						text: truncateForAI(
							result.content,
							result.rawResponsePath,
						),
					},
				],
			};
		} catch (error) {
			methodLogger.error(`Failed to make ${methodName} request`, error);
			return formatErrorForMcpTool(error);
		}
	};
}

// Create tool handlers
const get = createReadHandler('GET', handleGet);
const post = createWriteHandler('POST', handlePost);
const put = createWriteHandler('PUT', handlePut);
const patch = createWriteHandler('PATCH', handlePatch);
const del = createReadHandler('DELETE', handleDelete);

// Tool descriptions
const BB_GET_DESCRIPTION = `Fetch data from any Bitbucket Cloud REST API v2.0 endpoint (read-only).

Use for ALL read operations: listing repos, fetching PRs, reading comments, browsing commits, checking CI statuses, inspecting branches, reading file contents, etc.
Do NOT use to create, update, or delete resources — use bb_post, bb_put, bb_patch, or bb_delete for those.

**Common paths:**
- \`/workspaces\` - list workspaces
- \`/repositories/{workspace}\` - list repos in workspace
- \`/repositories/{workspace}/{repo}\` - get repo details
- \`/repositories/{workspace}/{repo}/pullrequests\` - list PRs (?state=OPEN|MERGED|DECLINED)
- \`/repositories/{workspace}/{repo}/pullrequests/{id}\` - get PR details
- \`/repositories/{workspace}/{repo}/pullrequests/{id}/comments\` - list PR comments
- \`/repositories/{workspace}/{repo}/pullrequests/{id}/diff\` - unified diff
- \`/repositories/{workspace}/{repo}/pullrequests/{id}/diffstat\` - files changed summary (cheaper than full diff)
- \`/repositories/{workspace}/{repo}/pullrequests/{id}/statuses\` - CI build statuses
- \`/repositories/{workspace}/{repo}/refs/branches\` - list branches
- \`/repositories/{workspace}/{repo}/commits\` - list commits
- \`/repositories/{workspace}/{repo}/src/{commit}/{filepath}\` - read a single file
- \`/repositories/{workspace}/{repo}/diff/{source}..{destination}\` - compare branches/commits
- \`/user\` - current authenticated user (useful for getting your own account_id)

**Query params:** \`pagelen\` (page size), \`page\` (page number), \`q\` (filter), \`sort\` (order), \`fields\` (sparse response)

**Pagination:** Responses include \`size\` (total count) and \`next\` (URL present when more pages exist). Increment \`page\` to navigate forward.

**Example filters (q param):** \`state="OPEN"\`, \`source.branch.name="feature"\`, \`title~"bug"\`, \`author.display_name~"Franco"\`

**Cost optimization:**
- ALWAYS use \`jq\` to filter fields — unfiltered responses are expensive
- Use \`pagelen\` to limit result count (e.g., \`pagelen: "5"\`)
- For large diffs, use \`/diffstat\` first to understand scope before fetching the full \`/diff\`
- Schema discovery: fetch ONE item with \`pagelen: "1"\` and no jq to explore fields, then filter in subsequent calls

**JQ examples:** \`values[*].slug\`, \`values[0]\`, \`values[*].{name: name, uuid: uuid}\`

**Output format:** TOON (default, token-efficient) or JSON (\`outputFormat: "json"\`)

The \`/2.0\` prefix is added automatically. API reference: https://developer.atlassian.com/cloud/bitbucket/rest/`;

const BB_POST_DESCRIPTION = `Create a new resource or trigger an action in Bitbucket Cloud (HTTP POST).

Use for: opening PRs, posting comments, approving PRs, merging, declining, requesting changes, creating webhooks, creating branch restrictions.
Do NOT use to update existing resources — use bb_put (full replace) or bb_patch (partial update) instead.

**Common operations:**

1. **Create PR:** \`/repositories/{workspace}/{repo}/pullrequests\`
   body: \`{"title": "...", "source": {"branch": {"name": "feature"}}, "destination": {"branch": {"name": "main"}}}\`
   Optional: \`"description"\`, \`"reviewers": [{"uuid": "..."}]\`, \`"draft": true\`

2. **Add PR comment:** \`/repositories/{workspace}/{repo}/pullrequests/{id}/comments\`
   body: \`{"content": {"raw": "Comment text"}}\`
   For inline code comments add: \`"inline": {"path": "src/file.py", "to": 42}\`

3. **Approve PR:** \`/repositories/{workspace}/{repo}/pullrequests/{id}/approve\`
   body: \`{}\`

4. **Request changes:** \`/repositories/{workspace}/{repo}/pullrequests/{id}/request-changes\`
   body: \`{}\`

5. **Decline PR:** \`/repositories/{workspace}/{repo}/pullrequests/{id}/decline\`
   body: \`{}\` (closes without merging — use POST, not DELETE)

6. **Merge PR:** \`/repositories/{workspace}/{repo}/pullrequests/{id}/merge\`
   body: \`{"merge_strategy": "squash"}\` (strategies: merge_commit, squash, fast_forward)

**Response:** Contains the created resource including its ID — use that ID in subsequent bb_get, bb_patch, or bb_put calls.

**Cost optimization:** Use \`jq\` to extract only needed fields (e.g., \`jq: "{id: id, title: title}"\`)

**Output format:** TOON (default) or JSON (\`outputFormat: "json"\`)

The \`/2.0\` prefix is added automatically. API reference: https://developer.atlassian.com/cloud/bitbucket/rest/`;

const BB_PUT_DESCRIPTION = `Fully replace a Bitbucket resource (HTTP PUT — all required fields must be sent).

Use when replacing a resource wholesale. If you only need to change one or two fields, use bb_patch instead — it is safer and avoids accidentally blanking fields you did not intend to change.
Always use bb_get to fetch the current state first so you can include all required fields in the body.

**Common operations:**

1. **Update PR (full replace):** \`/repositories/{workspace}/{repo}/pullrequests/{id}\`
   body must include all required fields: \`{"title": "...", "source": {"branch": {"name": "..."}}, "destination": {"branch": {"name": "..."}}}\`

2. **Update repository settings:** \`/repositories/{workspace}/{repo}\`
   body: \`{"description": "...", "is_private": true, "has_issues": true}\`

3. **Update branch restriction:** \`/repositories/{workspace}/{repo}/branch-restrictions/{id}\`
   body: \`{"kind": "push", "pattern": "main", "users": [{"uuid": "..."}]}\`

**Cost optimization:** Use \`jq\` to extract only needed fields from the response.

**Output format:** TOON (default) or JSON (\`outputFormat: "json"\`)

The \`/2.0\` prefix is added automatically. API reference: https://developer.atlassian.com/cloud/bitbucket/rest/`;

const BB_PATCH_DESCRIPTION = `Partially update a Bitbucket resource (HTTP PATCH — send only the fields you want to change).

Prefer this over bb_put whenever you only need to update specific fields. You do not need to fetch the full resource first — just send the fields you want to change.
Do NOT use bb_put when bb_patch is sufficient.

**Common operations:**

1. **Update PR title or description:** \`/repositories/{workspace}/{repo}/pullrequests/{id}\`
   body: \`{"title": "New title"}\` or \`{"description": "Updated description"}\`

2. **Update PR reviewers:** \`/repositories/{workspace}/{repo}/pullrequests/{id}\`
   body: \`{"reviewers": [{"uuid": "{user-uuid}"}]}\`

3. **Update repository description:** \`/repositories/{workspace}/{repo}\`
   body: \`{"description": "New description"}\`

4. **Update a comment:** \`/repositories/{workspace}/{repo}/pullrequests/{pr_id}/comments/{comment_id}\`
   body: \`{"content": {"raw": "Updated comment text"}}\`

**Cost optimization:** Use \`jq\` to extract only needed fields from the response.

**Output format:** TOON (default) or JSON (\`outputFormat: "json"\`)

The \`/2.0\` prefix is added automatically. API reference: https://developer.atlassian.com/cloud/bitbucket/rest/`;

const BB_DELETE_DESCRIPTION = `Remove a resource from Bitbucket Cloud (HTTP DELETE).

Use for: removing your PR approval, deleting a comment, deleting a branch, removing a branch restriction, deleting a webhook, or deleting a repository.
WARNING: Most deletions are irreversible. Always confirm the exact resource ID with bb_get before deleting.

Do NOT use to decline a PR — that is a POST to \`/pullrequests/{id}/decline\`, not a DELETE.

**Common operations:**

1. **Remove PR approval:** \`/repositories/{workspace}/{repo}/pullrequests/{id}/approve\`
   (removes your approval — use bb_post to the same path to re-approve)

2. **Delete PR comment:** \`/repositories/{workspace}/{repo}/pullrequests/{pr_id}/comments/{comment_id}\`

3. **Delete branch:** \`/repositories/{workspace}/{repo}/refs/branches/{branch_name}\`

4. **Delete webhook:** \`/repositories/{workspace}/{repo}/hooks/{uid}\`

5. **Delete repository:** \`/repositories/{workspace}/{repo}\`
   IRREVERSIBLE — confirm workspace and repo with bb_get first

**Response:** Returns 204 No Content on success (no body).

**Output format:** TOON (default) or JSON (\`outputFormat: "json"\`)

The \`/2.0\` prefix is added automatically. API reference: https://developer.atlassian.com/cloud/bitbucket/rest/`;

/**
 * Register generic Bitbucket API tools with the MCP server.
 * Uses the modern registerTool API (SDK v1.22.0+) instead of deprecated tool() method.
 */
function registerTools(server: McpServer) {
	const registerLogger = Logger.forContext(
		'tools/atlassian.api.tool.ts',
		'registerTools',
	);
	registerLogger.debug('Registering API tools...');

	server.registerTool(
		'bb_get',
		{
			title: 'Bitbucket GET Request',
			description: BB_GET_DESCRIPTION,
			inputSchema: GetApiToolArgs,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		get,
	);

	server.registerTool(
		'bb_post',
		{
			title: 'Bitbucket POST Request',
			description: BB_POST_DESCRIPTION,
			inputSchema: RequestWithBodyArgs,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		post,
	);

	server.registerTool(
		'bb_put',
		{
			title: 'Bitbucket PUT Request',
			description: BB_PUT_DESCRIPTION,
			inputSchema: RequestWithBodyArgs,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		put,
	);

	server.registerTool(
		'bb_patch',
		{
			title: 'Bitbucket PATCH Request',
			description: BB_PATCH_DESCRIPTION,
			inputSchema: RequestWithBodyArgs,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		patch,
	);

	server.registerTool(
		'bb_delete',
		{
			title: 'Bitbucket DELETE Request',
			description: BB_DELETE_DESCRIPTION,
			inputSchema: DeleteApiToolArgs,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		del,
	);

	registerLogger.debug('Successfully registered API tools');
}

export default { registerTools };
