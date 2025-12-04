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


 * Analyzes a meeting transcript to detect various intents (create, comment, pause) related to Jira tickets.


 * @param transcript - The full text of the meeting transcript.


 * @returns A structured object detailing the AI's determined intent and associated details.


 */


export async function analyzeTranscript(transcript: string): Promise<{


    intent: 'CREATE_ISSUE' | 'ADD_COMMENT' | 'PAUSE_ISSUE' | 'NONE';


    details: {


        // For CREATE_ISSUE intent


        summary?: string;


        description?: string;


        issueType?: 'Epic' | 'Feature' | 'Task'; // From user's valid issue types





        // For ADD_COMMENT intent


        searchQuery?: string; // To find an existing issue


        comment?: string;





        // For PAUSE_ISSUE intent


        ticketKey?: string; // If mentioned explicitly


        reason?: string;


    };


    confidence: 'high' | 'medium' | 'low';


}> {


    const prompt = `


        Analyze the following meeting transcript to determine the primary intent regarding Jira tickets.


        The output must be a clean JSON object with no extra text or explanations.


        The JSON object should have an "intent", "details", and "confidence" key.





        "intent": Determines the main action.


            - "CREATE_ISSUE": If the discussion is clearly about a NEW feature, task, or epic that needs a new ticket.


            - "ADD_COMMENT": If the discussion is about an EXISTING feature/task (even without a ticket ID) and a note needs to be added to it.


            - "PAUSE_ISSUE": If the discussion explicitly indicates pausing, delaying, or canceling an EXISTING, identified (by ID) feature/task.


            - "NONE": If no clear Jira-related action is implied.





        "details": An object containing context-specific information based on the "intent".





        "confidence": Your confidence in this assessment ('high', 'medium', 'low').





        ---


        Guidance for "intent" and "details":





        If "intent" is "CREATE_ISSUE":


            "details" must contain:


            - "summary": A concise title for the new ticket.


            - "description": A detailed description of the new request.


            - "issueType": Choose from "Epic", "Feature", "Task". (Use "Feature" for new capabilities, "Task" for small fixes/updates, "Epic" for large goals).





        If "intent" is "ADD_COMMENT":


            "details" must contain:


            - "searchQuery": A short phrase to search for the relevant existing Jira ticket (e.g., "dark mode feature", "login bug").


            - "comment": The full comment text to add to the found ticket, summarizing the discussion.





        If "intent" is "PAUSE_ISSUE":


            "details" must contain:


            - "ticketKey": The exact Jira ticket key (e.g., "KAN-123"). If a key is not explicitly mentioned, assume "ADD_COMMENT" intent instead.


            - "reason": A brief explanation for pausing/delaying.





        ---


        Here is the transcript:


        "${transcript}"





        JSON Output:


    `;





    try {


        const result = await model.generateContent({


            contents: [{ role: "user", parts: [{ text: prompt }] }],


            generationConfig: jsonGenerationConfig,


        });


        const response = result.response;


        const parsedResponse = JSON.parse(response.text());


        


        // Basic validation for the new structure


        if (!parsedResponse.intent || !parsedResponse.confidence || !parsedResponse.details) {


            throw new Error('Missing core fields in Gemini response for analyzeTranscript');


        }





        return parsedResponse;





    } catch (error) {


        console.error('Error calling Gemini SDK for transcript analysis:', error);


        throw new Error('Failed to analyze transcript with Gemini SDK.');


    }


}

