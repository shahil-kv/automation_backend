import { GoogleGenerativeAI, GenerationConfig } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in the environment variables.');
}

// --- SDK Initialization ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
});

const jsonGenerationConfig: GenerationConfig = {
    responseMimeType: "application/json",
    temperature: 0.1,
};


/**
 * Analyzes a Slack message using the Gemini API to extract details for a Jira ticket.
 
  * @param message - The text content of the Slack message.
  * @returns A structured object with summary, description, projectKey, and issueType.
  */
 export async function parseBugReport(message: string): Promise<{ summary: string; description: string; projectKey: string; issueType: string }> {
   const prompt = `
     Analyze the following message from a Slack channel and extract the necessary details to create a Jira ticket.
     The output must be a clean JSON object with no extra text or explanations.
     The JSON object should have four keys: "summary", "description", "projectKey", and "issueType".
 
     - "summary": A concise title for the ticket.
     - "description": A detailed description of the request.
     - "projectKey": The project key. Infer it from the context. If no specific project is mentioned, use "FE" for frontend tasks and "BE" for backend tasks.
     - "issueType": Classify the user's intent. The value for this key MUST be one of the following exact strings: "Epic", "Feature", "Task". If the message describes a bug or small fix, use "Task". If it describes a new capability, use "Feature". If it's a very large, high-level goal, use "Epic".
 
     Here is the message:
     "${message}"
 
     JSON Output:
   `;
 
   try {
     const result = await model.generateContent({
         contents: [{ role: "user", parts: [{ text: prompt }] }],
         generationConfig: jsonGenerationConfig,
     });
     const response = result.response;
     const parsedJson = JSON.parse(response.text());
     
     if (!parsedJson.summary || !parsedJson.description || !parsedJson.projectKey || !parsedJson.issueType) {
         throw new Error('Missing required fields in Gemini response');
     }
     
     return parsedJson;
 

    } catch (error) {
        console.error('Error calling Gemini SDK:', error);
        throw new Error('Failed to analyze message with Gemini SDK.');
    }
}


/**
 * Analyzes a meeting transcript to detect scope changes related to a Jira ticket.
 * @param transcript - The full text of the meeting transcript.
 * @returns An object detailing the detected action, ticket key, reason, and confidence level.
 */
export async function analyzeTranscript(transcript: string): Promise<{
    action: 'pause' | 'delay' | 'cancel' | 'none';
    ticketKey: string | null;
    reason: string | null;
    confidence: 'high' | 'medium' | 'low';
}> {
    const prompt = `
        Analyze the following meeting transcript to determine if a decision was made to change the scope of a project or ticket.
        The output must be a clean JSON object with no extra text or explanations.
        The JSON object should have four keys: "action", "ticketKey", "reason", and "confidence".

        - "action": Can be one of 'pause', 'delay', 'cancel', or 'none'.
        - "ticketKey": The Jira ticket key (e.g., "PROJ-202") if mentioned. If no ticket is mentioned, this should be null.
        - "reason": A brief explanation for the decision, extracted from the text.
        - "confidence": Your confidence in this assessment ('high', 'medium', 'low'). Only return 'high' confidence if the decision is explicit (e.g., "we have decided to pause", "let's cancel this feature").

        Here is the transcript:
        "${transcript}"

        JSON Output:
    `;

    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { ...jsonGenerationConfig, temperature: 0.0 },
        });
        const response = result.response;
        return JSON.parse(response.text());

    } catch (error) {
        console.error('Error calling Gemini SDK for transcript analysis:', error);
        throw new Error('Failed to analyze transcript with Gemini SDK.');
    }
}