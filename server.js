const express = require('express');
const OpenAI = require('openai');
const dotenv = require('dotenv');

dotenv.config();

if (!process.env.OPENAI_API_KEY) {
	throw new Error('OPENAI_API_KEY is missing from .env');
}

const app = express();
app.use(express.json({ limit: '2mb' }));

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY
});

app.get('/', (req, res) => {
	res.send('Backend running');
});

app.get('/openai-api-sample', async (req, res) => {
	try {
		const response = await openai.responses.create({
			model: 'gpt-4.1-mini',
			input: 'Write a tiny haiku about ai'
		});

		res.send(response.output_text);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: 'OpenAI request failed' });
	}
});

app.post('/generate-javadocs', async (req, res) => {
	try {
		const { javaSource, methodInfos, model } = req.body;

		if (typeof javaSource !== 'string' || !Array.isArray(methodInfos)) {
			return res.status(400).json({
				error: 'Invalid request body. Expected javaSource:string and methodInfos:array.'
			});
		}

		const prompt = buildMethodDescriptionPrompt(javaSource, methodInfos);

		const response = await openai.responses.create({
			model: model || 'gpt-4.1-mini',
			input: [
				{
					role: 'system',
					content: [
						{
							type: 'input_text',
							text: 'You analyze Java code and produce concise, accurate Javadoc-ready descriptions.'
						}
					]
				},
				{
					role: 'user',
					content: [
						{
							type: 'input_text',
							text: prompt
						}
					]
				}
			],
			text: {
				format: {
					type: 'json_schema',
					name: 'method_docs',
					schema: {
						type: 'object',
						additionalProperties: false,
						properties: {
							items: {
								type: 'array',
								items: {
									type: 'object',
									additionalProperties: false,
									properties: {
										signature: { type: 'string' },
										description: { type: 'string' },
										params: {
											type: 'array',
											items: {
												type: 'object',
												additionalProperties: false,
												properties: {
													name: { type: 'string' },
													description: { type: 'string' }
												},
												required: ['name', 'description']
											}
										},
										returnDescription: { type: ['string', 'null'] },
										throws: {
											type: 'array',
											items: {
												type: 'object',
												additionalProperties: false,
												properties: {
													type: { type: 'string' },
													description: { type: 'string' }
												},
												required: ['type', 'description']
											}
										}
									},
									required: [
										'signature',
										'description',
										'params',
										'returnDescription',
										'throws'
									]
								}
							}
						},
						required: ['items']
					},
					strict: true
				}
			}
		});

		const outputText = response.output_text?.trim();

		if (!outputText) {
			return res.status(500).json({ error: 'OpenAI returned no output_text.' });
		}

		let parsed;
		try {
			parsed = JSON.parse(outputText);
		} catch (err) {
			console.error('Failed to parse OpenAI output_text:', outputText);
			return res.status(500).json({ error: 'Failed to parse model output as JSON.' });
		}

		return res.json(parsed);
	} catch (err) {
		console.error(err);
		return res.status(500).json({
			error: err instanceof Error ? err.message : String(err)
		});
	}
});

app.get('/health', (req, res) => {
	res.json({
		ok: true,
		hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY)
	});
});

app.listen(3000, () => {
	console.log('Server listening on http://localhost:3000');
});

function buildSignature(info) {
	const paramTypes = (info.params || [])
		.map((p) =>
			String(p.type)
				.replace(/\bfinal\s+/g, '')
				.replace(/\s+/g, ' ')
				.replace(/\s*,\s*/g, ',')
				.trim()
		)
		.join(',');

	return `${info.name}(${paramTypes})`;
}

function buildMethodDescriptionPrompt(javaSource, methodInfos) {
	const expectedSignatures = methodInfos.map(buildSignature).join('\n');

	return `
Analyze the Java file below and generate Javadoc-ready descriptions.

Return documentation only for these signatures:
${expectedSignatures}

For each signature, return:
- "description": exactly one concise sentence describing what the method or constructor does
- "params": one item for each parameter, with:
  - "name": the exact parameter name
  - "description": a concise description of that parameter's purpose
- "returnDescription": a concise description of the return value, or null if the method is a constructor or returns void
- "throws": one item for each declared exception, with:
  - "type": the exact declared exception type
  - "description": a concise explanation of when it is thrown

Rules:
- Use the full Java file for context.
- Be factual and specific.
- Do not include markdown.
- Preserve the exact signature text.
- Include every listed signature exactly once.
- If a method has no parameters, return an empty params array.
- If a method declares no exceptions, return an empty throws array.

Java file:
\`\`\`java
${javaSource}
\`\`\`
`.trim();
}
