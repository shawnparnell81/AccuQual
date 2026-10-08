/** A filled copy is a new record. The template object is not written. */

export interface BuiltTemplate {
  id: number;
  title: string;
  formNumber: string | null;
  revision: string;
  structure: unknown;
}

export interface BuiltFill {
  templateId: number;
  templateRevision: string;
  templateFormNumber: string | null;
  structure: unknown;
  answers: Record<string, unknown>;
}

export function openFillCopy(template: BuiltTemplate): BuiltFill {
  return {
    templateId: template.id,
    templateRevision: template.revision,
    templateFormNumber: template.formNumber,
    structure: JSON.parse(JSON.stringify(template.structure)) as unknown,
    answers: {},
  };
}

export function saveFillAnswers(fill: BuiltFill, answers: Record<string, unknown>): BuiltFill {
  return { ...fill, answers };
}
