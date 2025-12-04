import { WebClient } from '@slack/web-api';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

if (!SLACK_BOT_TOKEN) {
    throw new Error('SLACK_BOT_TOKEN is not set in the environment variables.');
}

const webClient = new WebClient(SLACK_BOT_TOKEN);

/**
 * Posts a message to a Slack channel.
 * @param channel The ID of the channel to post to.
 * @param text The message content.
 */

export async function postMessage(channel: string, text: string) {
    try {
        await webClient.chat.postMessage({
            channel: channel,
            text: text,
        });
        console.log(`Message posted to channel ${channel}`);
    } catch (error) {
        console.error(`Error posting message to Slack:`, error);
        throw new Error('Failed to post message to Slack.');
    }
}

/**
 * Sends a direct message to a Slack user, finding them by their email address.
 * @param email The email address of the user to message.
 * @param text The message content.
 */
export async function sendDirectMessageByEmail(email: string, text: string) {
    if (!email) {
        console.warn('Cannot send DM: email address is missing.');
        return;
    }

    try {
        // 1. Look up the user by email to get their Slack ID
        const userResult = await webClient.users.lookupByEmail({ email });
        
        if (!userResult.ok || !userResult.user || !userResult.user.id) {
            console.warn(`Could not find Slack user with email: ${email}`);
            return;
        }
        
        const userId = userResult.user.id;

        // 2. Send the direct message
        await webClient.chat.postMessage({
            channel: userId, // Sending to user ID sends a DM
            text: text,
        });

        console.log(`Successfully sent DM to ${email}`);

    } catch (error) {
        console.error(`Error sending DM to ${email}:`, error);
        throw new Error('Failed to send direct message via Slack.');
    }
}