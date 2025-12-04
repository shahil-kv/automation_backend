import { Request, Response } from 'express';
import * as crypto from 'crypto';

// AI Service Imports
import { parseBugReport, analyzeTranscript } from '../services/ai.service';

// Jira Service Imports
import {
    createTicket,
    updateTicketStatus,
    addComment,
    getTicketAssignee,
    getUserDetailsById,
    jiraApiClient
} from '../services/jira.service';

// SlackK Service Imports
import { postMessage, sendDirectMessageByEmail } from '../services/slack.service';

// --- Slack Handler ---
export const handleSlackEvent = async (req: Request, res: Response) => {
    const { type, challenge, event } = req.body;

    if (type === 'url_verification') {
        return res.status(200).send(challenge);
    }

    res.status(200).send('OK');

    if (event && event.type === 'message' && !event.bot_id) {
        const text = event.text.toLowerCase();
        if (text.includes('bug') || text.includes('broken')) {
            try {
                const bugDetails = await parseBugReport(event.text);
                // Override the projectKey with the user-provided valid key
                bugDetails.projectKey = "KAN";
                const ticket = await createTicket(bugDetails);
                await postMessage(event.channel, `✅ Bug reported! Jira Ticket Created: *${ticket.key}*\nSummary: ${bugDetails.summary}`);
            } catch (error) {
                console.error("Error processing Slack bug report:", error);
                await postMessage(event.channel, "❌ Failed to create Jira ticket. Please check logs.");
            }
        }
    }
};

// --- GitHub Handler ---
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET!;

export const handleGithubEvent = async (req: Request, res: Response) => {
    console.log('hitted the githubb')
    console.log(req.body)
    const signature = req.headers['x-hub-signature-256'] as string;
    const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
    const digest = 'sha256=' + hmac.update((req as any).rawBody).digest('hex');

    if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
        return res.status(401).send('Invalid signature');
    }

    const eventType = req.headers['x-github-event'];
    const payload = req.body;
    res.status(202).send('Accepted');

    try {
        const jiraKey = extractJiraKey(`${payload.ref || ''} ${payload.pull_request?.head.ref || ''} ${payload.pull_request?.title || ''}`);
        if (!jiraKey) return;

        if (eventType === 'create' && payload.ref_type === 'branch') {
            await updateTicketStatus(jiraKey, 'In Progress');
            await addComment(jiraKey, `Work has started on branch: ${payload.ref}`);
        }

        if (eventType === 'pull_request' && payload.action === 'closed' && payload.pull_request.merged) {
            await updateTicketStatus(jiraKey, 'Done');
            await addComment(jiraKey, `Pull request merged: ${payload.pull_request.html_url}`);

            const supportChannelId = 'C0A1D39J9M3'; // TODO: Move to .env
            const ticketUrl = `https://${process.env.JIRA_HOST}/browse/${jiraKey}`;
            await postMessage(supportChannelId, `✅ Issue <${ticketUrl}|${jiraKey}> has been resolved.`);
        }
    } catch (error) {
        console.error("Error processing GitHub event:", error);
    }
};

function extractJiraKey(text: string): string | null {
    const match = text.match(/([A-Z]{2,}-\d+)/);
    return match ? match[0] : null;
}

// --- Scenario 2: Scope Change (Google Meet) ---
export const handleMeetEvent = async (req: Request, res: Response) => {
    const { transcript } = req.body;
    if (!transcript) return res.status(400).send('Transcript data is missing.');
    res.status(202).send('Accepted');

    try {
        const scopeChange = await analyzeTranscript(transcript);
        if (scopeChange.confidence === 'high' && scopeChange.ticketKey) {
            const comment = `⚠️ **Scope Change Detected in Meeting**\n*Action:* ${scopeChange.action}\n*Reason:* ${scopeChange.reason || 'Not specified.'}`;
            await addComment(scopeChange.ticketKey, comment);

            const assignee = await getTicketAssignee(scopeChange.ticketKey);
            if (assignee && assignee.emailAddress) {
                const ticketUrl = `https://${process.env.JIRA_HOST}/browse/${scopeChange.ticketKey}`;
                const dmText = `A potential scope change was detected for ticket <${ticketUrl}|${scopeChange.ticketKey}> which is assigned to you. A comment has been added.`;
                await sendDirectMessageByEmail(assignee.emailAddress, dmText);
            }
        }
    } catch (error) {
        console.error("Error processing Meet event:", error);
    }
};

// --- Scenario 3: The Unblocker (Jira Comment) ---
const BLOCKING_KEYWORDS = ['blocked by', 'waiting on', 'cant proceed until', 'unblock please'];
const MENTION_REGEX = /[[~]accountid:([a-f0-9\-:]+)]/g;

export const handleJiraEvent = async (req: Request, res: Response) => {
    const event = req.body;
    res.status(200).send('OK');

    if (event.webhookEvent !== 'comment_created') return;

    const commentBody = event.comment.body.toLowerCase();
    const isBlocked = BLOCKING_KEYWORDS.some(keyword => commentBody.includes(keyword));
    const mentions = [...event.comment.body.matchAll(MENTION_REGEX)];

    if (isBlocked && mentions.length > 0) {
        const ticketKey = event.issue.key;
        const ticketStatus = event.issue.fields.status.name;
        const ticketUrl = `https://${process.env.JIRA_HOST}/browse/${ticketKey}`;
        const author = event.comment.author.displayName;

        for (const match of mentions) {
            const accountId = match[1];
            const user = await getUserDetailsById(accountId);
            if (user && user.emailAddress) {
                const dmText = `🚨 **Blocker Alert** 🚨\nYou were mentioned on <${ticketUrl}|${ticketKey}>.\n*Author:* ${author}\n*Comment:* "${event.comment.body.substring(0, 200)}..."`;
                await sendDirectMessageByEmail(user.emailAddress, dmText);

                const FOUR_HOURS_IN_MS = 4 * 60 * 60 * 1000;
                setTimeout(async () => {
                    try {
                        const currentIssue = await jiraApiClient.get(`/issue/${ticketKey}?fields=status`);
                        if (currentIssue.data.fields.status.name === ticketStatus) {
                            const devChannelId = 'C0A1D39J9M3'; // TODO: Move to .env
                            const escalationText = `⚠️ **Blocker Escalation** ⚠️\nTicket <${ticketUrl}|${ticketKey}> is still in status *${ticketStatus}* 4 hours after a blocking comment from *${author}*.`;
                            await postMessage(devChannelId, escalationText);
                        }
                    } catch (e) { console.error('Error during escalation check:', e); }
                }, FOUR_HOURS_IN_MS);
            }
        }
    }
};