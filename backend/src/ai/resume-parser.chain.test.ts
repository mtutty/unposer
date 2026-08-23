jest.mock('./llm', () => ({ structuredCall: jest.fn() }));
import { structuredCall } from './llm';
import { parseResume } from './resume-parser.chain';

const mockStructuredCall = structuredCall as jest.Mock;

describe('parseResume', () => {
  beforeEach(() => {
    mockStructuredCall.mockReset();
  });

  it('sends the raw resume text and returns the extracted structured data as-is', async () => {
    const extracted = {
      contact: { email: 'a@b.com', phone: '', location: '', linkedin: '' },
      workHistory: [],
      education: [],
      skills: ['TypeScript'],
      certifications: [],
      summary: 'Backend engineer.'
    };
    mockStructuredCall.mockResolvedValue(extracted);

    const result = await parseResume('Jane Doe\nSoftware Engineer...', false);

    expect(result).toEqual(extracted);
    const [, , human, temperature] = mockStructuredCall.mock.calls[0];
    expect(human).toContain('Jane Doe\nSoftware Engineer...');
    expect(temperature).toBe(0.1);
  });

  it('uses the standard (non-career-changer) system prompt by default', async () => {
    mockStructuredCall.mockResolvedValue({});

    await parseResume('resume text', false);

    const [, system] = mockStructuredCall.mock.calls[0];
    expect(system).toMatch(/do not invent/i);
    expect(system).not.toMatch(/transferable skills/i);
  });

  it('switches to the career-changer system prompt when isCareerChanger is true', async () => {
    mockStructuredCall.mockResolvedValue({});

    await parseResume('resume text', true);

    const [, system] = mockStructuredCall.mock.calls[0];
    expect(system).toMatch(/changing industries or roles/i);
    expect(system).toMatch(/transferable skills/i);
    expect(system).not.toMatch(/do not invent/i);
  });
});
