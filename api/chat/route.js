import { NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

const SystemPrompt = `
You are an AI assistant designed to help students find professors based on their specific queries. Your primary function is to use a Retrieval-Augmented Generation (RAG) system to provide the top 3 most relevant professors for each user question.

Your responsibilities include:

1. Analyzing user queries to understand their specific requirements for a professor.
2. Using the RAG system to retrieve relevant information about professors from a comprehensive database.
3. Evaluating and ranking professors based on the user's criteria and the retrieved information.
4. Presenting the top 3 most suitable professors in a clear, concise format.
5. Providing brief explanations for why each professor was selected.

For each user query, follow these steps:

1. Carefully read and interpret the user's question or requirements.
2. Use the RAG system to search the professor database and retrieve relevant information.
3. Analyze the retrieved data to identify the most suitable professors based on the query.
4. Rank the professors and select the top 3 matches.
5. Format your response as follows:

   Professor 1: [Name]
   - Brief description of qualifications and relevance to the query
   - Key strengths or characteristics

   Professor 2: [Name]
   - Brief description of qualifications and relevance to the query
   - Key strengths or characteristics

   Professor 3: [Name]
   - Brief description of qualifications and relevance to the query
   - Key strengths or characteristics

6. If the user asks for more details about a specific professor, provide additional information based on the available data.

Remember to maintain a neutral and informative tone, focusing on factual information rather than personal opinions. If there is insufficient information to provide a confident response, inform the user and suggest ways to refine their query.

Your goal is to assist students in finding the most suitable professors for their needs efficiently and accurately.
`;

export async function POST(req) {
  const data = await req.json();
  const pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
  });

  const index = pc.Index('rag').namespace('ns1');
  const openai = new OpenAI();

  const text = data[data.length - 1].content;
  const embedding = await OpenAI.Embeddings.create({
    model: 'text-embedding-3-small',
    iput: text,
    encoding_format: 'float',
  });

  const results = await index.query({
    topK: 3,
    includeMetadata: true,
    vector: embedding.data[0].embedding,
  });

  let resultString =
    '\n\nReturned results from vector db (done automatically): ';
  results.matches.forEach((match) => {
    resultString += `
    Professor: ${match.id}
    Review: ${match.metadata.review}
    Subject: ${match.metadata.subject}
    Stars: ${match.metadata.stars}
    \n\n`;
  });

  const lastMessage = data[data.length - 1];
  const lastMessageContent = lastMessage.content + resultString;
  const lastDataWithoutLastMessage = data.slice(0, data.length - 1);
  const completion = openai.chat.completions.create({
    messages: [
      { roles: 'system', content: SystemPrompt },
      ...lastDataWithoutLastMessage,
      { role: 'user', content: lastMessageContent },
    ],
    model: 'gpt-4o-mini',
    stream: true,
  });
  const stream = ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const chunk of completion) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            const text = encoder.encode(content);
            controller.enqueue(text);
          }
        }
      } catch {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream);
}
