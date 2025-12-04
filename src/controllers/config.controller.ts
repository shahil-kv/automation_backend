import { Request, Response } from 'express';
import prisma from '../db';

export const getSystemStatus = async (req: Request, res: Response) => {
    const status = {
        slack: !!process.env.SLACK_BOT_TOKEN,
        jira: !!process.env.JIRA_API_TOKEN,
        github: !!process.env.GITHUB_WEBHOOK_SECRET,
        openai: !!process.env.OPENAI_API_KEY,
        database: false
    };

    try {
        await prisma.$connect();
        status.database = true;
    } catch (error) {
        console.error("DB Connection Check Failed:", error);
        status.database = false;
    }

    res.json(status);
};
