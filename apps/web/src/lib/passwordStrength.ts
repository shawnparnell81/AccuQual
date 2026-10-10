export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Too short" | "Weak" | "Fair" | "Strong" | "Very strong";
}

/** A local meter for the temporary password. The server still enforces the real rules. */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < 12) return { score: password.length === 0 ? 0 : 1, label: password.length === 0 ? "Too short" : "Weak" };
  let score = 1;
  if (password.length >= 16) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  const capped = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  const label = capped <= 1 ? "Weak" : capped === 2 ? "Fair" : capped === 3 ? "Strong" : "Very strong";
  return { score: capped, label };
}
