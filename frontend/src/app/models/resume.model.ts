export interface WorkHistoryItem {
  company: string;
  title: string;
  startDate: string;
  endDate: string;
  description: string;
  highlights: string[];
}

export interface ResumeStructuredData {
  contact: { email: string; phone: string; location: string; linkedin: string };
  workHistory: WorkHistoryItem[];
  education: Array<{ institution: string; degree: string; field: string; graduationYear: string }>;
  skills: string[];
  certifications: string[];
  summary: string;
  transferableSkills?: string[];
  changeMotivation?: string;
  movingToward?: string;
}

export interface Resume {
  id: string;
  user_id: string;
  file_name: string | null;
  raw_text: string | null;
  structured_data: ResumeStructuredData | null;
  is_career_changer: boolean;
  confirmed: boolean;
  parse_status: 'pending' | 'processing' | 'complete' | 'failed';
  parse_error: string | null;
}
