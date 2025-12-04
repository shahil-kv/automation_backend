
import axios from 'axios';

const JIRA_HOST = process.env.JIRA_HOST;
const JIRA_USER_EMAIL = process.env.JIRA_USER_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

const JIRA_API_URL = `https://${JIRA_HOST}/rest/api/3`;

if (!JIRA_HOST || !JIRA_USER_EMAIL || !JIRA_API_TOKEN) {
    throw new Error('Jira environment variables are not fully set.');
}

export const jiraApiClient = axios.create({
    baseURL: JIRA_API_URL,
    headers: {
        'Authorization': `Basic ${Buffer.from(`${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    },
});

interface JiraTicketDetails {
    summary: string;
    description: string;
    projectKey: string;
    issueType: string; // Added issueType
}

/**
 * Finds the ID of a transition by its name (e.g., "In Progress", "Done").
 */
async function findTransitionIdByName(issueKey: string, transitionName: string): Promise<string> {
    try {
        const response = await jiraApiClient.get(`/issue/${issueKey}/transitions`);
        const transition = response.data.transitions.find((t: any) => t.name.toLowerCase() === transitionName.toLowerCase());

        if (!transition) {
            throw new Error(`Transition '${transitionName}' not found for issue ${issueKey}.`);
        }
        return transition.id;
    } catch (error: any) {
        console.error(`Error finding transitions for ${issueKey}:`, error.response?.data?.errors || error.message);
        throw new Error(`Could not find transition ID for '${transitionName}'.`);
    }
}

/**
 * Transitions a Jira issue to a new status.
 */
export async function updateTicketStatus(issueKey: string, statusName: string) {
    try {
        const transitionId = await findTransitionIdByName(issueKey, statusName);

        await jiraApiClient.post(`/issue/${issueKey}/transitions`, {
            transition: { id: transitionId },
        });
        console.log(`Successfully transitioned Jira ticket ${issueKey} to '${statusName}'.`);
    } catch (error: any) {
        console.error(`Error transitioning Jira ticket ${issueKey}:`, error.response?.data?.errors || error.message);
        throw new Error(`Failed to transition Jira ticket.`);
    }
}

/**
 * Adds a comment to a Jira issue.
 */
export async function addComment(issueKey: string, commentBody: string) {
    try {
        await jiraApiClient.post(`/issue/${issueKey}/comment`, {
            body: {
                type: 'doc',
                version: 1,
                content: [{ type: 'paragraph', content: [{ type: 'text', text: commentBody }] }],
            },
        });
        console.log(`Successfully added comment to ${issueKey}.`);
    } catch (error: any) {
        console.error(`Error adding comment to ${issueKey}:`, error.response?.data?.errors || error.message);
        throw new Error('Failed to add comment to Jira ticket.');
    }
}

/**
 * Creates a new issue in Jira.
 */
export async function createTicket(details: JiraTicketDetails) {
    try {
        console.log(details)
        const response = await jiraApiClient.post('/issue', {
            fields: {
                summary: details.summary,
                description: {
                    type: 'doc',
                    version: 1,
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: details.description }] }],
                },
                project: { key: details.projectKey },
                issuetype: { name: details.issueType }, // Use dynamic issueType
            },
        });
        console.log(`Successfully created Jira ticket: ${response.data.key}`);
        return response.data;
    } catch (error: any) {
        console.log(error)
        console.error('Error creating Jira ticket:', error.response?.data?.errors || error.message);
        throw new Error('Failed to create Jira ticket.');
    }
}

/**
 * Retrieves the assignee details for a specific Jira ticket.
 */
export async function getTicketAssignee(issueKey: string): Promise<{ emailAddress: string, displayName: string } | null> {
    try {
        const response = await jiraApiClient.get(`/issue/${issueKey}?fields=assignee`);
        const assignee = response.data.fields.assignee;

        if (!assignee) {
            console.log(`Ticket ${issueKey} is unassigned.`);
            return null;
        }
        return {
            emailAddress: assignee.emailAddress,
            displayName: assignee.displayName,
        };
    } catch (error: any) {
        console.error(`Error fetching assignee for ${issueKey}:`, error.response?.data?.errors || error.message);
        throw new Error('Failed to fetch ticket assignee from Jira.');
    }
}

/**
 * Retrieves user details from Jira using their account ID.
 */
export async function getUserDetailsById(accountId: string): Promise<{ emailAddress: string, displayName: string } | null> {
    try {
        const response = await jiraApiClient.get(`/user?accountId=${accountId}`);
        const user = response.data;

        if (!user) {
            console.warn(`Could not find Jira user with accountId: ${accountId}`);
            return null;
        }
        return {
            emailAddress: user.emailAddress,
            displayName: user.displayName,
        };
    } catch (error: any) {
        console.error(`Error fetching user details for ${accountId}:`, error.response?.data?.errors || error.message);
        throw new Error('Failed to fetch user details from Jira.');
    }
}

/**
 * Searches for Jira issues using a text query.
 * @param query The text to search for in the issue summary or description.
 * @returns A list of found issues, limited to the top 3 most recently updated.
 */
export async function searchJiraIssues(query: string): Promise<{ key: string, fields: { summary: string } }[]> {
    try {
        // This JQL query searches for the query text in the summary and description,
        // ordering by the most recently updated tickets first.
        const jql = `(summary ~ "${query}" OR description ~ "${query}") ORDER BY updated DESC`;
        
        const response = await jiraApiClient.get('/search', {
            params: {
                jql: jql,
                fields: 'summary', // Only fetch the fields we need
                maxResults: 3, // Limit to the top 3 results to keep it focused
            }
        });

        console.log(`Jira search for "${query}" found ${response.data.issues.length} issues.`);
        return response.data.issues;

    } catch (error: any) {
        console.error(`Error searching Jira issues for query "${query}":`, error.response?.data?.errors || error.message);
        throw new Error('Failed to search for issues in Jira.');
    }
}
