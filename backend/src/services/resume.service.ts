import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { db } from '../db/connection';
import { AppError, Resume, ResumeStructuredData } from '../types';
import { parseResume } from '../ai/resume-parser.chain';

const emptyStructuredData: ResumeStructuredData = {
  contact: { email: '', phone: '', location: '', linkedin: '' },
  workHistory: [],
  education: [],
  skills: [],
  certifications: [],
  summary: ''
};

export class ResumeService {
  /** Standard path: upload a file, extract text, and run it through the AI parser. */
  async uploadAndParse(
    userId: string,
    file: Express.Multer.File,
    isCareerChanger: boolean
  ): Promise<Resume> {
    const [resume] = await db('resumes')
      .insert({
        user_id: userId,
        file_path: file.path,
        file_name: file.originalname,
        mime_type: file.mimetype,
        is_career_changer: isCareerChanger,
        parse_status: 'processing'
      })
      .returning('*')
      .onConflict('user_id')
      .merge(['file_path', 'file_name', 'mime_type', 'is_career_changer', 'parse_status', 'confirmed', 'confirmed_at']);

    try {
      const rawText = await this.extractText(file.path, file.mimetype);
      let structuredData: ResumeStructuredData;

      try {
        structuredData = await parseResume(rawText, isCareerChanger);
      } catch (aiError: any) {
        // Parsing failure shouldn't block the candidate — fall through to manual entry with
        // whatever raw text we have; the confirmation screen lets them fill the rest in by hand.
        const [failed] = await db('resumes')
          .where({ id: resume.id })
          .update({
            raw_text: rawText,
            structured_data: emptyStructuredData,
            parse_status: 'failed',
            parse_error: aiError.message || 'AI parsing failed'
          })
          .returning('*');
        return failed;
      }

      const [updated] = await db('resumes')
        .where({ id: resume.id })
        .update({
          raw_text: rawText,
          structured_data: structuredData,
          parse_status: 'complete',
          parse_error: null
        })
        .returning('*');

      return updated;
    } catch (error: any) {
      const [failed] = await db('resumes')
        .where({ id: resume.id })
        .update({ parse_status: 'failed', parse_error: error.message })
        .returning('*');
      return failed;
    }
  }

  /** Career-changer / no-resume path: start from a blank structured-data skeleton. */
  async startManualEntry(userId: string, isCareerChanger: boolean): Promise<Resume> {
    const [resume] = await db('resumes')
      .insert({
        user_id: userId,
        is_career_changer: isCareerChanger,
        structured_data: emptyStructuredData,
        parse_status: 'complete'
      })
      .returning('*')
      .onConflict('user_id')
      .merge(['is_career_changer', 'structured_data', 'parse_status', 'confirmed', 'confirmed_at']);

    return resume;
  }

  private async extractText(filePath: string, mimeType: string): Promise<string> {
    const buffer = await fs.readFile(filePath);

    if (mimeType === 'application/pdf') {
      const data = await pdfParse(buffer);
      return data.text;
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } else if (mimeType === 'text/plain') {
      return buffer.toString('utf-8');
    }

    throw new Error('Unsupported file type');
  }

  async getResume(userId: string): Promise<Resume | null> {
    return (await db('resumes').where({ user_id: userId }).first()) || null;
  }

  /** Confirmation/correction screen: parser output is never ground truth until this is called. */
  async confirm(userId: string, structuredData: ResumeStructuredData): Promise<Resume> {
    const [resume] = await db('resumes')
      .where({ user_id: userId })
      .update({
        structured_data: structuredData,
        confirmed: true,
        confirmed_at: new Date()
      })
      .returning('*');

    if (!resume) {
      throw new AppError('NOT_FOUND', 'Resume not found', 404);
    }

    return resume;
  }
}
