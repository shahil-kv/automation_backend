
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Import your controllers
import { handleSlackEvent, handleGithubEvent, handleJiraEvent, handleMeetEvent } from './controllers/webhook.controller';
import { getSystemStatus } from './controllers/config.controller';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Use express.json() for all routes, including webhooks.
// GitHub and Slack webhooks work best with this.
app.use(express.json({
    verify: (req, res, buf) => {
        // Save the raw body buffer for signature verification in the controller
        // This is crucial for security
        (req as any).rawBody = buf;
    }
}));


// --- Webhook and API Routes ---
app.post('/webhooks/slack', handleSlackEvent);
app.post('/webhooks/github', handleGithubEvent);
app.post('/webhooks/jira', handleJiraEvent);
app.post('/webhooks/meet', handleMeetEvent);

app.get('/api/status', getSystemStatus);

// Health Check
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(`⚡️ Server is running on port ${PORT}`);
});
