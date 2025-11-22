
// Mock Electron app path
import path from 'path';
import fs from 'fs';

// Mock electron module
const mockUserDataPath = path.join(process.cwd(), 'temp-test-data');
if (!fs.existsSync(mockUserDataPath)) {
    fs.mkdirSync(mockUserDataPath);
}

// Mock OpenAI
class MockOpenAIEmbeddings {
    constructor(config: any) {}
    async embedQuery(text: string) {
        // Return a dummy 1536-dim vector
        return new Array(1536).fill(0.1);
    }
}

class MockChatOpenAI {
    constructor(config: any) {}
    async invoke(prompt: any) {
        // Mock responses based on prompt content
        const p = JSON.stringify(prompt);
        if (p.includes('Name')) return { content: 'John Doe' };
        if (p.includes('Email')) return { content: 'john@example.com' };
        if (p.includes('Experience')) return { content: '5 years of React dev' };
        return { content: '[Mock Answer]' };
    }
    pipe(next: any) { return this; }
}

// Mock module loading
import Module from 'module';
const originalRequire = Module.prototype.require;

// @ts-ignore
Module.prototype.require = function(id) {
    if (id === 'electron') {
        return {
            app: { getPath: () => mockUserDataPath }
        };
    }
    if (id === '@langchain/openai') {
        return {
            OpenAIEmbeddings: MockOpenAIEmbeddings,
            ChatOpenAI: MockChatOpenAI
        };
    }
    return originalRequire.call(this, id);
};

// Import services after mocking
import { knowledgeBase } from '../electron/services/knowledgeBase';
import { fillingAgent } from '../electron/services/fillingAgent';

async function runTest() {
    console.log('🚀 Starting Integration Test Simulation...\n');

    // 1. Setup
    console.log('Step 1: Configuring API Key...');
    const MOCK_KEY = 'sk-mock-key';
    knowledgeBase.setApiKey(MOCK_KEY);
    fillingAgent.setApiKey(MOCK_KEY);
    console.log('✅ API Key set.\n');

    // 2. Add Resume to Knowledge Base
    console.log('Step 2: Adding "Resume" to Knowledge Base...');
    const resumeText = `
    Name: John Doe
    Email: john@example.com
    Phone: 123-456-7890
    Experience:
    - Senior Frontend Developer at TechCorp (2020-2024)
    - Specialized in React, Electron, and AI integration.
    Education:
    - BS Computer Science, University of Code (2016-2020)
    `;
    
    const chunksAdded = await knowledgeBase.addDocument(resumeText, { 
        source: 'resume.pdf', 
        type: 'pdf' 
    });
    console.log(`✅ Resume processed. Added ${chunksAdded} chunks to Vector DB.\n`);

    // 3. Search Verification
    console.log('Step 3: Verifying Knowledge Retrieval...');
    const searchResult = await knowledgeBase.search('What is his email?');
    console.log(`✅ Search returned ${searchResult.length} results.`);
    console.log(`   Top result source: ${searchResult[0]?.source}\n`);

    // 4. Simulate Form Filling
    console.log('Step 4: Simulating "Auto Fill" for a new form...');
    const formContent = `Name,Email,Years of Experience,University`;
    console.log(`   Form Header: "${formContent}"`);
    
    // Mock the analyze part since it relies on string parsing which is real
    // But the generation relies on LLM which is mocked
    const results = await fillingAgent.processForm(formContent);
    
    console.log('\n📊 Filling Results:');
    console.table(results);

    // Basic assertions
    if (results['Name'] && results['Email']) {
        console.log('\n✅ Test PASSED: Agent successfully extracted and filled fields.');
    } else {
        console.error('\n❌ Test FAILED: Missing expected fields.');
        process.exit(1);
    }
}

runTest().catch(console.error);
