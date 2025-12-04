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
    jiraApiClient,
    searchJiraIssues
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

// --- Scenario 2: The Intelligent Meeting Assistant ---
export const handleMeetEvent = async (req: Request, res: Response) => {
    const { transcript } = req.body;
    if (!transcript) return res.status(400).send('Transcript data is missing.');
    res.status(202).send('Accepted');

    try {
        const analysis = await analyzeTranscript(transcript);
        console.log('AI analysis complete. Intent:', analysis.intent);

        // A default channel to post updates to, since meetings don't have a source channel.
        const updateChannelId = 'C0A1D39J9M3'; // TODO: Move to .env

        if (analysis.confidence !== 'high') {
            console.log('AI confidence is not high. No action will be taken.');
            return;
        }

        switch (analysis.intent) {
            case 'CREATE_ISSUE':
                if (analysis.details.summary && analysis.details.description && analysis.details.issueType) {
                    const newTicketDetails = {
                        projectKey: 'KAN', // Use the default project for new tickets from meetings
                        summary: analysis.details.summary,
                        description: analysis.details.description,
                        issueType: analysis.details.issueType,
                    };
                    const ticket = await createTicket(newTicketDetails);
                    const ticketUrl = `https://${process.env.JIRA_HOST}/browse/${ticket.key}`;
                    await postMessage(updateChannelId, `✅ As discussed in the meeting, a new ticket was created: <${ticketUrl}|${ticket.key}> - ${ticket.fields.summary}`);
                }
                break;

            case 'ADD_COMMENT':
                if (analysis.details.searchQuery && analysis.details.comment) {
                    const issues = await searchJiraIssues(analysis.details.searchQuery);
                    if (issues && issues.length > 0) {
                        const mostRelevantIssue = issues[0]; // The search is ordered by recently updated
                        await addComment(mostRelevantIssue.key, `**Meeting Note:**\n${analysis.details.comment}`);
                        const ticketUrl = `https://${process.env.JIRA_HOST}/browse/${mostRelevantIssue.key}`;
                        await postMessage(updateChannelId, `✅ A meeting note was added to <${ticketUrl}|${mostRelevantIssue.key}>: "${analysis.details.comment.substring(0, 50)}..."`);
                    } else {
                        console.log(`AI intent was ADD_COMMENT, but no issues were found for query: "${analysis.details.searchQuery}"`);
                    }
                }
                break;

            case 'PAUSE_ISSUE':
                if (analysis.details.ticketKey && analysis.details.reason) {
                    const comment = `⚠️ **Decision from Meeting:**\nThis issue has been put on hold.\n*Reason:* ${analysis.details.reason}`;
                    await addComment(analysis.details.ticketKey, comment);

                    // Notify the assignee
                    const assignee = await getTicketAssignee(analysis.details.ticketKey);
                    if (assignee && assignee.emailAddress) {
                        const ticketUrl = `https://${process.env.JIRA_HOST}/browse/${analysis.details.ticketKey}`;
                        const dmText = `A decision was made in a recent meeting to pause ticket <${ticketUrl}|${analysis.details.ticketKey}>, which is assigned to you. A comment has been added with details.`;
                        await sendDirectMessageByEmail(assignee.emailAddress, dmText);
                    }
                }
                break;

            case 'NONE':
                console.log('AI detected no actionable intent in the transcript.');
                break;
        }
    } catch (error) {
        console.error("Error processing Meet event:", error);
    }
};

// --- Scenario 3: The Unblocker (Jira Comment) ---
const BLOCKING_KEYWORDS = ['blocked by', 'waiting on', 'cant proceed until', 'unblock please'];
const MENTION_REGEX = /[[~]accountid:([a-f0-9\-:]+)]/g;

export const handleJiraEvent = async (req: Request, res: Response) => {
    console.log('--- Jira Webhook Event Received ---');
    const event = req.body;
    res.status(200).send('OK');

    // Diagnostic Log 1: What event are we receiving?
    console.log(`Event Type: ${event.webhookEvent}`);

    if (event.webhookEvent !== 'comment_created') {
        console.log('Event is not "comment_created". Exiting.');
        return;
    }

    const commentBody = event.comment.body;
    console.log(`Comment Body: "${commentBody}"`);

    const isBlocked = BLOCKING_KEYWORDS.some(keyword => commentBody.toLowerCase().includes(keyword));
    const mentions = [...commentBody.matchAll(MENTION_REGEX)];

    // Diagnostic Log 2: Are the conditions being met?
    console.log(`Keyword match ('isBlocked'): ${isBlocked}`);
    console.log(`Mention match count ('mentions.length'): ${mentions.length}`);



    if (isBlocked && mentions.length > 0) {

        console.log('Conditions MET. Proceeding with automation...');

        const ticketKey = event.issue.key;

        const ticketStatus = event.issue.fields.status.name;

        const ticketUrl = `https://${process.env.JIRA_HOST}/browse/${ticketKey}`;

        const author = event.comment.author.displayName;



        for (const match of mentions) {

            const accountId = match[1];

            console.log(`Found mention with accountId: "${accountId}". Fetching user details...`);



            try {

                const user = await getUserDetailsById(accountId);

                console.log('Jira user details response:', user);



                if (user && user.emailAddress) {

                    console.log(`User email found: ${user.emailAddress}. Sending DM...`);

                    const dmText = `🚨 **Blocker Alert** 🚨\nYou were mentioned on <${ticketUrl}|${ticketKey}>.\n*Author:* ${author}\n*Comment:* "${event.comment.body.substring(0, 200)}..."`;

                    await sendDirectMessageByEmail(user.emailAddress, dmText);



                    const FOUR_HOURS_IN_MS = 4 * 60 * 60 * 1000;

                    setTimeout(async () => {

                        try {

                            const currentIssue = await jiraApiClient.get(`/issue/${ticketKey}?fields=status`);

                            if (currentIssue.data.fields.status.name === ticketStatus) {

                                const devChannelId = 'C07M6QXL71Q'; // TODO: Move to .env

                                const escalationText = `⚠️ **Blocker Escalation** ⚠️\nTicket <${ticketUrl}|${ticketKey}> is still in status *${ticketStatus}* 4 hours after a blocking comment from *${author}*.`;

                                await postMessage(devChannelId, escalationText);

                            }

                        } catch (e) { console.error('Error during escalation check:', e); }

                    }, FOUR_HOURS_IN_MS);

                } else {

                    console.log(`Could not find a valid user or email address for accountId: ${accountId}. Skipping DM.`);

                }

            } catch (error) {

                console.error(`Error during automation for accountId ${accountId}:`, error);

            }

        }

    } else {

        console.log('Conditions NOT MET. Exiting.');

    }

};

